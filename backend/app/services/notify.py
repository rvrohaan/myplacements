"""In-app notification fan-out: who should be told, and about what.

The split with ``services.notifications`` is deliberate. That module is the
mailer - how a message leaves the building - and is imported here as ``mailer``.
This module decides recipients, writes the rows, and mirrors the few urgent ones
to email.

Two rules hold everywhere in here:

*Never raise.* A notification is a courtesy. Approving a company must not return
a 500 because the fan-out tripped over a bad row, so every public entry point is
wrapped and failures are logged instead.

*Never commit, and never roll back.* Rows are added to the caller's session, so
they land in the same transaction as the change that caused them and vanish with
it if that change fails - the rule ``services.invites`` already states. Rolling
back here would discard the caller's pending work and turn a cosmetic failure
into data loss, so the risky work all happens before anything is added to the
session and the only mutation is a final ``add_all``.
"""

import logging
from datetime import datetime, timedelta
from functools import wraps
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.core.links import tenant_url
from app.core.roles import LEADERSHIP_ROLES, STAFF_ROLES
from app.models.college import College
from app.models.notification import HIGH, NORMAL, Notification
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.user import User, UserRole
from app.services import notifications as mailer

logger = logging.getLogger(__name__)

# The whole vocabulary, checked on every emit. Plain strings in the database (see
# models.notification) with the valid set enforced here, so a typo fails a test
# rather than silently writing a row nothing will ever filter on.
NOTIFICATION_TYPES = frozenset(
    {
        "drive.created",
        "drive.rescheduled",
        "drive.cancelled",
        "drive.application",
        "drive.round_results",
        "drive.selections",
        "drive.offer",
        "assignment.created",
        "assignment.bulk_created",
        "assignment.escalated",
        "assignment.completed",
        "assignment.removed",
        "company.review_pending",
        "company.approved",
        "company.declined",
        "daily_update.filed",
        "daily_update.escalation",
        "daily_update.reviewed",
        "daily_update.reminder",
        "daily_update.digest_ready",
        "followup.due",
    }
)

# A repeat of the same grouped event inside this window folds into the existing
# unread row instead of adding another. Short on purpose: it is there to absorb a
# burst (six students applying to the same drive in a minute), not to hide a day
# of activity behind one line.
_COALESCE_WINDOW = timedelta(minutes=10)

# A burst of email is worse than no email. Past this many recipients in a single
# emit the in-app rows still go out and the mail does not.
_MAX_INLINE_EMAILS = 5


def _never_fails(fn):
    """Contain a fan-out failure to the fan-out. See the module docstring."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception:
            logger.exception(
                "notify.%s failed; the request that triggered it is unaffected", fn.__name__
            )
            return 0

    return wrapper


# --------------------------------------------------------------------------
# Recipient resolvers
#
# Every query in this module runs under `no_autoflush`. These read from the
# caller's session mid-request, and a plain SELECT would otherwise flush whatever
# half-built objects the caller has pending - surfacing their IntegrityError from
# inside the fan-out, on a request that was about to succeed.
# --------------------------------------------------------------------------


def _staff_query(db: Session, college_id: Optional[int], roles) -> list[User]:
    # A missing college means "tell nobody". Without this guard the filter below
    # becomes `college_id IS NULL`, which matches every super_admin on the
    # platform and mails them another college's business.
    if college_id is None:
        return []
    with db.no_autoflush:
        return (
            db.query(User)
            .filter(
                User.is_active.is_(True),
                User.college_id == college_id,
                User.role.in_(roles),
            )
            .all()
        )


def leadership_of(db: Session, college_id: Optional[int]) -> list[User]:
    """The heads of this college - the default audience for anything that is a
    college-wide fact rather than one person's task."""
    return _staff_query(db, college_id, LEADERSHIP_ROLES)


def staff_of(db: Session, college_id: Optional[int], roles=STAFF_ROLES) -> list[User]:
    return _staff_query(db, college_id, roles)


def user_by_id(db: Session, user_id: Optional[int], college_id: Optional[int]) -> Optional[User]:
    """One named user, tenant-checked, or None."""
    if user_id is None:
        return None
    with db.no_autoflush:
        user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if user is None:
        return None
    if college_id is not None and user.college_id is not None and user.college_id != college_id:
        return None
    return user


