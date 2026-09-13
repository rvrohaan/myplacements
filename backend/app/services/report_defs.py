"""The reports themselves (spec §7).

Each builder returns a :class:`Report`, which the router renders either as JSON
for the screen or as an .xlsx for the file. Business rules live here rather than
in the router so the two renderings can never drift apart.

A note on the placement figures throughout: they count **students**, each at the
package they ended up on, not offers. The Offers analytics tab counts offers —
a student holding three appears three times there. Anything a college quotes
externally is a student count, so that is what these reports use.
"""

import json
import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Callable, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.timeutil import overdue_before
from app.models.college import College
from app.models.communication import Communication
from app.models.company import Company, CompanyStatus, HRContact
from app.models.drive import Drive, DriveParticipant, DriveStatus
from app.models.insight import DashboardInsight
from app.models.offer import Offer, OfferStatus
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.student import PlacementStatus, RiskCategory, Student
from app.models.training import StudentTraining, TrainingModule
from app.models.user import User
from app.services import monthly
from app.services.hr_engagement import NO_RESPONSE, RESPONDED, score_many
from app.services.report_builder import Report, Section

# Thresholds come from the analytics router rather than being redefined, so a
# report and the dashboard quoting the same word ("overdue", "active") cannot
# drift apart. Same reason services/daily_metrics.py imports them.
from app.routers.analytics import (
    ACTIVE_WITHIN_DAYS,
    OPEN_ASSIGNMENT_STATUSES,
    STALE_AFTER_DAYS,
    WON_OFFER_STATUSES,
    _month_key,
    _recent_months,
)

# Offer states that mean the student actually has the job. Mirrors
# analytics.WON_OFFER_STATUSES and services.placement.LIVE_STATUSES.
LIVE_OFFERS = (OfferStatus.ACCEPTED, OfferStatus.JOINED)

#: Cache scope for a month's write-up, in the shared dashboard_insights table.
MONTHLY_SCOPE = "monthly"


def _college_name(db: Session, user: User) -> str:
    if not user.college_id:
        return "All colleges"
    college = db.query(College).filter(College.id == user.college_id).first()
    return college.name if college else "This college"


def _students(db: Session, user: User, batch_year: Optional[int] = None):
    q = db.query(Student)
    if user.college_id:
        q = q.filter(Student.college_id == user.college_id)
    if batch_year:
        q = q.filter(Student.batch_year == batch_year)
    return q


def _resolve_batch(db: Session, user: User, params: dict) -> tuple[Optional[int], bool]:
    """Which batch a report covers: one year, or all of them.

    Three states, and they have to stay distinguishable:

    ``batch_year=2026``   that batch.
    ``all_batches=true``  every batch pooled — returns ``(None, True)``.
    neither               the newest batch, which is what the picker calls
                          "Latest batch".

    The last two both end up with no year to filter on, so the flag is returned
    alongside rather than inferred from ``year is None`` — otherwise an empty
    college and a deliberate college-wide request would be the same value, and
    the report would quietly claim to cover everything while covering nothing.
    """
    if params.get("all_batches"):
        return None, True
    raw = params.get("batch_year")
    if raw:
        return int(raw), False
    years = _batch_years(db, user)
    return (years[0] if years else None), False


def _batch_label(year: Optional[int], all_batches: bool) -> Optional[str]:
    """The subtitle under the report title: "2026 batch" or "All batches"."""
    if all_batches:
        return "All batches"
    return f"{year} batch" if year else None


def _batch_meta(year: Optional[int], all_batches: bool) -> str:
    """The Batch row in the meta block. Bare, because the row is already
    labelled "Batch" — "Batch: 2026 batch" reads as a stutter."""
    if all_batches:
        return "All batches"
    return str(year) if year else "—"


def _pooled_caveat(db: Session, user: User, all_batches: bool) -> list[str]:
    """Said out loud whenever batches are pooled.

    A placement rate across batches is not a rate anybody should quote: the
    newest batch is usually still in progress, so pooling it with finished years
    drags every percentage down and the report looks like a bad year rather than
    an unfinished one. The counts and packages pool fine; the percentages do not.
    """
    if not all_batches:
        return []
    years = _batch_years(db, user)
    if not years:
        return []
    span = f"{years[-1]}-{years[0]}" if len(years) > 1 else str(years[0])
    return [
        f"Every batch on file is pooled here ({span}). Counts and packages add up across "
        "years, but a placement percentage does not: the newest batch is usually still in "
        "progress, which drags the combined rate below any single year's. Pick one batch "
        "before quoting a rate."
    ]


def _batch_years(db: Session, user: User) -> list[int]:
    q = db.query(Student.batch_year).distinct()
    if user.college_id:
        q = q.filter(Student.college_id == user.college_id)
    return sorted({r[0] for r in q.all() if r[0]}, reverse=True)


def _median(values: list[float]) -> Optional[float]:
    return round(statistics.median(values), 2) if values else None


def _pct(part: int, whole: int) -> Optional[float]:
    return round(part * 100 / whole, 1) if whole else None


def _meta(db: Session, user: User, extra: list[tuple[str, str]]) -> list[tuple[str, str]]:
    return [
        ("College", _college_name(db, user)),
        *extra,
        ("Generated", datetime.utcnow().strftime("%d %b %Y, %H:%M UTC")),
        ("Generated by", user.full_name or user.email),
    ]


# --- shared per-cohort arithmetic -------------------------------------------


