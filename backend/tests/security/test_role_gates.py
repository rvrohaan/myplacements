"""Who may do what, within one college.

The tenant boundary decides *whose* data you reach; this decides what you may do
with your own college's. The shape throughout is: leadership sees the whole
college, filers see their own slice, students are not in the staff app at all.

Unlike the tenant boundary, the answer here is **403, not 404**. The resource is
not hidden - an officer knows the reports page exists, they simply may not open
it - so there is nothing to leak by saying so.

Every case is asserted from both sides: the role that must be refused, and a
role that must still get through. A gate that refuses everyone passes a
one-sided test while breaking the feature.
"""

import pytest

from app.core.roles import FILER_ROLES, LEADERSHIP_ROLES, STAFF_ROLES
from app.models.user import UserRole
from tests import factories


# Endpoints only the heads may reach. Each is a whole-college view: a report on
# every student, or one officer's performance measured against another's.
LEADERSHIP_ONLY = [
    ("GET", "/api/reports"),
    ("GET", "/api/analytics/officer-workload"),
    ("GET", "/api/analytics/officer-performance"),
    ("GET", "/api/analytics/companies"),
    ("GET", "/api/analytics/hr"),
    ("GET", "/api/analytics/drives"),
    ("GET", "/api/daily-updates/digest"),
    ("GET", "/api/daily-updates/settings"),
]


@pytest.mark.parametrize(("method", "path"), LEADERSHIP_ONLY, ids=[p for _, p in LEADERSHIP_ONLY])
def test_an_officer_is_refused_a_leadership_view(make_client, auth, rit, method, path):
    response = make_client("rit").request(method, path, headers=auth(rit.officer_user))
    assert response.status_code == 403


@pytest.mark.parametrize(("method", "path"), LEADERSHIP_ONLY, ids=[p for _, p in LEADERSHIP_ONLY])
def test_a_coordinator_is_refused_a_leadership_view(make_client, auth, rit, method, path):
    response = make_client("rit").request(method, path, headers=auth(rit.coordinator))
    assert response.status_code == 403


@pytest.mark.parametrize(("method", "path"), LEADERSHIP_ONLY, ids=[p for _, p in LEADERSHIP_ONLY])
def test_the_head_still_reaches_it(make_client, auth, rit, method, path):
    """The other half of the gate. A check that refuses everybody would pass
    the two tests above while the feature is simply broken."""
    response = make_client("rit").request(method, path, headers=auth(rit.head))
    assert response.status_code != 403


def test_the_refusal_is_a_403_not_a_404(make_client, auth, rit):
    """Nothing is hidden here - an officer knows the reports page exists - so
    saying "not allowed" leaks nothing and is far easier to act on."""
    response = make_client("rit").get("/api/reports", headers=auth(rit.officer_user))
    assert response.status_code == 403
    assert "permission" in response.json()["detail"].lower()


# --- managing officers ------------------------------------------------------


def test_an_officer_cannot_create_another_officer(make_client, auth, db, rit):
    victim = factories.make_user(db, college=rit.college, role=UserRole.PLACEMENT_OFFICER)
    response = make_client("rit").post(
        "/api/officers", headers=auth(rit.officer_user), json={"user_id": victim.id}
    )
    assert response.status_code == 403


def test_a_head_can_create_an_officer(make_client, auth, db, rit):
    fresh = factories.make_user(db, college=rit.college, role=UserRole.PLACEMENT_OFFICER)
    response = make_client("rit").post(
        "/api/officers", headers=auth(rit.head), json={"user_id": fresh.id}
    )
    assert response.status_code in (200, 201)


# --- reviewing officer-sourced leads ----------------------------------------
# The workflow only means anything if the officer who raised a lead cannot also
# wave it through.


def test_an_officer_cannot_approve_their_own_lead(make_client, auth, db, rit):
    lead = factories.make_company(
        db, college=rit.college, source="officer_lead", review_status="pending"
    )
    factories.assign_company(db, company=lead, officer=rit.officer)
    response = make_client("rit").post(
        f"/api/companies/{lead.id}/approve", headers=auth(rit.officer_user)
    )
    assert response.status_code == 403


def test_an_officer_cannot_decline_a_lead(make_client, auth, db, rit):
    lead = factories.make_company(
        db, college=rit.college, source="officer_lead", review_status="pending"
    )
    response = make_client("rit").post(
        f"/api/companies/{lead.id}/decline", headers=auth(rit.officer_user)
    )
    assert response.status_code == 403


def test_the_head_can_approve_a_lead(make_client, auth, db, rit):
    lead = factories.make_company(
        db, college=rit.college, source="officer_lead", review_status="pending"
    )
    response = make_client("rit").post(f"/api/companies/{lead.id}/approve", headers=auth(rit.head))
    assert response.status_code == 200
    assert response.json()["review_status"] == "approved"


