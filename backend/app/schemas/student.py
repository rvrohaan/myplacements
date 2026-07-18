from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.student import PlacementStatus, RiskCategory


class StudentBase(BaseModel):
    roll_number: str
    branch: str
    batch_year: int
    cgpa: Optional[float] = None
    backlogs: int = 0
    skills: Optional[str] = None
    certifications: Optional[str] = None
    internships: Optional[str] = None
    projects: Optional[str] = None
    resume_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    placement_preference: Optional[str] = None
    location_preference: Optional[str] = None
    placement_ctc: Optional[float] = None
    higher_studies_plan: bool = False


class StudentCreate(StudentBase):
    # Either link to an existing user account, or pass full_name to auto-create
    # a login-less backing user for this profile.
    user_id: Optional[int] = None
    full_name: Optional[str] = None


class StudentUpdate(BaseModel):
    full_name: Optional[str] = None
    roll_number: Optional[str] = None
    branch: Optional[str] = None
    batch_year: Optional[int] = None
    cgpa: Optional[float] = None
    backlogs: Optional[int] = None
    skills: Optional[str] = None
    certifications: Optional[str] = None
    internships: Optional[str] = None
    projects: Optional[str] = None
    resume_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    placement_preference: Optional[str] = None
    location_preference: Optional[str] = None
    placement_status: Optional[PlacementStatus] = None
    placement_ctc: Optional[float] = None
    readiness_score: Optional[float] = None
    risk_category: Optional[RiskCategory] = None
    higher_studies_plan: Optional[bool] = None


class StudentOut(StudentBase):
    id: int
    user_id: int
    full_name: Optional[str] = None
    placement_status: PlacementStatus
    readiness_score: Optional[float] = None
    risk_category: RiskCategory
    login_enabled: bool = False
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EnableLoginRequest(BaseModel):
    student_ids: list[int]


class EnableLoginResult(BaseModel):
    student_id: int
    roll_number: str
    full_name: Optional[str] = None
    temp_password: str