def user_for_officer(db: Session, officer_id: Optional[int]) -> Optional[User]:
    """The account behind a PlacementOfficer profile."""
    if officer_id is None:
        return None
    with db.no_autoflush:
        officer = db.query(PlacementOfficer).filter(PlacementOfficer.id == officer_id).first()
        return officer.user if officer else None


def officer_for_company(db: Session, company_id: Optional[int]) -> Optional[User]:
    """The officer a company is allocated to, or None when nobody owns it yet.
    The most recent assignment wins if a company has been handed over."""
    if company_id is None:
        return None
    with db.no_autoflush:
        assignment = (
            db.query(CompanyAssignment)
            .filter(CompanyAssignment.company_id == company_id)
            .order_by(CompanyAssignment.assigned_at.desc())
            .first()
        )
        if assignment is None or assignment.officer is None:
            return None
        return assignment.officer.user


def _college(db: Session, college_id: Optional[int]) -> Optional[College]:
    if college_id is None:
        return None
    with db.no_autoflush:
        return db.query(College).filter(College.id == college_id).first()


# --------------------------------------------------------------------------
# The emit
# --------------------------------------------------------------------------


def _coalescable(
    db: Session, user_id: int, group_key: str, now: datetime
) -> Optional[Notification]:
    """An unread row for the same group, recent enough to fold into. A row the
    recipient has already read is never reused - they have seen it, so the next
    one is news."""
    with db.no_autoflush:
        return (
            db.query(Notification)
            .filter(
                Notification.user_id == user_id,
                Notification.group_key == group_key,
                Notification.read_at.is_(None),
                Notification.created_at >= now - _COALESCE_WINDOW,
            )
            .order_by(Notification.created_at.desc())
            .first()
        )


def notify(
    db: Session,
    *,
    type: str,
    recipients: Iterable[Optional[User]],
    college_id: Optional[int],
    title: str,
    actor: Optional[User] = None,
    body: Optional[str] = None,
    link: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    priority: str = NORMAL,
    group_key: Optional[str] = None,
    group_title: Optional[str] = None,
    group_link: Optional[str] = None,
    meta: Optional[dict] = None,
    email: Optional[bool] = None,
) -> int:
    """Fan one event out to the staff who need to know. Returns rows created.

    ``group_title`` is a format string taking ``{count}`` and is used to retitle
    a row that has absorbed repeats; ``group_link`` widens its destination at the
    same time, for a row that pointed at one item and now stands for several. ``email`` defaults to "yes if high priority";
    pass it explicitly to suppress mail for an event whose email another part of
    the app already sends.

    Never raises, never commits - see the module docstring.
    """
    if type not in NOTIFICATION_TYPES:
        raise ValueError(f"unknown notification type {type!r}")
    if priority not in (NORMAL, HIGH):
        raise ValueError(f"unknown priority {priority!r}")

    actor_id = actor.id if actor else None
    targets: dict[int, User] = {}
    for user in recipients:
        if user is None or not user.is_active:
            continue
        # Nobody needs telling what they just did themselves.
        if user.id == actor_id:
            continue
        # Staff-only for now; the student portal has its own surfaces.
        if user.role == UserRole.STUDENT:
            continue
        # Dedupe: leadership and the owning officer frequently overlap.
        targets[user.id] = user
    if not targets:
        return 0

    now = datetime.utcnow()
    rows: list[Notification] = []
    fresh: list[tuple[User, Notification]] = []

    for user in targets.values():
        existing = _coalescable(db, user.id, group_key, now) if group_key else None
        if existing is not None:
            count = (existing.meta or {}).get("count", 1) + 1
            existing.meta = {**(existing.meta or {}), "count": count}
            if group_title:
                existing.title = group_title.format(count=count)
            if group_link:
                existing.link = group_link
            # Float it back to the top of the list, and never re-send its email.
            existing.created_at = now
            continue
        row = Notification(
            user_id=user.id,
            college_id=college_id,
            actor_id=actor_id,
            type=type,
            priority=priority,
            title=title,
            body=body,
            link=link,
            entity_type=entity_type,
            entity_id=entity_id,
            group_key=group_key,
            meta=meta,
            created_at=now,
        )
        rows.append(row)
        fresh.append((user, row))

    # Last, and cannot fail: everything that could throw is already done.
    db.add_all(rows)

    send = (priority == HIGH) if email is None else email
    if send and fresh:
        if len(fresh) > _MAX_INLINE_EMAILS:
            logger.info(
                "notify(%s): %d recipients is over the inline email cap; in-app only",
                type,
                len(fresh),
            )
        else:
            college = _college(db, college_id)
            url = tenant_url(college, link or "/dashboard")
            college_name = college.name if college else None
            for user, row in fresh:
                # send_email never raises; it returns sent/failed/skipped. Note
                # the mail goes out before the caller commits, so a request that
                # fails afterwards can leave an email about something that did
                # not happen - the same trade services.invites already accepts.
                row.email_status = mailer.send_notification_email(
                    to=user.email,
                    name=user.full_name,
                    college_name=college_name,
                    title=title,
                    body=body,
                    url=url,
                )

    return len(rows)


