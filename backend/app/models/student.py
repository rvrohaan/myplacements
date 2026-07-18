import enum
from datetime import datetime

from sqlalchemy import (  # noqa
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class PlacementStatus(str, enum.Enum):
    UNPLACED = "unplaced"
    PLACED = "placed"
    OPTED_OUT = "opted_out"
    HIGHER_STUDIES = "higher_studies"


class RiskCategory(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Student(Base):
    __tablename__ = "students"
    # Roll numbers are unique within a college, not globally — two colleges may
    # legitimately reuse the same roll number.
    __table_args__ = (
        UniqueConstraint("college_id", "roll_number", name="uq_students_college_roll"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    roll_number = Column(String, nullable=False, index=True)
    branch = Column(String, nullable=False)
    batch_year = Column(Integer, nullable=False)
    cgpa = Column(Float, nullable=True)
    backlogs = Column(Integer, default=0)
    skills = Column(Text, nullable=True)
    certifications = Column(Text, nullable=True)
    internships = Column(Text, nullable=True)
    projects = Column(Text, nullable=True)
    resume_url = Column(String, nullable=True)
    linkedin_url = Column(String, nullable=True)
    github_url = Column(String, nullable=True)
    placement_preference = Column(String, nullable=True)
    location_preference = Column(String, nullable=True)
    placement_status = Column(Enum(PlacementStatus), default=PlacementStatus.UNPLACED)
    placement_ctc = Column(Float, nullable=True)  # package in LPA, set when placed
    readiness_score = Column(Float, nullable=True)
    risk_category = Column(Enum(RiskCategory), default=RiskCategory.MEDIUM)
    higher_studies_plan = Column(Boolean, default=False)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")
    drive_participations = relationship("DriveParticipant", back_populates="student")

    @property
    def full_name(self) -> str | None:
        return self.user.full_name if self.user else None

    @property
    def login_enabled(self) -> bool:
        """True once an admin has activated this student's login (the backing
        user account is active). Login-less profiles are inactive by default."""
        return bool(self.user and self.user.is_active)

    offers = relationship("Offer", back_populates="student")
    training_records = relationship("StudentTraining", back_populates="student")
