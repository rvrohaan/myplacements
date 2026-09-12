import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.core.deps import require_roles
from app.core.security import get_password_hash
from app.core.tenant import get_current_college
from app.models.college import College
from app.models.user import User, UserRole
from app.schemas.user import InviteOut
from app.services.invites import issue_and_deliver

router = APIRouter(prefix="/colleges", tags=["colleges"])

# Only the platform owner manages colleges (from admin.myplacements.in).
SUPER_ADMIN_ONLY = require_roles(UserRole.SUPER_ADMIN)

# A college code doubles as its subdomain label, so it must be a valid DNS label:
# lowercase letters, digits and hyphens, not starting/ending with a hyphen.
_SUBDOMAIN_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
# Reserved labels that must never become a tenant subdomain. "send" carries the
# SPF/bounce records for outbound email, so a college claiming it would find its
# portal shadowed by those records rather than the tenant wildcard.
_RESERVED_CODES = {"www", "api", "app", "admin", "mail", "send", "static", "assets"}


class FirstAdmin(BaseModel):
    """The college's initial placement-head account, created alongside it."""

    email: EmailStr
    full_name: str
    # Optional: with no password the account is created without a usable one and
    # the response carries a single-use link for the head to set their own.
    password: Optional[str] = Field(default=None, min_length=8)


class CollegeCreate(BaseModel):
    name: str
    code: str
    city: Optional[str] = None
    logo_url: Optional[str] = None
    # Optionally provision the first admin in the same call so onboarding a
    # college is a single request.
    admin: Optional[FirstAdmin] = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        v = v.strip().lower()
        if not _SUBDOMAIN_RE.match(v):
            raise ValueError(
                "code must be a valid subdomain label (lowercase letters, digits, hyphens)"
            )
        if v in _RESERVED_CODES:
            raise ValueError("code is reserved")
        return v


class CollegeBranding(BaseModel):
    """Public, unauthenticated tenant identity for the login screen."""

    name: str
    code: str
    logo_url: Optional[str] = None

    class Config:
        from_attributes = True


class CollegeOut(BaseModel):
    id: int
    name: str
    code: str
    city: Optional[str] = None
    logo_url: Optional[str] = None
    is_active: bool

    class Config:
        from_attributes = True


class CollegeCreated(CollegeOut):
    """Create response: the college, plus the first admin's setup link when one
    was issued."""

    invite: Optional[InviteOut] = None


@router.get("", response_model=list[CollegeOut])
def list_colleges(db: Session = Depends(get_db), _: User = Depends(SUPER_ADMIN_ONLY)):
    return db.query(College).filter(College.is_active == True).all()


@router.post("", response_model=CollegeCreated, status_code=201)
def create_college(
    payload: CollegeCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(SUPER_ADMIN_ONLY),
):
    if db.query(College).filter(College.code == payload.code).first():
        raise HTTPException(status_code=400, detail="College code already exists")
    if payload.admin and db.query(User).filter(User.email == payload.admin.email).first():
        raise HTTPException(status_code=400, detail="Admin email already registered")

    college = College(name=payload.name, code=payload.code, city=payload.city, logo_url=payload.logo_url)
    db.add(college)
    db.flush()  # assign college.id for the admin FK

    issued = None
    if payload.admin:
        # Without a password in the payload the account gets an unguessable one
        # nobody ever sees; the setup link below is the only way in.
        admin = User(
            email=payload.admin.email,
            full_name=payload.admin.full_name,
            hashed_password=get_password_hash(payload.admin.password or secrets.token_urlsafe(32)),
            role=UserRole.PRO_CHANCELLOR,
            college_id=college.id,
            must_reset_password=True,
        )
        db.add(admin)
        db.flush()  # assign admin.id for the invite FK
        if not payload.admin.password:
            issued = issue_and_deliver(db, admin, actor=actor)

    db.commit()
    db.refresh(college)

    created = CollegeCreated.model_validate(college)
    created.invite = InviteOut(**vars(issued)) if issued else None
    return created


@router.get("/current", response_model=CollegeBranding)
def get_current(college: College = Depends(get_current_college)):
    """Branding for the college identified by the request's subdomain.

    Public (no auth) so the login screen can show the right name/logo before a
    user signs in. 404s when the subdomain is missing or unknown.
    """
    return college


@router.get("/{college_id}", response_model=CollegeOut)
def get_college(college_id: int, db: Session = Depends(get_db), _: User = Depends(SUPER_ADMIN_ONLY)):
    college = db.query(College).filter(College.id == college_id).first()
    if not college:
        raise HTTPException(status_code=404, detail="College not found")
    return college
