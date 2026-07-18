import enum
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


class DriveMode(str, enum.Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    HYBRID = "hybrid"


class DriveStatus(str, enum.Enum):
    UPCOMING = "upcoming"
    ONGOING = "ongoing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ParticipantStatus(str, enum.Enum):
    REGISTERED = "registered"
    SHORTLISTED = "shortlisted"
    ATTENDED = "attended"
    # Cleared at least one interview round with more rounds still to come. Set by
    # the round-results upload; a coarse rollup of the per-round DriveRoundResult.
    IN_PROCESS = "in_process"
    APTITUDE_CLEARED = "aptitude_cleared"
    TECHNICAL_CLEARED = "technical_cleared"
    HR_CLEARED = "hr_cleared"
    SELECTED = "selected"
    REJECTED = "rejected"
    # Student is out of this drive's process — e.g. they accepted an offer from
    # another company, or (via round uploads) cleared a round but did not appear
    # for the next. Distinct from "rejected" (the company dropped them).
    WITHDRAWN = "withdrawn"


class Drive(Base):
    __tablename__ = "drives"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    job_role = Column(String, nullable=False)
    drive_date = Column(DateTime, nullable=True)
    mode = Column(Enum(DriveMode), default=DriveMode.OFFLINE)
    status = Column(Enum(DriveStatus), default=DriveStatus.UPCOMING)
    min_cgpa = Column(Float, nullable=True)
    eligible_branches = Column(String, nullable=True)
    max_backlogs = Column(Integer, default=0)
    ctc_offered = Column(Float, nullable=True)
    job_description = Column(Text, nullable=True)
    location = Column(String, nullable=True)
    registration_deadline = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    # Planned number of interview rounds for the role; seeds the DriveRound rows.
    total_rounds = Column(Integer, nullable=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company = relationship("Company", back_populates="drives")
    participants = relationship("DriveParticipant", back_populates="drive", cascade="all, delete-orphan")
    rounds = relationship(
        "DriveRound",
        back_populates="drive",
        cascade="all, delete-orphan",
        order_by="DriveRound.round_number",
    )
    offers = relationship("Offer", back_populates="drive")

    @property
    def participant_count(self) -> int:
        return len(self.participants)


class DriveRound(Base):
    """One interview round of a drive and its funnel counts.

    Both counts are entered by the officer: ``appeared_count`` is how many
    candidates turned up for the round and ``passed_count`` how many cleared it.
    As a convenience, recording a round's ``passed_count`` auto-fills the next
    round's ``appeared_count`` when that field is still empty. Either stays
    ``None`` until the officer fills it.
    """

    __tablename__ = "drive_rounds"

    id = Column(Integer, primary_key=True, index=True)
    drive_id = Column(Integer, ForeignKey("drives.id"), nullable=False)
    round_number = Column(Integer, nullable=False)
    name = Column(String, nullable=True)
    appeared_count = Column(Integer, nullable=True)
    passed_count = Column(Integer, nullable=True)
    conducted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    drive = relationship("Drive", back_populates="rounds")
    results = relationship(
        "DriveRoundResult", back_populates="round", cascade="all, delete-orphan"
    )

    @property
    def completed(self) -> bool:
        return self.passed_count is not None


class DriveRoundResult(Base):
    """One student's outcome in one interview round, populated from an uploaded
    roster. ``appeared`` records that they turned up; ``passed`` is ``True``/
    ``False`` once decided (``None`` while only an appeared list is in). ``ctc``
    carries the offered package when it's supplied on the passed sheet.
    """

    __tablename__ = "drive_round_results"

    id = Column(Integer, primary_key=True, index=True)
    round_id = Column(Integer, ForeignKey("drive_rounds.id"), nullable=False)
    participant_id = Column(Integer, ForeignKey("drive_participants.id"), nullable=False)
    appeared = Column(Boolean, default=False)
    passed = Column(Boolean, nullable=True)
    ctc = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    round = relationship("DriveRound", back_populates="results")
    participant = relationship("DriveParticipant", back_populates="round_results")

    @property
    def round_number(self) -> int | None:
        return self.round.round_number if self.round else None


class DriveParticipant(Base):
    __tablename__ = "drive_participants"

    id = Column(Integer, primary_key=True, index=True)
    drive_id = Column(Integer, ForeignKey("drives.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    status = Column(Enum(ParticipantStatus), default=ParticipantStatus.REGISTERED)
    rejection_reason = Column(String, nullable=True)
    # Resume the student submitted with this application (snapshot of their
    # profile resume at apply time).
    resume_url = Column(String, nullable=True)
    registered_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    drive = relationship("Drive", back_populates="participants")
    student = relationship("Student", back_populates="drive_participations")
    round_results = relationship(
        "DriveRoundResult", back_populates="participant", cascade="all, delete-orphan"
    )

    @property
    def ctc(self) -> float | None:
        """Package captured for this student, taken from the latest round whose
        roster carried a CTC (typically the final, selection round)."""
        with_ctc = [r for r in self.round_results if r.ctc is not None]
        if not with_ctc:
            return None
        return max(with_ctc, key=lambda r: r.round_number or 0).ctc

    # Convenience accessors so the participants API can show who applied without
    # the frontend cross-referencing the students list.
    @property
    def student_name(self) -> str | None:
        return self.student.full_name if self.student else None

    @property
    def roll_number(self) -> str | None:
        return self.student.roll_number if self.student else None

    @property
    def branch(self) -> str | None:
        return self.student.branch if self.student else None

    @property
    def cgpa(self) -> float | None:
        return self.student.cgpa if self.student else None
