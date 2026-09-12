"""What the system already knows about a person's day.

The point of the daily update is that officers should not retype numbers the
database can produce. Self-reported activity counts are worth very little; counts
derived from the calls, drives and offers already recorded are worth reading. So
the officer only types judgment - highlights, blockers, escalations, tomorrow's
plan - and everything countable is computed here.

Every timestamp in the database is naive UTC, so each function converts the
*local* day it is asked about into UTC bounds (see app.core.timeutil) before
comparing. Passing a bare date into a query would silently be wrong by 5.5 hours.

Thresholds are imported from the analytics router rather than redefined, so the
daily digest and the dashboards can never disagree about what "stale" means.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.core.timeutil import day_bounds_utc, to_local
from app.models.communication import Communication
from app.models.company import Company, CompanyStatus, HRContact
from app.models.drive import Drive, DriveRound
from app.models.offer import Offer
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.student import RiskCategory, Student
from app.models.training import StudentTraining, TrainingModule
from app.models.user import User, UserRole

# Single source of truth for the thresholds, shared with /analytics so the digest
# and the officer dashboards can never disagree about what "stale" means.
from app.routers.analytics import (
    STALE_AFTER_DAYS,
    WON_OFFER_STATUSES,
    _assigned_company_ids,
    _drive_ids_for_companies,
    _percent,
)

# Communication types, in the order they read best on the page.
COMM_KEYS = ("calls", "emails", "meetings", "whatsapp", "linkedin")
_COMM_TYPE_TO_KEY = {
    "call": "calls",
    "email": "emails",
    "meeting": "meetings",
    "whatsapp": "whatsapp",
    "linkedin": "linkedin",
}

# The keys that decide whether a day counts as "something happened".
ACTIVITY_KEYS = (
    *COMM_KEYS,
    "new_companies",
    "hr_contacts_added",
    "drives_conducted",
    "drives_scheduled",
    "rounds_conducted",
    "offers",
    "trainings_completed",
    "trainings_enrolled",
)


def _comm_key(comm_type) -> str | None:
    raw = comm_type.value if hasattr(comm_type, "value") else comm_type
    return _COMM_TYPE_TO_KEY.get(raw)


def has_activity(metrics: dict | None) -> bool:
    """True when any countable thing happened. Drives the digest's
    "filed but nothing moved" exception list."""
    if not metrics:
        return False
    return any(metrics.get(key) or 0 for key in ACTIVITY_KEYS)


def _college_clause(model, college_id: int | None):
    """Tenant filter that is a no-op for super_admin, who has no college_id."""
    return model.college_id == college_id if college_id else True


# --- Officer ----------------------------------------------------------------


def officer_day_metrics(db: Session, user: User, officer: PlacementOfficer, day: date) -> dict:
    """One officer's day: their own outreach, and what moved on their companies."""
    start, end = day_bounds_utc(day)
    company_ids = _assigned_company_ids(db, officer)
    drive_ids = _drive_ids_for_companies(db, company_ids)

    metrics: dict = {key: 0 for key in COMM_KEYS}

    # Only outreach attributed to this officer counts as their activity - a head's
    # log on their company is contact, but it is not work they did.
    todays_comms = (
        db.query(Communication.company_id, Communication.comm_type)
        .filter(
            Communication.officer_id == officer.id,
            Communication.communicated_at >= start,
            Communication.communicated_at < end,
        )
        .all()
    )
    touched: set[int] = set()
    for company_id, comm_type in todays_comms:
        key = _comm_key(comm_type)
        if key:
            metrics[key] += 1
        if company_id:
            touched.add(company_id)
    metrics["communications"] = len(todays_comms)
    metrics["companies_touched"] = len(touched)

    metrics["new_companies"] = (
        db.query(Company)
        .filter(
            Company.created_by_id == user.id,
            Company.created_at >= start,
            Company.created_at < end,
        )
        .count()
    )

    metrics["hr_contacts_added"] = (
        db.query(HRContact)
        .filter(
            HRContact.company_id.in_(company_ids),
            HRContact.created_at >= start,
            HRContact.created_at < end,
        )
        .count()
        if company_ids
        else 0
    )

    metrics["drives_conducted"] = (
        db.query(Drive)
        .filter(
            Drive.company_id.in_(company_ids),
            Drive.drive_date >= start,
            Drive.drive_date < end,
        )
        .count()
        if company_ids
        else 0
    )
    metrics["drives_scheduled"] = (
        db.query(Drive)
        .filter(
            Drive.company_id.in_(company_ids),
            Drive.created_at >= start,
            Drive.created_at < end,
        )
        .count()
        if company_ids
        else 0
    )
    metrics["rounds_conducted"] = (
        db.query(DriveRound)
        .filter(
            DriveRound.drive_id.in_(drive_ids),
            DriveRound.conducted_at >= start,
            DriveRound.conducted_at < end,
        )
        .count()
        if drive_ids
        else 0
    )

    todays_offers = (
        db.query(Offer.status)
        .filter(
            Offer.drive_id.in_(drive_ids),
            Offer.created_at >= start,
            Offer.created_at < end,
        )
        .all()
        if drive_ids
        else []
    )
    metrics["offers"] = len(todays_offers)
    metrics["offers_won"] = sum(1 for (status,) in todays_offers if status in WON_OFFER_STATUSES)

    metrics.update(_officer_standing(db, officer, company_ids, drive_ids))
    return metrics


