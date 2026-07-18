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
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
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