class _Cohort:
    """One batch year's students, and the figures a placement report quotes.

    ``batch_year=None`` pools every batch — the college-wide view. Pooling is
    only meaningful for counts and packages; a placement *rate* across batches
    mixes a finished year with one still in progress, so the reports that quote
    one say which years they pooled.
    """

    def __init__(self, db: Session, user: User, batch_year: Optional[int] = None):
        self.batch_year = batch_year
        self.rows = (
            _students(db, user, batch_year)
            .with_entities(
                Student.id, Student.branch, Student.placement_status,
                Student.placement_ctc, Student.cgpa,
            )
            .all()
        )
        self.total = len(self.rows)
        self.placed = [r for r in self.rows if r.placement_status == PlacementStatus.PLACED]
        self.higher_studies = [
            r for r in self.rows if r.placement_status == PlacementStatus.HIGHER_STUDIES
        ]
        self.opted_out = [r for r in self.rows if r.placement_status == PlacementStatus.OPTED_OUT]
        self.seeking = [r for r in self.rows if r.placement_status == PlacementStatus.UNPLACED]
        self.packages = [r.placement_ctc for r in self.placed if r.placement_ctc is not None]

    @property
    def median_package(self) -> Optional[float]:
        return _median(self.packages)

    @property
    def highest_package(self) -> Optional[float]:
        return round(max(self.packages), 2) if self.packages else None

    @property
    def average_package(self) -> Optional[float]:
        return round(sum(self.packages) / len(self.packages), 2) if self.packages else None

    @property
    def placement_rate(self) -> Optional[float]:
        return _pct(len(self.placed), self.total)


def _joined_count(db: Session, user: User, batch_year: int) -> int:
    """Students with an offer recorded as joined — the figure that matters for
    accreditation, where an accepted offer nobody turned up for doesn't count."""
    q = (
        db.query(Offer.student_id)
        .join(Student, Offer.student_id == Student.id)
        .filter(Offer.status == OfferStatus.JOINED, Student.batch_year == batch_year)
    )
    if user.college_id:
        q = q.filter(Student.college_id == user.college_id)
    return len({r[0] for r in q.all()})


def _recruiters(db: Session, user: User, batch_year: int) -> int:
    """Distinct companies that made an offer to this batch."""
    q = (
        db.query(Offer.company_id)
        .join(Student, Offer.student_id == Student.id)
        .filter(Offer.company_id.isnot(None), Student.batch_year == batch_year)
    )
    if user.college_id:
        q = q.filter(Student.college_id == user.college_id)
    return len({r[0] for r in q.all()})


# --- 1. Accreditation evidence ----------------------------------------------


def placement_evidence(db: Session, user: User, params: dict) -> Report:
    """The year-wise placement figures an NBA / NAAC / NIRF submission is built
    from: cohort size, placed, progression to higher study, median package."""
    years_wanted = int(params.get("years") or 3)
    years = _batch_years(db, user)[:years_wanted]

    summary_rows = []
    for year in years:
        c = _Cohort(db, user, year)
        summary_rows.append([
            year, c.total, len(c.placed), len(c.higher_studies), len(c.opted_out),
            len(c.seeking), c.placement_rate, c.median_package, c.average_package,
            c.highest_package, _joined_count(db, user, year), _recruiters(db, user, year),
        ])

    sections = [
        Section(
            heading="Placement and higher study, by graduating batch",
            note=(
                "One row per student, counted at the package they ended up on. "
                "Median is over placed students with a package on record."
            ),
            columns=[
                "Batch", "Students on file", "Placed", "Higher studies", "Opted out",
                "Still seeking", "Placement %", "Median (LPA)", "Average (LPA)",
                "Highest (LPA)", "Joined (confirmed)", "Recruiters",
            ],
            rows=summary_rows,
        )
    ]

    # Branch-wise for the most recent batch — the breakdown every submission
    # asks for programme by programme.
    if years:
        latest = years[0]
        cohort = _Cohort(db, user, latest)
        by_branch: dict[str, dict] = {}
        for r in cohort.rows:
            branch = (r.branch or "Unrecorded").strip() or "Unrecorded"
            b = by_branch.setdefault(branch, {"total": 0, "placed": 0, "higher": 0, "packages": []})
            b["total"] += 1
            if r.placement_status == PlacementStatus.PLACED:
                b["placed"] += 1
                if r.placement_ctc is not None:
                    b["packages"].append(r.placement_ctc)
            elif r.placement_status == PlacementStatus.HIGHER_STUDIES:
                b["higher"] += 1
        rows = [
            [name, v["total"], v["placed"], v["higher"], _pct(v["placed"], v["total"]),
             _median(v["packages"]), round(max(v["packages"]), 2) if v["packages"] else None]
            for name, v in sorted(by_branch.items(), key=lambda kv: kv[0].lower())
        ]
        sections.append(Section(
            heading=f"Branch-wise, {latest} batch",
            columns=["Branch", "Students", "Placed", "Higher studies", "Placement %",
                     "Median (LPA)", "Highest (LPA)"],
            rows=rows,
            total_row=["All branches", cohort.total, len(cohort.placed),
                       len(cohort.higher_studies), cohort.placement_rate,
                       cohort.median_package, cohort.highest_package],
        ))

    return Report(
        id="placement-evidence",
        title="Placement evidence",
        subtitle="Year-wise placement and progression figures for accreditation",
        meta=_meta(db, user, [("Batches covered", ", ".join(str(y) for y in years) or "—")]),
        sections=sections,
        caveats=[
            "These are the underlying figures, not a filled-in submission form. NBA, NAAC and "
            "NIRF each ask for them in their own template and their own window, and those "
            "change between cycles — map these numbers into the form your cycle asks for.",
            "\"Students on file\" counts the student records this system holds for the batch. "
            "If a cohort was admitted but never imported, it is not in this denominator, and "
            "the placement percentage will read high.",
            "\"Placed\" is the student's recorded placement status. \"Joined (confirmed)\" counts "
            "only students with an offer marked joined, which is the stricter figure and the "
            "one worth quoting where a form distinguishes them.",
            "Median and average cover placed students who have a package recorded; a placement "
            "logged without a package is counted as placed but not in the money columns.",
        ],
    )


