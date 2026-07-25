"""Provision (or reset) a platform super_admin — the account that signs in at
admin.myplacements.in.

A super_admin has no college (``college_id`` is NULL) and can sign in only on
the admin host. This script is idempotent: run it again to reset the password or
re-activate the account.

Credentials come from environment variables so no plaintext password is stored
in the file or your shell history:

    SUPERADMIN_EMAIL     (required)  e.g. owner@myplacements.in
    SUPERADMIN_PASSWORD  (required)  the login password
    SUPERADMIN_NAME      (optional)  display name, defaults to "Platform Owner"

Run it against the target database by pointing DATABASE_URL at it. On Railway:

    railway run python create_super_admin.py     # uses the service's DATABASE_URL

Locally against production (use the Neon *direct* endpoint, not -pooler):

    DATABASE_URL="postgresql://...neon.tech/db" \
    SUPERADMIN_EMAIL=you@example.com \
    SUPERADMIN_PASSWORD='choose-a-strong-one' \
    python create_super_admin.py
"""

import os
import sys

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.user import User, UserRole


def main() -> int:
    email = os.environ.get("SUPERADMIN_EMAIL", "").strip().lower()
    password = os.environ.get("SUPERADMIN_PASSWORD", "")
    full_name = os.environ.get("SUPERADMIN_NAME", "Platform Owner").strip()

    if not email or not password:
        print("ERROR: SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be set.", file=sys.stderr)
        return 1
    if len(password) < 8:
        print("ERROR: choose a password of at least 8 characters.", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            user = User(
                email=email,
                full_name=full_name,
                hashed_password=get_password_hash(password),
                role=UserRole.SUPER_ADMIN,
                college_id=None,
                is_active=True,
                must_reset_password=False,
            )
            db.add(user)
            action = "created"
        else:
            # Reset an existing account back to a known-good super_admin state.
            user.full_name = full_name or user.full_name
            user.hashed_password = get_password_hash(password)
            user.role = UserRole.SUPER_ADMIN
            user.college_id = None
            user.is_active = True
            user.must_reset_password = False
            action = "updated"
        db.commit()
        db.refresh(user)
        print(f"super_admin {action}: id={user.id} email={user.email}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
