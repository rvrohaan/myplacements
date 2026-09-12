"""The daily update an officer or coordinator files, and the scheduler's run log.

Authorship follows the same dual stamp as ``Communication``: ``submitted_by_id``
is the account that typed it (always taken from the session) while ``officer_id``
is whose numbers it counts towards. Coordinators have no officer profile, so for
them ``officer_id`` stays NULL and ``kind`` carries the distinction.

Status values are plain strings rather than native Postgres enums - the same
choice ``CompanyAssignment`` makes - because adding a value to a native enum
needs an autocommit migration, and these lists will grow.
"""

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.core.database import Base

# Which flavour of update this is; drives the form shown and the metrics computed.
KINDS = ("officer", "coordinator")

# Where the person worked that day. "leave" excuses them from the day's
# compliance count instead of showing up as a non-filer.
WORK_MODES = ("office", "field", "travel", "wfh", "leave")

# Derived at submit time against the college's cutoff, then left alone: a late
# filing stays late even if it is edited the next morning.
STATUSES = ("on_time", "late")


class DailyUpdate(Base):
    __tablename__ = "daily_updates"

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True, index=True)
    # The local date being reported on, not the timestamp it was typed at.
    report_date = Column(Date, nullable=False, index=True)
    kind = Column(String, nullable=False, default="officer")

    # Who typed it. Stamped from the session, never from the client.
    submitted_by_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Whose activity it counts towards. NULL for coordinators, who have no
    # officer profile and no company allocation.
    officer_id = Column(Integer, ForeignKey("placement_officers.id"), nullable=True, index=True)

    work_mode = Column(String, nullable=True)

    # The judgment half of the update - the part no query could produce.
    highlights = Column(Text, nullable=True)
    blockers = Column(Text, nullable=True)
    support_needed = Column(Text, nullable=True)
    plan_tomorrow = Column(Text, nullable=True)
    needs_escalation = Column(Boolean, nullable=False, default=False)
    escalation_note = Column(Text, nullable=True)

    # Offline work that has no system trace yet (a walk-in meeting on the way
    # home). Kept separate from the derived counts so the two never blur.
    manual_visits = Column(Integer, default=0)
    manual_meetings = Column(Integer, default=0)

    # The derived counts as they stood when this was filed. Frozen on purpose:
    # back-dating a communication next week must not silently rewrite a report
    # leadership has already read.
    metrics = Column(JSON, nullable=True)

    submitted_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # The leadership loop. Officers keep filing when they can see it is read.
    reviewed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_note = Column(Text, nullable=True)

    submitted_by = relationship("User", foreign_keys=[submitted_by_id])
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_id])
    officer = relationship("PlacementOfficer")


class DailyUpdateRun(Base):
    """One row per college per day per job, written by the scheduler endpoint.

    This is what makes ``POST /daily-updates/cron/run`` safe to retry: a cron
    that fires twice, or a deploy that replays it, must not email the
    pro-chancellor the same digest again.
    """

    __tablename__ = "daily_update_runs"

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False, index=True)
    report_date = Column(Date, nullable=False, index=True)
    kind = Column(String, nullable=False)  # "reminder" | "digest"
    ran_at = Column(DateTime, default=datetime.utcnow)
    recipients = Column(Integer, default=0)
