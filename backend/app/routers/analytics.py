import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_staff, get_current_user, require_roles
from app.core.timeutil import overdue_before
from app.models.communication import Communication
from app.models.company import Company, CompanyStatus
from app.models.drive import Drive, DriveParticipant, DriveRound, DriveStatus, ParticipantStatus
from app.models.offer import Offer, OfferStatus
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.student import PlacementStatus, RiskCategory, Student
from app.models.training import StudentTraining
from app.models.user import User, UserRole

router = APIRouter(prefix="/analytics", tags=["analytics"], dependencies=[Depends(get_current_staff)])

# Leadership sees the whole college plus every officer's progress; a placement
# officer only ever sees the slice of the college allocated to them.
LEADERSHIP_ROLES = (
    UserRole.SUPER_ADMIN,
    UserRole.PRINCIPAL,
    UserRole.PRO_CHANCELLOR,
    UserRole.DEPUTY_PRO_CHANCELLOR,
)

# Assignment states that still represent work in hand.
OPEN_ASSIGNMENT_STATUSES = ("active", "accepted", "escalated")
# Offer states that mean a student actually landed the job.
WON_OFFER_STATUSES = (OfferStatus.ACCEPTED, OfferStatus.JOINED)
# A company with no logged contact in this many days is going stale.
STALE_AFTER_DAYS = 30
# How recently an officer must have logged something to read as "active".
ACTIVE_WITHIN_DAYS = 7


def _college_filter(q, model, college_id):
    if college_id:
        q = q.filter(model.college_id == college_id)
    return q


def _officer_profile(db: Session, user: User) -> PlacementOfficer | None:
    """The PlacementOfficer card behind a user account, if there is one."""
    return db.query(PlacementOfficer).filter(PlacementOfficer.user_id == user.id).first()


def _assigned_company_ids(db: Session, officer: PlacementOfficer | None) -> list[int]:
    if officer is None:
        return []
    rows = (
        db.query(CompanyAssignment.company_id)
        .filter(CompanyAssignment.officer_id == officer.id)
        .all()
    )
    return [r[0] for r in rows]


def _drive_ids_for_companies(db: Session, company_ids: list[int]) -> list[int]:
    if not company_ids:
        return []
    return [r[0] for r in db.query(Drive.id).filter(Drive.company_id.in_(company_ids)).all()]


def _is_officer_scope(current_user: User) -> bool:
    """Placement officers get a personal view of every analytics endpoint."""
    return current_user.role == UserRole.PLACEMENT_OFFICER


def _officer_student_ids(db: Session, drive_ids: list[int]) -> set[int]:
    """Students an officer actually touched - everyone who took part in one of the
    drives run at a company allocated to them."""
    if not drive_ids:
        return set()
    rows = (
        db.query(DriveParticipant.student_id)
        .filter(DriveParticipant.drive_id.in_(drive_ids))
        .distinct()
        .all()
    )
    return {r[0] for r in rows}


# --- Overview ---------------------------------------------------------------


def _officer_overview(db: Session, current_user: User) -> dict:
    """The overview cards restricted to one officer's own portfolio: the companies
    allocated to them, the drives those companies ran, and the offers that came
    out of them."""
    officer = _officer_profile(db, current_user)
    company_ids = _assigned_company_ids(db, officer)
    drive_ids = _drive_ids_for_companies(db, company_ids)
    student_ids = _officer_student_ids(db, drive_ids)

    active_companies = (
        db.query(func.count(Company.id))
        .filter(Company.id.in_(company_ids), Company.status == CompanyStatus.ACTIVE)
        .scalar()
        if company_ids
        else 0
    )
    placed = (
        db.query(func.count(Student.id))
        .filter(
            Student.id.in_(student_ids),
            Student.placement_status == PlacementStatus.PLACED,
        )
        .scalar()
        if student_ids
        else 0
    )
    total_offers = (
        db.query(func.count(Offer.id)).filter(Offer.drive_id.in_(drive_ids)).scalar()
        if drive_ids
        else 0
    )
    accepted_offers = (
        db.query(func.count(Offer.id))
        .filter(Offer.drive_id.in_(drive_ids), Offer.status.in_(WON_OFFER_STATUSES))
        .scalar()
        if drive_ids
        else 0
    )
    # An officer's average package comes off their own offers, not the whole
    # college's placed students.
    avg_ctc = (
        db.query(func.avg(Offer.ctc))
        .filter(Offer.drive_id.in_(drive_ids), Offer.ctc.isnot(None))
        .scalar()
        if drive_ids
        else None
    )

    total_students = len(student_ids)
    return {
        "scope": "officer",
        "students": {
            "total": total_students,
            "placed": placed or 0,
            "placement_rate": round(((placed or 0) / total_students * 100) if total_students else 0, 1),
        },
        "companies": {"total": len(company_ids), "active": active_companies or 0},
        "drives": {"total": len(drive_ids)},
        "offers": {
            "total": total_offers or 0,
            "accepted": accepted_offers or 0,
            "avg_ctc": round(float(avg_ctc), 2) if avg_ctc else 0,
        },
    }


@router.get("/overview")
def get_overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if _is_officer_scope(current_user):
        return _officer_overview(db, current_user)

    cid = current_user.college_id

    total_students = _college_filter(db.query(func.count(Student.id)), Student, cid).scalar()
    placed = _college_filter(db.query(func.count(Student.id)), Student, cid).filter(Student.placement_status == PlacementStatus.PLACED).scalar()
    total_companies = _college_filter(db.query(func.count(Company.id)), Company, cid).scalar()
    active_companies = _college_filter(db.query(func.count(Company.id)), Company, cid).filter(Company.status == CompanyStatus.ACTIVE).scalar()
    total_drives = _college_filter(db.query(func.count(Drive.id)), Drive, cid).scalar()
    total_offers = _college_filter(
        db.query(func.count(Offer.id)).join(Student, Offer.student_id == Student.id), Student, cid
    ).scalar()
    accepted_offers = (
        _college_filter(
            db.query(func.count(Offer.id)).join(Student, Offer.student_id == Student.id), Student, cid
        )
        .filter(Offer.status == OfferStatus.ACCEPTED)
        .scalar()
    )
    avg_ctc = (
        _college_filter(db.query(func.avg(Student.placement_ctc)), Student, cid)
        .filter(
            Student.placement_status == PlacementStatus.PLACED,
            Student.placement_ctc.isnot(None),
        )
        .scalar()
    )

    return {
        "scope": "college",
        "students": {
            "total": total_students,
            "placed": placed,
            "placement_rate": round((placed / total_students * 100) if total_students else 0, 1),
        },
        "companies": {
            "total": total_companies,
            "active": active_companies,
        },
        "drives": {
            "total": total_drives,
        },
        "offers": {
            "total": total_offers,
            "accepted": accepted_offers,
            "avg_ctc": round(float(avg_ctc), 2) if avg_ctc else 0,
        },
    }


