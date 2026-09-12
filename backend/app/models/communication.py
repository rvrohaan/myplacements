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
    # Who typed the log. Always stamped from the session, never from the client,
    # so leadership can see the author of every entry.
    logged_by_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # Which officer the outreach counts towards. Set when the author is an
    # officer; NULL when a head or coordinator logged it themselves.
    officer_id = Column(Integer, ForeignKey("placement_officers.id"), nullable=True, index=True)
    # "recorded" = stamped at log time, "inferred" = backfilled from the company
    # allocation for rows logged before authorship was captured.
    officer_attribution = Column(String, nullable=True)
    hr_contact_id = Column(Integer, ForeignKey("hr_contacts.id"), nullable=True)
    comm_type = Column(Enum(CommunicationType), nullable=False)
    subject = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    response_received = Column(String, nullable=True)
    next_followup_date = Column(DateTime, nullable=True)
    communicated_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company = relationship("Company", back_populates="communications")
    logged_by = relationship("User")
    officer = relationship("PlacementOfficer")
