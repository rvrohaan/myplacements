"""Can one college reach another college's data?

This is the highest-consequence question in a multi-tenant product, and it has
already been answered wrongly once here - the HR-contact directory leaked across
tenants before it was fixed. An HR contact list is the asset a placement cell
guards most, so a leak is not an embarrassment, it is the product's core value
handed to a competitor.

Two rules the suite assumes throughout:

* The answer to "may I see this?" is **404, not 403**. A 403 confirms the row
  exists, which is itself a leak - a rival college learning that RIT has a
  record with id 41 has learned something.
* Reads are checked by *count*, not by status code. An endpoint that returns 200
  with the other college's rows in the body has leaked just as completely as one
  that returns them under a 403.
"""

import pytest

from tests import factories


def names(response) -> list[str]:
    return [row.get("name") for row in response.json()]


# --- list endpoints: the other college's rows must simply not be there -------


def test_the_company_list_stops_at_the_tenant_boundary(make_client, auth, rit, bmsce):
    response = make_client("rit").get("/api/companies", headers=auth(rit.head))
    assert response.status_code == 200
    listed = names(response)
    assert "RIT Corp" in listed
    assert "BMSCE Corp" not in listed


def test_the_company_total_count_does_not_count_the_other_college(make_client, auth, rit, bmsce):
    """X-Total-Count drives pagination and is computed by a separate query, so
    it can leak the size of another college's database on its own."""
    response = make_client("rit").get("/api/companies", headers=auth(rit.head))
    assert int(response.headers["X-Total-Count"]) == len(response.json())


def test_the_student_list_stops_at_the_tenant_boundary(make_client, auth, rit, bmsce):
    response = make_client("rit").get("/api/students", headers=auth(rit.head))
    assert response.status_code == 200
    rolls = [row["roll_number"] for row in response.json()]
    assert "rit-001" in rolls
    assert "bmsce-001" not in rolls


def test_the_hr_directory_stops_at_the_tenant_boundary(make_client, auth, rit, bmsce):
    """The regression that has already happened once."""
    response = make_client("rit").get("/api/hr-contacts", headers=auth(rit.head))
    assert response.status_code == 200
    listed = [row["name"] for row in response.json()]
    assert "RIT Champion" in listed
    assert "BMSCE Champion" not in listed


def test_the_officer_list_stops_at_the_tenant_boundary(make_client, auth, rit, bmsce):
    response = make_client("rit").get("/api/officers", headers=auth(rit.head))
    assert response.status_code == 200
    ids = [row["id"] for row in response.json()]
    assert rit.officer.id in ids
    assert bmsce.officer.id not in ids


def test_the_drive_list_stops_at_the_tenant_boundary(make_client, auth, rit, bmsce):
    response = make_client("rit").get("/api/drives", headers=auth(rit.head))
    assert response.status_code == 200
    ids = [row["id"] for row in response.json()]
    assert rit.drive.id in ids
    assert bmsce.drive.id not in ids


# --- single-row reads -------------------------------------------------------


def test_another_colleges_company_is_not_found(make_client, auth, rit, bmsce):
    response = make_client("rit").get(f"/api/companies/{bmsce.company.id}", headers=auth(rit.head))
    assert response.status_code == 404


def test_another_colleges_drive_is_not_found(make_client, auth, rit, bmsce):
    response = make_client("rit").get(f"/api/drives/{bmsce.drive.id}", headers=auth(rit.head))
    assert response.status_code == 404


def test_another_colleges_student_is_not_found(make_client, auth, rit, bmsce):
    response = make_client("rit").get(f"/api/students/{bmsce.student.id}", headers=auth(rit.head))
    assert response.status_code == 404


def test_another_colleges_officer_is_not_found(make_client, auth, rit, bmsce):
    response = make_client("rit").get(f"/api/officers/{bmsce.officer.id}", headers=auth(rit.head))
    assert response.status_code == 404


def test_the_refusal_is_a_404_and_not_a_403(make_client, auth, rit, bmsce):
    """A 403 would confirm the row exists. Compared against a genuinely absent
    id so the two are indistinguishable from outside."""
    client, headers = make_client("rit"), auth(rit.head)
    real_elsewhere = client.get(f"/api/companies/{bmsce.company.id}", headers=headers)
    never_existed = client.get("/api/companies/98765", headers=headers)
    assert real_elsewhere.status_code == never_existed.status_code == 404
    assert real_elsewhere.json() == never_existed.json()


# --- writes -----------------------------------------------------------------


def test_another_colleges_company_cannot_be_edited(make_client, auth, rit, bmsce):
    response = make_client("rit").put(
        f"/api/companies/{bmsce.company.id}",
        headers=auth(rit.head),
        json={"name": "Renamed by RIT"},
    )
    assert response.status_code == 404


