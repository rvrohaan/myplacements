import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.core.security import create_access_token, get_password_hash, verify_password
from app.core.tenant import get_current_college, get_optional_college, is_admin_host
from app.models.college import College
from app.models.invite import InvitePurpose, UserInvite
from app.models.student import Student
from app.models.user import User, UserRole
from app.schemas.user import (
    FindPortalRequest,
    FindPortalResponse,
    InviteAccept,
    InviteCheck,
    LoginRequest,
    PasswordReset,
    PortalMatch,
    StudentLoginRequest,
    Token,
    UserCreate,
    UserOut,
)
from app.services.invites import resolve_invite

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(
    request: Request,
    payload: LoginRequest,
    db: Session = Depends(get_db),
    college: College | None = Depends(get_optional_college),
):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    # The host decides where you may sign in. SUPER_ADMIN signs in on the platform
    # console (admin.myplacements.in); everyone else on their own college subdomain.
    # The apex and unknown subdomains accept no logins. Always return the same 401
    # as a bad password so we don't leak which emails exist or where.
    if user.role == UserRole.SUPER_ADMIN:
        allowed = is_admin_host(request)
    else:
        allowed = college is not None and user.college_id == college.id
    if not allowed:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token(subject=user.id, college_id=user.college_id)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.post("/student/login", response_model=Token)
def student_login(
    payload: StudentLoginRequest,
    db: Session = Depends(get_db),
    college: College = Depends(get_current_college),
):
    """Students sign in with their roll number on their own college subdomain.
    The roll number is unique per college, so the subdomain disambiguates it."""
    student = (
        db.query(Student)
        .filter(Student.roll_number == payload.roll_number, Student.college_id == college.id)
        .first()
    )
    # Same 401 for unknown roll / bad password / disabled login, so we don't leak
    # which roll numbers exist or whether login has been enabled.
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not student or not student.user:
        raise invalid
    user = student.user
    if not user.is_active or user.role != UserRole.STUDENT:
        raise invalid
    if not verify_password(payload.password, user.hashed_password):
        raise invalid

    token = create_access_token(subject=user.id, college_id=user.college_id)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.post("/register", response_model=UserOut, status_code=201)
def register(
    payload: UserCreate,
    db: Session = Depends(get_db),
    college: College | None = Depends(get_optional_college),
    # Account creation is privileged: super_admin provisions across tenants, while
    # college admins are scoped to their own college (enforced below + by host).
    actor: User = Depends(require_roles(*(UserRole.SUPER_ADMIN, UserRole.PRINCIPAL, UserRole.PRO_CHANCELLOR, UserRole.DEPUTY_PRO_CHANCELLOR))),
):
    # The subdomain is the source of truth for the tenant. On a college host the
    # actor is pinned to that college; only super_admin (on the admin host) may
    # target an arbitrary college via the body.
    if college is not None:
        college_id = college.id
    elif actor.role == UserRole.SUPER_ADMIN:
        college_id = payload.college_id
    else:
        college_id = actor.college_id
    if db.query(User).filter(User.email == payload.email, User.college_id == college_id).first():
        raise HTTPException(status_code=400, detail="Email already registered for this college")
    user = User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=get_password_hash(payload.password or secrets.token_urlsafe(32)),
        role=payload.role,
        department=payload.department,
        college_id=college_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/find-portal", response_model=FindPortalResponse)
def find_portal(payload: FindPortalRequest, db: Session = Depends(get_db)):
    """Public 'find your college portal' lookup for the apex marketing page.

    Accepts a staff email (exact match) or a college name/code fragment and
    returns matching active colleges. Students have no real email on file
    (their backing accounts use synthetic addresses), so they search by
    college name instead.

    NOTE: the email path intentionally trades a little enumeration resistance
    for UX — it confirms that some account exists for that address by naming
    its college, but never reveals role or account type. SUPER_ADMIN accounts
    are excluded so the platform console is never surfaced.
    """
    q = payload.query.strip()
    if len(q) < 2:
        return FindPortalResponse(colleges=[])

    matches: list[College] = []
    if "@" in q:
        user = (
            db.query(User)
            .filter(User.email.ilike(q), User.is_active.is_(True))
            .filter(User.role != UserRole.SUPER_ADMIN, User.college_id.isnot(None))
            .first()
        )
        if user:
            college = (
                db.query(College)
                .filter(College.id == user.college_id, College.is_active.is_(True))
                .first()
            )
            if college:
                matches = [college]
    else:
        matches = (
            db.query(College)
            .filter(College.is_active.is_(True))
            .filter((College.name.ilike(f"%{q}%")) | (College.code.ilike(f"%{q}%")))
            .order_by(College.name)
            .limit(5)
            .all()
        )

    return FindPortalResponse(
        colleges=[PortalMatch(name=c.name, code=c.code, city=c.city) for c in matches]
    )


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/reset-password", response_model=UserOut)
def reset_password(
    payload: PasswordReset,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.hashed_password = get_password_hash(payload.new_password)
    current_user.must_reset_password = False
    db.commit()
    db.refresh(current_user)
    return current_user


# A link that is unknown, expired, already used or superseded gets one answer.
# Saying which would turn the endpoint into an oracle for guessing tokens.
_BAD_LINK = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="This link is no longer valid. Ask your administrator to send a new one.",
)


def _invite_for_request(
    token: str, request: Request, db: Session, college: College | None
) -> tuple[UserInvite, User, College | None]:
    """Resolve a live invite and check it is being redeemed on the host it was
    issued for - the same tenant boundary login enforces, so a link minted for
    one college can't be spent on another."""
    invite = resolve_invite(db, token)
    if not invite:
        raise _BAD_LINK
    if invite.college_id is not None:
        if college is None or college.id != invite.college_id:
            raise _BAD_LINK
    elif not is_admin_host(request):
        # College-less accounts are platform admins, who live on the console.
        raise _BAD_LINK

    user = db.query(User).filter(User.id == invite.user_id).first()
    # A disabled account must not be walked back in through an old link; an
    # admin re-enabling it sends a fresh one.
    if not user or not user.is_active:
        raise _BAD_LINK
    return invite, user, college


@router.get("/invite/{token}", response_model=InviteCheck)
def check_invite(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
    college: College | None = Depends(get_optional_college),
):
    """Public: confirm a setup link is live and say who it belongs to, so the
    page can greet them by name before any password is typed."""
    invite, user, college = _invite_for_request(token, request, db, college)
    return InviteCheck(
        full_name=user.full_name,
        college_name=college.name if college else None,
        is_reset=invite.purpose == InvitePurpose.RESET.value,
    )


@router.post("/invite/{token}/accept", response_model=Token)
def accept_invite(
    token: str,
    payload: InviteAccept,
    request: Request,
    db: Session = Depends(get_db),
    college: College | None = Depends(get_optional_college),
):
    """Public: set the password the link was issued for, spend the link, and
    return a session so the new password isn't typed twice."""
    invite, user, _ = _invite_for_request(token, request, db, college)

    user.hashed_password = get_password_hash(payload.new_password)
    user.must_reset_password = False
    invite.used_at = datetime.utcnow()
    db.commit()
    db.refresh(user)

    access = create_access_token(subject=user.id, college_id=user.college_id)
    return Token(access_token=access, user=UserOut.model_validate(user))
