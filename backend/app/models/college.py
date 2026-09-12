from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String

from app.core.database import Base


class College(Base):
    __tablename__ = "colleges"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, unique=True, nullable=False, index=True)
    city = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # --- Daily updates ------------------------------------------------------
    # Local "HH:MM" by which officers are expected to file; anything after it is
    # recorded as late. Also anchors the reminder and digest emails.
    daily_update_cutoff = Column(String, default="19:00")
    daily_update_enabled = Column(Boolean, default=True)
