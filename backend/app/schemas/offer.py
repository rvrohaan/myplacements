from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.offer import OfferStatus


class OfferCreate(BaseModel):
    drive_id: int
    student_id: int
    ctc: Optional[float] = None
    role: Optional[str] = None
    location: Optional[str] = None
    joining_date: Optional[datetime] = None
    is_dream_offer: int = 0


class OfferUpdate(BaseModel):
    status: Optional[OfferStatus] = None
    joining_date: Optional[datetime] = None
    dropout_reason: Optional[str] = None
    offer_letter_url: Optional[str] = None


class OfferOut(BaseModel):
    id: int
    drive_id: int
    student_id: int
    ctc: Optional[float] = None
    role: Optional[str] = None
    location: Optional[str] = None
    joining_date: Optional[datetime] = None
    status: OfferStatus
    is_dream_offer: int
    dropout_reason: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