def _officer_standing(
    db: Session, officer: PlacementOfficer, company_ids: list[int], drive_ids: list[int]
) -> dict:
    """Counts that describe where the officer stands rather than what happened
    today: what is owed, what is going cold, how the targets look."""
    now = datetime.utcnow()

    open_followups = (
        db.query(Communication.next_followup_date)
        .filter(
            Communication.officer_id == officer.id,
            Communication.next_followup_date.isnot(None),
            or_(
                Communication.response_received.is_(None),
                Communication.response_received != "received",
            ),
        )
        .all()
    )
    overdue = sum(1 for (due,) in open_followups if due and due < now)

    # Last contact per company, whoever logged it - staleness is a property of the
    # relationship, not of who happened to make the call.
    stale_cutoff = now - timedelta(days=STALE_AFTER_DAYS)
    last_contact: dict[int, datetime] = {}
    if company_ids:
        for company_id, when in (
            db.query(Communication.company_id, Communication.communicated_at)
            .filter(Communication.company_id.in_(company_ids))
            .all()
        ):
            if when and (company_id not in last_contact or when > last_contact[company_id]):
                last_contact[company_id] = when
    stale = sum(
        1 for cid in company_ids if cid not in last_contact or last_contact[cid] < stale_cutoff
    )

    won_total = (
        db.query(Offer)
        .filter(Offer.drive_id.in_(drive_ids), Offer.status.in_(WON_OFFER_STATUSES))
        .count()
        if drive_ids
        else 0
    )

    return {
        "companies_assigned": len(company_ids),
        "open_followups": len(open_followups),
        "overdue_followups": overdue,
        "stale_companies": stale,
        "target_companies": officer.target_companies or 0,
        "target_offers": officer.target_offers or 0,
        "target_companies_percent": _percent(len(company_ids), officer.target_companies),
        "target_offers_percent": _percent(won_total, officer.target_offers),
    }


# --- Coordinator ------------------------------------------------------------


def coordinator_day_metrics(db: Session, user: User, college_id: int | None, day: date) -> dict:
    """A coordinator's day is about student readiness rather than companies, so
    the counts come from training records instead of outreach."""
    start, end = day_bounds_utc(day)

    student_ids = [
        row[0]
        for row in db.query(Student.id).filter(_college_clause(Student, college_id)).all()
    ]

    completed = enrolled = 0
    if student_ids:
        completed = (
            db.query(StudentTraining)
            .filter(
                StudentTraining.student_id.in_(student_ids),
                StudentTraining.completed_at >= start,
                StudentTraining.completed_at < end,
            )
            .count()
        )
        enrolled = (
            db.query(StudentTraining)
            .filter(
                StudentTraining.student_id.in_(student_ids),
                StudentTraining.created_at >= start,
                StudentTraining.created_at < end,
            )
            .count()
        )

    return {
        "trainings_completed": completed,
        "trainings_enrolled": enrolled,
        "modules_added": (
            db.query(TrainingModule)
            .filter(
                _college_clause(TrainingModule, college_id),
                TrainingModule.created_at >= start,
                TrainingModule.created_at < end,
            )
            .count()
        ),
        "students_at_risk": (
            db.query(Student)
            .filter(
                _college_clause(Student, college_id),
                Student.risk_category == RiskCategory.HIGH,
            )
            .count()
        ),
        "students_tracked": len(student_ids),
    }


