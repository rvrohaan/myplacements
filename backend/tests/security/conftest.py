"""Two fully-populated colleges, for asking whether either can see the other.

Every test in this directory is a variation on one question, so the setup is
shared: build RIT and BMSCE with the same shapes in each, then check that a
token minted for one is useless against the other.

The tenant is carried by the Host header, exactly as in production - these
tests drive `make_client("rit")` rather than stubbing the college dependency,
so the resolution logic is under test alongside the handlers.
"""

import pytest

from app.models.user import UserRole
from tests import factories


class Tenant:
    """One college and the cast of characters inside it."""

    def __init__(self, db, code: str):
        self.code = code
        self.college = factories.make_college(db, code=code, name=code.upper())
        self.head = factories.make_user(db, college=self.college, role=UserRole.PRO_CHANCELLOR)
        self.principal = factories.make_user(db, college=self.college, role=UserRole.PRINCIPAL)
        self.coordinator = factories.make_user(
            db, college=self.college, role=UserRole.DEPARTMENT_COORDINATOR
        )
        self.officer = factories.make_officer(db, college=self.college)
        self.officer_user = self.officer.user

        self.company = factories.make_company(db, college=self.college, name=f"{code.upper()} Corp")
        # A second company, assigned to the officer, so officer scoping has both
        # a company it should reach and one it should not.
        self.assigned_company = factories.make_company(
            db, college=self.college, name=f"{code.upper()} Assigned"
        )
        factories.assign_company(db, company=self.assigned_company, officer=self.officer)

        self.contact = factories.make_hr_contact(
            db, company=self.company, name=f"{code.upper()} Champion"
        )
        self.student = factories.make_student(db, college=self.college, roll_number=f"{code}-001")
        self.drive = factories.make_drive(db, college=self.college, company=self.company)


@pytest.fixture
def rit(db) -> Tenant:
    return Tenant(db, "rit")


@pytest.fixture
def bmsce(db) -> Tenant:
    return Tenant(db, "bmsce")


@pytest.fixture
def platform_admin(db):
    """The one account that crosses tenants by design."""
    return factories.make_user(db, college=None, role=UserRole.SUPER_ADMIN)