# --------------------------------------------------------------------------
# Event helpers
#
# One per row of the notification matrix. Call sites get a single readable line
# and all the recipient logic lives here, behind the failure containment.
# --------------------------------------------------------------------------


def _digest_day(update) -> str:
    day = getattr(update, "report_date", None)
    return day.isoformat() if hasattr(day, "isoformat") else str(day)


def _digest_link(update, *, whose: bool = True) -> str:
    """A link into the digest for the day an update covers.

    The date matters as much as the id: the digest opens on today, so a bare
    /daily-digest lands on the wrong day the moment the reader opens the
    notification tomorrow morning. ``whose=False`` drops the person, for a row
    that stands for several people at once.
    """
    link = f"/daily-digest?date={_digest_day(update)}"
    return f"{link}&update={update.id}" if whose else link


def _drive_label(drive) -> str:
    company = drive.company.name if drive.company else "a company"
    return f"{company} - {drive.job_role}"


def _drive_audience(db: Session, drive) -> list[Optional[User]]:
    return leadership_of(db, drive.college_id) + [officer_for_company(db, drive.company_id)]


@_never_fails
def drive_created(db: Session, *, drive, actor: Optional[User]) -> int:
    return notify(
        db,
        type="drive.created",
        recipients=_drive_audience(db, drive),
        college_id=drive.college_id,
        actor=actor,
        title=f"New drive: {_drive_label(drive)}",
        body=f"A placement drive has been added for {_drive_label(drive)}.",
        link=f"/drives/{drive.id}",
        entity_type="drive",
        entity_id=drive.id,
    )


@_never_fails
def drive_rescheduled(db: Session, *, drive, actor: Optional[User]) -> int:
    when = drive.drive_date.strftime("%d %b %Y") if drive.drive_date else "an unset date"
    return notify(
        db,
        type="drive.rescheduled",
        recipients=_drive_audience(db, drive),
        college_id=drive.college_id,
        actor=actor,
        title=f"Drive rescheduled: {_drive_label(drive)}",
        body=f"The drive is now set for {when}.",
        link=f"/drives/{drive.id}",
        entity_type="drive",
        entity_id=drive.id,
    )


@_never_fails
def drive_cancelled(db: Session, *, drive, actor: Optional[User]) -> int:
    return notify(
        db,
        type="drive.cancelled",
        recipients=_drive_audience(db, drive),
        college_id=drive.college_id,
        actor=actor,
        priority=HIGH,
        title=f"Drive cancelled: {_drive_label(drive)}",
        body="Students registered for this drive will need to be told.",
        link=f"/drives/{drive.id}",
        entity_type="drive",
        entity_id=drive.id,
    )


@_never_fails
def drive_application(db: Session, *, drive, student_name: Optional[str]) -> int:
    """A student applied. Goes to whoever owns the company, falling back to the
    heads when nobody does. Coalesced: a popular drive can draw a dozen
    applications in a minute."""
    owner = officer_for_company(db, drive.company_id)
    recipients = [owner] if owner else leadership_of(db, drive.college_id)
    who = student_name or "A student"
    return notify(
        db,
        type="drive.application",
        recipients=recipients,
        college_id=drive.college_id,
        title=f"{who} applied to {_drive_label(drive)}",
        body=None,
        link=f"/drives/{drive.id}",
        entity_type="drive",
        entity_id=drive.id,
        group_key=f"drive.application:{drive.id}",
        group_title=f"{{count}} new applications for {_drive_label(drive)}",
        meta={"count": 1},
    )


