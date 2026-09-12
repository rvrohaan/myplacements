"""Settings that belong to the platform rather than to any one college.

A single row, created on first read. Everything else in this schema is scoped to
a tenant because tenants own their data; this table exists for the handful of
switches that are not any tenant's to flip - the ones that spend money or run
work on behalf of everybody.

Today that is one switch: whether the daily opportunity scan runs on its own.
The scan is shared platform-wide (see app/models/job_lead.py), so leaving it on
bills the platform every morning whether or not anyone reads the results - which
is exactly the wrong default before there is a client watching. It starts off,
and a super_admin turns it on.
"""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Session, relationship

from app.core.database import Base

# The row. There is only ever one, and this is its id.
SINGLETON_ID = 1


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    id = Column(Integer, primary_key=True)

    # Whether the scheduler starts the daily opportunity scan. Off by default:
    # an unattended scan costs real credit every day, so it has to be switched on
    # deliberately rather than arriving switched on with a deploy.
    job_scan_schedule_enabled = Column(Boolean, nullable=False, default=False)

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    updated_by = relationship("User")


def get_platform_settings(db: Session) -> PlatformSetting:
    """The settings row, created with safe defaults the first time it is asked for.

    Created here rather than in a migration so a fresh database and a redeployed
    one behave the same, and so the defaults live next to the columns they belong
    to.
    """
    row = db.query(PlatformSetting).filter(PlatformSetting.id == SINGLETON_ID).first()
    if row is None:
        row = PlatformSetting(id=SINGLETON_ID, job_scan_schedule_enabled=False)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row
