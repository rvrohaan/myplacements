"""One month of placement activity, and the case for writing it up.

The Monthly progress report already draws six months as a table. This is the
other half of what a placement cell actually sends management: *one* month, with
the movement explained rather than left to be read off a grid.

Same split as the dashboard summary, and deliberately the same code: the facts
and the findings are computed here, the model only joins them into prose, and
:func:`app.services.insights.verify` checks that what comes back quotes nothing
we did not supply. ``Finding`` is imported rather than redefined for the same
reason the thresholds are imported from the analytics router - two features that
both claim to state "what happened" must not be able to disagree about it.

A month is a closed window, which makes this different from the dashboard in one
way that matters: the report defaults to the **last complete month**, because a
report about a month still running understates everything in it. Asking for the
current month is allowed and carries a caveat saying so.
"""

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.communication import Communication
from app.models.company import Company
from app.models.drive import Drive
from app.models.offer import Offer, OfferStatus
from app.models.student import Student
from app.models.user import User
from app.services.insights import Finding, _fmt, _plural

# What counts as a placement in a month. Imported rather than restated so this
# and the analytics tiles cannot drift; see report_defs.LIVE_OFFERS.
WON = (OfferStatus.ACCEPTED, OfferStatus.JOINED)


def month_key(when: datetime) -> str:
    return when.strftime("%Y-%m")


def last_complete_month(today: Optional[datetime] = None) -> str:
    """The month before the one we are in - the one a report can be written about."""
    cursor = (today or datetime.utcnow()).replace(day=1)
    return month_key(cursor - timedelta(days=1))


def recent_months(count: int = 12, today: Optional[datetime] = None) -> list[dict]:
    """Months the picker should offer, newest first, including the current one."""
    cursor = (today or datetime.utcnow()).replace(day=1)
    out = []
    for _ in range(count):
        out.append({"key": month_key(cursor), "label": cursor.strftime("%B %Y")})
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    return out


def bounds(key: str) -> tuple[datetime, datetime]:
    """``[start, end)`` for a YYYY-MM key. Half-open, so an event at midnight on
    the first of the next month belongs to that month and not to both."""
    start = datetime.strptime(key, "%Y-%m")
    end = (start + timedelta(days=32)).replace(day=1)
    return start, end


def label(key: str) -> str:
    return datetime.strptime(key, "%Y-%m").strftime("%B %Y")


def is_current(key: str, today: Optional[datetime] = None) -> bool:
    return key == month_key(today or datetime.utcnow())


def _counts(db: Session, user: User, key: str) -> dict:
    """Everything that happened inside one month, in four queries."""
    start, end = bounds(key)
    cid = user.college_id

    offer_q = (
        db.query(Offer.ctc, Offer.status, Offer.company_id, Offer.student_id, Student.branch)
        .join(Student, Offer.student_id == Student.id)
        .filter(Offer.created_at >= start, Offer.created_at < end)
    )
    if cid:
        offer_q = offer_q.filter(Student.college_id == cid)
    offers = offer_q.all()
    won = [o for o in offers if o.status in WON]

    company_q = db.query(Company.id).filter(
        Company.created_at >= start, Company.created_at < end
    )
    drive_q = db.query(Drive.id).filter(
        # A drive belongs to the month it ran in; one with no date yet falls back
        # to when it was set up, matching monthly_progress.
        Drive.drive_date.isnot(None), Drive.drive_date >= start, Drive.drive_date < end
    )
    comm_q = (
        db.query(Communication.id)
        .join(Company, Communication.company_id == Company.id)
        .filter(Communication.communicated_at >= start, Communication.communicated_at < end)
    )
    if cid:
        company_q = company_q.filter(Company.college_id == cid)
        drive_q = drive_q.filter(Drive.college_id == cid)
        comm_q = comm_q.filter(Company.college_id == cid)

    packages = [o.ctc for o in won if o.ctc is not None]
    return {
        "month": key,
        "offers": len(offers),
        "placements": len({o.student_id for o in won}),
        "companies_added": company_q.count(),
        "drives_held": drive_q.count(),
        "outreach_logged": comm_q.count(),
        "recruiters": len({o.company_id for o in won if o.company_id}),
        "highest_package": round(max(packages), 2) if packages else None,
        "packages_recorded": len(packages),
        "_won": won,
    }


def _delta_phrase(now: int, before: int, noun: str) -> tuple[str, list[str]]:
    """"6 placements, up from 2" - and the figures that sentence is allowed to use."""
    word = _plural(now, noun)
    if before == now:
        return f"{now} {word}, unchanged from the month before", [_fmt(now)]
    direction = "up" if now > before else "down"
    return (
        f"{now} {word}, {direction} from {before} the month before",
        [_fmt(now), _fmt(before)],
    )


