from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.communication import CommunicationType


class CommunicationCreate(BaseModel):
    company_id: int
    hr_contact_id: Optional[int] = None
    officer_id: Optional[int] = None
    comm_type: CommunicationType
    subject: Optional[str] = None
    notes: Optional[str] = None
    response_received: Optional[str] = None  # awaited | received | no_response
    next_followup_date: Optional[datetime] = None
    communicated_at: Optional[datetime] = None


class CommunicationUpdate(BaseModel):
    comm_type: Optional[CommunicationType] = None
    subject: Optional[str] = None
    notes: Optional[str] = None
    response_received: Optional[str] = None
    next_followup_date: Optional[datetime] = None
    communicated_at: Optional[datetime] = None


class CommunicationOut(BaseModel):
    id: int
    company_id: int
    hr_contact_id: Optional[int] = None
    officer_id: Optional[int] = None
    comm_type: CommunicationType
    subject: Optional[str] = None
    notes: Optional[str] = None
    response_received: Optional[str] = None
    next_followup_date: Optional[datetime] = None
    communicated_at: datetime
    created_at: datetime
    # Denormalised for the timeline / follow-up list.
    company_name: Optional[str] = None
    hr_contact_name: Optional[str] = None

    class Config:
        from_attributes = True
