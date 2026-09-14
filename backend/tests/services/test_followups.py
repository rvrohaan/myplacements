"""app/services/followups.py - who owes an HR follow-up, and since when.

This feeds the reminder that lands in an officer's notifications, so being wrong
here is not a silent analytics error - it is a message telling somebody they owe
work they do not, or staying quiet about work they do.

The design rests on one idea worth testing hard: **the unit is the obligation,
not the row.** Logging a communication syncs the contact's own
`next_followup_date`, so the same promise exists in two tables. Counting both
would tell an officer they owe twice what they do.

Dates here are naive local midnight, never UTC instants - `next_followup_date`
comes from an `<input type="date">`. `timeutil.overdue_before` is the boundary
every surface that says "overdue" shares.
"""

from datetime import datetime, timedelta

import pytest
from freezegun import freeze_time

from app.services.followups import Owed, owed_followups, summarise
from tests import factories

# Frozen so "today" is a fixed local date. 08:00 UTC is 13:30 IST - comfortably
# inside the same local day, so no test here straddles a boundary by accident.
TODAY = datetime(2026, 9, 14)
FROZEN = "2026-09-14 08:00:00"


def at(days: int) -> datetime:
    """Local midnight `days` from today, the shape a date input produces."""
    return TODAY + timedelta(days=days)


@pytest.fixture
def officer(db, college):
    return factories.make_officer(db, college=college)


@pytest.fixture
def company(db, college, officer):
    company = factories.make_company(db, college=college)
    factories.assign_company(db, company=company, officer=officer)
    return company


def owed_for(db, college, user):
    return owed_followups(db, college.id).get(user.id)


# --- what counts as owed ----------------------------------------------------


@freeze_time(FROZEN)
def test_a_followup_due_today_is_owed(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer, next_followup_date=at(0)
    )
    entry = owed_for(db, college, officer.user)
    assert entry.due_today == 1
    assert entry.overdue == 0


@freeze_time(FROZEN)
def test_a_followup_from_yesterday_is_overdue_not_forgotten(db, college, officer, company):
    """A reminder that only fires on the exact due date is the one that misses
    everything an officer was on leave for."""
    factories.log_communication(
        db, college=college, company=company, officer=officer, next_followup_date=at(-1)
    )
    entry = owed_for(db, college, officer.user)
    assert entry.overdue == 1
    assert entry.oldest_overdue_days == 1


@freeze_time(FROZEN)
def test_a_followup_due_tomorrow_is_not_owed_yet(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer, next_followup_date=at(1)
    )
    assert owed_for(db, college, officer.user) is None


@freeze_time(FROZEN)
def test_a_contact_who_replied_owes_nothing_however_old_the_date(db, college, officer, company):
    """The same rule report_defs.officer_followup applies: the chase is moot
    once they answered."""
    factories.log_communication(
        db,
        college=college,
        company=company,
        officer=officer,
        next_followup_date=at(-30),
        response_received="received",
    )
    assert owed_for(db, college, officer.user) is None


@freeze_time(FROZEN)
def test_an_unanswered_followup_is_still_owed(db, college, officer, company):
    factories.log_communication(
        db,
        college=college,
        company=company,
        officer=officer,
        next_followup_date=at(-3),
        response_received="no_response",
    )
    assert owed_for(db, college, officer.user).overdue == 1


@freeze_time(FROZEN)
def test_a_log_with_no_followup_date_is_not_an_obligation(db, college, officer, company):
    factories.log_communication(db, college=college, company=company, officer=officer)
    assert owed_for(db, college, officer.user) is None


@freeze_time(FROZEN)
def test_the_oldest_overdue_age_is_reported(db, college, officer, company):
    for days in (-2, -15, -6):
        factories.log_communication(
            db, college=college, company=company, officer=officer, next_followup_date=at(days)
        )
    entry = owed_for(db, college, officer.user)
    assert entry.overdue == 3
    assert entry.oldest_overdue_days == 15


# --- one obligation, not two ------------------------------------------------


@freeze_time(FROZEN)
def test_a_contact_obligation_absorbs_the_communication_behind_it(db, college, officer, company):
    """The rule the module exists to get right. Logging the communication syncs
    the contact's own date, so both tables carry the same promise."""
    contact = factories.make_hr_contact(db, company=company, next_followup_date=at(-1))
    factories.log_communication(
        db,
        college=college,
        company=company,
        contact=contact,
        officer=officer,
        next_followup_date=at(-1),
    )
    entry = owed_for(db, college, officer.user)
    assert entry.total == 1


@freeze_time(FROZEN)
def test_several_logs_against_one_contact_are_one_obligation(db, college, officer, company):
    """Three chases of the same person are one thing still to do."""
    contact = factories.make_hr_contact(db, company=company)
    for days in (-5, -3, -1):
        factories.log_communication(
            db,
            college=college,
            company=company,
            contact=contact,
            officer=officer,
            next_followup_date=at(days),
        )
    assert owed_for(db, college, officer.user).total == 1


@freeze_time(FROZEN)
def test_the_obligation_takes_the_earliest_date_of_the_logs_behind_it(db, college, officer, company):
    """So its age is how long the promise has been outstanding, not how recently
    somebody last touched it."""
    contact = factories.make_hr_contact(db, company=company)
    for days in (-9, -2):
        factories.log_communication(
            db,
            college=college,
            company=company,
            contact=contact,
            officer=officer,
            next_followup_date=at(days),
        )
    assert owed_for(db, college, officer.user).oldest_overdue_days == 9


