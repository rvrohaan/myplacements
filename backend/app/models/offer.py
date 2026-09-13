import enum
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


class OfferStatus(str, enum.Enum):
    ISSUED = "issued"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    JOINED = "joined"
    DROPOUT = "dropout"


class Offer(Base):
    __tablename__ = "offers"

    id = Column(Integer, primary_key=True, index=True)
    drive_id = Column(Integer, ForeignKey("drives.id"), nullable=True)
    # Who made the offer. Drive-linked offers inherit it from the drive; offers
    # recorded by hand carry it directly, which is how an off-campus or referral
    # offer gets attributed to a company at all. NULL means one thing only: the
    # placeholder the "mark as placed" flow keeps in sync (see `is_placeholder`).
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, index=True)
    ctc = Column(Float, nullable=True)
    role = Column(String, nullable=True)
    location = Column(String, nullable=True)
    joining_date = Column(DateTime, nullable=True)
    status = Column(Enum(OfferStatus), default=OfferStatus.ISSUED)
    dropout_reason = Column(Text, nullable=True)
    offer_letter_url = Column(String, nullable=True)
    is_dream_offer = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    drive = relationship("Drive", back_populates="offers")
    student = relationship("Student", back_populates="offers")
    company = relationship("Company")

    @property
    def is_placeholder(self) -> bool:
        """True for the row the Students page's "mark as placed" flow maintains:
        no drive and no company, because nobody said where the offer came from.
        It exists so a manually-placed student still counts in offer totals, and
        it is the one offer the student record owns rather than the other way
        round — see ``students._sync_placement_offer``."""
        return self.drive_id is None and self.company_id is None

    # --- display fields, resolved through the relationships -----------------
    # Read-only, so an offer row can name its student and company without every
    # caller joining three tables to render one line.

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
    def batch_year(self) -> int | None:
        return self.student.batch_year if self.student else None

    @property
    def company_name(self) -> str | None:
        if self.company:
            return self.company.name
        # A drive-linked offer written before company_id existed still knows its
        # company through the drive.
        if self.drive and self.drive.company:
            return self.drive.company.name
        return None

    @property
    def drive_title(self) -> str | None:
        return self.drive.job_role if self.drive else None
