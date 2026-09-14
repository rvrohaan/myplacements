"""app/services/workload.py - is the work spread fairly across the team?

A different question from the officer-performance table, which ranks people by
what they have landed. This measures what each of them is *carrying*, because an
officer who lands fewer offers while holding twice the companies is not
underperforming, and a table sorted by offers won says the opposite.

Two design decisions the tests hold down:

* **No comparison against `target_companies`.** An earlier version read that
  field as capacity, and a reader took "25x their target" to mean the officer had
  done twenty-five times their job. Nothing in the schema states capacity, so
  this panel does not pretend to measure it.
* **Follow-ups come from the shared service**, so "owed" means here exactly what
  it means in the reminder and the officer report.
"""

from datetime import datetime, timedelta

import pytest
from freezegun import freeze_time

from app.models.company import CompanyStatus
from app.models.drive import DriveStatus
from app.services import workload
from app.services.workload import WEIGHTS, compute
from tests import factories

TODAY = datetime(2026, 9, 14)
FROZEN = "2026-09-14 08:00:00"


def at(days: int) -> datetime:
    return TODAY + timedelta(days=days)


@pytest.fixture
def head(db, college):
    from app.models.user import UserRole

    return factories.make_user(db, college=college, role=UserRole.PRO_CHANCELLOR)


def hold(db, college, officer, *, companies=0, **kw):
    """Give an officer some open companies, and return the last one."""
    last = None
    for _ in range(companies):
        last = factories.make_company(db, college=college)
        factories.assign_company(db, company=last, officer=officer, **kw)
    return last


def row_for(result, officer):
    return next(r for r in result["officers"] if r["officer_id"] == officer.id)


# --- what counts as load ----------------------------------------------------


def test_an_officer_with_nothing_carries_no_load(db, college, head):
    officer = factories.make_officer(db, college=college)
    assert row_for(compute(db, head), officer)["load"] == 0


def test_open_companies_are_load(db, college, head):
    officer = factories.make_officer(db, college=college)
    hold(db, college, officer, companies=3)
    row = row_for(compute(db, head), officer)
    assert row["open_companies"] == 3
    assert row["load"] == 3 * WEIGHTS["open_companies"]


def test_a_closed_assignment_is_not_open_work(db, college, head):
    """The panel is about what is still being carried."""
    officer = factories.make_officer(db, college=college)
    hold(db, college, officer, companies=2, status="completed")
    assert row_for(compute(db, head), officer)["open_companies"] == 0


def test_an_upcoming_drive_outweighs_an_open_company(db, college, head):
    """It is a fixed date with a room and a panel behind it, not a conversation."""
    officer = factories.make_officer(db, college=college)
    company = hold(db, college, officer, companies=1)
    factories.make_drive(db, college=college, company=company, status=DriveStatus.UPCOMING)

    row = row_for(compute(db, head), officer)
    assert row["upcoming_drives"] == 1
    assert WEIGHTS["upcoming_drives"] > WEIGHTS["open_companies"]
    assert row["load"] == WEIGHTS["open_companies"] + WEIGHTS["upcoming_drives"]


def test_a_finished_drive_is_not_carried(db, college, head):
    officer = factories.make_officer(db, college=college)
    company = hold(db, college, officer, companies=1)
    factories.make_drive(db, college=college, company=company, status=DriveStatus.COMPLETED)
    assert row_for(compute(db, head), officer)["upcoming_drives"] == 0


@freeze_time(FROZEN)
def test_an_overdue_followup_outweighs_one_merely_due(db, college, head):
    """It is already late."""
    officer = factories.make_officer(db, college=college)
    company = hold(db, college, officer, companies=1)
    factories.make_hr_contact(db, company=company, next_followup_date=at(-3))

    row = row_for(compute(db, head), officer)
    assert row["followups_overdue"] == 1
    assert WEIGHTS["followups_overdue"] > WEIGHTS["followups_due"]


@freeze_time(FROZEN)
def test_followups_agree_with_the_shared_service(db, college, head):
    """Imported rather than recounted, so the panel and the reminder cannot
    disagree about what somebody owes."""
    from app.services.followups import owed_followups

    officer = factories.make_officer(db, college=college)
    company = hold(db, college, officer, companies=1)
    factories.make_hr_contact(db, company=company, next_followup_date=at(-2))

    row = row_for(compute(db, head), officer)
    owed = owed_followups(db, college.id)[officer.user_id]
    assert (row["followups_due"], row["followups_overdue"]) == (owed.due_today, owed.overdue)


# --- shares and spread ------------------------------------------------------


