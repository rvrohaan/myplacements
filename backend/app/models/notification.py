"""In-app notifications for staff: one row per (event, recipient).

Fan-out on write. A college has tens of staff, not millions, so duplicating a
line of text per recipient costs nothing and buys three things a shared row with
read receipts cannot: the unread badge is a single indexed COUNT rather than an
anti-join, the recipient list is frozen at the moment the event happened (a new
hire does not inherit a year of history, and a role change does not silently
rewrite who was told), and the same event can be worded differently for the
officer who owns it and the head reviewing it.

``type``, ``priority`` and ``entity_type`` are plain strings rather than native
Postgres enums - the same choice ``DailyUpdate`` and ``CompanyAssignment`` make -
because adding a value to a native enum needs the autocommit ALTER TYPE dance in
core.migrations._ENUM_VALUES, and this vocabulary grows with every feature. The
valid set is enforced in Python by services.notify, where a typo fails a test
rather than a deploy.
"""

from datetime import datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import relationship

from app.core.database import Base

# How loudly an event asks to be noticed. "high" is the only one that also sends
# an email, so it is reserved for things somebody should act on before they go
# home - see services.notify.
NORMAL = "normal"
HIGH = "high"
PRIORITIES = (NORMAL, HIGH)

# What ``entity_id`` points at. Deliberately not a foreign key: see below.
ENTITY_TYPES = ("drive", "company", "assignment", "daily_update", "communication")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True, index=True)
    # The recipient. This column *is* the access-control boundary - a
    # notification belongs to exactly one person, so every read endpoint filters
    # on it and needs no other tenant check.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Who caused the event. Kept so we never tell someone about their own action,
    # and so the UI can say who did it.
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    type = Column(String(64), nullable=False, index=True)
    priority = Column(String(16), nullable=False, default=NORMAL)

    # Rendered once, at emit time, and then left alone. Denormalised on purpose:
    # a page of the list is one query against one table however many different
    # things it references. It is also the honest thing to store - a notification
    # is a record of a message that was sent, so it should still read correctly
    # after the drive it describes has been renamed or deleted.
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    # Relative in-app path, e.g. "/drives/42". The frontend navigates to it
    # without needing to know anything about entity types.
    link = Column(String(300), nullable=True)

    # Loose reference, never a ForeignKey. A cascade would erase the audit trail
    # when the drive is deleted; no cascade would block the delete. Neither is
    # acceptable, and a dangling id is harmless - the text still reads and the
    # link 404s, which is the truth.
    entity_type = Column(String(32), nullable=True)
    entity_id = Column(Integer, nullable=True)

    # Coalescing key, e.g. "drive.application:42". Non-unique on purpose: the
    # same event next week is news again, so only a burst inside the window in
    # services.notify merges.
    group_key = Column(String(120), nullable=True)
    # Extras for coalesced rows (a count, sample names). Cannot be called
    # `metadata` - that attribute is reserved on declarative classes.
    meta = Column(JSON, nullable=True)

    # The single source of truth for read state. No is_read boolean alongside it
    # that could drift out of agreement.
    read_at = Column(DateTime, nullable=True)
    # "sent" | "failed" | "skipped" | NULL (never attempted), mirroring
    # UserInvite.email_status so a high-priority mail that bounced is visible.
    email_status = Column(String(16), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    actor = relationship("User", foreign_keys=[actor_id])

    __table_args__ = (
        Index("ix_notifications_user_created", "user_id", text("created_at DESC")),
        # The badge query, polled by every signed-in staff member. Partial, so it
        # stays tiny however much read history accumulates behind it.
        Index(
            "ix_notifications_user_unread",
            "user_id",
            postgresql_where=text("read_at IS NULL"),
        ),
        Index("ix_notifications_group", "user_id", "group_key"),
    )

    @property
    def is_read(self) -> bool:
        return self.read_at is not None

    @property
    def actor_name(self) -> str | None:
        return self.actor.full_name if self.actor else None