# --- 2. Branch-wise placement -----------------------------------------------


def branch_wise(db: Session, user: User, params: dict) -> Report:
    year, all_batches = _resolve_batch(db, user, params)
    if year is None and not all_batches:
        return Report(id="branch-wise", title="Branch-wise placement",
                      meta=_meta(db, user, []), sections=[],
                      caveats=["No students on file yet."])

    cohort = _Cohort(db, user, year)
    by_branch: dict[str, dict] = {}
    for r in cohort.rows:
        branch = (r.branch or "Unrecorded").strip() or "Unrecorded"
        b = by_branch.setdefault(
            branch, {"total": 0, "placed": 0, "higher": 0, "seeking": 0, "packages": []}
        )
        b["total"] += 1
        if r.placement_status == PlacementStatus.PLACED:
            b["placed"] += 1
            if r.placement_ctc is not None:
                b["packages"].append(r.placement_ctc)
        elif r.placement_status == PlacementStatus.HIGHER_STUDIES:
            b["higher"] += 1
        elif r.placement_status == PlacementStatus.UNPLACED:
            b["seeking"] += 1

    rows = [
        [name, v["total"], v["placed"], v["seeking"], v["higher"],
         _pct(v["placed"], v["total"]), _median(v["packages"]),
         round(max(v["packages"]), 2) if v["packages"] else None]
        for name, v in sorted(by_branch.items(), key=lambda kv: -kv[1]["placed"])
    ]
    return Report(
        id="branch-wise",
        title="Branch-wise placement",
        subtitle=_batch_label(year, all_batches),
        meta=_meta(db, user, [("Batch", _batch_meta(year, all_batches))]),
        sections=[Section(
            heading="By branch, best placed first",
            columns=["Branch", "Students", "Placed", "Still seeking", "Higher studies",
                     "Placement %", "Median (LPA)", "Highest (LPA)"],
            rows=rows,
            total_row=["All branches", cohort.total, len(cohort.placed), len(cohort.seeking),
                       len(cohort.higher_studies), cohort.placement_rate,
                       cohort.median_package, cohort.highest_package],
        )],
        caveats=[
            "A percentage over a handful of students moves a long way on one placement — read "
            "the count beside it before comparing branches.",
            "Students who opted out are in the total but in none of the outcome columns, so "
            "the three outcome columns need not sum to the total.",
            *_pooled_caveat(db, user, all_batches),
        ],
    )


# --- 3. CTC analysis ---------------------------------------------------------


def ctc_analysis(db: Session, user: User, params: dict) -> Report:
    year, all_batches = _resolve_batch(db, user, params)
    cohort = _Cohort(db, user, year) if (year or all_batches) else None

    bands = [("20 LPA and above", 20.0, None), ("15–20 LPA", 15.0, 20.0),
             ("10–15 LPA", 10.0, 15.0), ("5–10 LPA", 5.0, 10.0), ("Below 5 LPA", None, 5.0)]
    band_rows = []
    if cohort:
        for label, lo, hi in bands:
            count = sum(
                1 for p in cohort.packages
                if (lo is None or p >= lo) and (hi is None or p < hi)
            )
            band_rows.append([label, count, _pct(count, len(cohort.packages))])
        missing = len(cohort.placed) - len(cohort.packages)
        if missing:
            band_rows.append(["Package not recorded", missing, None])

    # Per-offer view: what companies actually offered this batch, which is a
    # different question from what each student ended up on.
    offer_q = (
        db.query(Offer.ctc, Company.name)
        .join(Student, Offer.student_id == Student.id)
        .outerjoin(Company, Offer.company_id == Company.id)
        .filter(Offer.status.in_(LIVE_OFFERS), Offer.ctc.isnot(None))
    )
    if user.college_id:
        offer_q = offer_q.filter(Student.college_id == user.college_id)
    if year:
        offer_q = offer_q.filter(Student.batch_year == year)
    # all_batches deliberately adds no filter: every batch's offers belong here.
    offers = offer_q.all()
    by_company: dict[str, list[float]] = {}
    for ctc, name in offers:
        by_company.setdefault(name or "Not recorded", []).append(ctc)
    company_rows = sorted(
        ([name, len(v), _median(v), round(max(v), 2)] for name, v in by_company.items()),
        key=lambda r: (-(r[3] or 0), r[0].lower()),
    )[:15]

    sections = [
        Section(
            heading="Packages by band",
            note="One row per placed student, at their recorded package.",
            columns=["Band", "Students", "Share of placed with a package"],
            rows=band_rows,
        ),
        Section(
            heading="By company, highest first",
            note=(
                "Live offers only (accepted or joined), counted per offer — a student holding "
                "two appears twice. Top 15 by highest package."
            ),
            columns=["Company", "Live offers", "Median (LPA)", "Highest (LPA)"],
            rows=company_rows,
        ),
    ]
    summary = []
    if cohort:
        summary = [("Placed students", str(len(cohort.placed))),
                   ("With a package recorded", str(len(cohort.packages))),
                   ("Median", f"{cohort.median_package} LPA" if cohort.median_package else "—"),
                   ("Average", f"{cohort.average_package} LPA" if cohort.average_package else "—"),
                   ("Highest", f"{cohort.highest_package} LPA" if cohort.highest_package else "—")]

    return Report(
        id="ctc-analysis",
        title="CTC analysis",
        subtitle=_batch_label(year, all_batches),
        meta=_meta(db, user, [("Batch", _batch_meta(year, all_batches)), *summary]),
        sections=sections,
        caveats=[
            "The two tables count different things on purpose: the bands count students, the "
            "company table counts offers. A student with two live offers is one student and "
            "two offers.",
            "An average package is pulled up by a single large offer far more than a median is. "
            "Quote the median unless you mean the average.",
            *_pooled_caveat(db, user, all_batches),
        ],
    )