def test_shares_are_of_the_team_total(db, college, head):
    busy = factories.make_officer(db, college=college)
    light = factories.make_officer(db, college=college)
    hold(db, college, busy, companies=3)
    hold(db, college, light, companies=1)

    result = compute(db, head)
    assert row_for(result, busy)["share"] == 75.0
    assert row_for(result, light)["share"] == 25.0


def test_the_busiest_officer_is_listed_first(db, college, head):
    light = factories.make_officer(db, college=college)
    busy = factories.make_officer(db, college=college)
    hold(db, college, busy, companies=4)
    hold(db, college, light, companies=1)
    assert compute(db, head)["officers"][0]["officer_id"] == busy.id


def test_the_spread_is_busiest_minus_lightest(db, college, head):
    busy = factories.make_officer(db, college=college)
    light = factories.make_officer(db, college=college)
    hold(db, college, busy, companies=3)
    hold(db, college, light, companies=1)
    assert compute(db, head)["spread"] == 50.0


def test_an_even_split_has_no_spread(db, college, head):
    for _ in range(2):
        officer = factories.make_officer(db, college=college)
        hold(db, college, officer, companies=2)
    assert compute(db, head)["spread"] == 0.0


def test_the_question_is_meaningless_with_one_officer(db, college, head):
    """One officer always carries 100%, which says nothing about fairness."""
    officer = factories.make_officer(db, college=college)
    hold(db, college, officer, companies=3)
    assert compute(db, head)["spread"] is None


def test_no_spread_when_nobody_is_carrying_anything(db, college, head):
    for _ in range(2):
        factories.make_officer(db, college=college)
    result = compute(db, head)
    assert result["total_load"] == 0
    assert result["spread"] is None


def test_a_share_of_nothing_is_none_rather_than_zero(db, college, head):
    """0% would assert the officer holds none of a pile that does not exist."""
    officer = factories.make_officer(db, college=college)
    assert row_for(compute(db, head), officer)["share"] is None


def test_the_fair_share_is_an_equal_split(db, college, head):
    for _ in range(4):
        factories.make_officer(db, college=college)
    assert compute(db, head)["fair_share"] == 25.0


def test_idle_officers_are_counted(db, college, head):
    busy = factories.make_officer(db, college=college)
    hold(db, college, busy, companies=2)
    factories.make_officer(db, college=college)
    factories.make_officer(db, college=college)
    assert compute(db, head)["idle_officers"] == 2


# --- work nobody owns -------------------------------------------------------


def test_unassigned_companies_are_reported_beside_the_spread(db, college, head):
    """Balance across officers says nothing useful while a pile of companies has
    no owner at all."""
    factories.make_officer(db, college=college)
    factories.make_company(db, college=college)
    factories.make_company(db, college=college)
    assert compute(db, head)["unassigned_companies"] == 2


def test_an_assigned_company_is_not_counted_as_unassigned(db, college, head):
    officer = factories.make_officer(db, college=college)
    hold(db, college, officer, companies=1)
    assert compute(db, head)["unassigned_companies"] == 0


@pytest.mark.parametrize("status", [CompanyStatus.BLACKLISTED, CompanyStatus.DORMANT])
def test_a_company_not_worth_working_is_not_unassigned_work(db, college, head, status):
    """Nobody is meant to pick these up, so counting them would make the backlog
    look permanent."""
    factories.make_officer(db, college=college)
    factories.make_company(db, college=college, status=status)
    assert compute(db, head)["unassigned_companies"] == 0


# --- tenant scoping ---------------------------------------------------------


def test_another_colleges_officers_are_not_in_the_panel(db, college, other_college, head):
    mine = factories.make_officer(db, college=college)
    theirs = factories.make_officer(db, college=other_college)
    ids = {r["officer_id"] for r in compute(db, head)["officers"]}
    assert mine.id in ids
    assert theirs.id not in ids


# --- shape ------------------------------------------------------------------


def test_the_weights_travel_with_the_answer(db, college, head):
    """They are reasoned, not fitted, so the panel shows what it weighed rather
    than asserting a number."""
    assert compute(db, head)["weights"] == WEIGHTS


def test_no_officer_carries_a_target_comparison(db, college, head):
    """The decision the docstring argues hardest for: `assigned / target` is
    already rendered as Target attainment elsewhere, and the same ratio cannot
    mean "how much they achieved" in one panel and "how overloaded they are" in
    another on the same page."""
    officer = factories.make_officer(db, college=college, target_companies=2)
    hold(db, college, officer, companies=50)
    row = row_for(compute(db, head), officer)
    assert not any("target" in key for key in row)


def test_an_officer_row_names_the_person_not_just_the_record(db, college, head):
    officer = factories.make_officer(db, college=college)
    assert row_for(compute(db, head), officer)["name"] == officer.user.full_name


def test_a_minimum_officer_count_guards_the_spread(db):
    assert workload.MIN_OFFICERS >= 2