# --- College-wide -----------------------------------------------------------

# The shape every day-bucket carries, so the digest can sum and average without
# guarding for missing keys.
_EMPTY_DAY = {
    **{key: 0 for key in COMM_KEYS},
    "communications": 0,
    "companies_touched": 0,
    "new_companies": 0,
    "drives_conducted": 0,
    "offers": 0,
    "offers_won": 0,
    "trainings_completed": 0,
}

TOTAL_KEYS = tuple(_EMPTY_DAY)


def college_totals_by_day(db: Session, college_id: int | None, days: list[date]) -> dict:
    """Day-by-day college activity across a list of local dates.

    Computed from the source tables, not from what officers filed, so the digest
    still shows the day honestly when somebody skips their update. Pulled over the
    whole range in one pass per table and bucketed in Python - the same shape
    analytics.officer_performance uses - so a 7-day trend costs a handful of
    queries rather than one per day.
    """
    if not days:
        return {}
    start, _ = day_bounds_utc(min(days))
    _, end = day_bounds_utc(max(days))
    buckets: dict[date, dict] = {day: dict(_EMPTY_DAY) for day in days}
    touched: dict[date, set[int]] = defaultdict(set)

    def bucket_for(timestamp: datetime | None) -> tuple[date | None, dict | None]:
        local = to_local(timestamp)
        if local is None:
            return None, None
        day = local.date()
        return day, buckets.get(day)

    for company_id, comm_type, when in (
        db.query(Communication.company_id, Communication.comm_type, Communication.communicated_at)
        .filter(
            _college_clause(Communication, college_id),
            Communication.communicated_at >= start,
            Communication.communicated_at < end,
        )
        .all()
    ):
        day, bucket = bucket_for(when)
        if bucket is None:
            continue
        key = _comm_key(comm_type)
        if key:
            bucket[key] += 1
        bucket["communications"] += 1
        if company_id:
            touched[day].add(company_id)
    for day, company_ids in touched.items():
        if day in buckets:
            buckets[day]["companies_touched"] = len(company_ids)

    for (when,) in (
        db.query(Company.created_at)
        .filter(
            _college_clause(Company, college_id),
            Company.created_at >= start,
            Company.created_at < end,
        )
        .all()
    ):
        _, bucket = bucket_for(when)
        if bucket is not None:
            bucket["new_companies"] += 1

    for (when,) in (
        db.query(Drive.drive_date)
        .filter(
            _college_clause(Drive, college_id),
            Drive.drive_date >= start,
            Drive.drive_date < end,
        )
        .all()
    ):
        _, bucket = bucket_for(when)
        if bucket is not None:
            bucket["drives_conducted"] += 1

    # Offers carry no college_id of their own; they reach it through the drive.
    drive_ids = [
        row[0] for row in db.query(Drive.id).filter(_college_clause(Drive, college_id)).all()
    ]
    if drive_ids:
        for status, when in (
            db.query(Offer.status, Offer.created_at)
            .filter(
                Offer.drive_id.in_(drive_ids),
                Offer.created_at >= start,
                Offer.created_at < end,
            )
            .all()
        ):
            _, bucket = bucket_for(when)
            if bucket is not None:
                bucket["offers"] += 1
                if status in WON_OFFER_STATUSES:
                    bucket["offers_won"] += 1

    student_ids = [
        row[0] for row in db.query(Student.id).filter(_college_clause(Student, college_id)).all()
    ]
    if student_ids:
        for (when,) in (
            db.query(StudentTraining.completed_at)
            .filter(
                StudentTraining.student_id.in_(student_ids),
                StudentTraining.completed_at >= start,
                StudentTraining.completed_at < end,
            )
            .all()
        ):
            _, bucket = bucket_for(when)
            if bucket is not None:
                bucket["trainings_completed"] += 1

    return buckets


