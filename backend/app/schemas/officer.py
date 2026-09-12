from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class OfficerCreate(BaseModel):
    user_id: int
    region: Optional[str] = None
    sector_expertise: Optional[str] = None
    target_companies: int = 0
    target_offers: int = 0


class OfficerUpdate(BaseModel):
    region: Optional[str] = None
    sector_expertise: Optional[str] = None
    target_companies: Optional[int] = None
    target_offers: Optional[int] = None


class OfficerOut(BaseModel):
    id: int
    user_id: int
    region: Optional[str] = None
    sector_expertise: Optional[str] = None
    target_companies: int = 0
    target_offers: int = 0
    created_at: datetime
    # Denormalised for the allocation screen / officer cards.
    officer_name: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    assignment_count: int = 0
    active_count: int = 0

    class Config:
        from_attributes = True


class AssignmentCreate(BaseModel):
    company_id: int
    priority: str = "normal"
    notes: Optional[str] = None


class AssignmentUpdate(BaseModel):
    # Workflow status: active → accepted → completed, or escalated.
    status: Optional[str] = None
    priority: Optional[str] = None
    notes: Optional[str] = None


class AssignmentOut(BaseModel):
    id: int
    company_id: int
    officer_id: int
    status: str
    priority: str
    notes: Optional[str] = None
    assigned_at: datetime
    company_name: Optional[str] = None
    company_status: Optional[str] = None
    company_sector: Optional[str] = None

    class Config:
        from_attributes = True


# --- auto-allocation --------------------------------------------------------


class AllocationProposal(BaseModel):
    """One proposed company → officer allocation, shown for review."""

    company_id: int
    company_name: Optional[str] = None
    company_sector: Optional[str] = None
    company_location: Optional[str] = None
    company_status: Optional[str] = None
    officer_id: int
    officer_name: Optional[str] = None
    priority: str = "normal"
    reasoning: Optional[str] = None


class AllocationPreviewOut(BaseModel):
    proposals: list[AllocationProposal]
    # Every allocatable company in the college with no owner yet.
    unassigned_count: int
    officer_count: int
    # How many of those the chosen scope looked at. Proposals are the top
    # `limit` of these by importance, so considered_count > len(proposals) means
    # the head is seeing a shortlist and re-running will offer more.
    considered_count: int = 0
    scope: str = "pipeline"
    limit: int = 0


class AllocationApplyItem(BaseModel):
    company_id: int
    officer_id: int
    priority: str = "normal"


class AllocationApplyIn(BaseModel):
    allocations: list[AllocationApplyItem]


class AllocationApplyOut(BaseModel):
    created: int
    skipped: int