# --- 4. Unplaced / at-risk students -----------------------------------------


def unplaced_risk(db: Session, user: User, params: dict) -> Report:
    year, all_batches = _resolve_batch(db, user, params)

    q = _students(db, user, year).filter(Student.placement_status == PlacementStatus.UNPLACED)
    students = q.all()
    # Highest risk first, then lowest readiness: the order to work the list in.
    rank = {RiskCategory.HIGH: 0, RiskCategory.MEDIUM: 1, RiskCategory.LOW: 2}
    students.sort(key=lambda s: (rank.get(s.risk_category, 1), s.readiness_score or 0))

    rows = [
        [s.roll_number, s.full_name or "—", s.branch, s.cgpa, s.backlogs,
         (s.risk_category.value if s.risk_category else "—"), s.readiness_score,
         (s.skills or "").strip() or "None recorded"]
        for s in students
    ]
    by_branch: dict[str, int] = {}
    for s in students:
        by_branch[(s.branch or "Unrecorded").strip() or "Unrecorded"] = (
            by_branch.get((s.branch or "Unrecorded").strip() or "Unrecorded", 0) + 1
        )

    return Report(
        id="unplaced-risk",
        title="Students still seeking",
        subtitle=_batch_label(year, all_batches),
        meta=_meta(db, user, [("Batch", _batch_meta(year, all_batches)),
                              ("Still seeking", str(len(students)))]),
        sections=[
            Section(
                heading="Where they are",
                columns=["Branch", "Still seeking"],
                rows=sorted(([k, v] for k, v in by_branch.items()), key=lambda r: -r[1]),
                total_row=["All branches", len(students)],
            ),
            Section(
                heading="The list, highest risk first",
                note="Work order: risk band, then readiness score within the band.",
                columns=["Roll no", "Name", "Branch", "CGPA", "Backlogs", "Risk",
                         "Readiness", "Skills on file"],
                rows=rows,
            ),
        ],
        caveats=[
            "Risk and readiness are the rule-based score in services/student_scoring.py — "
            "CGPA, backlogs and the number of skills listed. It is a triage order, not a "
            "prediction, and it knows nothing about interviews already attended.",
            "Students who opted out or declared higher studies are not here; this is the list "
            "of people still looking.",
            *_pooled_caveat(db, user, all_batches),
        ],
    )


# --- 5. Training effectiveness ----------------------------------------------


def training_effectiveness(db: Session, user: User, params: dict) -> Report:
    batch_year = params.get("batch_year")
    batch_year = int(batch_year) if batch_year else None

    student_rows = _students(db, user, batch_year).with_entities(
        Student.id, Student.placement_status
    ).all()
    placed_ids = {r.id for r in student_rows if r.placement_status == PlacementStatus.PLACED}
    student_ids = {r.id for r in student_rows}

    modules = db.query(TrainingModule)
    if user.college_id:
        modules = modules.filter(TrainingModule.college_id == user.college_id)
    modules = modules.all()

    records = (
        db.query(
            StudentTraining.module_id, StudentTraining.student_id, StudentTraining.score,
            StudentTraining.attendance_percent, StudentTraining.mock_test_score,
            StudentTraining.status,
        )
        .filter(StudentTraining.student_id.in_(student_ids))
        .all()
    ) if student_ids else []

    per_module: dict[int, list] = {}
    for r in records:
        per_module.setdefault(r.module_id, []).append(r)

    def avg(values: list[float]) -> Optional[float]:
        vals = [v for v in values if v is not None]
        return round(sum(vals) / len(vals), 1) if vals else None

    module_rows = []
    for m in modules:
        rs = per_module.get(m.id, [])
        enrolled_ids = {r.student_id for r in rs}
        module_rows.append([
            m.name, m.category or "—", len(rs),
            sum(1 for r in rs if r.status == "completed"),
            avg([r.attendance_percent for r in rs]),
            avg([r.score for r in rs]),
            avg([r.mock_test_score for r in rs]),
            _pct(len(enrolled_ids & placed_ids), len(enrolled_ids)),
        ])
    module_rows.sort(key=lambda r: -r[2])

    trained_ids = {r.student_id for r in records}
    untrained_ids = student_ids - trained_ids
    comparison = [
        ["Attended at least one module", len(trained_ids),
         len(trained_ids & placed_ids), _pct(len(trained_ids & placed_ids), len(trained_ids))],
        ["Attended none", len(untrained_ids), len(untrained_ids & placed_ids),
         _pct(len(untrained_ids & placed_ids), len(untrained_ids))],
    ]

    return Report(
        id="training-effectiveness",
        title="Training effectiveness",
        subtitle=f"{batch_year} batch" if batch_year else "All batches",
        meta=_meta(db, user, [("Batch", str(batch_year) if batch_year else "All"),
                              ("Modules", str(len(modules)))]),
        sections=[
            Section(
                heading="By module",
                columns=["Module", "Category", "Enrolments", "Completed", "Avg attendance %",
                         "Avg score", "Avg mock score", "Placement % of those enrolled"],
                rows=module_rows,
            ),
            Section(
                heading="Trained against untrained",
                columns=["Group", "Students", "Placed", "Placement %"],
                rows=comparison,
            ),
        ],
        caveats=[
            "This is a correlation and cannot show cause. The students who enrol for training "
            "are rarely a random sample of the year — they are often the ones already most "
            "engaged in placement, which would raise their rate with or without the training.",
            "A module whose enrolment is small will show a placement percentage that swings "
            "wildly on one student. Read the enrolment count beside it.",
        ],
    )