def standing_counts(db: Session, college_id: int | None) -> dict:
    """College-wide things that are owed or going cold - the standing worry list
    that sits under the day's exceptions in the digest."""
    now = datetime.utcnow()
    stale_cutoff = now - timedelta(days=STALE_AFTER_DAYS)

    overdue = (
        db.query(Communication)
        .filter(
            _college_clause(Communication, college_id),
            Communication.next_followup_date.isnot(None),
            Communication.next_followup_date < now,
            or_(
                Communication.response_received.is_(None),
                Communication.response_received != "received",
            ),
        )
        .count()
    )

    # Counted in SQL rather than by pulling ids into Python: a college that has
    # bulk-imported its company list carries thousands of rows, and an IN clause
    # that size is slow against a hosted database.
    live_companies = db.query(Company.id).filter(
        _college_clause(Company, college_id),
        Company.status != CompanyStatus.BLACKLISTED,
    )

    last_contact = (
        select(func.max(Communication.communicated_at))
        .where(Communication.company_id == Company.id)
        .correlate(Company)
        .scalar_subquery()
    )
    stale = live_companies.filter(
        or_(last_contact.is_(None), last_contact < stale_cutoff)
    ).count()

    unassigned = live_companies.filter(
        ~exists().where(CompanyAssignment.company_id == Company.id)
    ).count()

    return {
        "overdue_followups": overdue,
        "stale_companies": stale,
        "pending_lead_reviews": (
            db.query(Company)
            .filter(
                _college_clause(Company, college_id),
                Company.review_status == "pending",
            )
            .count()
        ),
        "unassigned_companies": unassigned,
    }


# --- Prompts ----------------------------------------------------------------


def build_prompts(metrics: dict, kind: str) -> list[str]:
    """Short, actionable nudges shown beside the form - the few things worth doing
    before filing. Deliberately capped: a wall of warnings gets ignored."""
    prompts: list[str] = []
    if kind == "officer":
        overdue = metrics.get("overdue_followups") or 0
        if overdue:
            prompts.append(
                f"{overdue} follow-up{'s' if overdue != 1 else ''} "
                f"{'are' if overdue != 1 else 'is'} past due."
            )
        stale = metrics.get("stale_companies") or 0
        if stale:
            prompts.append(
                f"{stale} of your companies {'have' if stale != 1 else 'has'} had no "
                f"contact in {STALE_AFTER_DAYS}+ days."
            )
        if not has_activity(metrics):
            prompts.append(
                "Nothing is logged against you today - if you made calls or visits, "
                "log them first so they count."
            )
    else:
        at_risk = metrics.get("students_at_risk") or 0
        if at_risk:
            prompts.append(
                f"{at_risk} student{'s are' if at_risk != 1 else ' is'} flagged high-risk."
            )
        if not has_activity(metrics):
            prompts.append("No training records were updated today.")
    return prompts[:3]


# --- Dispatch ---------------------------------------------------------------


def filer_kind(user: User, officer: PlacementOfficer | None) -> str | None:
    """Which flavour of update this account files, or None if it files none.

    An officer account with no PlacementOfficer card cannot file: there is nothing
    to attribute the work to, which is the same rule /analytics/my-work applies.
    """
    if user.role == UserRole.PLACEMENT_OFFICER and officer is not None:
        return "officer"
    if user.role == UserRole.DEPARTMENT_COORDINATOR:
        return "coordinator"
    return None


def metrics_for(
    db: Session, user: User, officer: PlacementOfficer | None, kind: str, day: date
) -> dict:
    if kind == "officer" and officer is not None:
        return officer_day_metrics(db, user, officer, day)
    return coordinator_day_metrics(db, user, user.college_id, day)
