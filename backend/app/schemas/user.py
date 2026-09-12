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
    # Optional: leave it out and the account is created with no usable password,
    # and the caller gets a one-time setup link to send instead. A password is
    # still accepted for scripted/offline provisioning.
    password: Optional[str] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    department: Optional[str] = None
    is_active: Optional[bool] = None


class PasswordReset(BaseModel):
    new_password: str = Field(min_length=8)


class InviteOut(BaseModel):
    """The one-time password-setup link handed back to whoever provisioned the
    account, so they can send it on any channel."""

    url: str
    expires_at: datetime
    # Address we attempted, and what happened: sent | failed | skipped.
    # "skipped" means nothing was attempted (no mail provider configured, or a
    # login-less student account with no real address).
    email: str
    email_status: str


class InviteCheck(BaseModel):
    """What the public accept-invite page may show before anyone authenticates:
    enough to confirm the link is for you, and nothing more."""

    full_name: str
    college_name: Optional[str] = None
    is_reset: bool = False


class InviteAccept(BaseModel):
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


class UserCreated(UserOut):
    """Create-user response: the account plus the setup link, when one was
    issued. Null when the caller supplied a password itself."""

    invite: Optional[InviteOut] = None


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