@router.get("/branch-wise")
def get_branch_wise(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(
        Student.branch,
        func.count(Student.id),
        func.sum(case((Student.placement_status == PlacementStatus.PLACED, 1), else_=0)),
    ).group_by(Student.branch)
    if current_user.college_id:
        q = q.filter(Student.college_id == current_user.college_id)
    # An officer's branch split covers only the students who sat their drives.
    if _is_officer_scope(current_user):
        officer = _officer_profile(db, current_user)
        drive_ids = _drive_ids_for_companies(db, _assigned_company_ids(db, officer))
        student_ids = _officer_student_ids(db, drive_ids)
        if not student_ids:
            return []
        q = q.filter(Student.id.in_(student_ids))
    rows = q.all()
    return [{"branch": r[0], "total": r[1], "placed": int(r[2] or 0)} for r in rows]


@router.get("/ctc-distribution")
def get_ctc_distribution(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = _college_filter(db.query(Student.placement_ctc), Student, current_user.college_id).filter(
        Student.placement_status == PlacementStatus.PLACED,
        Student.placement_ctc.isnot(None),
    )
    if _is_officer_scope(current_user):
        officer = _officer_profile(db, current_user)
        drive_ids = _drive_ids_for_companies(db, _assigned_company_ids(db, officer))
        student_ids = _officer_student_ids(db, drive_ids)
        if not student_ids:
            return {"distribution": [], "min": 0, "max": 0, "avg": 0, "median": 0}
        q = q.filter(Student.id.in_(student_ids))
    rows = q.all()
    ctc_values = [r[0] for r in rows]
    if not ctc_values:
        return {"distribution": [], "min": 0, "max": 0, "avg": 0, "median": 0}

    ctc_values.sort()
    n = len(ctc_values)
    median = ctc_values[n // 2] if n % 2 else (ctc_values[n // 2 - 1] + ctc_values[n // 2]) / 2

    buckets: dict = {}
    for v in ctc_values:
        bucket = f"{int(v // 5) * 5}-{int(v // 5) * 5 + 5} LPA"
        buckets[bucket] = buckets.get(bucket, 0) + 1

    return {
        "distribution": [{"range": k, "count": v} for k, v in sorted(buckets.items())],
        "min": min(ctc_values),
        "max": max(ctc_values),
        "avg": round(sum(ctc_values) / n, 2),
        "median": round(median, 2),
    }


@router.get("/drive-funnel/{drive_id}")
def get_drive_funnel(drive_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    counts = {}
    for status in ParticipantStatus:
        counts[status.value] = (
            db.query(func.count(DriveParticipant.id))
            .filter(DriveParticipant.drive_id == drive_id, DriveParticipant.status == status)
            .scalar()
        )
    return counts


# --- The officer's own dashboard --------------------------------------------


def _percent(achieved: int, target: int | None) -> int:
    """Progress toward a target, capped at 100. No target set reads as 0."""
    if not target:
        return 0
    return min(100, round(achieved / target * 100))


@router.get("/my-work")
def get_my_work(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Everything the signed-in placement officer owns: their allocations, the
    companies behind them, their outreach, drives, offers and targets. Scoped
    entirely to the officer - nothing from the rest of the college leaks in."""
    officer = _officer_profile(db, current_user)
    if officer is None:
        raise HTTPException(
            status_code=404,
            detail="No placement officer profile is linked to this account",
        )

    now = datetime.utcnow()
    recent_cutoff = now - timedelta(days=STALE_AFTER_DAYS)

    assignments = (
        db.query(CompanyAssignment)
        .filter(CompanyAssignment.officer_id == officer.id)
        .order_by(CompanyAssignment.assigned_at.desc())
        .all()
    )
    company_ids = [a.company_id for a in assignments]
    assignment_by_company = {a.company_id: a for a in assignments}

    by_assignment_status: dict[str, int] = defaultdict(int)
    for a in assignments:
        by_assignment_status[a.status or "active"] += 1

    companies = db.query(Company).filter(Company.id.in_(company_ids)).all() if company_ids else []
    by_company_status: dict[str, int] = defaultdict(int)
    for c in companies:
        by_company_status[c.status.value if c.status else "new"] += 1

    # Drives and offers roll up through the officer's companies.
    drives = db.query(Drive).filter(Drive.company_id.in_(company_ids)).all() if company_ids else []
    drive_ids = [d.id for d in drives]
    drives_by_company: dict[int, int] = defaultdict(int)
    for d in drives:
        drives_by_company[d.company_id] += 1

    offers = db.query(Offer).filter(Offer.drive_id.in_(drive_ids)).all() if drive_ids else []
    drive_company = {d.id: d.company_id for d in drives}
    offers_by_company: dict[int, int] = defaultdict(int)
    for o in offers:
        offers_by_company[drive_company.get(o.drive_id, 0)] += 1
    won_offers = [o for o in offers if o.status in WON_OFFER_STATUSES]
    ctcs = [o.ctc for o in offers if o.ctc]

    # Every log touching the officer's companies, whoever wrote it - a head's call
    # still counts as contact, so staleness stays honest.
    comm_filters = [Communication.officer_id == officer.id]
    if company_ids:
        comm_filters.append(Communication.company_id.in_(company_ids))
    communications = (
        db.query(Communication)
        .filter(or_(*comm_filters))
        .order_by(Communication.communicated_at.desc())
        .all()
    )
    last_contact: dict[int, datetime] = {}
    for c in communications:
        when = c.communicated_at
        if when and (c.company_id not in last_contact or when > last_contact[c.company_id]):
            last_contact[c.company_id] = when

    # The officer's own outreach, though, is only what is attributed to them -
    # somebody else's log on their company is not their activity.
    my_comms = [c for c in communications if c.officer_id == officer.id]
    comms_30d = sum(
        1 for c in my_comms if c.communicated_at and c.communicated_at >= recent_cutoff
    )
    open_followups = [
        c
        for c in my_comms
        if c.next_followup_date and (c.response_received or "") != "received"
    ]
    # Late means the follow-up's *day* has passed — see timeutil.overdue_before.
    late_before = overdue_before()
    overdue = [c for c in open_followups if c.next_followup_date < late_before]

    student_ids = _officer_student_ids(db, drive_ids)
    placed_count = (
        db.query(func.count(Student.id))
        .filter(
            Student.id.in_(student_ids),
            Student.placement_status == PlacementStatus.PLACED,
        )
        .scalar()
        if student_ids
        else 0
    )

    my_companies = []
    for c in companies:
        assignment = assignment_by_company.get(c.id)
        contacted = last_contact.get(c.id)
        my_companies.append(
            {
                "id": c.id,
                "name": c.name,
                "sector": c.sector,
                "status": c.status.value if c.status else None,
                "review_status": c.review_status,
                "assignment_status": assignment.status if assignment else None,
                "priority": assignment.priority if assignment else None,
                "last_contacted_at": contacted.isoformat() if contacted else None,
                "days_since_contact": (now - contacted).days if contacted else None,
                "drives": drives_by_company.get(c.id, 0),
                "offers": offers_by_company.get(c.id, 0),
                "stale": contacted is None or contacted < recent_cutoff,
            }
        )
    # Coldest companies first - that's the officer's next call list.
    my_companies.sort(key=lambda c: (-(c["days_since_contact"] or 10**6), c["name"]))

    company_names = {c.id: c.name for c in companies}
    return {
        "officer": {
            "id": officer.id,
            "name": current_user.full_name,
            "region": officer.region,
            "sector_expertise": officer.sector_expertise,
        },
        "assignments": {
            "total": len(assignments),
            "open": sum(by_assignment_status.get(s, 0) for s in OPEN_ASSIGNMENT_STATUSES),
            "by_status": dict(by_assignment_status),
        },
        "companies": {
            "total": len(companies),
            "by_status": dict(by_company_status),
            "stale": sum(1 for c in my_companies if c["stale"]),
        },
        "communications": {
            "total": len(my_comms),
            "last_30_days": comms_30d,
            "pending_followups": len(open_followups),
            "overdue_followups": len(overdue),
        },
        "drives": {
            "total": len(drives),
            "upcoming": sum(1 for d in drives if d.status == DriveStatus.UPCOMING),
            "ongoing": sum(1 for d in drives if d.status == DriveStatus.ONGOING),
            "completed": sum(1 for d in drives if d.status == DriveStatus.COMPLETED),
        },
        "offers": {
            "total": len(offers),
            "won": len(won_offers),
            "avg_ctc": round(sum(ctcs) / len(ctcs), 2) if ctcs else 0,
        },
        "students": {"participated": len(student_ids), "placed": placed_count or 0},
        "targets": {
            "companies": {
                "target": officer.target_companies or 0,
                "achieved": len(assignments),
                "percent": _percent(len(assignments), officer.target_companies),
            },
            "offers": {
                "target": officer.target_offers or 0,
                "achieved": len(won_offers),
                "percent": _percent(len(won_offers), officer.target_offers),
            },
        },
        "my_companies": my_companies,
        "upcoming_followups": [
            {
                "id": c.id,
                "company_id": c.company_id,
                "company_name": company_names.get(c.company_id),
                "subject": c.subject,
                "comm_type": c.comm_type.value if c.comm_type else None,
                "next_followup_date": c.next_followup_date.isoformat(),
                "overdue": c.next_followup_date < late_before,
            }
            for c in sorted(open_followups, key=lambda x: x.next_followup_date)[:8]
        ],
        "recent_activity": [
            {
                "id": c.id,
                "company_id": c.company_id,
                "company_name": company_names.get(c.company_id),
                "comm_type": c.comm_type.value if c.comm_type else None,
                "subject": c.subject,
                "communicated_at": c.communicated_at.isoformat() if c.communicated_at else None,
            }
            for c in communications[:8]
        ],
    }


# --- Leadership view of officer progress ------------------------------------


def _month_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


def _recent_months(count: int = 6) -> list[dict]:
    """The last ``count`` calendar months, oldest first, as trend buckets."""
    cursor = datetime.utcnow().replace(day=1)
    months = []
    for _ in range(count):
        months.append({"key": _month_key(cursor), "label": cursor.strftime("%b %y")})
        # Step back a month by landing on the last day of the previous one.
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    return list(reversed(months))


@router.get("/officer-workload")
def get_officer_workload(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
):
    """Is the work spread fairly across the team? Leadership only.

    Separate from officer-performance, which ranks by what officers have landed.
    This measures what they are currently carrying, because an officer holding
    twice the companies and landing fewer offers is not underperforming - and a
    table sorted by offers won says exactly that.
    """
    from app.services import workload

    return workload.compute(db, current_user)


@router.get("/officer-performance")
def get_officer_performance(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
):
    """How every placement officer in the college is progressing: allocations
    worked, outreach logged, drives run, offers landed, and how that tracks
    against each officer's targets. Leadership only."""
    cid = current_user.college_id
    now = datetime.utcnow()
    recent_cutoff = now - timedelta(days=STALE_AFTER_DAYS)
    active_cutoff = now - timedelta(days=ACTIVE_WITHIN_DAYS)

    officer_q = db.query(PlacementOfficer)
    if cid:
        officer_q = officer_q.filter(PlacementOfficer.college_id == cid)
    officers = officer_q.all()
    officer_ids = [o.id for o in officers]

    # A company has exactly one owner, so a flat company -> officer map is enough
    # to attribute every drive, offer and communication downstream.
    assign_rows = (
        db.query(
            CompanyAssignment.officer_id,
            CompanyAssignment.company_id,
            CompanyAssignment.status,
        )
        .filter(CompanyAssignment.officer_id.in_(officer_ids))
        .all()
        if officer_ids
        else []
    )
    company_owner = {r[1]: r[0] for r in assign_rows}
    all_company_ids = list(company_owner.keys())

    assigned_count: dict[int, int] = defaultdict(int)
    open_count: dict[int, int] = defaultdict(int)
    completed_count: dict[int, int] = defaultdict(int)
    for officer_id, _company_id, status in assign_rows:
        assigned_count[officer_id] += 1
        if status == "completed":
            completed_count[officer_id] += 1
        elif (status or "active") in OPEN_ASSIGNMENT_STATUSES:
            open_count[officer_id] += 1

    drive_rows = (
        db.query(Drive.id, Drive.company_id, Drive.status, Drive.drive_date, Drive.created_at)
        .filter(Drive.company_id.in_(all_company_ids))
        .all()
        if all_company_ids
        else []
    )
    drive_owner = {r[0]: company_owner.get(r[1]) for r in drive_rows}
    drives_total: dict[int, int] = defaultdict(int)
    drives_completed: dict[int, int] = defaultdict(int)
    drives_upcoming: dict[int, int] = defaultdict(int)
    for drive_id, _company_id, status, _drive_date, _created in drive_rows:
        owner = drive_owner.get(drive_id)
        if owner is None:
            continue
        drives_total[owner] += 1
        if status == DriveStatus.COMPLETED:
            drives_completed[owner] += 1
        elif status == DriveStatus.UPCOMING:
            drives_upcoming[owner] += 1

    drive_ids = list(drive_owner.keys())
    offer_rows = (
        db.query(Offer.drive_id, Offer.status, Offer.ctc, Offer.student_id, Offer.created_at)
        .filter(Offer.drive_id.in_(drive_ids))
        .all()
        if drive_ids
        else []
    )
    offers_total: dict[int, int] = defaultdict(int)
    offers_won: dict[int, int] = defaultdict(int)
    offer_ctcs: dict[int, list[float]] = defaultdict(list)
    placed_students: dict[int, set[int]] = defaultdict(set)
    for drive_id, status, ctc, student_id, _created in offer_rows:
        owner = drive_owner.get(drive_id)
        if owner is None:
            continue
        offers_total[owner] += 1
        if ctc:
            offer_ctcs[owner].append(ctc)
        if status in WON_OFFER_STATUSES:
            offers_won[owner] += 1
            placed_students[owner].add(student_id)

    officer_id_set = set(officer_ids)
    comm_filters = []
    if officer_ids:
        comm_filters.append(Communication.officer_id.in_(officer_ids))
    if all_company_ids:
        comm_filters.append(Communication.company_id.in_(all_company_ids))
    comm_rows = (
        db.query(
            Communication.company_id,
            Communication.officer_id,
            Communication.communicated_at,
            Communication.next_followup_date,
            Communication.response_received,
        )
        .filter(or_(*comm_filters))
        .all()
        if comm_filters
        else []
    )
    comms_total: dict[int, int] = defaultdict(int)
    comms_30d: dict[int, int] = defaultdict(int)
    pending_followups: dict[int, int] = defaultdict(int)
    overdue_followups: dict[int, int] = defaultdict(int)
    last_activity: dict[int, datetime] = {}
    for company_id, comm_officer_id, when, followup, response in comm_rows:
        # Credit outreach only to the officer stamped on the log. Logs written by
        # a head (or by anyone with no officer profile) belong to nobody and are
        # left out of the comparison rather than inflating the company's owner.
        owner = comm_officer_id if comm_officer_id in officer_id_set else None
        if owner is None:
            continue
        comms_total[owner] += 1
        if when:
            if when >= recent_cutoff:
                comms_30d[owner] += 1
            if owner not in last_activity or when > last_activity[owner]:
                last_activity[owner] = when
        if followup and (response or "") != "received":
            pending_followups[owner] += 1
            if followup < now:
                overdue_followups[owner] += 1

    def _activity_status(officer_id: int) -> str:
        when = last_activity.get(officer_id)
        if when is None:
            return "no_activity"
        if when >= active_cutoff:
            return "active"
        if when >= recent_cutoff:
            return "slowing"
        return "idle"

    rows = []
    for o in officers:
        ctcs = offer_ctcs.get(o.id, [])
        rows.append(
            {
                "officer_id": o.id,
                "user_id": o.user_id,
                "name": o.user.full_name if o.user else f"Officer #{o.id}",
                "email": o.user.email if o.user else None,
                "department": o.user.department if o.user else None,
                "region": o.region,
                "sector_expertise": o.sector_expertise,
                "companies_assigned": assigned_count.get(o.id, 0),
                "open_assignments": open_count.get(o.id, 0),
                "completed_assignments": completed_count.get(o.id, 0),
                "communications_total": comms_total.get(o.id, 0),
                "communications_30d": comms_30d.get(o.id, 0),
                "pending_followups": pending_followups.get(o.id, 0),
                "overdue_followups": overdue_followups.get(o.id, 0),
                "drives_total": drives_total.get(o.id, 0),
                "drives_completed": drives_completed.get(o.id, 0),
                "drives_upcoming": drives_upcoming.get(o.id, 0),
                "offers_total": offers_total.get(o.id, 0),
                "offers_won": offers_won.get(o.id, 0),
                "students_placed": len(placed_students.get(o.id, set())),
                "avg_ctc": round(sum(ctcs) / len(ctcs), 2) if ctcs else 0,
                "target_companies": o.target_companies or 0,
                "target_offers": o.target_offers or 0,
                "company_target_percent": _percent(assigned_count.get(o.id, 0), o.target_companies),
                "offer_target_percent": _percent(offers_won.get(o.id, 0), o.target_offers),
                "last_activity": last_activity[o.id].isoformat() if o.id in last_activity else None,
                "activity_status": _activity_status(o.id),
            }
        )
    # Strongest performers first, measured by offers landed then recent outreach.
    rows.sort(key=lambda r: (-r["offers_won"], -r["communications_30d"], r["name"]))

    # Work that has no owner yet, so leadership can see the gap.
    unassigned_q = db.query(func.count(Company.id)).filter(
        Company.status.notin_((CompanyStatus.BLACKLISTED, CompanyStatus.DORMANT))
    )
    if cid:
        unassigned_q = unassigned_q.filter(Company.college_id == cid)
    if all_company_ids:
        unassigned_q = unassigned_q.filter(Company.id.notin_(all_company_ids))
    unassigned_companies = unassigned_q.scalar() or 0

    pending_review_q = db.query(func.count(Company.id)).filter(Company.review_status == "pending")
    if cid:
        pending_review_q = pending_review_q.filter(Company.college_id == cid)
    pending_reviews = pending_review_q.scalar() or 0

    months = _recent_months()
    month_index = {m["key"]: i for i, m in enumerate(months)}
    trend = [{"month": m["label"], "communications": 0, "drives": 0, "offers": 0} for m in months]
    for _company_id, _officer_id, when, _followup, _response in comm_rows:
        i = month_index.get(_month_key(when)) if when else None
        if i is not None:
            trend[i]["communications"] += 1
    for _drive_id, _company_id, _status, drive_date, created in drive_rows:
        when = drive_date or created
        i = month_index.get(_month_key(when)) if when else None
        if i is not None:
            trend[i]["drives"] += 1
    for _drive_id, _status, _ctc, _student_id, created in offer_rows:
        i = month_index.get(_month_key(created)) if created else None
        if i is not None:
            trend[i]["offers"] += 1

    return {
        "officers": rows,
        "totals": {
            "officers": len(rows),
            "companies_assigned": sum(r["companies_assigned"] for r in rows),
            "open_assignments": sum(r["open_assignments"] for r in rows),
            "completed_assignments": sum(r["completed_assignments"] for r in rows),
            "communications_30d": sum(r["communications_30d"] for r in rows),
            "overdue_followups": sum(r["overdue_followups"] for r in rows),
            "drives_total": sum(r["drives_total"] for r in rows),
            "offers_won": sum(r["offers_won"] for r in rows),
            "students_placed": sum(r["students_placed"] for r in rows),
            "unassigned_companies": unassigned_companies,
            "pending_lead_reviews": pending_reviews,
            "needs_attention": sum(
                1 for r in rows if r["activity_status"] in ("idle", "no_activity")
            ),
        },
        "trend": trend,
    }


# --- Offer analytics --------------------------------------------------------
#
# The overview's CTC figures read `Student.placement_ctc`: one number per
# student, their best live offer. These read the offer rows themselves, so a
# student holding three offers counts three times. The two therefore report
# different medians *by design* — "what packages did our students get" is a
# question about students, "what are companies offering" is a question about
# offers — and both screens say which they are showing.


def _visible_offers(db: Session, user: User):
    """Offers this user may see, joined to the student they belong to.

    Scoped the same way routers/offers.py scopes its list: by company for an
    officer, not by drive. (The officer *dashboard* above still counts offers
    through drives, so an off-campus offer an officer recorded won't appear
    there — worth reconciling, but changing it would move numbers people are
    already reading, so it isn't done here.)
    """
    q = db.query(Offer).join(Student, Offer.student_id == Student.id)
    if user.college_id:
        q = q.filter(Student.college_id == user.college_id)
    if _is_officer_scope(user):
        officer = _officer_profile(db, user)
        company_ids = _assigned_company_ids(db, officer)
        if not company_ids:
            return None
        q = q.filter(Offer.company_id.in_(company_ids))
    return q


def _median(values: list[float]) -> Optional[float]:
    return round(statistics.median(values), 2) if values else None


def _rate(part: int, whole: int) -> Optional[float]:
    return round(part * 100 / whole, 1) if whole else None


def _live(status) -> bool:
    return status in WON_OFFER_STATUSES


@router.get("/offers")
def get_offer_analytics(
    batch_year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Offers cut by branch, company and role, plus how many were taken up.

    Packages are read off **live** offers only (accepted or joined): a rejected
    offer's CTC was never this college's number, and letting it into the median
    would flatter or depress it depending on who turned what down.
    """
    scope = "officer" if _is_officer_scope(current_user) else "college"
    empty = {
        "scope": scope,
        "batch_year": batch_year,
        "headline": {
            "offers": 0, "students_with_offer": 0, "students_with_multiple": 0,
            "median_ctc": None, "highest_ctc": None, "avg_ctc": None,
            "joining_conversion": None, "dropout_rate": None, "awaiting_joining_date": 0,
        },
        "funnel": [], "lost": {"rejected": 0, "dropout": 0},
        "by_branch": [], "by_company": [], "by_role": [], "offers_per_student": [],
    }

    q = _visible_offers(db, current_user)
    if q is None:
        return empty
    if batch_year:
        q = q.filter(Student.batch_year == batch_year)

    rows = q.with_entities(
        Offer.id, Offer.status, Offer.ctc, Offer.student_id, Offer.joining_date,
        Offer.role, Offer.company_id, Student.branch,
    ).all()
    if not rows:
        return empty

    company_names = dict(
        db.query(Company.id, Company.name)
        .filter(Company.id.in_({r.company_id for r in rows if r.company_id}))
        .all()
    ) if any(r.company_id for r in rows) else {}

    by_status: dict = defaultdict(int)
    per_student: dict = defaultdict(int)
    live_packages: list[float] = []
    awaiting = 0
    branches: dict = defaultdict(lambda: {"offers": 0, "students": set(), "joined": 0, "packages": []})
    companies: dict = defaultdict(lambda: {"offers": 0, "students": set(), "packages": []})
    roles: dict = defaultdict(lambda: {"offers": 0, "packages": []})

    for r in rows:
        by_status[r.status] += 1
        per_student[r.student_id] += 1
        live = _live(r.status)
        if live:
            if r.ctc is not None:
                live_packages.append(r.ctc)
            if r.joining_date is None:
                awaiting += 1

        branch = (r.branch or "Unrecorded").strip() or "Unrecorded"
        b = branches[branch]
        b["offers"] += 1
        b["students"].add(r.student_id)
        if r.status == OfferStatus.JOINED:
            b["joined"] += 1
        if live and r.ctc is not None:
            b["packages"].append(r.ctc)

        # An offer with no company is the "mark as placed" placeholder — it has
        # no company to attribute to, so it sits out the company breakdown
        # rather than being lumped under a made-up label.
        if r.company_id:
            c = companies[r.company_id]
            c["offers"] += 1
            c["students"].add(r.student_id)
            if live and r.ctc is not None:
                c["packages"].append(r.ctc)

        role = (r.role or "").strip()
        if role:
            ro = roles[role.lower()]
            ro["offers"] += 1
            ro.setdefault("label", role)
            if live and r.ctc is not None:
                ro["packages"].append(r.ctc)

    total = len(rows)
    accepted = by_status[OfferStatus.ACCEPTED]
    joined = by_status[OfferStatus.JOINED]
    dropout = by_status[OfferStatus.DROPOUT]
    taken_up = accepted + joined

    counts_per_student: dict = defaultdict(int)
    for n in per_student.values():
        counts_per_student[min(n, 3)] += 1

    return {
        "scope": scope,
        "batch_year": batch_year,
        "headline": {
            "offers": total,
            "students_with_offer": len(per_student),
            "students_with_multiple": sum(1 for n in per_student.values() if n > 1),
            "median_ctc": _median(live_packages),
            "highest_ctc": round(max(live_packages), 2) if live_packages else None,
            "avg_ctc": round(sum(live_packages) / len(live_packages), 2) if live_packages else None,
            # Of the offers students said yes to, the share that reached joining.
            "joining_conversion": _rate(joined, taken_up),
            # Of those same offers, the share that fell through afterwards.
            "dropout_rate": _rate(dropout, taken_up + dropout),
            "awaiting_joining_date": awaiting,
        },
        # Each stage is a subset of the one above it, so this reads as a funnel
        # rather than three statuses that happen to be drawn side by side.
        "funnel": [
            {"stage": "Offers made", "count": total},
            {"stage": "Taken up", "count": taken_up},
            {"stage": "Joined", "count": joined},
        ],
        "lost": {"rejected": by_status[OfferStatus.REJECTED], "dropout": dropout},
        "by_branch": sorted(
            (
                {
                    "branch": name,
                    "offers": v["offers"],
                    "students": len(v["students"]),
                    "joined": v["joined"],
                    "median_ctc": _median(v["packages"]),
                    "highest_ctc": round(max(v["packages"]), 2) if v["packages"] else None,
                }
                for name, v in branches.items()
            ),
            key=lambda d: -d["offers"],
        ),
        "by_company": sorted(
            (
                {
                    "company": company_names.get(cid, f"Company #{cid}"),
                    "offers": v["offers"],
                    "students": len(v["students"]),
                    "median_ctc": _median(v["packages"]),
                    "highest_ctc": round(max(v["packages"]), 2) if v["packages"] else None,
                }
                for cid, v in companies.items()
            ),
            key=lambda d: (-d["offers"], d["company"].lower()),
        )[:12],
        "by_role": sorted(
            (
                {"role": v["label"], "offers": v["offers"], "median_ctc": _median(v["packages"])}
                for v in roles.values()
            ),
            key=lambda d: (-d["offers"], d["role"].lower()),
        )[:12],
        "offers_per_student": [
            {"offers": "3+" if n == 3 else str(n), "students": counts_per_student[n]}
            for n in sorted(counts_per_student)
        ],
    }


# --- Student analytics ------------------------------------------------------
#
# Deliberately *not* "placement rate by risk band": student_scoring.assess()
# sets a placed student to readiness 100 and risk low, so that chart would
# always read "100% of low-risk students get placed" — it would be measuring its
# own definition. The bands below (CGPA, backlogs, training) are inputs the
# score is derived from rather than outputs of it, so the rates mean something.
# Risk is reported only as the mix among students still looking, which is the
# actionable question anyway.

# Placement statuses that mean the student is still looking.
SEEKING = (PlacementStatus.UNPLACED,)

CGPA_BANDS = [("9+", 9.0, None), ("8–9", 8.0, 9.0), ("7–8", 7.0, 8.0), ("6–7", 6.0, 7.0), ("Below 6", None, 6.0)]


def _cgpa_band(cgpa: Optional[float]) -> str:
    if cgpa is None:
        return "Not recorded"
    for label, lo, hi in CGPA_BANDS:
        if (lo is None or cgpa >= lo) and (hi is None or cgpa < hi):
            return label
    return "Not recorded"


def _empty_student_analytics(scope: str, batch_year: Optional[int]) -> dict:
    """The same shape as a populated response, so a caller never has to branch on
    whether any students came back."""
    return {
        "scope": scope,
        "batch_year": batch_year,
        "headline": {
            "students": 0, "placed": 0, "placement_rate": None,
            "seeking": 0, "avg_readiness_of_seeking": None,
        },
        "risk_of_seeking": [],
        "cgpa_bands": [],
        "backlogs": [],
        "training": None,
        "skills": {"placed": [], "seeking": [], "gaps": []},
    }


@router.get("/students")
def get_student_analytics(
    batch_year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Who is placed, against the things that might explain it: marks, backlogs,
    training and skills. Correlation only — these are the numbers that would tell
    you whether a predictive model is worth building, not the model itself."""
    scope = "officer" if _is_officer_scope(current_user) else "college"
    q = db.query(Student)
    if current_user.college_id:
        q = q.filter(Student.college_id == current_user.college_id)
    if _is_officer_scope(current_user):
        officer = _officer_profile(db, current_user)
        drive_ids = _drive_ids_for_companies(db, _assigned_company_ids(db, officer))
        student_ids = _officer_student_ids(db, drive_ids)
        if not student_ids:
            return _empty_student_analytics(scope, batch_year)
        q = q.filter(Student.id.in_(student_ids))
    if batch_year:
        q = q.filter(Student.batch_year == batch_year)

    students = q.with_entities(
        Student.id, Student.cgpa, Student.backlogs, Student.skills,
        Student.placement_status, Student.risk_category, Student.readiness_score,
    ).all()
    if not students:
        return _empty_student_analytics(scope, batch_year)

    placed_ids = {s.id for s in students if s.placement_status == PlacementStatus.PLACED}
    seeking = [s for s in students if s.placement_status in SEEKING]

    def bucket(key_fn):
        """Group students by a label and count how many of each group are placed."""
        groups: dict = defaultdict(lambda: {"students": 0, "placed": 0})
        for s in students:
            g = groups[key_fn(s)]
            g["students"] += 1
            if s.id in placed_ids:
                g["placed"] += 1
        return groups

    cgpa_groups = bucket(lambda s: _cgpa_band(s.cgpa))
    order = [b[0] for b in CGPA_BANDS] + ["Not recorded"]
    cgpa_bands = [
        {"band": b, "students": cgpa_groups[b]["students"], "placed": cgpa_groups[b]["placed"],
         "placement_rate": _rate(cgpa_groups[b]["placed"], cgpa_groups[b]["students"])}
        for b in order if b in cgpa_groups
    ]

    backlog_groups = bucket(lambda s: "No backlogs" if not (s.backlogs or 0) else
                            ("1–2 backlogs" if (s.backlogs or 0) <= 2 else "3+ backlogs"))
    backlogs = [
        {"band": b, "students": v["students"], "placed": v["placed"],
         "placement_rate": _rate(v["placed"], v["students"])}
        for b, v in sorted(backlog_groups.items(), key=lambda kv: ["No backlogs", "1–2 backlogs", "3+ backlogs"].index(kv[0]))
    ]

    risk_counts: dict = defaultdict(int)
    for s in seeking:
        risk_counts[s.risk_category or RiskCategory.MEDIUM] += 1
    risk_of_seeking = [
        {"band": band.value, "students": risk_counts.get(band, 0)}
        for band in (RiskCategory.HIGH, RiskCategory.MEDIUM, RiskCategory.LOW)
    ]
    readiness = [s.readiness_score for s in seeking if s.readiness_score is not None]

    # --- training -----------------------------------------------------------
    student_ids = [s.id for s in students]
    records = (
        db.query(
            StudentTraining.student_id, StudentTraining.score,
            StudentTraining.attendance_percent, StudentTraining.mock_test_score,
            StudentTraining.status,
        )
        .filter(StudentTraining.student_id.in_(student_ids))
        .all()
    ) if student_ids else []

    training = None
    if records:
        trained_ids = {r.student_id for r in records}
        attendance = [r.attendance_percent for r in records if r.attendance_percent is not None]
        scores = [r.score for r in records if r.score is not None]
        mocks = [r.mock_test_score for r in records if r.mock_test_score is not None]
        untrained = [s for s in students if s.id not in trained_ids]
        training = {
            "enrolments": len(records),
            "students_trained": len(trained_ids),
            "completed": sum(1 for r in records if r.status == "completed"),
            "avg_attendance": round(sum(attendance) / len(attendance), 1) if attendance else None,
            "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
            "avg_mock_score": round(sum(mocks) / len(mocks), 1) if mocks else None,
            # Correlation, not proof: the students who turn up for training are
            # rarely a random sample of the year.
            "placement_rate_trained": _rate(len(trained_ids & placed_ids), len(trained_ids)),
            "placement_rate_untrained": _rate(
                sum(1 for s in untrained if s.id in placed_ids), len(untrained)
            ),
        }

    # --- skills -------------------------------------------------------------
    # Free text, so the same skill arrives as "Python", "python " and "PYTHON".
    # Counted per student, not per mention: listing React twice isn't two people.
    def skill_counts(group) -> dict:
        counts: dict = defaultdict(int)
        for s in group:
            if not s.skills:
                continue
            seen = {part.strip().lower() for part in s.skills.split(",") if part.strip()}
            for skill in seen:
                counts[skill] += 1
        return counts

    placed_students = [s for s in students if s.id in placed_ids]
    placed_skills = skill_counts(placed_students)
    seeking_skills = skill_counts(seeking)

    def top(counts: dict, group_size: int, limit: int = 10):
        return [
            {"skill": k, "students": v, "share": _rate(v, group_size)}
            for k, v in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
        ]

    # The gap: skills common among placed students that the ones still looking
    # don't have. Restricted to skills at least a fifth of placed students list,
    # so a single placed student's niche tool doesn't read as a training need.
    gaps = []
    if placed_students:
        floor = max(1, len(placed_students) // 5)
        for skill, count in placed_skills.items():
            if count < floor:
                continue
            placed_share = _rate(count, len(placed_students)) or 0
            seeking_share = _rate(seeking_skills.get(skill, 0), len(seeking)) or 0
            if placed_share > seeking_share:
                gaps.append({
                    "skill": skill,
                    "placed_share": placed_share,
                    "seeking_share": seeking_share,
                    "gap": round(placed_share - seeking_share, 1),
                })
        gaps.sort(key=lambda d: -d["gap"])

    return {
        "scope": scope,
        "batch_year": batch_year,
        "headline": {
            "students": len(students),
            "placed": len(placed_ids),
            "placement_rate": _rate(len(placed_ids), len(students)),
            "seeking": len(seeking),
            # Placed students are scored 100 by definition, so an average over
            # everyone would just track the placement rate. This is the average
            # for the students the number is actually about.
            "avg_readiness_of_seeking": round(sum(readiness) / len(readiness), 1) if readiness else None,
        },
        "risk_of_seeking": risk_of_seeking,
        "cgpa_bands": cgpa_bands,
        "backlogs": backlogs,
        "training": training,
        "skills": {
            "placed": top(placed_skills, len(placed_students)),
            "seeking": top(seeking_skills, len(seeking)),
            "gaps": gaps[:10],
        },
    }


@router.get("/batch-years")
def get_batch_years(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Batch years on file, newest first — the filter both screens above share."""
    q = db.query(Student.batch_year).distinct()
    if current_user.college_id:
        q = q.filter(Student.college_id == current_user.college_id)
    return sorted({r[0] for r in q.all() if r[0]}, reverse=True)


# --- Company analytics -------------------------------------------------------
#
# The arithmetic lives in services/company_metrics.py because the Company
# Conversion report answers the same question in another shape. One definition
# of "contacted", two presentations.


@router.get("/companies")
def get_company_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
):
    """Where the company pipeline actually is: the mix on file, how far each
    stage converts, whether outreach gets answered, and who has gone quiet."""
    from app.services.company_metrics import (
        company_rows, engagement_by_company, funnel, status_mix,
    )

    rows = company_rows(db, current_user)
    if not rows:
        return {
            "companies": 0, "status_mix": [], "funnel": [], "reply_rate": None,
            "logged": 0, "replied": 0, "stale": 0, "never_contacted": 0,
            "unassigned": 0, "without_contacts": 0, "top_companies": [],
            "going_quiet": [], "engagement": [],
        }

    logged = sum(r.logged for r in rows)
    replied = sum(r.replied for r in rows)
    engagement = engagement_by_company(db, current_user)

    # Companies worth chasing that nobody has spoken to lately. Blacklisted and
    # dormant ones are left out: they are quiet on purpose.
    workable = [r for r in rows if r.status not in ("blacklisted", "dormant")]
    going_quiet = sorted(
        (r for r in workable if r.stale and r.offers == 0),
        key=lambda r: (r.days_since_contact is None, -(r.days_since_contact or 0)),
    )[:10]

    top = sorted(rows, key=lambda r: (-len(r.placed), -r.offers, r.name.lower()))[:10]

    return {
        "companies": len(rows),
        "status_mix": [{"status": s, "companies": n} for s, n in status_mix(rows)],
        "funnel": [{"stage": stage, "companies": n} for stage, n in funnel(rows)],
        "logged": logged,
        "replied": replied,
        # Of all outreach logged, the share marked answered. Unlike the per-channel
        # rate on the HR tab this keeps awaited entries in the denominator, because
        # here the question is "how much of what we sent came back", not "how good
        # is this channel".
        "reply_rate": round(replied * 100 / logged, 1) if logged else None,
        "stale": sum(1 for r in workable if r.stale),
        "never_contacted": sum(1 for r in workable if not r.logged),
        "unassigned": sum(1 for r in rows if r.owner == "Unassigned"),
        "without_contacts": sum(1 for r in rows if not r.contacts),
        "top_companies": [
            {
                "company": r.name, "status": r.status, "owner": r.owner,
                "logged": r.logged, "reply_rate": r.reply_rate, "drives": r.drives,
                "offers": r.offers, "students_placed": len(r.placed),
                "engagement": (engagement.get(r.id) or {}).get("score"),
            }
            for r in top
        ],
        "going_quiet": [
            {
                "company": r.name, "status": r.status, "owner": r.owner,
                "days_since_contact": r.days_since_contact, "logged": r.logged,
            }
            for r in going_quiet
        ],
        "engagement": [
            {"company": r.name, "score": engagement[r.id]["score"],
             "contacts_scored": engagement[r.id]["contacts_scored"]}
            for r in sorted(rows, key=lambda r: -(engagement.get(r.id, {}).get("score", -1)))
            if r.id in engagement
        ][:10],
    }


# --- HR analytics ------------------------------------------------------------


@router.get("/hr")
def get_hr_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
):
    """Whether outreach is landing: which channels get answered, how the
    relationships are banded, and what is overdue."""
    from app.services.hr_metrics import (
        channel_stats, contact_scores, engagement_mix, followup_buckets,
    )

    contacts, scores, company_of = contact_scores(db, current_user)
    channels = channel_stats(db, current_user)
    now = datetime.utcnow()
    late_before = overdue_before()

    # The escalation list: relationships that have gone cold or silent, worst
    # first. Ordered by how long they have been ignored rather than by score, so
    # it reads as a work queue.
    alerts = []
    for contact in contacts:
        result = scores.get(contact.id)
        overdue_days = (
            (now - contact.next_followup_date).days
            if contact.next_followup_date and contact.next_followup_date < late_before
            else None
        )
        stale = result["stale"] if result else True
        if overdue_days is None and not stale:
            continue
        alerts.append({
            "contact": contact.name,
            "company": company_of.get(contact.id, "—"),
            "band": result["band"] if result else "no history",
            "days_since_contact": result["days_since_contact"] if result else None,
            "overdue_days": overdue_days,
            "reason": (
                "Follow-up overdue" if overdue_days is not None
                else "Nothing logged yet" if not result
                else "No contact in six months"
            ),
        })
    alerts.sort(key=lambda a: (-(a["overdue_days"] or 0), -(a["days_since_contact"] or 0)))

    replied = sum(c["replied"] for c in channels)
    decided = sum(c["replied"] + c["no_response"] for c in channels)
    return {
        "contacts": len(contacts),
        "logged": sum(c["logged"] for c in channels),
        "replied": replied,
        "reply_rate": round(replied * 100 / decided, 1) if decided else None,
        "awaiting": sum(c["awaiting"] for c in channels),
        "channels": channels,
        "engagement": engagement_mix(scores, len(contacts)),
        "followups": followup_buckets(contacts, now),
        "alerts": alerts[:12],
        "alert_total": len(alerts),
    }


# --- Drive analytics ---------------------------------------------------------


@router.get("/drives")
def get_drive_analytics(
    batch_year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
):
    """How drives convert: participants through the rounds, and what came out.

    Round figures are the counts officers entered on each round, not a
    recomputation from participant statuses — the two can legitimately differ
    (a student who cleared a round then withdrew), and silently reconciling them
    would hide that rather than show it.
    """
    cid = current_user.college_id
    drives_q = db.query(Drive)
    if cid:
        drives_q = drives_q.filter(Drive.college_id == cid)
    drives = drives_q.all()
    drive_ids = [d.id for d in drives]
    if not drive_ids:
        return {
            "drives": 0, "by_status": [], "participants": 0, "funnel": [],
            "rounds": [], "conversion": {}, "by_drive": [],
        }

    participants = (
        db.query(DriveParticipant.drive_id, DriveParticipant.status,
                 DriveParticipant.student_id)
        .filter(DriveParticipant.drive_id.in_(drive_ids))
        .all()
    )
    if batch_year:
        student_batch = dict(
            db.query(Student.id, Student.batch_year)
            .filter(Student.id.in_({p.student_id for p in participants}))
            .all()
        )
        participants = [p for p in participants if student_batch.get(p.student_id) == batch_year]

    status_counts: dict = defaultdict(int)
    per_drive: dict[int, dict] = defaultdict(lambda: {"participants": 0, "selected": 0, "rejected": 0})
    for p in participants:
        status_counts[p.status] += 1
        row = per_drive[p.drive_id]
        row["participants"] += 1
        if p.status == ParticipantStatus.SELECTED:
            row["selected"] += 1
        elif p.status == ParticipantStatus.REJECTED:
            row["rejected"] += 1

    total_participants = len(participants)
    selected = status_counts[ParticipantStatus.SELECTED]
    rejected = status_counts[ParticipantStatus.REJECTED]
    withdrawn = status_counts[ParticipantStatus.WITHDRAWN]
    # Everyone who got past registration — the drives' working set.
    beyond_registration = total_participants - status_counts[ParticipantStatus.REGISTERED]

    offers = (
        db.query(Offer.drive_id, Offer.status, Offer.student_id)
        .filter(Offer.drive_id.in_(drive_ids))
        .all()
    )
    offer_count = len(offers)
    won = sum(1 for o in offers if o.status in WON_OFFER_STATUSES)
    for o in offers:
        per_drive[o.drive_id]["offers"] = per_drive[o.drive_id].get("offers", 0) + 1

    rounds = (
        db.query(DriveRound.round_number, DriveRound.name,
                 DriveRound.appeared_count, DriveRound.passed_count)
        .filter(DriveRound.drive_id.in_(drive_ids))
        .all()
    )
    by_round: dict[int, dict] = defaultdict(lambda: {"appeared": 0, "passed": 0, "rounds": 0, "names": set()})
    for number, name, appeared, passed in rounds:
        if appeared is None and passed is None:
            continue  # nothing recorded for this round yet
        bucket = by_round[number]
        bucket["rounds"] += 1
        bucket["appeared"] += appeared or 0
        bucket["passed"] += passed or 0
        if name:
            bucket["names"].add(name)

    round_rows = []
    for number in sorted(by_round):
        b = by_round[number]
        appeared, passed = b["appeared"], b["passed"]
        round_rows.append({
            "round": number,
            # The most common label officers gave this round, when they gave one.
            "name": sorted(b["names"])[0] if b["names"] else f"Round {number}",
            "drives": b["rounds"],
            "appeared": appeared,
            "passed": passed,
            "dropped": max(0, appeared - passed),
            "pass_rate": round(passed * 100 / appeared, 1) if appeared else None,
        })

    company_names = dict(
        db.query(Company.id, Company.name).filter(
            Company.id.in_({d.company_id for d in drives})
        ).all()
    )
    by_drive = sorted(
        (
            {
                "drive": f"{company_names.get(d.company_id, 'Company')} — {d.job_role}",
                "status": d.status.value if d.status else "—",
                "participants": per_drive[d.id]["participants"],
                "selected": per_drive[d.id]["selected"],
                "offers": per_drive[d.id].get("offers", 0),
                "selection_rate": (
                    round(per_drive[d.id]["selected"] * 100 / per_drive[d.id]["participants"], 1)
                    if per_drive[d.id]["participants"] else None
                ),
            }
            for d in drives
        ),
        key=lambda r: (-r["selected"], -r["participants"]),
    )[:12]

    status_mix = defaultdict(int)
    for d in drives:
        status_mix[d.status.value if d.status else "—"] += 1

    return {
        "drives": len(drives),
        "batch_year": batch_year,
        "by_status": [{"status": s, "drives": n} for s, n in
                      sorted(status_mix.items(), key=lambda kv: -kv[1])],
        "participants": total_participants,
        # Subsets, so this reads as a funnel.
        "funnel": [
            {"stage": "Registered", "count": total_participants},
            {"stage": "Took part", "count": beyond_registration},
            {"stage": "Selected", "count": selected},
            {"stage": "Offer recorded", "count": offer_count},
        ],
        "lost": {"rejected": rejected, "withdrawn": withdrawn},
        "rounds": round_rows,
        "conversion": {
            "selection_rate": round(selected * 100 / total_participants, 1) if total_participants else None,
            "offers_per_selection": round(offer_count / selected, 2) if selected else None,
            "offers_won": won,
            "offer_conversion": round(won * 100 / offer_count, 1) if offer_count else None,
        },
        "by_drive": by_drive,
    }


@router.get("/risk-calibration")
def get_risk_calibration(
    batch_year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
):
    """Whether the risk score predicts anything, measured on a settled batch.

    Scores every student on their *inputs* only — the stored risk band folds in
    placement status, so validating that against placement would be circular —
    and reports what actually happened to each band. Runs the current rule and a
    richer candidate side by side, so a change to the scorer can be argued from
    this college's own outcomes rather than asserted.
    """
    from app.services.risk import calibration

    return calibration(db, current_user, batch_year)
