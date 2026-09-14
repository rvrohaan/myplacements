"""An officer sees their own book, and nothing else.

Inside one college there is a second boundary: a placement officer works the
companies allocated to them. It exists so a cell can divide the work without
every officer seeing every relationship - and because an officer moving to a
rival college should not have walked out with the whole database.

Like the tenant boundary, the refusal is a **404**: a company an officer may not
see should not confirm its own existence to them.
"""

from tests import factories


def names(response) -> list[str]:
    return [row["name"] for row in response.json()]


# --- the company list -------------------------------------------------------


def test_an_officer_sees_only_companies_allocated_to_them(make_client, auth, rit):
    response = make_client("rit").get("/api/companies", headers=auth(rit.officer_user))
    assert response.status_code == 200
    assert names(response) == ["RIT Assigned"]


def test_the_head_sees_the_whole_college(make_client, auth, rit):
    """The other side of the same rule - scoping must not leak upwards."""
    listed = names(make_client("rit").get("/api/companies", headers=auth(rit.head)))
    assert {"RIT Corp", "RIT Assigned"} <= set(listed)


def test_an_officer_with_no_allocations_sees_an_empty_list(make_client, auth, db, rit):
    """Not the whole college. An empty allocation set is the easiest thing for a
    filter to treat as "no filter"."""
    fresh = factories.make_officer(db, college=rit.college)
    response = make_client("rit").get("/api/companies", headers=auth(fresh.user))
    assert response.status_code == 200
    assert response.json() == []


def test_the_total_count_matches_what_an_officer_may_see(make_client, auth, db, rit):
    """X-Total-Count is a separate query, so it can disclose the size of the
    college's database even when the rows themselves are filtered."""
    fresh = factories.make_officer(db, college=rit.college)
    response = make_client("rit").get("/api/companies", headers=auth(fresh.user))
    assert response.headers["X-Total-Count"] == "0"


def test_a_coordinator_is_not_narrowed_to_allocations(make_client, auth, rit):
    """The narrowing is specific to placement_officer. Stated so that widening
    it to another role has to be deliberate."""
    listed = names(make_client("rit").get("/api/companies", headers=auth(rit.coordinator)))
    assert "RIT Corp" in listed


# --- single companies -------------------------------------------------------


def test_an_officer_reaches_an_allocated_company(make_client, auth, rit):
    response = make_client("rit").get(
        f"/api/companies/{rit.assigned_company.id}", headers=auth(rit.officer_user)
    )
    assert response.status_code == 200


def test_an_unallocated_company_is_not_found_for_an_officer(make_client, auth, rit):
    response = make_client("rit").get(
        f"/api/companies/{rit.company.id}", headers=auth(rit.officer_user)
    )
    assert response.status_code == 404


def test_an_officer_may_edit_an_allocated_company(make_client, auth, rit):
    """Officers move their companies through the relationship, so this is not
    an accident of the gate - it is the feature."""
    response = make_client("rit").put(
        f"/api/companies/{rit.assigned_company.id}",
        headers=auth(rit.officer_user),
        json={"notes": "Called, meeting booked"},
    )
    assert response.status_code == 200


def test_an_officer_may_not_edit_an_unallocated_company(make_client, auth, rit):
    response = make_client("rit").put(
        f"/api/companies/{rit.company.id}",
        headers=auth(rit.officer_user),
        json={"notes": "Not mine to touch"},
    )
    assert response.status_code == 404


def test_an_officer_may_not_delete_an_unallocated_company(make_client, auth, db, rit):
    from app.models.company import Company

    response = make_client("rit").delete(
        f"/api/companies/{rit.company.id}", headers=auth(rit.officer_user)
    )
    assert response.status_code == 404
    assert db.query(Company).filter(Company.id == rit.company.id).first() is not None


def test_an_officer_may_not_read_hr_contacts_of_an_unallocated_company(make_client, auth, rit):
    """The contacts are the point of the scoping: names, emails and mobiles of
    the people who decide whether a company visits."""
    response = make_client("rit").get(
        f"/api/companies/{rit.company.id}/hr-contacts", headers=auth(rit.officer_user)
    )
    assert response.status_code == 404


def test_an_officer_may_not_spend_ai_credit_on_an_unallocated_company(make_client, auth, rit):
    for path in ("interview-questions", "exam-questions"):
        response = make_client("rit").post(
            f"/api/companies/{rit.company.id}/{path}",
            headers=auth(rit.officer_user),
            json={"job_role": "SDE"},
        )
        assert response.status_code == 404, path


# --- officer records themselves ---------------------------------------------


def test_an_officer_reaches_their_own_card(make_client, auth, rit):
    response = make_client("rit").get(
        f"/api/officers/{rit.officer.id}", headers=auth(rit.officer_user)
    )
    assert response.status_code == 200


def test_an_officer_cannot_read_a_colleagues_card(make_client, auth, db, rit):
    """Targets and performance are between an officer and their head."""
    colleague = factories.make_officer(db, college=rit.college)
    response = make_client("rit").get(
        f"/api/officers/{colleague.id}", headers=auth(rit.officer_user)
    )
    assert response.status_code == 404


def test_the_head_reaches_every_officer_card(make_client, auth, db, rit):
    colleague = factories.make_officer(db, college=rit.college)
    assert (
        make_client("rit").get(f"/api/officers/{colleague.id}", headers=auth(rit.head)).status_code
        == 200
    )


def test_losing_an_allocation_closes_the_door_again(make_client, auth, db, rit):
    """Allocation is the whole key, so removing one has to take the access with
    it - otherwise a reassigned company stays readable forever."""
    from app.models.officer import CompanyAssignment

    client, headers = make_client("rit"), auth(rit.officer_user)
    assert client.get(f"/api/companies/{rit.assigned_company.id}", headers=headers).status_code == 200

    db.query(CompanyAssignment).filter(
        CompanyAssignment.company_id == rit.assigned_company.id
    ).delete()
    db.flush()

    assert client.get(f"/api/companies/{rit.assigned_company.id}", headers=headers).status_code == 404
