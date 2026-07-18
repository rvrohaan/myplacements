from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token
from app.core.tenant import get_optional_college
from app.models.college import College
from app.models.user import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    college: College | None = Depends(get_optional_college),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None or not user.is_active:
        raise credentials_exception

    # Enforce the tenant boundary: a token is only valid on its own college's
    # subdomain. SUPER_ADMIN is the platform owner and crosses tenants freely.
    if user.role != UserRole.SUPER_ADMIN and college is not None and user.college_id != college.id:
        raise credentials_exception
    return user


def require_roles(*roles: UserRole):
    def checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return checker


def get_current_student(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolve the Student profile for the signed-in user. Used by the student
    portal; 403 for non-students, 404 if no profile is linked."""
    from app.models.student import Student

    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=403, detail="Student account required")
    student = db.query(Student).filter(Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")
    return student