def test_an_officer_cannot_bulk_import_companies(make_client, auth, rit):
    """Import writes straight into the college's records in bulk, which is why
    it is gated more tightly than adding one company by hand."""
    response = make_client("rit").post(
        "/api/companies/import",
        headers=auth(rit.officer_user),
        files={"file": ("x.xlsx", b"not a real workbook", "application/vnd.ms-excel")},
    )
    assert response.status_code == 403


# --- the platform console ---------------------------------------------------


def test_a_college_head_cannot_list_every_college(make_client, auth, rit, bmsce):
    """The console is the platform owner's. A college head reaching this would
    see every other customer on the platform."""
    response = make_client("rit").get("/api/colleges", headers=auth(rit.head))
    assert response.status_code == 403


def test_a_college_head_cannot_onboard_a_college(make_client, auth, rit):
    response = make_client("rit").post(
        "/api/colleges",
        headers=auth(rit.head),
        json={"name": "Sneaky College", "code": "sneaky"},
    )
    assert response.status_code == 403


def test_the_platform_admin_can_list_colleges(make_client, auth, platform_admin, rit):
    response = make_client("admin").get("/api/colleges", headers=auth(platform_admin))
    assert response.status_code == 200


def test_only_the_platform_owner_controls_the_shared_scan(make_client, auth, rit):
    """One national scan a day is shared by every tenant and bills the platform,
    so starting or stopping it is not a college's decision to make."""
    for path in ("/api/job-leads/schedule/start", "/api/job-leads/schedule/stop"):
        response = make_client("rit").post(path, headers=auth(rit.head))
        assert response.status_code in (403, 404, 405), f"{path} -> {response.status_code}"


# --- students are not staff -------------------------------------------------


@pytest.mark.parametrize(
    "path",
    ["/api/companies", "/api/students", "/api/officers", "/api/reports", "/api/drives"],
)
def test_a_student_cannot_reach_the_staff_app(make_client, auth, db, rit, path):
    """Students live in /portal. A student account reaching the staff API would
    see every classmate's marks, risk band and placement status."""
    student_user = rit.student.user
    response = make_client("rit").get(path, headers=auth(student_user))
    assert response.status_code in (403, 404), f"{path} -> {response.status_code}"


def test_a_student_cannot_edit_their_own_record(make_client, auth, rit):
    """Their CGPA and backlogs are the college's record of them, not a profile
    field - being able to edit it would make every shortlist meaningless."""
    response = make_client("rit").put(
        f"/api/students/{rit.student.id}",
        headers=auth(rit.student.user),
        json={"cgpa": 10.0},
    )
    assert response.status_code in (403, 404)


# --- the role tuples themselves ---------------------------------------------
# roles.py says several routers keep their own copies, deliberately left alone
# so consolidating them is its own change. Left alone is fine; drifting apart
# is not, and only a test can tell the two cases apart.


def test_the_analytics_copy_of_leadership_matches_the_shared_one():
    from app.routers.analytics import LEADERSHIP_ROLES as local

    assert set(local) == set(LEADERSHIP_ROLES)


def test_the_daily_updates_copies_match_the_shared_ones():
    from app.routers.daily_updates import FILER_ROLES as local_filers
    from app.routers.daily_updates import LEADERSHIP_ROLES as local_leadership

    assert set(local_leadership) == set(LEADERSHIP_ROLES)
    assert set(local_filers) == set(FILER_ROLES)


def test_the_manage_role_copies_agree_with_each_other():
    from app.routers.companies import MANAGE_ROLES as companies_manage
    from app.routers.officers import MANAGE_ROLES as officers_manage

    assert set(companies_manage) == set(officers_manage) == set(LEADERSHIP_ROLES)


def test_no_filer_role_has_crept_into_leadership():
    """The single most damaging drift: it would hand every officer the whole
    college's analytics and reports."""
    assert not set(LEADERSHIP_ROLES) & set(FILER_ROLES)


def test_students_are_in_no_staff_role_grouping():
    assert UserRole.STUDENT not in STAFF_ROLES
    assert UserRole.STUDENT not in LEADERSHIP_ROLES
    assert UserRole.STUDENT not in FILER_ROLES


def test_the_student_router_role_list_is_narrower_than_the_shared_one():
    """students.py keeps its own STAFF_ROLES that leaves out super_admin and
    department_coordinator. Recorded rather than corrected: it is a product
    decision about who may switch a student's login on, and the point of the
    test is that changing it should be deliberate."""
    from app.routers.students import STAFF_ROLES as student_staff

    assert set(student_staff) < set(STAFF_ROLES)
    assert UserRole.SUPER_ADMIN not in student_staff
    assert UserRole.DEPARTMENT_COORDINATOR not in student_staff