# --- 6. Officer follow-up ----------------------------------------------------


def _officer_rows(db: Session, user: User):
    """The per-officer figures shared by the follow-up report.

    Outreach is credited only to the officer stamped on the log — a head logging
    a call themselves belongs to nobody, and crediting it to the company's owner
    would flatter an officer who did not make it. Same rule as
    /analytics/officer-performance, deliberately.
    """
    now = datetime.utcnow()
    late_before = overdue_before()
    recent_cutoff = now - timedelta(days=STALE_AFTER_DAYS)
    active_cutoff = now - timedelta(days=ACTIVE_WITHIN_DAYS)

    officers_q = db.query(PlacementOfficer)
    if user.college_id:
        officers_q = officers_q.filter(PlacementOfficer.college_id == user.college_id)
    officers = officers_q.all()
    officer_ids = [o.id for o in officers]
    officer_id_set = set(officer_ids)

    assignments = (
        db.query(CompanyAssignment.officer_id, CompanyAssignment.company_id,
                 CompanyAssignment.status)
        .filter(CompanyAssignment.officer_id.in_(officer_ids)).all()
        if officer_ids else []
    )
    company_owner = {a.company_id: a.officer_id for a in assignments}
    assigned: dict[int, int] = defaultdict(int)
    open_work: dict[int, int] = defaultdict(int)
    for a in assignments:
        assigned[a.officer_id] += 1
        if (a.status or "active") in OPEN_ASSIGNMENT_STATUSES:
            open_work[a.officer_id] += 1

    comms = (
        db.query(Communication.officer_id, Communication.communicated_at,
                 Communication.next_followup_date, Communication.response_received)
        .filter(Communication.officer_id.in_(officer_ids)).all()
        if officer_ids else []
    )
    logged: dict[int, int] = defaultdict(int)
    recent: dict[int, int] = defaultdict(int)
    replied: dict[int, int] = defaultdict(int)
    pending: dict[int, int] = defaultdict(int)
    overdue: dict[int, int] = defaultdict(int)
    last_seen: dict[int, datetime] = {}
    for c in comms:
        if c.officer_id not in officer_id_set:
            continue
        logged[c.officer_id] += 1
        if (c.response_received or "") == RESPONDED:
            replied[c.officer_id] += 1
        if c.communicated_at:
            if c.communicated_at >= recent_cutoff:
                recent[c.officer_id] += 1
            if c.officer_id not in last_seen or c.communicated_at > last_seen[c.officer_id]:
                last_seen[c.officer_id] = c.communicated_at
        # A follow-up that has already been answered is not still owed.
        if c.next_followup_date and (c.response_received or "") != RESPONDED:
            pending[c.officer_id] += 1
            if c.next_followup_date < late_before:
                overdue[c.officer_id] += 1

    company_ids = list(company_owner.keys())
    drives = (
        db.query(Drive.id, Drive.company_id).filter(Drive.company_id.in_(company_ids)).all()
        if company_ids else []
    )
    drive_owner = {d.id: company_owner.get(d.company_id) for d in drives}
    drives_run: dict[int, int] = defaultdict(int)
    for d in drives:
        owner = company_owner.get(d.company_id)
        if owner is not None:
            drives_run[owner] += 1

    offers = (
        db.query(Offer.drive_id, Offer.company_id, Offer.status, Offer.student_id).filter(
            or_(Offer.drive_id.in_(list(drive_owner.keys()) or [0]),
                Offer.company_id.in_(company_ids or [0]))
        ).all()
        if company_ids else []
    )
    offers_won: dict[int, int] = defaultdict(int)
    placed: dict[int, set] = defaultdict(set)
    for o in offers:
        owner = company_owner.get(o.company_id) or drive_owner.get(o.drive_id)
        if owner is None or o.status not in WON_OFFER_STATUSES:
            continue
        offers_won[owner] += 1
        placed[owner].add(o.student_id)

    def activity(officer_id: int) -> str:
        when = last_seen.get(officer_id)
        if when is None:
            return "no activity logged"
        if when >= active_cutoff:
            return "active"
        if when >= recent_cutoff:
            return "slowing"
        return "idle"

    rows = []
    for o in officers:
        name = o.user.full_name if o.user else f"Officer #{o.id}"
        total_logged = logged.get(o.id, 0)
        rows.append({
            "name": name,
            "region": o.region or "—",
            "assigned": assigned.get(o.id, 0),
            "open": open_work.get(o.id, 0),
            "logged": total_logged,
            "recent": recent.get(o.id, 0),
            "reply_rate": _pct(replied.get(o.id, 0), total_logged),
            "pending": pending.get(o.id, 0),
            "overdue": overdue.get(o.id, 0),
            "drives": drives_run.get(o.id, 0),
            "offers_won": offers_won.get(o.id, 0),
            "placed": len(placed.get(o.id, set())),
            "target_companies": o.target_companies or 0,
            "target_offers": o.target_offers or 0,
            "last_activity": last_seen.get(o.id),
            "activity": activity(o.id),
        })
    rows.sort(key=lambda r: (-r["overdue"], -r["pending"], r["name"]))
    return rows, company_owner


