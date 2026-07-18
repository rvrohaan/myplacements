import enum
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


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
    relationship_strength = Column(Integer, default=3)
    last_contacted_at = Column(DateTime, nullable=True)
    next_followup_date = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    company = relationship("Company", back_populates="hr_contacts")
