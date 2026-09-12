import enum
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.core.database import Base


class InvitePurpose(str, enum.Enum):
    # A brand-new account that has never had a password.
    INVITE = "invite"
    # An existing account whose password is being re-issued (lockout, rotation).
    RESET = "reset"


class UserInvite(Base):
    """A single-use, expiring link that lets someone set their own password.

    Only the SHA-256 of the token is stored, so a leaked database can't be
    replayed as a working link. The raw token exists in exactly one place: the
    URL handed to the invitee.
    """

    __tablename__ = "user_invites"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Copied from the user at issue time so the link's tenant is fixed even if
    # the account is later moved.
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    purpose = Column(String, nullable=False, default=InvitePurpose.INVITE.value)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    # Set when a newer link supersedes this one, so only the latest ever works.
    revoked_at = Column(DateTime, nullable=True)
    # Outcome of the one automated channel: sent | failed | skipped. SMS and
    # WhatsApp are shared by hand from the UI until the provider work lands.
    email_status = Column(String, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
