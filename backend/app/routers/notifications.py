"""Read-side API for in-app notifications.

Nothing is created over HTTP - rows arrive only through services.notify, fanned
out from the event that caused them - so this router is list, count and mark-read
and nothing else.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import MarkAllReadOut, NotificationOut, UnreadCountOut
from app.services.notify import NOTIFICATION_TYPES

router = APIRouter(prefix="/notifications", tags=["notifications"])

# The part of a type before the dot ("drive", "assignment", ...). Derived rather
# than hand-listed so a new type cannot add a family the API silently rejects.
FAMILIES = frozenset(t.split(".", 1)[0] for t in NOTIFICATION_TYPES)


def _mine(db: Session, current_user: User):
    """Every read goes through here. ``user_id`` is the whole access-control
    story: a notification belongs to exactly one person, so there is no separate
    tenant filter to forget."""
    return db.query(Notification).filter(Notification.user_id == current_user.id)


def _unread(db: Session, current_user: User) -> int:
    return _mine(db, current_user).filter(Notification.read_at.is_(None)).count()


# The literal paths are declared before /{notification_id} on purpose: FastAPI
# matches routes in declaration order, so the parameterised one would otherwise
# swallow "unread-count" and try to parse it as an int.
@router.get("/unread-count", response_model=UnreadCountOut)
def unread_count(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Just the badge number. Kept separate from the list because it is polled
    every minute by every signed-in staff member, while the list is fetched only
    when somebody opens the bell."""
    return UnreadCountOut(unread=_unread(db, current_user))


@router.post("/read-all", response_model=MarkAllReadOut)
def mark_all_read(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    updated = (
        _mine(db, current_user)
        .filter(Notification.read_at.is_(None))
        .update({Notification.read_at: datetime.utcnow()}, synchronize_session=False)
    )
    db.commit()
    return MarkAllReadOut(updated=updated, unread=0)


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    response: Response,
    unread_only: bool = False,
    type: Optional[str] = None,
    family: list[str] = Query(default_factory=list),
    skip: int = 0,
    limit: int = Query(default=20, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One page of the caller's notifications, newest first. The total for the
    current filters is returned in ``X-Total-Count`` so callers can paginate.

    ``family`` matches whole groups of types ("drive", "assignment") and may be
    repeated. Every filter has to be applied here rather than in the client:
    paginating server-side and then narrowing client-side would make ``skip``
    and the total describe a different sequence from the one on screen, so
    "load more" would re-request rows the caller has already been given.
    """
    q = _mine(db, current_user)
    if unread_only:
        q = q.filter(Notification.read_at.is_(None))
    if type:
        q = q.filter(Notification.type == type)
    if family:
        unknown = sorted(set(family) - FAMILIES)
        # Rejected rather than ignored: silently dropping the filter would show
        # the caller everything and look like the filter simply did nothing.
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown notification family: {', '.join(unknown)}",
            )
        q = q.filter(or_(*[Notification.type.like(f"{f}.%") for f in family]))
    response.headers["X-Total-Count"] = str(q.count())
    # One extra query for the whole page rather than one per row. Everything else
    # the list renders is denormalised onto the row itself.
    return (
        q.options(selectinload(Notification.actor))
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.post("/{notification_id}/read", response_model=UnreadCountOut)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = _mine(db, current_user).filter(Notification.id == notification_id).first()
    # 404 rather than 403: somebody else's notification should not have its
    # existence confirmed, the same rule companies._accessible_company follows.
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    if row.read_at is None:
        row.read_at = datetime.utcnow()
    db.commit()
    # Hand back the fresh count so the client never has to guess at it.
    return UnreadCountOut(unread=_unread(db, current_user))
