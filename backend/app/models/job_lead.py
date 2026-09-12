"""Openings discovered on the web, and each college's handling of them.

Two tables, because discovery and ownership are different things:

``JobPosting`` is a public fact - TCS is hiring 2026-batch freshers - and it is
the same fact for every college on the platform. Campus hiring in India is
national: an opening in Kolkata still recruits from a Bangalore campus. So the
scan runs **once** for everybody and postings are stored globally, with no
``college_id`` at all.

``JobLead`` is one college's decision about one posting - added, or dismissed.
Rows here are created only when somebody acts. A posting nobody has touched is
"new" to that college by the absence of a row, which is why a college that signs
up tomorrow sees the whole existing pool without anything being fanned out to it.

Status values are plain strings rather than native Postgres enums, matching
``DailyUpdate`` and ``CompanyAssignment``: adding a value to a native enum needs
an autocommit migration, and these lists will grow.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.database import Base

# Job vs internship - the two things a placement cell chases separately.
LEAD_TYPES = ("job", "internship")

# "added" points at the company the posting became; "dismissed" is what stops it
# resurfacing. There is deliberately no stored "new" - that is the absence of a row.
LEAD_STATUSES = ("added", "dismissed")

# The model's own read on how solid a posting is. Advisory, shown as a chip.
CONFIDENCE_LEVELS = ("high", "medium", "low")

SCAN_STATUSES = ("ok", "failed")


class JobPosting(Base):
    """One opening found on the web. Platform-wide: no tenant owns it."""

    __tablename__ = "job_postings"

    id = Column(Integer, primary_key=True, index=True)

    company_name = Column(String, nullable=False)
    role_title = Column(String, nullable=True)
    lead_type = Column(String, nullable=False, default="job")
    location = Column(String, nullable=True)
    work_mode = Column(String, nullable=True)
    eligibility = Column(String, nullable=True)
    compensation = Column(String, nullable=True)

    # When the posting went up, if the source said so. ``posted_label`` keeps the
    # source's own wording ("2 hours ago") for when no date could be parsed.
    posted_at = Column(Date, nullable=True)
    posted_label = Column(String, nullable=True)

    source_name = Column(String, nullable=True)
    source_url = Column(String, nullable=True)
    summary = Column(Text, nullable=True)
    confidence = Column(String, nullable=True)
    # False when the source_url was never seen in a search result: the model may
    # have invented the link. Warns in the UI; never drops the posting.
    verified = Column(Boolean, nullable=False, default=True)

    # sha1(company | role | url), unique across the platform - the same opening
    # found by two consecutive scans is one row.
    dedupe_key = Column(String, nullable=False, unique=True, index=True)
    discovered_at = Column(DateTime, default=datetime.utcnow, index=True)
    scan_id = Column(Integer, ForeignKey("job_lead_scans.id"), nullable=True)

    leads = relationship("JobLead", back_populates="posting", cascade="all, delete-orphan")


class JobLead(Base):
    """What one college did about one posting. Written only when they act."""

    __tablename__ = "job_leads"
    __table_args__ = (UniqueConstraint("college_id", "posting_id", name="uq_job_leads_college_posting"),)

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False, index=True)
    posting_id = Column(Integer, ForeignKey("job_postings.id"), nullable=False, index=True)

    status = Column(String, nullable=False, default="dismissed")
    # Set when the posting was promoted, so the row links to what it became.
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    actioned_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    actioned_at = Column(DateTime, default=datetime.utcnow)
    dismiss_reason = Column(String, nullable=True)

    posting = relationship("JobPosting", back_populates="leads")
    company = relationship("Company")
    actioned_by = relationship("User")


class JobLeadScan(Base):
    """One scan attempt - the run log, and the scheduler's idempotency key.

    Platform-wide, like the postings it produces. ``triggered_by_id`` is the
    person who pressed Scan now, or NULL for the scheduler; ``college_id`` records
    which tenant that person pressed it from, for the audit trail only.
    """

    __tablename__ = "job_lead_scans"

    id = Column(Integer, primary_key=True, index=True)
    scan_date = Column(Date, nullable=False, index=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)
    status = Column(String, nullable=False, default="ok")
    found = Column(Integer, default=0)
    new_count = Column(Integer, default=0)
    error = Column(String, nullable=True)
    triggered_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True)

    triggered_by = relationship("User")
