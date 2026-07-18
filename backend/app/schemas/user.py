from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field

from app.models.user import UserRole


class CollegeSnippet(BaseModel):
    id: int
    name: str
    code: str

    class Config:
        from_attributes = True


class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    role: UserRole = UserRole.STUDENT
    department: Optional[str] = None
    college_id: Optional[int] = None


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    department: Optional[str] = None
    is_active: Optional[bool] = None


class PasswordReset(BaseModel):
    new_password: str = Field(min_length=8)


class UserOut(UserBase):
    id: int
    # plain str (not EmailStr): login-less backing accounts use placeholder
    # addresses that needn't pass deliverable-email validation on output.
    email: str
    is_active: bool
    must_reset_password: bool
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class StudentLoginRequest(BaseModel):
    roll_number: str
    password: str


class FindPortalRequest(BaseModel):
    query: str


class PortalMatch(BaseModel):
    name: str
    code: str
    city: str | None = None


class FindPortalResponse(BaseModel):
    colleges: list[PortalMatch]