@_never_fails
def drive_round_results(db: Session, *, drive, round_number: int, summary: dict, actor) -> int:
    """One row for a whole roster upload. Never one per student - a round can
    carry three hundred of them."""
    return notify(
        db,
        type="drive.round_results",
        recipients=_drive_audience(db, drive),
        college_id=drive.college_id,
        actor=actor,
        title=f"Round {round_number} results in for {_drive_label(drive)}",
        body=(
            f"{summary.get('appeared', 0)} appeared, {summary.get('passed', 0)} cleared, "
            f"{summary.get('withdrawn', 0)} withdrawn."
        ),
        link=f"/drives/{drive.id}",
        entity_type="drive",
        entity_id=drive.id,
    )


@_never_fails
def drive_selection(db: Session, *, drive, student_name: Optional[str], actor) -> int:
    who = student_name or "A student"
    return notify(
        db,
        type="drive.selections",
        recipients=_drive_audience(db, drive),
        college_id=drive.college_id,
        actor=actor,
        title=f"{who} selected by {_drive_label(drive)}",
        link=f"/drives/{drive.id}",
        entity_type="drive",
        entity_id=drive.id,
        group_key=f"drive.selections:{drive.id}",
        group_title=f"{{count}} students selected by {_drive_label(drive)}",
        meta={"count": 1},
    )


@_never_fails
def drive_offer(db: Session, *, drive, actor) -> int:
    return notify(
        db,
        type="drive.offer",
        recipients=leadership_of(db, drive.college_id),
        college_id=drive.college_id,
        actor=actor,
        title=f"Offer recorded for {_drive_label(drive)}",
        link=f"/drives/{drive.id}",
        entity_type="drive",
        entity_id=drive.id,
    )


@_never_fails
def assignment_created(db: Session, *, officer_id: int, company, college_id, actor) -> int:
    return notify(
        db,
        type="assignment.created",
        recipients=[user_for_officer(db, officer_id)],
        college_id=college_id,
        actor=actor,
        title=f"{company.name} allocated to you",
        body="You are now the point of contact for this company.",
        link="/officers",
        entity_type="company",
        entity_id=company.id,
    )


@_never_fails
def assignment_bulk_created(db: Session, *, per_officer: dict[int, list[str]], college_id, actor) -> int:
    """One row per officer for a whole auto-allocation run. A head applying two
    hundred allocations must not produce two hundred notifications."""
    total = 0
    for officer_id, names in per_officer.items():
        if not names:
            continue
        sample = ", ".join(names[:3])
        more = f" and {len(names) - 3} more" if len(names) > 3 else ""
        total += notify(
            db,
            type="assignment.bulk_created",
            recipients=[user_for_officer(db, officer_id)],
            college_id=college_id,
            actor=actor,
            title=f"{len(names)} companies allocated to you",
            body=f"{sample}{more}.",
            link="/officers",
            meta={"count": len(names), "companies": names[:10]},
        )
    return total


@_never_fails
def assignment_escalated(db: Session, *, company, officer_name: Optional[str], college_id, actor) -> int:
    who = officer_name or "An officer"
    return notify(
        db,
        type="assignment.escalated",
        recipients=leadership_of(db, college_id),
        college_id=college_id,
        actor=actor,
        priority=HIGH,
        title=f"{company.name} escalated",
        body=f"{who} has escalated this company and needs a decision.",
        link=f"/companies/{company.id}",
        entity_type="company",
        entity_id=company.id,
    )


@_never_fails
def assignment_completed(db: Session, *, company, officer_name: Optional[str], college_id, actor) -> int:
    who = officer_name or "An officer"
    return notify(
        db,
        type="assignment.completed",
        recipients=leadership_of(db, college_id),
        college_id=college_id,
        actor=actor,
        title=f"{company.name} marked complete",
        body=f"{who} has closed out this allocation.",
        link=f"/companies/{company.id}",
        entity_type="company",
        entity_id=company.id,
    )


@_never_fails
def assignment_removed(db: Session, *, officer_id: int, company, college_id, actor) -> int:
    return notify(
        db,
        type="assignment.removed",
        recipients=[user_for_officer(db, officer_id)],
        college_id=college_id,
        actor=actor,
        title=f"{company.name} is no longer allocated to you",
        link="/officers",
        entity_type="company",
        entity_id=company.id,
    )