def officer_followup(db: Session, user: User, params: dict) -> Report:
    rows, company_owner = _officer_rows(db, user)

    followup_rows = [
        [r["name"], r["region"], r["assigned"], r["open"], r["pending"], r["overdue"],
         r["recent"], r["reply_rate"],
         r["last_activity"].strftime("%d %b %Y") if r["last_activity"] else None,
         r["activity"]]
        for r in rows
    ]
    delivery_rows = [
        [r["name"], r["assigned"], r["target_companies"],
         _pct(r["assigned"], r["target_companies"]),
         r["drives"], r["offers_won"], r["target_offers"],
         _pct(r["offers_won"], r["target_offers"]), r["placed"]]
        for r in sorted(rows, key=lambda r: (-r["offers_won"], r["name"]))
    ]

    # Work nobody owns, so the gap is visible beside the people who do own some.
    unowned_q = db.query(Company).filter(
        Company.status.notin_((CompanyStatus.BLACKLISTED, CompanyStatus.DORMANT))
    )
    if user.college_id:
        unowned_q = unowned_q.filter(Company.college_id == user.college_id)
    if company_owner:
        unowned_q = unowned_q.filter(Company.id.notin_(list(company_owner.keys())))
    unowned = unowned_q.count()

    return Report(
        id="officer-followup",
        title="Officer follow-up",
        subtitle="Outreach owed, and what each officer has landed",
        meta=_meta(db, user, [("Officers", str(len(rows))),
                              ("Companies with no owner", str(unowned))]),
        sections=[
            Section(
                heading="Follow-ups owed, most overdue first",
                note=f"\"Recent\" means the last {STALE_AFTER_DAYS} days; \"active\" means "
                     f"something logged inside {ACTIVE_WITHIN_DAYS}.",
                columns=["Officer", "Region", "Companies", "Open", "Follow-ups pending",
                         "Overdue", "Logged recently", "Reply rate %", "Last activity",
                         "Status"],
                rows=followup_rows,
            ),
            Section(
                heading="Against target",
                columns=["Officer", "Companies", "Target", "% of target", "Drives",
                         "Offers won", "Offer target", "% of target", "Students placed"],
                rows=delivery_rows,
            ),
        ],
        caveats=[
            "Outreach counts only against the officer stamped on the log. A call a head logged "
            "themselves belongs to nobody and appears in no officer's row — it is not added to "
            "the company owner's count, which would credit them with work they did not do.",
            "A follow-up already answered is not counted as owed, however old the date on it.",
            "An officer with no target set shows a blank percentage rather than 0% — no target "
            "is not the same as no progress.",
        ],
    )


# --- 7. Company conversion ---------------------------------------------------


def company_conversion(db: Session, user: User, params: dict) -> Report:
    """How far each company got: contacted, ran a drive, made an offer, placed
    somebody. The funnel every placement head is asked about.

    The arithmetic is services/company_metrics.py, shared with the Company
    Analytics tab — the report and the chart must not be able to disagree about
    what "contacted" means.
    """
    from app.services.company_metrics import company_rows, funnel as company_funnel

    rows = company_rows(db, user)
    table = sorted(
        rows,
        key=lambda r: (-len(r.placed), -r.offers, -r.logged, r.name.lower()),
    )
    company_table = [
        [r.name, r.status, r.owner, r.logged, r.replied, r.reply_rate, r.drives,
         r.offers, len(r.placed), _median(r.packages),
         r.last_contact.strftime("%d %b %Y") if r.last_contact else None]
        for r in table
    ]

    stages = company_funnel(rows)
    total = len(rows)
    funnel_rows = [
        [stage, count, (None if i == 0 else _pct(count, total))]
        for i, (stage, count) in enumerate(stages)
    ]
    placed_someone = stages[-1][1] if stages else 0

    return Report(
        id="company-conversion",
        title="Company conversion",
        subtitle="How far each company got, from first contact to a placement",
        meta=_meta(db, user, [("Companies", str(total)),
                              ("Placed at least one", str(placed_someone))]),
        sections=[
            Section(
                heading="The funnel",
                note="Each stage is a subset of the one above it. The percentage is of every "
                     "company on file, not of the stage above.",
                columns=["Stage", "Companies", "% of all companies"],
                rows=funnel_rows,
            ),
            Section(
                heading="By company, best converted first",
                columns=["Company", "Status", "Owner", "Logged", "Replies", "Reply rate %",
                         "Drives", "Offers", "Students placed", "Median (LPA)",
                         "Last contact"],
                rows=company_table,
            ),
        ],
        caveats=[
            "A company with no logged outreach reads as never contacted. If an officer emails "
            "without logging it, this report cannot tell the difference — the gap is in the "
            "log, not the relationship.",
            "Reply rate counts logs explicitly marked as answered. Entries still awaiting a "
            "reply sit in the denominator, so a company contacted this morning will show a low "
            "rate until the outcome is recorded.",
            "Blacklisted and dormant companies are included here; filter them out mentally when "
            "reading the funnel as a target list.",
        ],
    )


# --- 8. HR communication -----------------------------------------------------