def gather(db: Session, user: User, key: str) -> tuple[dict, list[Finding], dict]:
    """The month's facts, the findings drawn from them, and the tables."""
    this = _counts(db, user, key)
    start, _ = bounds(key)
    previous_key = month_key(start - timedelta(days=1))
    prev = _counts(db, user, previous_key)

    facts = {k: v for k, v in this.items() if not k.startswith("_")}
    facts["previous"] = {k: v for k, v in prev.items() if not k.startswith("_")}
    facts["label"] = label(key)

    findings: list[Finding] = []

    # --- the headline: placements made, against last month -------------------
    phrase, nums = _delta_phrase(this["placements"], prev["placements"], "placement")
    if this["placements"] == 0 and prev["placements"] == 0:
        findings.append(Finding(
            "placements", "urgent",
            f"No placements were recorded in {label(key)}, and none the month before.",
            [],
        ))
    else:
        sev = ("good" if this["placements"] > prev["placements"]
               else "watch" if this["placements"] == prev["placements"] else "urgent")
        findings.append(Finding(
            "placements", sev, f"{label(key)} recorded {phrase}.", nums,
        ))

    if this["highest_package"] is not None:
        findings.append(Finding(
            "top_package", "good",
            f"The best package of the month was {_fmt(this['highest_package'])} LPA, across "
            f"{this['recruiters']} {_plural(this['recruiters'], 'recruiter')}.",
            [_fmt(this["highest_package"]), _fmt(this["recruiters"])],
        ))

    # --- the work behind it --------------------------------------------------
    phrase, nums = _delta_phrase(this["outreach_logged"], prev["outreach_logged"], "outreach log")
    sev = "watch" if this["outreach_logged"] < prev["outreach_logged"] else "good"
    findings.append(Finding("outreach", sev, f"The team logged {phrase}.", nums))

    if this["drives_held"] or prev["drives_held"]:
        phrase, nums = _delta_phrase(this["drives_held"], prev["drives_held"], "drive")
        findings.append(Finding(
            "drives", "good" if this["drives_held"] >= prev["drives_held"] else "watch",
            f"{phrase.capitalize()} ran on campus.", nums,
        ))

    if this["companies_added"]:
        findings.append(Finding(
            "companies", "good",
            f"{this['companies_added']} new "
            f"{_plural(this['companies_added'], 'company', 'companies')} joined the pipeline.",
            [_fmt(this["companies_added"])],
        ))

    # A month where offers were made but none were taken up is worth naming: the
    # offer count alone reads like a good month.
    if this["offers"] and not this["placements"]:
        findings.append(Finding(
            "offers_not_taken", "urgent",
            f"{this['offers']} {_plural(this['offers'], 'offer was', 'offers were')} recorded "
            f"but none has been accepted or joined yet.",
            [_fmt(this["offers"])],
        ))

    findings.sort(key=lambda f: {"urgent": 0, "watch": 1, "good": 2}.get(f.severity, 1))

    # --- the tables ----------------------------------------------------------
    by_company: dict[int, dict] = {}
    by_branch: dict[str, dict] = {}
    for o in this["_won"]:
        if o.company_id:
            c = by_company.setdefault(o.company_id, {"students": set(), "packages": []})
            c["students"].add(o.student_id)
            if o.ctc is not None:
                c["packages"].append(o.ctc)
        branch = (o.branch or "Unrecorded").strip() or "Unrecorded"
        b = by_branch.setdefault(branch, {"students": set(), "packages": []})
        b["students"].add(o.student_id)
        if o.ctc is not None:
            b["packages"].append(o.ctc)

    names = {}
    if by_company:
        for cid_, name in db.query(Company.id, Company.name).filter(
            Company.id.in_(list(by_company))
        ).all():
            names[cid_] = name

    tables = {
        "by_company": sorted(
            ([names.get(k, "Not recorded"), len(v["students"]),
              round(max(v["packages"]), 2) if v["packages"] else None]
             for k, v in by_company.items()),
            key=lambda r: (-r[1], r[0].lower()),
        ),
        "by_branch": sorted(
            ([k, len(v["students"]),
              round(max(v["packages"]), 2) if v["packages"] else None]
             for k, v in by_branch.items()),
            key=lambda r: (-r[1], r[0].lower()),
        ),
    }
    return facts, findings, tables


def build_prompt(college: str, key: str, findings: list[Finding]) -> str:
    lines = "\n".join(f"- [{f.severity}] {f.headline}" for f in findings)
    return f"""You are writing the covering note of {college}'s placement report for
{label(key)}. It goes to senior management, who will read this and skim the tables
underneath it. The findings below are already worked out from the data.

Findings, most pressing first:
{lines}

Rules:
- Use ONLY the findings above. Do not add context, causes or recommendations that
  depend on anything not stated there.
- Digits are reserved for quoting a figure that appears above, exactly as written.
  For any other quantity use words ("two recruiters returned"). Never round,
  re-derive or combine the figures.
- Two or three short paragraphs. Open with the month's result, then the work
  behind it, then anything that needs attention.
- Measured and factual. This is a record, not a pitch: no congratulation, no
  alarm, no adjectives the figures do not earn.
- Do not claim a trend, a cause or a comparison that is not in the findings. One
  month against the one before it is the only comparison available to you.

Return ONLY a JSON object: {{"paragraphs": ["...", "..."]}}"""
