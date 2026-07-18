from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.drive import DriveMode, DriveStatus, ParticipantStatus


class DriveBase(BaseModel):
    company_id: int
    job_role: str
    drive_date: Optional[datetime] = None
    mode: DriveMode = DriveMode.OFFLINE
    status: DriveStatus = DriveStatus.UPCOMING
    min_cgpa: Optional[float] = None
    eligible_branches: Optional[str] = None
    max_backlogs: int = 0
    ctc_offered: Optional[float] = None
    job_description: Optional[str] = None
    location: Optional[str] = None
    registration_deadline: Optional[datetime] = None
    notes: Optional[str] = None
    total_rounds: Optional[int] = None


class DriveCreate(DriveBase):
    pass


class DriveUpdate(BaseModel):
    job_role: Optional[str] = None
    drive_date: Optional[datetime] = None
    mode: Optional[DriveMode] = None
    status: Optional[DriveStatus] = None
    min_cgpa: Optional[float] = None
    eligible_branches: Optional[str] = None
    ctc_offered: Optional[float] = None
    job_description: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    total_rounds: Optional[int] = None


class DriveRoundOut(BaseModel):
    id: int
    drive_id: int
    round_number: int
    name: Optional[str] = None
    appeared_count: Optional[int] = None
    passed_count: Optional[int] = None
    conducted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class DriveRoundUpdate(BaseModel):
    name: Optional[str] = None
    # How many turned up for this round. Editable per round; kept as a plain field
    # rather than derived so drives that aren't portal-driven can be tracked too.
    appeared_count: Optional[int] = None
    # Number who cleared this round. Sending null re-opens the round (clears the
    # recorded result); a value marks it conducted and auto-fills the next round's
    # appeared count when that is still empty.
    passed_count: Optional[int] = None


class DriveOut(DriveBase):
    id: int
    participant_count: int = 0
    rounds: list[DriveRoundOut] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ParticipantCreate(BaseModel):
    drive_id: int
    student_id: int


class ParticipantUpdate(BaseModel):
    status: ParticipantStatus
    rejection_reason: Optional[str] = None
    # Package (LPA) captured when a participant is marked "selected"; flows through
    # to the student's placement record and a drive-linked offer.
    ctc: Optional[float] = None


class RoundResultOut(BaseModel):
    round_number: Optional[int] = None
    appeared: bool = False
    passed: Optional[bool] = None

    class Config:
        from_attributes = True


class ParticipantOut(BaseModel):
    id: int
    drive_id: int
    student_id: int
    status: ParticipantStatus
    rejection_reason: Optional[str] = None
    resume_url: Optional[str] = None
    registered_at: datetime
    student_name: Optional[str] = None
    roll_number: Optional[str] = None
    branch: Optional[str] = None
    cgpa: Optional[float] = None
    ctc: Optional[float] = None
    round_results: list[RoundResultOut] = []

    class Config:
        from_attributes = True


class RoundUploadSummary(BaseModel):
    round_number: int
    appeared: int
    passed: int
    withdrawn: int
    created_participants: int
    # Students who weren't on file yet and were auto-created from the roster.
    created_students: int = 0
    # Rows ignored because the student was already eliminated in an earlier round
    # (e.g. a stale full roster re-uploaded for a later round).
    skipped_eliminated: int = 0
    # Retained for API compatibility; now always empty since unknown roll numbers
    # are auto-created rather than skipped.
    unmatched: list[str] = []
    used_ai: bool = False
