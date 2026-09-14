"""Reset the end-to-end database to a known state.

Run by Playwright's global setup, never by hand against anything that matters.
It **drops every table** and rebuilds, because an E2E suite that inherits the
last run's rows is one that passes until it doesn't.

The guard below is the important part: the dev database usually lives on the
same Postgres container as this one, so a mistyped URL would wipe real work.
The database name must end in `_e2e` or nothing happens.

Everything seeded here is deterministic and named for what it is for, so a
failing spec can be read without cross-referencing ids.
"""

import os
import sys
from datetime import datetime, timedelta

# Pinned before app imports: settings and the engine are both built at import.
DB_URL = os.environ.get(
    "E2E_DATABASE_URL", "postgresql://postgres:password@127.0.0.1:5432/myplacements_e2e"
)
os.environ["DATABASE_URL"] = DB_URL
os.environ.setdefault("SECRET_KEY", "e2e-secret-not-used-anywhere-real")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("ANTHROPIC_API_KEY", "")
os.environ.setdefault("RESEND_API_KEY", "")

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.migrations import run_migrations  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.models.college import College  # noqa: E402
from app.models.company import Company, CompanyStatus, HRContact  # noqa: E402
from app.models.drive import Drive, DriveMode, DriveStatus  # noqa: E402
from app.models.officer import CompanyAssignment, PlacementOfficer  # noqa: E402
from app.models.student import PlacementStatus, Student  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402

import app.models  # noqa: E402,F401  (register every model before create_all)

# One password for every seeded account: these are fixtures, not secrets, and a
# spec that has to look up which account uses which password is a worse spec.
PASSWORD = "e2e-password-123"

COLLEGE_CODE = "e2e"
OTHER_COLLEGE_CODE = "rival"

OWNER_EMAIL = "owner@myplacements.in"
HEAD_EMAIL = "head@e2e.example.com"
OFFICER_EMAIL = "officer@e2e.example.com"
RIVAL_HEAD_EMAIL = "head@rival.example.com"
STUDENT_ROLL = "E2E001"


def _guard() -> None:
    database = DB_URL.rsplit("/", 1)[-1].split("?", 1)[0]
    if not database.endswith("_e2e"):
        sys.exit(
            f"Refusing to run: {database!r} is not an end-to-end database. "
            "This script drops every table, and the dev database usually lives "
            "on the same Postgres. Name it with an '_e2e' suffix."
        )


def _user(db, *, email, name, role, college, password=PASSWORD) -> User:
    user = User(
        email=email,
        full_name=name,
        hashed_password=get_password_hash(password),
        role=role,
        college_id=college.id if college else None,
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def seed() -> None:
    _guard()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    run_migrations(engine)

    db = SessionLocal()
    try:
        college = College(
            name="E2E Institute of Technology",
            code=COLLEGE_CODE,
            city="Bengaluru",
            is_active=True,
        )
        # A second tenant, so the boundary can be walked into rather than
        # asserted about an empty database.
        rival = College(name="Rival College", code=OTHER_COLLEGE_CODE, city="Chennai", is_active=True)
        db.add_all([college, rival])
        db.flush()

        _user(db, email=OWNER_EMAIL, name="Platform Owner", role=UserRole.SUPER_ADMIN, college=None)
        _user(db, email=HEAD_EMAIL, name="Priya Head", role=UserRole.PRO_CHANCELLOR, college=college)
        _user(db, email=RIVAL_HEAD_EMAIL, name="Rival Head", role=UserRole.PRO_CHANCELLOR, college=rival)

        officer_user = _user(
            db, email=OFFICER_EMAIL, name="Meera Officer",
            role=UserRole.PLACEMENT_OFFICER, college=college,
        )
        officer = PlacementOfficer(
            user_id=officer_user.id, college_id=college.id,
            region="South", sector_expertise="IT",
            target_companies=10, target_offers=25,
        )
        db.add(officer)
        db.flush()

        # Two companies: one the officer owns, one they do not. The pair is what
        # makes officer scoping visible in a browser.
        allocated = Company(
            name="Allocated Corp", sector="IT Services", domain="Software",
            location="Bengaluru", status=CompanyStatus.ACTIVE, college_id=college.id,
        )
        unallocated = Company(
            name="Unallocated Corp", sector="Manufacturing", domain="Core",
            location="Pune", status=CompanyStatus.ACTIVE, college_id=college.id,
        )
        # And one belonging to the other tenant, which must never be visible.
        rival_company = Company(
            name="Rival Secret Corp", sector="IT Services",
            location="Chennai", status=CompanyStatus.ACTIVE, college_id=rival.id,
        )
        db.add_all([allocated, unallocated, rival_company])
        db.flush()

        db.add(CompanyAssignment(company_id=allocated.id, officer_id=officer.id, status="active"))
        db.add(
            HRContact(
                company_id=allocated.id, name="Ravi Kumar", designation="Talent Acquisition",
                email="ravi@allocated.example", relationship_strength=4,
            )
        )
        db.add(
            HRContact(
                company_id=rival_company.id, name="Rival Champion",
                designation="HR", relationship_strength=5,
            )
        )

        # A student who can sign in, and classmates who cannot - most student
        # rows exist for records only.
        student_user = _user(
            db, email=f"{STUDENT_ROLL.lower()}@{COLLEGE_CODE}.example.com",
            name="Asha Rao", role=UserRole.STUDENT, college=college,
        )
        db.add(
            Student(
                user_id=student_user.id, roll_number=STUDENT_ROLL, branch="CSE",
                batch_year=2026, cgpa=8.6, backlogs=0, skills="Python, SQL",
                placement_status=PlacementStatus.UNPLACED, college_id=college.id,
            )
        )
        for n in range(2, 6):
            classmate = _user(
                db, email=f"e2e{n:03d}@{COLLEGE_CODE}.example.com",
                name=f"Classmate {n}", role=UserRole.STUDENT, college=college,
            )
            classmate.is_active = False  # records only, no login
            db.add(
                Student(
                    user_id=classmate.id, roll_number=f"E2E{n:03d}", branch="ECE",
                    batch_year=2026, cgpa=7.0 + n / 10, backlogs=0,
                    placement_status=PlacementStatus.UNPLACED, college_id=college.id,
                )
            )

        db.add(
            Drive(
                company_id=allocated.id, job_role="Software Engineer",
                drive_date=datetime.utcnow() + timedelta(days=14),
                mode=DriveMode.OFFLINE, status=DriveStatus.UPCOMING,
                min_cgpa=7.0, eligible_branches="CSE,ECE", max_backlogs=0,
                ctc_offered=12.0, location="Bengaluru", total_rounds=3,
                college_id=college.id,
            )
        )

        db.commit()
    finally:
        db.close()

    print(f"Seeded {DB_URL.rsplit('/', 1)[-1]}: {COLLEGE_CODE}.localhost + {OTHER_COLLEGE_CODE}.localhost")


if __name__ == "__main__":
    seed()
