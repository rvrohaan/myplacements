from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.offer import OfferStatus


class OfferCreate(BaseModel):
    student_id: int
    # Required when recording an offer by hand: an offer always comes from a
    # company, and without one it can't be read company-wise or told apart from
    # the "mark as placed" placeholder. Drive-linked offers fill it from the drive.
    company_id: Optional[int] = None
    drive_id: Optional[int] = None
    ctc: Optional[float] = None
    role: Optional[str] = None
    location: Optional[str] = None
    joining_date: Optional[datetime] = None
    status: OfferStatus = OfferStatus.ISSUED
    offer_letter_url: Optional[str] = None
    is_dream_offer: int = 0


class OfferUpdate(BaseModel):
    company_id: Optional[int] = None
    ctc: Optional[float] = None
    role: Optional[str] = None
    location: Optional[str] = None
    status: Optional[OfferStatus] = None
    joining_date: Optional[datetime] = None
    dropout_reason: Optional[str] = None
    offer_letter_url: Optional[str] = None
    is_dream_offer: Optional[int] = None


class OfferOut(BaseModel):
    id: int
    # Nullable: an offer recorded outside a drive has no drive, and the
    # "mark as placed" placeholder has neither drive nor company.
    drive_id: Optional[int] = None
    company_id: Optional[int] = None
    student_id: int
    ctc: Optional[float] = None
    role: Optional[str] = None
    location: Optional[str] = None
    joining_date: Optional[datetime] = None
    status: OfferStatus
    is_dream_offer: int
    dropout_reason: Optional[str] = None
    offer_letter_url: Optional[str] = None
    created_at: datetime
    # Resolved through the relationships so a row can render without the caller
    # joining students, companies and drives itself.
    student_name: Optional[str] = None
    roll_number: Optional[str] = None
    branch: Optional[str] = None
    batch_year: Optional[int] = None
    company_name: Optional[str] = None
    drive_title: Optional[str] = None
    is_placeholder: bool = False
    # How many offers this student holds in total — what makes a student with
    # three offers legible on a list that shows one row per offer.
    offer_count: Optional[int] = None

    class Config:
        from_attributes = True


class OfferSummary(BaseModel):
    """Counts for the offers screen's summary strip. Computed over the current
    filters *except* status, so the tiles keep their meaning while one of them
    is being used as a filter."""

    total: int
    issued: int
    accepted: int
    joined: int
    rejected: int
    dropout: int
    # Students holding at least one offer, and those holding more than one —
    # the offer count alone overstates how many people are placed.
    students_with_offer: int
    students_with_multiple: int
    highest_ctc: Optional[float] = None
    median_ctc: Optional[float] = None
    avg_ctc: Optional[float] = None
    # Of the offers a student accepted, the share that reached "joined".
    joining_conversion: Optional[float] = None
    awaiting_joining_date: int = 0


class OfferFilterOptions(BaseModel):
    """The values behind the offers screen's dropdowns, so they only offer
    choices that can return a row."""

    branches: list[str]
    batch_years: list[int]
    companies: list["OfferCompanyOption"]


class OfferCompanyOption(BaseModel):
    id: int
    name: str


OfferFilterOptions.model_rebuild()
