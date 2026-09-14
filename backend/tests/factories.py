"""Object builders for tests.

Plain functions, not a factory library: each one takes the session, fills in
the columns the database insists on, and lets the test override anything it
actually cares about. A test should only mention the fields under test.

Every builder flushes rather than commits, so ids are available immediately
while the surrounding transaction still rolls back.
"""

from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.college import College
from app.models.company import Company, CompanyStatus, HRContact
from app.models.drive import Drive
from app.models.training import StudentTraining, TrainingModule
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.student import Student
from app.models.user import User, UserRole

# The password every factory-made account has, unless told otherwise.
DEFAULT_PASSWORD = "test-password-1234"

# Domain for generated addresses. Not ".test": pydantic's EmailStr rejects the
# IANA special-use TLDs (test, invalid, local, localhost, example), so an
# address there fails request validation before a handler ever runs.
EMAIL_DOMAIN = "example.com"

# bcrypt is deliberately slow - around a quarter of a second per call. Hashing
# the shared password once and reusing the digest keeps a suite that creates
# hundreds of users from spending minutes in the KDF. A test that needs a
# *different* password pays the cost for that one account only.
_DEFAULT_HASH: str | None = None

_seq = 0


def reset_sequence() -> None:
    """Called per-test so ids and emails are stable within a test."""
    global _seq
    _seq = 0


def _next() -> int:
    global _seq
    _seq += 1
    return _seq


def _hash(password: str | None) -> str:
    global _DEFAULT_HASH
    if password is not None and password != DEFAULT_PASSWORD:
        return get_password_hash(password)
    if _DEFAULT_HASH is None:
        _DEFAULT_HASH = get_password_hash(DEFAULT_PASSWORD)
    return _DEFAULT_HASH


def make_college(db: Session, *, code: str = "rit", name: str | None = None, **kw) -> College:
    college = College(
        name=name or code.upper(),
        code=code,
        city=kw.pop("city", "Bengaluru"),
        is_active=kw.pop("is_active", True),
        **kw,
    )
    db.add(college)
    db.flush()
    return college


def make_user(
    db: Session,
    *,
    college: College | None = None,
    role: UserRole = UserRole.PLACEMENT_OFFICER,
    email: str | None = None,
    password: str | None = None,
    **kw,
) -> User:
    """A staff or platform account.

    ``users.email`` is unique *globally*, not per college, so the default email
    carries a sequence number. Tests that assert on the address should pass one.
    """
    n = _next()
    user = User(
        email=email or f"user{n}@{college.code if college else 'platform'}.{EMAIL_DOMAIN}",
        full_name=kw.pop("full_name", f"Test User {n}"),
        hashed_password=_hash(password),
        role=role,
        college_id=college.id if college else None,
        is_active=kw.pop("is_active", True),
        must_reset_password=kw.pop("must_reset_password", False),
        **kw,
    )
    db.add(user)
    db.flush()
    return user


def make_officer(
    db: Session, *, college: College, user: User | None = None, **kw
) -> PlacementOfficer:
    """A placement officer: the ``PlacementOfficer`` card plus its backing user."""
    user = user or make_user(db, college=college, role=UserRole.PLACEMENT_OFFICER)
    officer = PlacementOfficer(
        user_id=user.id,
        college_id=college.id,
        region=kw.pop("region", "South"),
        sector_expertise=kw.pop("sector_expertise", "IT Services"),
        target_companies=kw.pop("target_companies", 10),
        target_offers=kw.pop("target_offers", 25),
        **kw,
    )
    db.add(officer)
    db.flush()
    return officer


def make_student(
    db: Session,
    *,
    college: College,
    roll_number: str | None = None,
    password: str | None = None,
    login_enabled: bool = True,
    **kw,
) -> Student:
    """A student and the user row behind them.

    ``login_enabled=False`` mirrors an account that exists for records only:
    it still needs a user row (the FK is NOT NULL) but is inactive, which is how
    the app distinguishes a student who cannot sign in.
    """
    n = _next()
    roll = roll_number or f"1RV{n:03d}"
    user = make_user(
        db,
        college=college,
        role=UserRole.STUDENT,
        email=f"{roll.lower()}@{college.code}.{EMAIL_DOMAIN}",
        password=password,
        full_name=kw.pop("full_name", f"Student {n}"),
        is_active=login_enabled,
    )
    student = Student(
        user_id=user.id,
        roll_number=roll,
        branch=kw.pop("branch", "CSE"),
        batch_year=kw.pop("batch_year", 2026),
        cgpa=kw.pop("cgpa", 8.0),
        backlogs=kw.pop("backlogs", 0),
        college_id=college.id,
        **kw,
    )
    db.add(student)
    db.flush()
    return student


def make_company(db: Session, *, college: College, name: str | None = None, **kw) -> Company:
    n = _next()
    company = Company(
        name=name or f"Acme {n}",
        sector=kw.pop("sector", "IT Services"),
        domain=kw.pop("domain", "Software"),
        location=kw.pop("location", "Bengaluru"),
        status=kw.pop("status", CompanyStatus.ACTIVE),
        college_id=college.id,
        **kw,
    )
    db.add(company)
    db.flush()
    return company


def assign_company(
    db: Session, *, company: Company, officer: PlacementOfficer, **kw
) -> CompanyAssignment:
    """Put a company in an officer's book - the thing officer scoping keys on."""
    assignment = CompanyAssignment(
        company_id=company.id,
        officer_id=officer.id,
        status=kw.pop("status", "active"),
        priority=kw.pop("priority", "normal"),
        **kw,
    )
    db.add(assignment)
    db.flush()
    return assignment


def make_hr_contact(db: Session, *, company: Company, name: str | None = None, **kw) -> HRContact:
    """A named contact at a company - the asset a placement cell guards most."""
    n = _next()
    contact = HRContact(
        company_id=company.id,
        name=name or f"Contact {n}",
        designation=kw.pop("designation", "Talent Acquisition"),
        email=kw.pop("email", f"hr{n}@{EMAIL_DOMAIN}"),
        relationship_strength=kw.pop("relationship_strength", 3),
        **kw,
    )
    db.add(contact)
    db.flush()
    return contact


def make_drive(db: Session, *, college: College, company: Company | None = None, **kw) -> Drive:
    company = company or make_company(db, college=college)
    drive = Drive(
        company_id=company.id,
        job_role=kw.pop("job_role", "Software Engineer"),
        college_id=college.id,
        **kw,
    )
    db.add(drive)
    db.flush()
    return drive


def make_module(db: Session, *, college: College, skills: str | None = None, **kw) -> TrainingModule:
    """A training module. `skills` is what completing it evidences - without it
    a completion says somebody attended something and nothing more."""
    n = _next()
    module = TrainingModule(
        college_id=college.id,
        name=kw.pop("name", f"Module {n}"),
        category=kw.pop("category", "Technical"),
        skills=skills,
        **kw,
    )
    db.add(module)
    db.flush()
    return module


def enrol(
    db: Session, *, student: Student, module: TrainingModule, status: str = "enrolled", **kw
) -> StudentTraining:
    """Put a student on a module. Only status="completed" counts as evidence."""
    from datetime import datetime

    record = StudentTraining(
        student_id=student.id,
        module_id=module.id,
        status=status,
        completed_at=kw.pop("completed_at", datetime.utcnow() if status == "completed" else None),
        **kw,
    )
    db.add(record)
    db.flush()
    return record
