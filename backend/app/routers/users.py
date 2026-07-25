from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_roles
from app.core.security import get_password_hash
from app.models.user import User, UserRole
from app.schemas.user import UserCreate, UserOut, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])

# Roles allowed to manage user accounts
ADMIN_ROLES = (UserRole.SUPER_ADMIN, UserRole.PRINCIPAL, UserRole.PRO_CHANCELLOR, UserRole.DEPUTY_PRO_CHANCELLOR)


@router.get("", response_model=list[UserOut])
def list_users(
    response: Response,
    role: Optional[UserRole] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    q = db.query(User)
    if current_user.college_id:
        q = q.filter(User.college_id == current_user.college_id)
    if role:
        q = q.filter(User.role == role)
    else:
        # The People tab manages staff; student profiles live on the Students tab.
        q = q.filter(User.role != UserRole.STUDENT)
    if search:
        like = f"%{search}%"
        q = q.filter((User.full_name.ilike(like)) | (User.email.ilike(like)))
    response.headers["X-Total-Count"] = str(q.count())
    return q.order_by(User.created_at.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    # Only the platform owner may target an arbitrary college; college admins are
    # pinned to their own college so they can't create users elsewhere.
    if current_user.role == UserRole.SUPER_ADMIN:
        college_id = payload.college_id
    else:
        college_id = current_user.college_id
    if college_id is None:
        raise HTTPException(status_code=400, detail="college_id is required")
    if db.query(User).filter(User.email == payload.email, User.college_id == college_id).first():
        raise HTTPException(status_code=400, detail="Email already registered for this college")
    user = User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=get_password_hash(payload.password),
        role=payload.role,
        department=payload.department,
        college_id=college_id,
        must_reset_password=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*ADMIN_ROLES)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if current_user.college_id and user.college_id != current_user.college_id:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id and payload.is_active is False:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user
