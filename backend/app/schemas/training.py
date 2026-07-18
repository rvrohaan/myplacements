from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ModuleCreate(BaseModel):
    name: str
    category: Optional[str] = None  # aptitude | coding | communication | mock_interview | other
    description: Optional[str] = None


class ModuleUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None


class ModuleOut(BaseModel):
    id: int
    name: str
    category: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime
    # Aggregates for the training dashboard.
    enrolled_count: int = 0
    completed_count: int = 0
    avg_score: Optional[float] = None
    avg_attendance: Optional[float] = None

    class Config:
        from_attributes = True


class TrainingRecordCreate(BaseModel):
    student_id: int


class TrainingRecordUpdate(BaseModel):
    score: Optional[float] = None
    attendance_percent: Optional[float] = None
    mock_test_score: Optional[float] = None
    status: Optional[str] = None  # enrolled | in_progress | completed | dropped


class TrainingRecordOut(BaseModel):
    id: int
    student_id: int
    module_id: int
    score: Optional[float] = None
    attendance_percent: Optional[float] = None
    mock_test_score: Optional[float] = None
    status: str
    completed_at: Optional[datetime] = None
    created_at: datetime
    # Denormalised student fields for the progress table.
    student_name: Optional[str] = None
    roll_number: Optional[str] = None
    branch: Optional[str] = None

    class Config:
        from_attributes = True
