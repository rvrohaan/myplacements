import enum
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


# A role the company hires for. Plain strings rather than native Postgres
# enums (matching CompanyAssignment / DailyUpdate): both lists will grow, and adding
# a value to a native enum needs an autocommit migration.
ROLE_TYPES = ("full_time", "internship", "internship_ppo", "contract", "apprenticeship")

# "open" means actively recruiting; "filled" is closed because the seats went.
ROLE_STATUSES = ("open", "on_hold", "filled", "closed")


class CompanyStatus(str, enum.Enum):
    ACTIVE = "active"
    DORMANT = "dormant"
    BLACKLISTED = "blacklisted"
    PRIORITY = "priority"
    NEW = "new"


class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    sector = Column(String, nullable=True)
    domain = Column(String, nullable=True)
    location = Column(String, nullable=True)
    size = Column(String, nullable=True)
    website = Column(String, nullable=True)
    products_services = Column(Text, nullable=True)
    status = Column(Enum(CompanyStatus), default=CompanyStatus.NEW)
    mou_status = Column(String, nullable=True)
    hiring_pattern = Column(String, nullable=True)
    preferred_branches = Column(String, nullable=True)
    min_cgpa = Column(Float, nullable=True)
    salary_min = Column(Float, nullable=True)
    salary_max = Column(Float, nullable=True)
    previous_visit_count = Column(Integer, default=0)
    ai_profile = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True)
    # Lead provenance: "officer_lead" marks a company an officer added themselves.
    # review_status is the placement head's decision on that lead:
    # None (no review needed) | "pending" | "approved" | "declined".
    source = Column(String, nullable=True)
    review_status = Column(String, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    hr_contacts = relationship("HRContact", back_populates="company", cascade="all, delete-orphan")
    roles = relationship(
        "CompanyRole",
        back_populates="company",
        cascade="all, delete-orphan",
        order_by="CompanyRole.created_at",
    )
    assignments = relationship("CompanyAssignment", back_populates="company")
    drives = relationship("Drive", back_populates="company")
    communications = relationship("Communication", back_populates="company")
    created_by = relationship("User")

    @property
    def created_by_name(self) -> str | None:
        return self.created_by.full_name if self.created_by else None


class HRContact(Base):
    __tablename__ = "hr_contacts"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    designation = Column(String, nullable=True)
    email = Column(String, nullable=True)
    mobile = Column(String, nullable=True)
    linkedin = Column(String, nullable=True)
    region = Column(String, nullable=True)
    response_status = Column(String, nullable=True)
    # The officer's own read on the relationship, 1-5. Deliberately a human
    # judgement and never computed: somebody can be a champion for the college
    # before a single communication has been logged against them, and a contact
    # who answers every mail politely while blocking every drive is not a 5.
    # The computed counterpart lives in services.hr_engagement, which scores the
    # evidence instead - the two are shown side by side and neither overwrites
    # the other.
    relationship_strength = Column(Integer, default=3)
    last_contacted_at = Column(DateTime, nullable=True)
    next_followup_date = Column(DateTime, nullable=True)
    # What we owe this contact next, in the officer's words - "send the 2027
    # brochure", "confirm the JD". next_followup_date says *when*; this says
    # *what*, which is the half that goes missing when an officer hands over.
    next_action = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company = relationship("Company", back_populates="hr_contacts")


class CompanyRole(Base):
    """A job role / offer the company recruits for.

    This is the company's standing catalogue - "Infosys hires Systems Engineers
    at 3.6 LPA and Digital Specialist Engineers at 9.5 LPA" - and it outlives any
    one campus visit. A ``Drive`` is the scheduled event that fills such a role in
    a given season; a role can seed many drives across batches, and a role with no
    drive yet is still worth recording the moment HR mentions it.
    """

    __tablename__ = "company_roles"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    role_type = Column(String, nullable=False, default="full_time")
    status = Column(String, nullable=False, default="open")
    # Annual package in LPA. A fixed package sets both ends to the same number.
    ctc_min = Column(Float, nullable=True)
    ctc_max = Column(Float, nullable=True)
    # Monthly stipend for internships, in rupees - a different unit from ctc_*,
    # so it gets its own column rather than overloading the package range.
    stipend = Column(Float, nullable=True)
    openings = Column(Integer, nullable=True)
    location = Column(String, nullable=True)
    work_mode = Column(String, nullable=True)
    eligible_branches = Column(String, nullable=True)
    min_cgpa = Column(Float, nullable=True)
    max_backlogs = Column(Integer, nullable=True)
    skills = Column(String, nullable=True)
    job_description = Column(Text, nullable=True)
    apply_deadline = Column(DateTime, nullable=True)
    posting_url = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company = relationship("Company", back_populates="roles")
    created_by = relationship("User")

    @property
    def created_by_name(self) -> str | None:
        return self.created_by.full_name if self.created_by else None
