from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.models.company import ROLE_STATUSES, ROLE_TYPES, CompanyStatus


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


class CompanyRoleBase(BaseModel):
    """A job role the company recruits for. Everything but the title is optional:
    a role is usually first written down the moment HR mentions it, long before
    the package or the eligibility bar is settled."""

    title: str
    role_type: str = "full_time"
    status: str = "open"
    ctc_min: Optional[float] = None
    ctc_max: Optional[float] = None
    stipend: Optional[float] = None
    openings: Optional[int] = None
    location: Optional[str] = None
    work_mode: Optional[str] = None
    eligible_branches: Optional[str] = None
    min_cgpa: Optional[float] = None
    max_backlogs: Optional[int] = None
    skills: Optional[str] = None
    job_description: Optional[str] = None
    apply_deadline: Optional[datetime] = None
    posting_url: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("role_type")
    @classmethod
    def _check_type(cls, value: str) -> str:
        if value not in ROLE_TYPES:
            raise ValueError(f"role_type must be one of: {', '.join(ROLE_TYPES)}")
        return value

    @field_validator("status")
    @classmethod
    def _check_status(cls, value: str) -> str:
        if value not in ROLE_STATUSES:
            raise ValueError(f"status must be one of: {', '.join(ROLE_STATUSES)}")
        return value


class CompanyRoleCreate(CompanyRoleBase):
    pass


class CompanyRoleUpdate(CompanyRoleBase):
    # Every field optional on edit; only what's sent is applied.
    title: Optional[str] = None
    role_type: Optional[str] = None
    status: Optional[str] = None

    @field_validator("role_type")
    @classmethod
    def _check_type(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in ROLE_TYPES:
            raise ValueError(f"role_type must be one of: {', '.join(ROLE_TYPES)}")
        return value

    @field_validator("status")
    @classmethod
    def _check_status(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in ROLE_STATUSES:
            raise ValueError(f"status must be one of: {', '.join(ROLE_STATUSES)}")
        return value


class CompanyRoleOut(CompanyRoleBase):
    id: int
    company_id: int
    created_by_id: Optional[int] = None
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

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
    roles: list[CompanyRoleOut] = []

    class Config:
        from_attributes = True
