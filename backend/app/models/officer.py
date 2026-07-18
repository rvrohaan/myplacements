from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base


class PlacementOfficer(Base):
    __tablename__ = "placement_officers"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True)
    region = Column(String, nullable=True)
    sector_expertise = Column(String, nullable=True)
    target_companies = Column(Integer, default=0)
    target_offers = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    assignments = relationship("CompanyAssignment", back_populates="officer")


class CompanyAssignment(Base):
    __tablename__ = "company_assignments"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    officer_id = Column(Integer, ForeignKey("placement_officers.id"), nullable=False)
    assigned_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="active")
    priority = Column(String, default="normal")
    notes = Column(Text, nullable=True)

    company = relationship("Company", back_populates="assignments")
    officer = relationship("PlacementOfficer", back_populates="assignments")
