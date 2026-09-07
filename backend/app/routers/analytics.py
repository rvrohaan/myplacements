from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.communication import Communication
from app.models.company import Company, CompanyStatus
from app.models.drive import Drive, DriveParticipant, DriveStatus, ParticipantStatus
from app.models.offer import Offer, OfferStatus
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.student import PlacementStatus, Student
from app.models.user import User, UserRole

router = APIRouter(prefix="/analytics", tags=["analytics"])

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

    # Outreach is attributed either explicitly (officer_id on the log) or through
    # the company allocation, since logs don't always carry an officer.
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

    comms_30d = sum(
        1 for c in communications if c.communicated_at and c.communicated_at >= recent_cutoff
    )
    open_followups = [
        c
        for c in communications
        if c.next_followup_date and (c.response_received or "") != "received"
    ]
    overdue = [c for c in open_followups if c.next_followup_date < now]

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
            "total": len(communications),
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
                "overdue": c.next_followup_date < now,
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
        # Prefer the officer stamped on the log; fall back to whoever owns the
        # company it was logged against.
        owner = comm_officer_id if comm_officer_id in officer_id_set else company_owner.get(company_id)
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