@freeze_time(FROZEN)
def test_logs_against_different_contacts_are_separate_obligations(db, college, officer, company):
    for _ in range(2):
        contact = factories.make_hr_contact(db, company=company)
        factories.log_communication(
            db,
            college=college,
            company=company,
            contact=contact,
            officer=officer,
            next_followup_date=at(-1),
        )
    assert owed_for(db, college, officer.user).total == 2


@freeze_time(FROZEN)
def test_a_log_with_no_contact_stands_on_its_own(db, college, officer, company):
    """Nothing to key it to, so the row itself is the obligation."""
    for days in (-1, -2):
        factories.log_communication(
            db, college=college, company=company, officer=officer, next_followup_date=at(days)
        )
    assert owed_for(db, college, officer.user).total == 2


@freeze_time(FROZEN)
def test_a_contact_date_with_no_communication_is_still_owed(db, college, officer, company):
    """An officer can set a date on the contact directly."""
    factories.make_hr_contact(db, company=company, next_followup_date=at(-2))
    assert owed_for(db, college, officer.user).total == 1


# --- who owes it ------------------------------------------------------------


@freeze_time(FROZEN)
def test_the_officer_stamped_on_the_log_owes_it(db, college, officer, company):
    """First in the attribution order, matching the officer report."""
    other = factories.make_officer(db, college=college)
    factories.log_communication(
        db,
        college=college,
        company=company,
        officer=other,
        logged_by=officer.user,
        next_followup_date=at(-1),
    )
    assert owed_for(db, college, other.user).total == 1
    assert owed_for(db, college, officer.user) is None


@freeze_time(FROZEN)
def test_whoever_typed_it_owes_it_when_no_officer_is_stamped(db, college, officer, company):
    head = factories.make_user(db, college=college)
    factories.log_communication(
        db, college=college, company=company, logged_by=head, next_followup_date=at(-1)
    )
    assert owed_for(db, college, head).total == 1


@freeze_time(FROZEN)
def test_the_allocated_officer_owes_it_when_nobody_else_can_be_named(db, college, officer, company):
    factories.make_hr_contact(db, company=company, next_followup_date=at(-1))
    assert owed_for(db, college, officer.user).total == 1


@freeze_time(FROZEN)
def test_an_unattributable_followup_is_left_out_rather_than_mailed_to_everyone(db, college):
    """A company nobody owns, with a date nobody set - there is no right
    recipient, and the wrong answer is "all of them"."""
    orphan = factories.make_company(db, college=college)
    factories.make_hr_contact(db, company=orphan, next_followup_date=at(-1))
    assert owed_followups(db, college.id) == {}


@freeze_time(FROZEN)
def test_a_deactivated_officer_is_not_reminded(db, college, company, officer):
    """They cannot sign in to act on it."""
    factories.log_communication(
        db, college=college, company=company, officer=officer, next_followup_date=at(-1)
    )
    officer.user.is_active = False
    db.flush()
    assert owed_followups(db, college.id) == {}


@freeze_time(FROZEN)
def test_each_officer_is_told_only_their_own(db, college, officer, company):
    colleague = factories.make_officer(db, college=college)
    other_company = factories.make_company(db, college=college)
    factories.assign_company(db, company=other_company, officer=colleague)

    factories.log_communication(
        db, college=college, company=company, officer=officer, next_followup_date=at(-1)
    )
    factories.log_communication(
        db, college=college, company=other_company, officer=colleague, next_followup_date=at(-4)
    )

    owed = owed_followups(db, college.id)
    assert owed[officer.user.id].total == 1
    assert owed[colleague.user.id].total == 1
    assert owed[colleague.user.id].oldest_overdue_days == 4


@freeze_time(FROZEN)
def test_the_companies_behind_an_obligation_are_recorded(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer, next_followup_date=at(-1)
    )
    assert owed_for(db, college, officer.user).companies == {company.id}


# --- tenant scoping ---------------------------------------------------------


@freeze_time(FROZEN)
def test_another_colleges_followups_are_not_counted(db, college, other_college, officer, company):
    """The reminder runs per college; pooling them would mail one college's
    officer about another's promises."""
    their_officer = factories.make_officer(db, college=other_college)
    their_company = factories.make_company(db, college=other_college)
    factories.assign_company(db, company=their_company, officer=their_officer)
    factories.log_communication(
        db,
        college=other_college,
        company=their_company,
        officer=their_officer,
        next_followup_date=at(-1),
    )

    assert owed_followups(db, college.id) == {}
    assert their_officer.user.id in owed_followups(db, other_college.id)


# --- the notification line ---------------------------------------------------


def test_the_summary_leads_with_what_has_already_slipped():
    line = summarise(Owed(user_id=1, due_today=2, overdue=3, oldest_overdue_days=9))
    assert line == "2 due later today · 3 overdue, oldest 9 days ago"


def test_the_summary_reads_as_english_for_a_single_day():
    line = summarise(Owed(user_id=1, overdue=1, oldest_overdue_days=1))
    assert line == "1 overdue, oldest 1 day ago"


def test_the_summary_omits_a_part_with_nothing_in_it():
    assert summarise(Owed(user_id=1, due_today=2)) == "2 due later today"
    assert summarise(Owed(user_id=1, overdue=2, oldest_overdue_days=3)) == "2 overdue, oldest 3 days ago"


def test_an_empty_obligation_summarises_to_nothing():
    """The caller decides not to send rather than sending an empty sentence."""
    assert summarise(Owed(user_id=1)) == ""


def test_total_adds_both_kinds():
    assert Owed(user_id=1, due_today=2, overdue=3).total == 5
