from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.company import CompanyStatus


class HRContactBase(BaseModel):
    name: str
    designation: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    linkedin: Optional[str] = None
    region: Optional[str] = None
    relationship_strength: int = 3
    next_followup_date: Optional[datetime] = None
    notes: Optional[str] = None


class HRContactCreate(HRContactBase):
    company_id: int


class HRContactOut(HRContactBase):
    id: int
    company_id: int
    response_status: Optional[str] = None
    last_contacted_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class DraftEmailRequest(BaseModel):
    purpose: str


class DraftEmailResponse(BaseModel):
    email: str


class InterviewQuestionsRequest(BaseModel):
    job_role: str


class InterviewQuestionsResponse(BaseModel):
    questions: list[str]


class ExamQuestionsRequest(BaseModel):
    # No role -> the company's general screening exam (e.g. TCS NQT style).
    job_role: Optional[str] = None


class ExamQuestion(BaseModel):
    category: str
    question: str
    options: list[str]
    correct_index: int
    explanation: str


class ExamQuestionsResponse(BaseModel):
    questions: list[ExamQuestion]


class CompanyBase(BaseModel):
    name: str
    sector: Optional[str] = None
    domain: Optional[str] = None
    location: Optional[str] = None
    size: Optional[str] = None
    website: Optional[str] = None
    products_services: Optional[str] = None
    status: CompanyStatus = CompanyStatus.NEW
    mou_status: Optional[str] = None
    hiring_pattern: Optional[str] = None
    preferred_branches: Optional[str] = None
    min_cgpa: Optional[float] = None
    salary_min: Optional[float] = None
    salary_max: Optional[float] = None
    notes: Optional[str] = None


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(CompanyBase):
    name: Optional[str] = None
    status: Optional[CompanyStatus] = None


class CompanyOut(CompanyBase):
    id: int
    previous_visit_count: int
    ai_profile: Optional[str] = None
    source: Optional[str] = None
    review_status: Optional[str] = None
    created_by_id: Optional[int] = None
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    hr_contacts: list[HRContactOut] = []

    class Config:
        from_attributes = True
