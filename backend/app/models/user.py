import enum
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Integer, String

from app.core.database import Base


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    PRINCIPAL = "principal"
    PRO_CHANCELLOR = "pro_chancellor"
    DEPUTY_PRO_CHANCELLOR = "deputy_pro_chancellor"
    PLACEMENT_OFFICER = "placement_officer"
    DEPARTMENT_COORDINATOR = "department_coordinator"
    STUDENT = "student"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.STUDENT)
    department = Column(String, nullable=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    must_reset_password = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