def test_another_colleges_company_cannot_be_deleted(make_client, auth, db, rit, bmsce):
    """Destructive and irreversible, so this is the worst case of the family.

    Deliberately a company with nothing referencing it. A company that happens
    to have a drive is protected by the foreign key rather than by any check,
    which would make this test pass for the wrong reason and hide the hole.
    """
    from app.models.company import Company

    orphan = factories.make_company(db, college=bmsce.college, name="BMSCE Unreferenced")

    response = make_client("rit").delete(f"/api/companies/{orphan.id}", headers=auth(rit.head))

    assert response.status_code == 404
    assert db.query(Company).filter(Company.id == orphan.id).first() is not None


def test_another_colleges_drive_cannot_be_edited(make_client, auth, rit, bmsce):
    response = make_client("rit").put(
        f"/api/drives/{bmsce.drive.id}", headers=auth(rit.head), json={"job_role": "Renamed"}
    )
    assert response.status_code == 404


def test_another_colleges_student_cannot_be_edited(make_client, auth, rit, bmsce):
    response = make_client("rit").put(
        f"/api/students/{bmsce.student.id}", headers=auth(rit.head), json={"branch": "MECH"}
    )
    assert response.status_code == 404


# --- the AI endpoints -------------------------------------------------------
# These take a company id and spend real credit. Cross-tenant access here is
# both a read of another college's data and a bill sent to the platform.


def test_a_profile_cannot_be_generated_for_another_colleges_company(make_client, auth, rit, bmsce):
    response = make_client("rit").post(
        f"/api/companies/{bmsce.company.id}/generate-profile", headers=auth(rit.head)
    )
    assert response.status_code == 404


def test_interview_questions_cannot_be_asked_about_another_colleges_company(
    make_client, auth, rit, bmsce
):
    response = make_client("rit").post(
        f"/api/companies/{bmsce.company.id}/interview-questions",
        headers=auth(rit.head),
        json={"job_role": "SDE"},
    )
    assert response.status_code == 404


def test_exam_questions_cannot_be_asked_about_another_colleges_company(make_client, auth, rit, bmsce):
    response = make_client("rit").post(
        f"/api/companies/{bmsce.company.id}/exam-questions",
        headers=auth(rit.head),
        json={"job_role": "SDE"},
    )
    assert response.status_code == 404


def test_an_email_cannot_be_drafted_to_another_colleges_hr_contact(make_client, auth, rit, bmsce):
    """The most pointed of these: a successful call would put another college's
    company name and their named HR contact into the response body."""
    response = make_client("rit").post(
        f"/api/companies/{bmsce.company.id}/hr-contacts/{bmsce.contact.id}/draft-email",
        headers=auth(rit.head),
        json={"purpose": "invite to campus"},
    )
    assert response.status_code == 404


def test_another_colleges_hr_contacts_are_not_listed(make_client, auth, rit, bmsce):
    response = make_client("rit").get(
        f"/api/companies/{bmsce.company.id}/hr-contacts", headers=auth(rit.head)
    )
    assert response.status_code == 404


def test_an_hr_contact_cannot_be_added_to_another_colleges_company(make_client, auth, rit, bmsce):
    response = make_client("rit").post(
        f"/api/companies/{bmsce.company.id}/hr-contacts",
        headers=auth(rit.head),
        json={"name": "Planted", "designation": "HR"},
    )
    assert response.status_code == 404


# --- the token itself -------------------------------------------------------


def test_a_token_is_refused_on_another_colleges_host(make_client, auth, rit, bmsce):
    """The outer boundary, before any handler runs: the subdomain decides whose
    token is acceptable, so a stolen token is useless off its own tenant."""
    assert make_client("rit").get("/api/companies", headers=auth(rit.head)).status_code == 200
    assert make_client("bmsce").get("/api/companies", headers=auth(rit.head)).status_code == 401


def test_the_apex_host_accepts_no_college_token(make_client, auth, rit):
    """There is no tenant there, so there is nothing a college token addresses.
    get_optional_college returns None, which the handler then scopes by the
    user's own college - this pins that it does not become a free-for-all."""
    response = make_client().get("/api/companies", headers=auth(rit.head))
    assert response.status_code in (200, 401)
    if response.status_code == 200:
        assert "BMSCE Corp" not in names(response)


def test_an_unknown_subdomain_does_not_grant_access(make_client, auth, rit):
    response = make_client("nosuchcollege").get("/api/companies", headers=auth(rit.head))
    assert response.status_code == 200
    assert "BMSCE Corp" not in names(response)


# --- the account that is meant to cross --------------------------------------


def test_a_platform_admin_reaches_a_college_on_its_own_host(
    make_client, auth, rit, bmsce, platform_admin
):
    """super_admin is the deliberate exception. Stated explicitly so that if the
    boundary above is ever tightened, the one account that must cross it is not
    broken silently."""
    response = make_client("rit").get("/api/companies", headers=auth(platform_admin))
    assert response.status_code == 200


@pytest.mark.parametrize("code", ["rit", "bmsce"])
def test_a_platform_admin_is_not_blocked_by_the_subdomain(
    make_client, auth, rit, bmsce, platform_admin, code
):
    assert make_client(code).get("/api/companies", headers=auth(platform_admin)).status_code == 200
