import enum
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


class CommunicationType(str, enum.Enum):
    EMAIL = "email"
    CALL = "call"
    WHATSAPP = "whatsapp"
    MEETING = "meeting"
    LINKEDIN = "linkedin"


class Communication(Base):
    __tablename__ = "communications"

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    officer_id = Column(Integer, ForeignKey("placement_officers.id"), nullable=True)
    hr_contact_id = Column(Integer, ForeignKey("hr_contacts.id"), nullable=True)
    comm_type = Column(Enum(CommunicationType), nullable=False)
    subject = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    response_received = Column(String, nullable=True)
    next_followup_date = Column(DateTime, nullable=True)
    communicated_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    company = relationship("Company", back_populates="communications")