def hr_communication(db: Session, user: User, params: dict) -> Report:
    contacts_q = (
        db.query(HRContact, Company.name)
        .join(Company, HRContact.company_id == Company.id)
    )
    if user.college_id:
        contacts_q = contacts_q.filter(Company.college_id == user.college_id)
    pairs = contacts_q.all()
    contacts = [c for c, _ in pairs]
    company_of = {c.id: name for c, name in pairs}
    contact_ids = [c.id for c in contacts]

    comms = (
        db.query(Communication)
        .filter(Communication.hr_contact_id.in_(contact_ids)).all()
        if contact_ids else []
    )
    by_contact: dict[int, list] = defaultdict(list)
    for c in comms:
        by_contact[c.hr_contact_id].append(c)
    scores = score_many(dict(by_contact))

    now = datetime.utcnow()
    rows = []
    for contact in contacts:
        s = scores.get(contact.id)
        overdue = (
            contact.next_followup_date is not None
            and contact.next_followup_date < overdue_before()
        )
        rows.append([
            company_of.get(contact.id, "—"), contact.name, contact.designation or "—",
            s["total_logged"] if s else 0,
            s["replied"] if s else 0,
            _pct(s["replied"], s["total_logged"]) if s and s["total_logged"] else None,
            s["band"] if s else "no history",
            contact.relationship_strength,
            s["days_since_contact"] if s else None,
            contact.next_followup_date.strftime("%d %b %Y") if contact.next_followup_date else None,
            "overdue" if overdue else "",
            (contact.next_action or "").strip() or None,
        ])
    # Overdue first, then the quietest relationships.
    rows.sort(key=lambda r: (r[10] != "overdue", -(r[8] or 0), r[0].lower()))

    # Channel mix: which kinds of outreach actually get answered. Shared with the
    # HR Analytics tab so "answered" means one thing in both.
    from app.services.hr_metrics import channel_stats

    channel_rows = [
        [c["channel"], c["logged"], c["replied"], c["no_response"], c["reply_rate"]]
        for c in channel_stats(db, user)
    ]

    overdue_count = sum(1 for r in rows if r[10] == "overdue")
    return Report(
        id="hr-communication",
        title="HR communication",
        subtitle="Every contact, what has been logged against them, and what is owed",
        meta=_meta(db, user, [("Contacts", str(len(contacts))),
                              ("Follow-ups overdue", str(overdue_count))]),
        sections=[
            Section(
                heading="By channel",
                note="Reply rate is of the outreach whose outcome was recorded — entries still "
                     "awaiting a reply are left out of the denominator rather than counted as "
                     "refusals.",
                columns=["Channel", "Logged", "Replied", "No response", "Reply rate %"],
                rows=channel_rows,
            ),
            Section(
                heading="By contact, overdue first",
                note="Engagement is the computed band from the log; strength is the officer's "
                     "own 1–5 read. They are deliberately two different things.",
                columns=["Company", "Contact", "Designation", "Logged", "Replied",
                         "Reply rate %", "Engagement", "Strength", "Days since contact",
                         "Next follow-up", "", "Next action"],
                rows=rows,
            ),
        ],
        caveats=[
            "\"No history\" means nothing has been logged against that contact — it is not a "
            "score of zero, and the two must not be read the same way.",
            "A relationship with no contact inside six months is capped below \"warm\" however "
            "good its history: it has to be re-established, not resumed.",
            "Engagement is computed from the log; strength is what the officer thinks. A large "
            "gap between them is worth a conversation in either direction.",
        ],
    )


# --- 9. Monthly progress -----------------------------------------------------


def monthly_progress(db: Session, user: User, params: dict) -> Report:
    months_wanted = int(params.get("months") or 6)
    months = _recent_months(months_wanted)
    index = {m["key"]: i for i, m in enumerate(months)}
    blank = lambda: [0] * len(months)  # noqa: E731

    companies_added, comms, drives_held, offers_made, students_placed = (
        blank(), blank(), blank(), blank(), blank()
    )

    def bucket(when: Optional[datetime]) -> Optional[int]:
        return index.get(_month_key(when)) if when else None

    company_q = db.query(Company.created_at)
    if user.college_id:
        company_q = company_q.filter(Company.college_id == user.college_id)
    for (created,) in company_q.all():
        i = bucket(created)
        if i is not None:
            companies_added[i] += 1

    comm_q = db.query(Communication.communicated_at).join(
        Company, Communication.company_id == Company.id
    )
    if user.college_id:
        comm_q = comm_q.filter(Company.college_id == user.college_id)
    for (when,) in comm_q.all():
        i = bucket(when)
        if i is not None:
            comms[i] += 1

    drive_q = db.query(Drive.drive_date, Drive.created_at)
    if user.college_id:
        drive_q = drive_q.filter(Drive.college_id == user.college_id)
    for drive_date, created in drive_q.all():
        # A drive belongs to the month it ran in; a drive with no date yet falls
        # back to when it was set up.
        i = bucket(drive_date or created)
        if i is not None:
            drives_held[i] += 1

    offer_q = db.query(Offer.created_at, Offer.status).join(
        Student, Offer.student_id == Student.id
    )
    if user.college_id:
        offer_q = offer_q.filter(Student.college_id == user.college_id)
    for created, status in offer_q.all():
        i = bucket(created)
        if i is not None:
            offers_made[i] += 1
            if status in WON_OFFER_STATUSES:
                students_placed[i] += 1

    rows = []
    running = 0
    for i, m in enumerate(months):
        running += students_placed[i]
        rows.append([m["label"], companies_added[i], comms[i], drives_held[i],
                     offers_made[i], students_placed[i], running])

    return Report(
        id="monthly-progress",
        title="Monthly progress",
        subtitle=f"The last {len(months)} months",
        meta=_meta(db, user, [("Months covered", f"{months[0]['label']} – {months[-1]['label']}"
                              if months else "—")]),
        sections=[Section(
            heading="Month by month",
            note="Counted by when each thing was recorded, oldest month first.",
            columns=["Month", "Companies added", "Outreach logged", "Drives held",
                     "Offers made", "Offers won", "Offers won (running)"],
            rows=rows,
            total_row=["Total", sum(companies_added), sum(comms), sum(drives_held),
                       sum(offers_made), sum(students_placed), running],
        )],
        caveats=[
            "The current month is partial and will always look short beside a finished one. "
            "Compare it with the same point in an earlier month, not with a whole one.",
            "Everything is bucketed by when it was recorded in this system, not when it "
            "happened. A back-dated import lands in the month it was imported.",
            "\"Offers won\" counts offers accepted or joined, so a student with two accepted "
            "offers counts twice — it is an offer count, not a headcount.",
        ],
    )


# --- registry ----------------------------------------------------------------


# --- 10. The month, written up ----------------------------------------------


