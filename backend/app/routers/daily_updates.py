"""Daily updates from placement officers, and the leadership digest over them.

The split that makes this work: everything countable is derived (see
app.services.daily_metrics) and everything typed is judgment. An officer files in
about a minute, and the pro-chancellor reads numbers nobody could inflate.

Visibility follows the same rule as communications - a filer sees only their own
updates, leadership sees the whole college - except that leadership can also
acknowledge and reply, which is what keeps officers filing past week three.
"""

import logging
import secrets
from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.links import tenant_url
from app.core.deps import get_current_user, require_roles
from app.core.tenant import get_optional_college
from app.core.timeutil import (
    DEFAULT_CUTOFF,
    local_now,
    local_today,
    parse_cutoff,
    to_naive_utc,
)
from app.models.college import College
from app.models.communication import Communication
from app.models.daily_update import DailyUpdate, DailyUpdateRun
from app.models.officer import PlacementOfficer
from app.models.user import User, UserRole
from app.schemas.daily_update import (
    DailyUpdateCreate,
    DailyUpdateOut,
    DailyUpdateReview,
    DailyUpdateSettings,
    DailyUpdateUpdate,
)
from app.services import notifications, notify
from app.services.ai_service import draft_escalation_reply
from app.services.daily_metrics import (
    TOTAL_KEYS,
    build_prompts,
    college_totals_by_day,
    filer_kind,
    has_activity,
    metrics_for,
    standing_counts,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/daily-updates", tags=["daily-updates"])

# Leadership reads every update in the college and may acknowledge or correct any
# of them. Same membership as the tuples in analytics.py and communications.py.
LEADERSHIP_ROLES = (
    UserRole.SUPER_ADMIN,
    UserRole.PRINCIPAL,
    UserRole.PRO_CHANCELLOR,
    UserRole.DEPUTY_PRO_CHANCELLOR,
)

# Roles expected to file something every working day.
FILER_ROLES = (UserRole.PLACEMENT_OFFICER, UserRole.DEPARTMENT_COORDINATOR)

# How long before the cutoff the "you haven't filed yet" nudge goes out, and how
# long after it to wait before mailing the digest (so late filings still land).
REMINDER_LEAD = timedelta(hours=2)
DIGEST_DELAY = timedelta(hours=1)

# Days of history behind the digest's baseline average and trend chart.
TREND_DAYS = 7


# --- Helpers ----------------------------------------------------------------


def _officer_profile(db: Session, user: User) -> Optional[PlacementOfficer]:
    return db.query(PlacementOfficer).filter(PlacementOfficer.user_id == user.id).first()


def _resolve_college(
    db: Session, current_user: User, tenant: College | None
) -> Optional[College]:
    """The college this request is about.

    Everyone except a super_admin carries their own college_id. A super_admin has
    none, so fall back to the tenant the request arrived on - otherwise their
    digest would silently span every college on the platform.
    """
    if current_user.college_id:
        return db.query(College).filter(College.id == current_user.college_id).first()
    return tenant


def _cutoff_of(college: College | None) -> str:
    return (college.daily_update_cutoff if college else None) or DEFAULT_CUTOFF


def _can_edit(update: DailyUpdate, current_user: User) -> bool:
    """Filers edit their own update; leadership may correct any of them."""
    return current_user.role in LEADERSHIP_ROLES or update.submitted_by_id == current_user.id


def _serialize(update: DailyUpdate, current_user: User | None) -> DailyUpdateOut:
    out = DailyUpdateOut.model_validate(update)
    if update.submitted_by:
        out.submitted_by_name = update.submitted_by.full_name
        out.submitted_by_role = (
            update.submitted_by.role.value if update.submitted_by.role else None
        )
    if update.officer and update.officer.user:
        out.officer_name = update.officer.user.full_name
    if update.reviewed_by:
        out.reviewed_by_name = update.reviewed_by.full_name
    out.no_activity = update.work_mode != "leave" and not has_activity(update.metrics)
    if current_user is not None:
        out.can_edit = _can_edit(update, current_user)
        out.can_review = current_user.role in LEADERSHIP_ROLES
    return out


def _scoped(db: Session, current_user: User):
    """The updates this user may see: their own, or the whole college for
    leadership. One officer never reads another officer's update."""
    q = db.query(DailyUpdate)
    if current_user.college_id:
        q = q.filter(DailyUpdate.college_id == current_user.college_id)
    if current_user.role not in LEADERSHIP_ROLES:
        q = q.filter(DailyUpdate.submitted_by_id == current_user.id)
    return q


def _expected_filers(db: Session, college_id: int | None) -> list[tuple[User, PlacementOfficer | None, str]]:
    """Everyone in the college who owes an update, with their officer card and
    which flavour they file. An officer account with no PlacementOfficer card is
    excluded - there is nothing to attribute their work to."""
    q = db.query(User).filter(User.is_active == True, User.role.in_(FILER_ROLES))  # noqa: E712
    if college_id:
        q = q.filter(User.college_id == college_id)
    users = q.order_by(User.full_name).all()

    officers = {
        officer.user_id: officer
        for officer in db.query(PlacementOfficer)
        .filter(PlacementOfficer.user_id.in_([u.id for u in users]))
        .all()
    } if users else {}

    rows = []
    for user in users:
        officer = officers.get(user.id)
        kind = filer_kind(user, officer)
        if kind:
            rows.append((user, officer, kind))
    return rows


def _tenant_url(college: College | None, path: str) -> str:
    """A link into the app on the tenant's own host - the only host where these
    accounts can sign in."""
    return tenant_url(college, path)


def _derive_status(cutoff: str, day: date) -> str:
    """On time only if filed before the cutoff on the day itself; anything filed
    for a past date is late by definition."""
    now = local_now()
    if day < now.date():
        return "late"
    return "late" if now > parse_cutoff(cutoff, day) else "on_time"


# --- Filing -----------------------------------------------------------------


@router.get("/today")
def get_today(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant: College | None = Depends(get_optional_college),
):
    """Everything the filing page needs in one request: today's derived counts,
    the nudges worth acting on, and the update if one has already been filed."""
    officer = _officer_profile(db, current_user)
    kind = filer_kind(current_user, officer)
    if kind is None:
        raise HTTPException(
            status_code=404,
            detail="Daily updates are filed by placement officers and department coordinators",
        )

    college = _resolve_college(db, current_user, tenant)
    cutoff = _cutoff_of(college)
    day = local_today()
    derived = metrics_for(db, current_user, officer, kind, day)

    existing = (
        _scoped(db, current_user)
        .filter(DailyUpdate.report_date == day, DailyUpdate.submitted_by_id == current_user.id)
        .first()
    )

    return {
        "date": day.isoformat(),
        "kind": kind,
        "cutoff": cutoff,
        "deadline_passed": local_now() > parse_cutoff(cutoff, day),
        "enabled": bool(college.daily_update_enabled) if college else True,
        "derived": derived,
        "prompts": build_prompts(derived, kind),
        "existing": _serialize(existing, current_user) if existing else None,
    }


@router.get("/mine", response_model=list[DailyUpdateOut])
def list_mine(
    limit: int = Query(default=14, le=90),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The filer's own history, including any remark leadership left on it -
    this is where an officer sees that the update was read."""
    rows = (
        db.query(DailyUpdate)
        .filter(DailyUpdate.submitted_by_id == current_user.id)
        .order_by(DailyUpdate.report_date.desc())
        .limit(limit)
        .all()
    )
    return [_serialize(row, current_user) for row in rows]


@router.post("", response_model=DailyUpdateOut, status_code=201)
def file_update(
    payload: DailyUpdateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant: College | None = Depends(get_optional_college),
):
    officer = _officer_profile(db, current_user)
    kind = filer_kind(current_user, officer)
    if kind is None:
        raise HTTPException(
            status_code=403,
            detail="Daily updates are filed by placement officers and department coordinators",
        )

    day = payload.report_date or local_today()
    if day > local_today():
        raise HTTPException(status_code=400, detail="Cannot file an update for a future date")

    duplicate = (
        db.query(DailyUpdate)
        .filter(
            DailyUpdate.submitted_by_id == current_user.id,
            DailyUpdate.report_date == day,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="You have already filed an update for this date - edit that one instead",
        )

    college = _resolve_college(db, current_user, tenant)
    data = payload.model_dump(exclude={"report_date"})
    update = DailyUpdate(
        **data,
        report_date=day,
        kind=kind,
        college_id=current_user.college_id,
        # Authorship comes from the session, never the client.
        submitted_by_id=current_user.id,
        officer_id=officer.id if officer else None,
        # Frozen on purpose: back-dating a call next week must not rewrite a
        # report leadership has already read.
        metrics=metrics_for(db, current_user, officer, kind, day),
        status=_derive_status(_cutoff_of(college), day),
        submitted_at=to_naive_utc(local_now()),
    )
    db.add(update)
    db.flush()  # assign update.id before the notification references it
    notify.daily_update_filed(
        db, update=update, college_id=current_user.college_id, actor=current_user
    )
    if update.needs_escalation:
        notify.daily_update_escalation(
            db, update=update, college_id=current_user.college_id, actor=current_user
        )
    db.commit()
    db.refresh(update)
    return _serialize(update, current_user)


# --- Leadership digest ------------------------------------------------------


def _build_digest(db: Session, college: College | None, day: date, viewer: User | None) -> dict:
    """The whole pro-chancellor view of one day, in one pass.

    Ordered around what a busy reader needs first: did everyone report, what
    moved, and what needs them personally. Totals come from the source tables
    rather than from what officers filed, so the day still reads honestly when
    somebody skips their update.
    """
    college_id = college.id if college else None
    cutoff = _cutoff_of(college)

    filers = _expected_filers(db, college_id)

    updates = (
        db.query(DailyUpdate)
        .filter(
            DailyUpdate.college_id == college_id if college_id else True,
            DailyUpdate.report_date == day,
        )
        .all()
    )
    filed_ids = {u.submitted_by_id for u in updates}

    # Someone on leave is neither expected to file activity nor counted absent.
    on_leave = [u for u in updates if u.work_mode == "leave"]
    working = [u for u in updates if u.work_mode != "leave"]
    expected = max(len(filers) - len(on_leave), 0)

    not_filed = [
        {"user_id": user.id, "name": user.full_name, "role": user.role.value, "kind": kind}
        for user, _officer, kind in filers
        if user.id not in filed_ids
    ]

    days = [day - timedelta(days=offset) for offset in range(TREND_DAYS - 1, -1, -1)]
    buckets = college_totals_by_day(db, college_id, days)
    totals = buckets.get(day, {key: 0 for key in TOTAL_KEYS})

    # Baseline is the trailing average of the days *before* this one, so every
    # delta answers "is today better or worse than usual?".
    prior = [buckets[d] for d in days if d != day and d in buckets]
    baseline = {
        key: (round(sum(bucket.get(key, 0) for bucket in prior) / len(prior), 1) if prior else 0)
        for key in TOTAL_KEYS
    }

    filed_by_day: dict[date, int] = {d: 0 for d in days}
    for (report_date,) in (
        db.query(DailyUpdate.report_date)
        .filter(
            DailyUpdate.college_id == college_id if college_id else True,
            DailyUpdate.report_date >= days[0],
            DailyUpdate.report_date <= days[-1],
        )
        .all()
    ):
        if report_date in filed_by_day:
            filed_by_day[report_date] += 1

    trend = [
        {
            "date": d.isoformat(),
            "expected": len(filers),
            "filed": filed_by_day.get(d, 0),
            "calls": buckets.get(d, {}).get("calls", 0),
            "meetings": buckets.get(d, {}).get("meetings", 0),
            "offers": buckets.get(d, {}).get("offers", 0),
        }
        for d in days
    ]

    serialized = [_serialize(u, viewer) for u in updates]
    serialized.sort(key=lambda u: (u.submitted_by_name or "").lower())

    return {
        "date": day.isoformat(),
        "cutoff": cutoff,
        "is_today": day == local_today(),
        "enabled": bool(college.daily_update_enabled) if college else True,
        "compliance": {
            "expected": expected,
            "filed": len(working),
            "on_time": sum(1 for u in working if u.status == "on_time"),
            "late": sum(1 for u in working if u.status == "late"),
            "missing": max(expected - len(working), 0),
            "on_leave": len(on_leave),
        },
        "totals": totals,
        "baseline": baseline,
        "attention": {
            "escalations": [
                {
                    "update_id": u.id,
                    "name": u.submitted_by.full_name if u.submitted_by else None,
                    "escalation_note": u.escalation_note,
                    "reviewed": u.reviewed_at is not None,
                }
                for u in updates
                if u.needs_escalation
            ],
            "not_filed": not_filed,
            "zero_activity": [
                {
                    "update_id": u.id,
                    "name": u.submitted_by.full_name if u.submitted_by else None,
                }
                for u in working
                if not has_activity(u.metrics)
            ],
            **standing_counts(db, college_id),
        },
        "updates": [u.model_dump(mode="json") for u in serialized],
        "trend": trend,
        "filers": len(filers),
    }


@router.get("/digest")
def get_digest(
    report_date: Optional[date] = Query(default=None, alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    college = _resolve_college(db, current_user, tenant)
    return _build_digest(db, college, report_date or local_today(), current_user)


@router.get("/settings")
def get_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    college = _resolve_college(db, current_user, tenant)
    return {
        "daily_update_cutoff": _cutoff_of(college),
        "daily_update_enabled": bool(college.daily_update_enabled) if college else True,
    }


@router.put("/settings")
def update_settings(
    payload: DailyUpdateSettings,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    college = _resolve_college(db, current_user, tenant)
    if college is None:
        raise HTTPException(status_code=404, detail="No college resolved for this request")
    if payload.daily_update_cutoff is not None:
        # Validate rather than let it fall back silently: a cutoff that quietly
        # reverted to the default would be a confusing thing to have "saved".
        raw = payload.daily_update_cutoff.strip()
        hours, _, minutes = raw.partition(":")
        try:
            hour_value, minute_value = int(hours), int(minutes or 0)
        except ValueError:
            raise HTTPException(status_code=400, detail="Cutoff must be a time like 19:00")
        if not (0 <= hour_value <= 23 and 0 <= minute_value <= 59):
            raise HTTPException(status_code=400, detail="Cutoff must be a time like 19:00")
        college.daily_update_cutoff = f"{hour_value:02d}:{minute_value:02d}"
    if payload.daily_update_enabled is not None:
        college.daily_update_enabled = payload.daily_update_enabled
    db.commit()
    return {
        "daily_update_cutoff": _cutoff_of(college),
        "daily_update_enabled": bool(college.daily_update_enabled),
    }


@router.post("/remind/{user_id}")
def remind_one(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    """The digest's per-person nudge button."""
    college = _resolve_college(db, current_user, tenant)
    target = db.query(User).filter(User.id == user_id).first()
    if not target or (current_user.college_id and target.college_id != current_user.college_id):
        raise HTTPException(status_code=404, detail="User not found")
    status = notifications.send_daily_update_reminder(
        to=target.email,
        name=target.full_name,
        college_name=college.name if college else None,
        url=_tenant_url(college, "/daily-update"),
        cutoff=_cutoff_of(college),
    )
    return {"email_status": status}


# --- Scheduler --------------------------------------------------------------


def _already_ran(db: Session, college_id: int, day: date, kind: str) -> bool:
    return (
        db.query(DailyUpdateRun)
        .filter(
            DailyUpdateRun.college_id == college_id,
            DailyUpdateRun.report_date == day,
            DailyUpdateRun.kind == kind,
        )
        .first()
        is not None
    )


def _send_reminders(db: Session, college: College, day: date) -> int:
    filed = {
        row[0]
        for row in db.query(DailyUpdate.submitted_by_id).filter(
            DailyUpdate.college_id == college.id, DailyUpdate.report_date == day
        )
    }
    sent = 0
    for user, _officer, _kind in _expected_filers(db, college.id):
        if user.id in filed:
            continue
        status = notifications.send_daily_update_reminder(
            to=user.email,
            name=user.full_name,
            college_name=college.name,
            url=_tenant_url(college, "/daily-update"),
            cutoff=_cutoff_of(college),
        )
        notify.daily_update_reminder(
            db, user=user, college_id=college.id, cutoff=_cutoff_of(college)
        )
        if status == notifications.SENT:
            sent += 1
    return sent


def _send_digest(db: Session, college: College, day: date) -> int:
    digest = _build_digest(db, college, day, None)
    recipients = (
        db.query(User)
        .filter(
            User.is_active == True,  # noqa: E712
            User.college_id == college.id,
            User.role.in_(LEADERSHIP_ROLES),
        )
        .all()
    )
    sent = 0
    for user in recipients:
        status = notifications.send_daily_digest_email(
            to=user.email,
            name=user.full_name,
            college_name=college.name,
            day=day,
            digest=digest,
            url=_tenant_url(college, "/daily-digest"),
        )
        if status == notifications.SENT:
            sent += 1
    compliance = digest.get("compliance", {})
    notify.daily_digest_ready(
        db,
        college_id=college.id,
        day=day,
        headline=f"{compliance.get('filed', 0)}/{compliance.get('expected', 0)} filed.",
    )
    return sent


def _notify_followups(db: Session, college: College, day: date) -> int:
    """One notification per person with HR follow-ups falling due today.

    Deliberately folded into this tick rather than given its own cron endpoint
    and token: the loop below already walks every active college hourly and
    already has a run log to keep a retry idempotent.
    """
    start = datetime.combine(day, time.min)
    end = start + timedelta(days=1)
    rows = (
        db.query(Communication.logged_by_id, func.count(Communication.id))
        .filter(
            Communication.college_id == college.id,
            Communication.logged_by_id.isnot(None),
            Communication.next_followup_date >= start,
            Communication.next_followup_date < end,
        )
        .group_by(Communication.logged_by_id)
        .all()
    )
    told = 0
    for user_id, count in rows:
        user = db.query(User).filter(User.id == user_id, User.is_active == True).first()  # noqa: E712
        if not user:
            continue
        told += notify.followups_due(db, user=user, college_id=college.id, count=count)
    return told


@router.post("/cron/run")
def cron_run(request: Request, db: Session = Depends(get_db)):
    """Unattended scheduler tick. Call it hourly; it decides what is due.

    Each college keeps its own cutoff, so the decision lives here rather than in a
    cron expression - one schedule entry serves every tenant. The run log makes a
    retry a no-op: a cron that fires twice must not mail the pro-chancellor the
    same digest again.
    """
    expected_token = settings.CRON_TOKEN.strip()
    provided = request.headers.get("x-cron-token", "")
    # 404 rather than 403: an unconfigured or wrongly-called scheduler endpoint
    # should not advertise that it exists.
    if not expected_token or not secrets.compare_digest(provided, expected_token):
        raise HTTPException(status_code=404, detail="Not Found")

    now = local_now()
    day = now.date()
    summary: dict = {
        "date": day.isoformat(),
        "reminders": 0,
        "digests": 0,
        "followups": 0,
        "colleges": [],
    }

    colleges = (
        db.query(College)
        .filter(College.is_active == True, College.daily_update_enabled == True)  # noqa: E712
        .all()
    )
    for college in colleges:
        # A college with nobody to file has nothing to report. Without this guard
        # a tenant that has not onboarded its officers yet would mail its
        # leadership an empty "0/0 filed" digest every single night.
        if not _expected_filers(db, college.id):
            continue

        cutoff = parse_cutoff(_cutoff_of(college), day)
        entry = {"college": college.code, "reminders": 0, "digest": 0, "followups": 0}

        # Today's due follow-ups, once per college per day - the first tick after
        # the working day starts, so it is waiting when people sign in.
        if not _already_ran(db, college.id, day, "followups"):
            entry["followups"] = _notify_followups(db, college, day)
            db.add(
                DailyUpdateRun(
                    college_id=college.id,
                    report_date=day,
                    kind="followups",
                    recipients=entry["followups"],
                )
            )
            summary["followups"] += entry["followups"]

        # Nudge whoever has not filed, in the window before the deadline. After
        # the cutoff a reminder is pointless - the digest is already on its way.
        if cutoff - REMINDER_LEAD <= now < cutoff and not _already_ran(
            db, college.id, day, "reminder"
        ):
            entry["reminders"] = _send_reminders(db, college, day)
            db.add(
                DailyUpdateRun(
                    college_id=college.id,
                    report_date=day,
                    kind="reminder",
                    recipients=entry["reminders"],
                )
            )
            summary["reminders"] += entry["reminders"]

        # Then the digest, once late filings have had an hour to land.
        if now >= cutoff + DIGEST_DELAY and not _already_ran(db, college.id, day, "digest"):
            entry["digest"] = _send_digest(db, college, day)
            db.add(
                DailyUpdateRun(
                    college_id=college.id,
                    report_date=day,
                    kind="digest",
                    recipients=entry["digest"],
                )
            )
            summary["digests"] += entry["digest"]

        if entry["reminders"] or entry["digest"] or entry["followups"]:
            summary["colleges"].append(entry)

    db.commit()
    return summary


# --- Single update ----------------------------------------------------------
# Declared last on purpose: FastAPI matches in declaration order, so every
# literal path above must be registered before /{update_id} can swallow it.


def _get_for_write(update_id: int, db: Session, current_user: User) -> DailyUpdate:
    update = _scoped(db, current_user).filter(DailyUpdate.id == update_id).first()
    if not update:
        raise HTTPException(status_code=404, detail="Daily update not found")
    if not _can_edit(update, current_user):
        raise HTTPException(
            status_code=403,
            detail="Only the person who filed this, or leadership, can change it",
        )
    return update


@router.put("/{update_id}", response_model=DailyUpdateOut)
def edit_update(
    update_id: int,
    payload: DailyUpdateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    update = _get_for_write(update_id, db, current_user)
    was_escalated = update.needs_escalation
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(update, field, value)

    # Re-freeze while the day is still running, so an officer who logs a call and
    # then edits sees the new number. Past days keep the snapshot they were filed
    # with, and `status` is never recomputed - a late filing stays late.
    if update.report_date == local_today():
        officer = db.query(PlacementOfficer).filter(
            PlacementOfficer.id == update.officer_id
        ).first() if update.officer_id else None
        author = update.submitted_by or current_user
        update.metrics = metrics_for(db, author, officer, update.kind, update.report_date)

    # Only on the transition: editing an already-escalated update must not
    # re-alert the heads every time a typo is fixed.
    if update.needs_escalation and not was_escalated:
        notify.daily_update_escalation(
            db, update=update, college_id=update.college_id, actor=current_user
        )
    db.commit()
    db.refresh(update)
    return _serialize(update, current_user)


@router.get("/{update_id}", response_model=DailyUpdateOut)
def get_update(
    update_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    update = _scoped(db, current_user).filter(DailyUpdate.id == update_id).first()
    if not update:
        raise HTTPException(status_code=404, detail="Daily update not found")
    return _serialize(update, current_user)


@router.post("/{update_id}/review", response_model=DailyUpdateOut)
def review_update(
    update_id: int,
    payload: DailyUpdateReview,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
):
    """Leadership acknowledging an update, optionally with a remark.

    The filer sees both on their own page. This is the half of the feature that
    keeps updates coming: an officer who never sees a response stops writing
    anything worth reading.
    """
    update = _scoped(db, current_user).filter(DailyUpdate.id == update_id).first()
    if not update:
        raise HTTPException(status_code=404, detail="Daily update not found")
    update.reviewed_by_id = current_user.id
    update.reviewed_at = to_naive_utc(local_now())
    if payload.note is not None:
        update.review_note = payload.note.strip() or None
    notify.daily_update_reviewed(
        db, update=update, college_id=update.college_id, actor=current_user
    )
    db.commit()
    db.refresh(update)
    return _serialize(update, current_user)


@router.post("/{update_id}/suggest-reply")
async def suggest_reply(
    update_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*LEADERSHIP_ROLES)),
):
    """A first draft of the reply to an escalation, for the leader to edit and send.

    Never fails the caller: with no API key configured, or if the model call goes
    wrong, this returns no suggestion and the reply box simply stays empty. A
    drafting aid is not worth an error toast on a page someone reads every morning.
    """
    update = _scoped(db, current_user).filter(DailyUpdate.id == update_id).first()
    if not update:
        raise HTTPException(status_code=404, detail="Daily update not found")
    if not update.needs_escalation or not (update.escalation_note or "").strip():
        return {"suggestion": None}
    if not settings.ANTHROPIC_API_KEY.strip():
        return {"suggestion": None, "reason": "no_api_key"}

    try:
        suggestion = await draft_escalation_reply(
            escalation_note=update.escalation_note,
            highlights=update.highlights,
            blockers=update.blockers,
            officer_name=(update.submitted_by.full_name if update.submitted_by else "the officer"),
            leader_name=current_user.full_name,
        )
    except Exception as exc:  # noqa: BLE001 - a drafting aid must never break the page
        logger.warning("Could not draft an escalation reply for update %s: %s", update_id, exc)
        return {"suggestion": None, "reason": "unavailable"}

    return {"suggestion": suggestion or None}
