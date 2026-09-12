from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.communication import CommunicationType


class CommunicationCreate(BaseModel):
    company_id: int
    hr_contact_id: Optional[int] = None
    comm_type: CommunicationType
    subject: Optional[str] = None
    notes: Optional[str] = None
    response_received: Optional[str] = None  # awaited | received | no_response
    next_followup_date: Optional[datetime] = None
    communicated_at: Optional[datetime] = None
    # Authorship (logged_by_id / officer_id) is stamped from the session, not
    # taken from the client, so a log can't be filed under someone else's name.


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
    logged_by_id: Optional[int] = None
    officer_id: Optional[int] = None
    officer_attribution: Optional[str] = None
    comm_type: CommunicationType
    subject: Optional[str] = None
    notes: Optional[str] = None
    response_received: Optional[str] = None
    next_followup_date: Optional[datetime] = None
    communicated_at: datetime
    created_at: datetime
    updated_at: Optional[datetime] = None
    # Denormalised for the timeline / follow-up list.
    company_name: Optional[str] = None
    hr_contact_name: Optional[str] = None
    # Who logged it, so a head reading the timeline can see the author without
    # looking anything up.
    logged_by_name: Optional[str] = None
    logged_by_role: Optional[str] = None
    officer_name: Optional[str] = None
    # Whether the caller may edit or delete this entry (author, or a head).
    can_edit: bool = False

    class Config:
        from_attributes = True