def monthly_placement(db: Session, user: User, params: dict) -> Report:
    """One month with its movement explained, not just tabulated.

    The prose is not generated here. It is written by whoever pressed the button
    on /insights/monthly and cached against the month, so opening this report -
    or exporting it, or three people reading it - never calls a model. When
    nothing has been written the rule-written findings stand in, which is also
    what the narrator was given, so the report says the same thing either way.
    """
    key = str(params.get("month") or "").strip() or monthly.last_complete_month()
    try:
        monthly.bounds(key)
    except ValueError:
        key = monthly.last_complete_month()

    facts, findings, tables = monthly.gather(db, user, key)

    narrative: list[str] = []
    note = "Not written up yet - these are the findings the numbers give."
    row = (
        db.query(DashboardInsight)
        .filter(
            DashboardInsight.college_id == user.college_id,
            DashboardInsight.scope == MONTHLY_SCOPE,
            DashboardInsight.period == key,
        )
        .first()
        if user.college_id else None
    )
    if row is not None and row.narrative:
        narrative = json.loads(row.narrative)
        note = (
            f"Written by {row.model} from the findings below"
            + (f", for {row.generated_by.full_name}" if row.generated_by else "")
            + f", on {row.generated_at.strftime('%d %b %Y')}."
        )

    prev = facts["previous"]
    summary = [
        ("Placements", f"{facts['placements']} (was {prev['placements']})"),
        ("Offers recorded", f"{facts['offers']} (was {prev['offers']})"),
        ("Drives held", f"{facts['drives_held']} (was {prev['drives_held']})"),
        ("Outreach logged", f"{facts['outreach_logged']} (was {prev['outreach_logged']})"),
        ("Companies added", f"{facts['companies_added']} (was {prev['companies_added']})"),
        ("Highest package",
         f"{facts['highest_package']} LPA" if facts["highest_package"] is not None else "—"),
    ]

    sections = [
        Section(
            heading="What the numbers say",
            note="Computed from the data, and the findings the write-up was made from.",
            columns=["Priority", "Finding"],
            rows=[[f.severity, f.headline] for f in findings],
        ),
        Section(
            heading="Placements by company",
            note="Counted per student on an accepted or joined offer dated in this month.",
            columns=["Company", "Students placed", "Highest (LPA)"],
            rows=tables["by_company"],
        ),
        Section(
            heading="Placements by branch",
            columns=["Branch", "Students placed", "Highest (LPA)"],
            rows=tables["by_branch"],
        ),
    ]

    caveats = [
        "A placement is counted in the month its offer was recorded, not the month the "
        "student joined. The two differ whenever an offer is entered late.",
        "Only the month before is available as a comparison. One month against one month is "
        "not a trend - the Monthly progress report draws the longer run.",
    ]
    if monthly.is_current(key):
        caveats.insert(0, (
            "This month is still running, so every figure here is a part-month and will "
            "understate it. Report on a completed month before quoting these."
        ))
    if facts["placements"] and not facts["packages_recorded"]:
        caveats.append(
            "No package was recorded on any of this month's placements, so the package "
            "figures are blank rather than zero."
        )

    return Report(
        id="monthly-placement",
        title="Monthly placement report",
        subtitle=monthly.label(key),
        meta=_meta(db, user, [("Month", monthly.label(key)),
                              *summary]),
        narrative=narrative,
        narrative_note=note,
        sections=sections,
        caveats=caveats,
    )


class ReportSpec:
    def __init__(self, id: str, name: str, description: str,
                 builder: Callable[[Session, User, dict], Report],
                 params: list[str]):
        self.id = id
        self.name = name
        self.description = description
        self.builder = builder
        #: Parameter names the UI should offer. "batch_year" renders the batch
        #: picker; "years" renders a how-many-years picker.
        self.params = params


REPORTS: list[ReportSpec] = [
    ReportSpec(
        "placement-evidence", "Placement evidence",
        "Year-wise placement, higher study and package figures — the numbers an NBA, NAAC or "
        "NIRF submission is built from.",
        placement_evidence, ["years"],
    ),
    ReportSpec(
        "branch-wise", "Branch-wise placement",
        "One batch, broken down by branch: placed, still seeking, higher studies and packages.",
        branch_wise, ["batch_year"],
    ),
    ReportSpec(
        "ctc-analysis", "CTC analysis",
        "Package bands across placed students, and what each company actually offered.",
        ctc_analysis, ["batch_year"],
    ),
    ReportSpec(
        "unplaced-risk", "Students still seeking",
        "The working list of unplaced students, highest risk first, with the profile behind it.",
        unplaced_risk, ["batch_year"],
    ),
    ReportSpec(
        "training-effectiveness", "Training effectiveness",
        "Module-by-module attendance and scores, and how the trained compare with the untrained.",
        training_effectiveness, ["batch_year"],
    ),
    ReportSpec(
        "officer-followup", "Officer follow-up",
        "What each officer owes: follow-ups pending and overdue, outreach logged, and progress "
        "against their targets.",
        officer_followup, [],
    ),
    ReportSpec(
        "company-conversion", "Company conversion",
        "How far each company got — contacted, ran a drive, made an offer, placed somebody.",
        company_conversion, [],
    ),
    ReportSpec(
        "hr-communication", "HR communication",
        "Every HR contact with what has been logged against them, which channels get answered, "
        "and what is overdue.",
        hr_communication, [],
    ),
    ReportSpec(
        "monthly-placement", "Monthly placement report",
        "One month written up for management: what was placed, the work behind it, and what "
        "needs attention — with the tables underneath.",
        monthly_placement, ["month"],
    ),
    ReportSpec(
        "monthly-progress", "Monthly progress",
        "Month by month: companies added, outreach logged, drives held and offers won.",
        monthly_progress, ["months"],
    ),
]

BY_ID = {spec.id: spec for spec in REPORTS}