@_never_fails
def company_review_pending(db: Session, *, company, actor) -> int:
    submitter = actor.full_name if actor else "An officer"
    return notify(
        db,
        type="company.review_pending",
        recipients=leadership_of(db, company.college_id),
        college_id=company.college_id,
        actor=actor,
        title=f"{company.name} is waiting for review",
        body=f"{submitter} added this company as a lead.",
        link=f"/companies/{company.id}",
        entity_type="company",
        entity_id=company.id,
    )


@_never_fails
def company_approved(db: Session, *, company, actor) -> int:
    return notify(
        db,
        type="company.approved",
        recipients=[user_by_id(db, company.created_by_id, company.college_id)],
        college_id=company.college_id,
        actor=actor,
        title=f"{company.name} approved",
        body="The company you added has been approved and allocated to you.",
        link=f"/companies/{company.id}",
        entity_type="company",
        entity_id=company.id,
    )


@_never_fails
def company_declined(db: Session, *, company, reason: Optional[str], actor) -> int:
    return notify(
        db,
        type="company.declined",
        recipients=[user_by_id(db, company.created_by_id, company.college_id)],
        college_id=company.college_id,
        actor=actor,
        title=f"{company.name} was declined",
        body=reason or "The company you added was not taken forward.",
        link=f"/companies/{company.id}",
        entity_type="company",
        entity_id=company.id,
    )


@_never_fails
def daily_update_filed(db: Session, *, update, college_id, actor) -> int:
    who = actor.full_name if actor else "Someone"
    return notify(
        db,
        type="daily_update.filed",
        recipients=leadership_of(db, college_id),
        college_id=college_id,
        actor=actor,
        title=f"{who} filed their daily update",
        link=_digest_link(update),
        entity_type="daily_update",
        entity_id=update.id,
        group_key=f"daily_update.filed:{college_id}:{update.report_date}",
        group_title="{count} daily updates filed today",
        # Once it stands for several people, pointing at one of them is wrong.
        group_link=_digest_link(update, whose=False),
        meta={"count": 1},
    )


@_never_fails
def daily_update_escalation(db: Session, *, update, college_id, actor) -> int:
    who = actor.full_name if actor else "An officer"
    return notify(
        db,
        type="daily_update.escalation",
        recipients=leadership_of(db, college_id),
        college_id=college_id,
        actor=actor,
        priority=HIGH,
        title=f"{who} flagged an escalation",
        body=update.escalation_note or "An escalation was raised in today's update.",
        link=_digest_link(update),
        entity_type="daily_update",
        entity_id=update.id,
    )


@_never_fails
def daily_update_reviewed(db: Session, *, update, college_id, actor) -> int:
    return notify(
        db,
        type="daily_update.reviewed",
        recipients=[user_by_id(db, update.submitted_by_id, college_id)],
        college_id=college_id,
        actor=actor,
        title="Your daily update was reviewed",
        body=update.review_note or None,
        link="/daily-update",
        entity_type="daily_update",
        entity_id=update.id,
    )


@_never_fails
def daily_update_reminder(db: Session, *, user: User, college_id, cutoff: str) -> int:
    """In-app twin of the reminder email. ``email=False`` because the caller has
    just sent that email itself - without this, officers get nudged twice every
    evening and stop reading either one."""
    return notify(
        db,
        type="daily_update.reminder",
        recipients=[user],
        college_id=college_id,
        title="Your daily update is not in yet",
        body=f"Today's cutoff is {cutoff}.",
        link="/daily-update",
        email=False,
    )


@_never_fails
def daily_digest_ready(db: Session, *, college_id, day, headline: str) -> int:
    return notify(
        db,
        type="daily_update.digest_ready",
        recipients=leadership_of(db, college_id),
        college_id=college_id,
        title=f"Daily digest for {day}",
        body=headline,
        link=f"/daily-digest?date={day}",
        email=False,  # the digest email itself has just gone out
    )


@_never_fails
def followups_due(db: Session, *, user: User, college_id, count: int) -> int:
    return notify(
        db,
        type="followup.due",
        recipients=[user],
        college_id=college_id,
        title=f"{count} HR follow-up{'s' if count != 1 else ''} due today",
        link="/communications",
    )
