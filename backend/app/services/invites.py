"""Issue and redeem the one-time links that let a user set their own password.

This replaces handing out temporary passwords: nothing the admin sees is a
credential that keeps working, the link expires, and a fresh link invalidates
the previous one. The raw token exists only in the URL we hand out - the
database stores its SHA-256.
"""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.college import College
from app.models.invite import InvitePurpose, UserInvite
from app.models.user import User, UserRole
from app.services import notifications

# 32 bytes of entropy, URL-safe. Guessing is not a threat model at this size,
# which is what lets the link stand in for a password.
_TOKEN_BYTES = 32


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def expiry_hours_for(user: User) -> int:
    """Students get the longer window - their logins are enabled in bulk, often
    well before anyone sits down to redeem the link."""
    if user.role == UserRole.STUDENT:
        return settings.STUDENT_INVITE_EXPIRY_HOURS
    return settings.INVITE_EXPIRY_HOURS


def issue_invite(
    db: Session,
    user: User,
    created_by: User | None = None,
    purpose: InvitePurpose = InvitePurpose.INVITE,
) -> tuple[UserInvite, str]:
    """Revoke any outstanding link for this user and mint a fresh one.

    Returns the row and the raw token - the only moment the token is in the
    clear. The caller commits.
    """
    now = datetime.utcnow()
    # Only ever one live link per user: a resend must not leave the older link
    # working, or revoking access means chasing every message ever sent.
    db.query(UserInvite).filter(
        UserInvite.user_id == user.id,
        UserInvite.used_at.is_(None),
        UserInvite.revoked_at.is_(None),
    ).update({UserInvite.revoked_at: now}, synchronize_session=False)

    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    invite = UserInvite(
        user_id=user.id,
        college_id=user.college_id,
        token_hash=hash_token(raw),
        purpose=purpose.value,
        expires_at=now + timedelta(hours=expiry_hours_for(user)),
        created_by_id=created_by.id if created_by else None,
    )
    db.add(invite)
    return invite, raw


def resolve_invite(db: Session, raw: str) -> UserInvite | None:
    """The live invite for this token, or None when it is unknown, already
    used, superseded or expired. Callers must not say which."""
    if not raw:
        return None
    invite = db.query(UserInvite).filter(UserInvite.token_hash == hash_token(raw)).first()
    if not invite:
        return None
    if invite.used_at or invite.revoked_at:
        return None
    if invite.expires_at <= datetime.utcnow():
        return None
    return invite


def invite_url(token: str, college: College | None) -> str:
    """The link to put in the message.

    It has to point at the tenant the account belongs to, because that is the
    only host where the account can sign in (see auth.login). Accounts with no
    college are platform admins, who live on the console subdomain.
    """
    host = (
        f"{college.code}.{settings.BASE_DOMAIN}"
        if college
        else f"{settings.ADMIN_SUBDOMAIN}.{settings.BASE_DOMAIN}"
    )
    return f"{settings.LINK_SCHEME}://{host}/accept-invite/{token}"


@dataclass
class IssuedInvite:
    """A minted link and what became of the one automated channel."""

    url: str
    expires_at: datetime
    email: str
    email_status: str


def issue_and_deliver(
    db: Session,
    user: User,
    actor: User | None = None,
    purpose: InvitePurpose = InvitePurpose.INVITE,
) -> IssuedInvite:
    """Mint a password-setup link for `user` and try to email it.

    Delivery is attempted inline rather than in the background because whoever
    provisioned the account needs an honest answer in the same breath: when the
    email doesn't go out - no provider configured, a student with no real
    address, a vendor outage - the UI shows the link so they can send it
    themselves. The caller commits.
    """
    invite, raw = issue_invite(db, user, created_by=actor, purpose=purpose)
    college = (
        db.query(College).filter(College.id == user.college_id).first()
        if user.college_id
        else None
    )
    url = invite_url(raw, college)
    invite.email_status = notifications.send_invite_email(
        to=user.email,
        name=user.full_name,
        college_name=college.name if college else None,
        url=url,
        expires_hours=expiry_hours_for(user),
        is_reset=purpose == InvitePurpose.RESET,
    )
    return IssuedInvite(
        url=url,
        expires_at=invite.expires_at,
        email=user.email,
        email_status=invite.email_status,
    )
