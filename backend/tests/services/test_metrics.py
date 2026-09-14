"""app/services/company_metrics.py and hr_metrics.py - the analytics tiles.

These are read at a glance and acted on, which makes an off-by-one here more
dangerous than in a report somebody studies. Two shapes recur:

* **A funnel must actually narrow.** Each stage is a strict subset of the one
  above it; four counts drawn side by side and labelled as a funnel would let a
  head conclude that companies are dropping out at a stage they are not.
* **Counts must match what clicking through shows.** Every bucket here shares a
  boundary with the list it filters, so "3 overdue" on the tile and the three
  rows behind it cannot disagree.
"""

from datetime import datetime, timedelta

import pytest
from freezegun import freeze_time

from app.models.company import CompanyStatus
from app.models.offer import Offer, OfferStatus
from app.models.user import UserRole
from app.services import company_metrics, hr_metrics
from app.services.company_metrics import company_rows, engagement_by_company, funnel, status_mix
from tests import factories

TODAY = datetime(2026, 9, 14)
FROZEN = "2026-09-14 08:00:00"


def at(days: int) -> datetime:
    return TODAY + timedelta(days=days)


@pytest.fixture
def head(db, college):
    return factories.make_user(db, college=college, role=UserRole.PRO_CHANCELLOR)


def row_for(rows, company):
    return next(r for r in rows if r.id == company.id)


# --- company rows -----------------------------------------------------------


def test_a_company_with_nothing_logged_still_appears(db, college, head):
    """The companies nobody has touched are the point of the panel."""
    company = factories.make_company(db, college=college, name="Untouched")
    row = row_for(company_rows(db, head), company)
    assert row.name == "Untouched"
    assert row.logged == 0


def test_outreach_and_replies_are_counted(db, college, head):
    company = factories.make_company(db, college=college)
    factories.log_communication(db, college=college, company=company, response_received="received")
    factories.log_communication(db, college=college, company=company, response_received="no_response")

    row = row_for(company_rows(db, head), company)
    assert row.logged == 2
    assert row.replied == 1
    assert row.reply_rate == 50.0


def test_a_reply_rate_with_nothing_logged_is_none_not_zero(db, college, head):
    """0% would assert this company ignores us; nobody has written to them."""
    company = factories.make_company(db, college=college)
    assert row_for(company_rows(db, head), company).reply_rate is None


def test_drives_and_offers_are_counted(db, college, head):
    company = factories.make_company(db, college=college)
    factories.make_drive(db, college=college, company=company)
    student = factories.make_student(db, college=college)
    db.add(Offer(student_id=student.id, company_id=company.id, status=OfferStatus.ACCEPTED, ctc=9.0))
    db.flush()

    row = row_for(company_rows(db, head), company)
    assert row.drives == 1
    assert row.offers == 1
    assert student.id in row.placed


def test_one_student_with_two_offers_is_placed_once(db, college, head):
    """`placed` is a set of students, not a count of offers - otherwise a
    company that made two offers to one person looks twice as productive."""
    company = factories.make_company(db, college=college)
    student = factories.make_student(db, college=college)
    for _ in range(2):
        db.add(Offer(student_id=student.id, company_id=company.id, status=OfferStatus.ACCEPTED))
    db.flush()
    assert len(row_for(company_rows(db, head), company).placed) == 1


@freeze_time(FROZEN)
def test_a_company_contacted_recently_is_not_stale(db, college, head):
    company = factories.make_company(db, college=college)
    factories.log_communication(db, college=college, company=company, communicated_at=at(-2))
    row = row_for(company_rows(db, head), company)
    assert row.days_since_contact == 2
    assert row.stale is False


@freeze_time(FROZEN)
def test_a_company_nobody_has_written_to_is_stale(db, college, head):
    """Never contacted is at least as stale as contacted long ago, and the
    panel exists to surface exactly these."""
    company = factories.make_company(db, college=college)
    row = row_for(company_rows(db, head), company)
    assert row.days_since_contact is None
    assert row.stale is True


@freeze_time(FROZEN)
def test_a_company_untouched_for_too_long_is_stale(db, college, head):
    company = factories.make_company(db, college=college)
    factories.log_communication(
        db, college=college, company=company,
        communicated_at=at(-(company_metrics.STALE_AFTER_DAYS + 1)),
    )
    assert row_for(company_rows(db, head), company).stale is True


def test_another_colleges_companies_are_not_in_the_panel(db, college, other_college, head):
    factories.make_company(db, college=other_college, name="Theirs")
    factories.make_company(db, college=college, name="Mine")
    assert {r.name for r in company_rows(db, head)} == {"Mine"}


def test_an_empty_college_produces_no_rows(db, head):
    assert company_rows(db, head) == []


# --- the funnel -------------------------------------------------------------


def test_each_funnel_stage_is_a_subset_of_the_one_above(db, college, head):
    """The property that makes it a funnel rather than four bars."""
    contacted = factories.make_company(db, college=college)
    factories.log_communication(db, college=college, company=contacted)

    ran_drive = factories.make_company(db, college=college)
    factories.log_communication(db, college=college, company=ran_drive)
    factories.make_drive(db, college=college, company=ran_drive)

    placed = factories.make_company(db, college=college)
    factories.log_communication(db, college=college, company=placed)
    factories.make_drive(db, college=college, company=placed)
    student = factories.make_student(db, college=college)
    db.add(Offer(student_id=student.id, company_id=placed.id, status=OfferStatus.ACCEPTED))
    db.flush()

    factories.make_company(db, college=college)  # on file, never contacted

    counts = [n for _, n in funnel(company_rows(db, head))]
    assert counts == sorted(counts, reverse=True)
    assert counts[0] == 4


def test_the_funnel_is_all_zeros_for_an_empty_college(db, head):
    assert [n for _, n in funnel(company_rows(db, head))] == [0, 0, 0, 0, 0]


def test_the_funnel_stages_are_labelled(db, head):
    assert [label for label, _ in funnel([])] == [
        "Companies on file",
        "Contacted at least once",
        "Ran a drive",
        "Made an offer",
        "Placed at least one student",
    ]


# --- the status mix ---------------------------------------------------------


def test_the_status_mix_counts_each_status(db, college, head):
    factories.make_company(db, college=college, status=CompanyStatus.ACTIVE)
    factories.make_company(db, college=college, status=CompanyStatus.ACTIVE)
    factories.make_company(db, college=college, status=CompanyStatus.DORMANT)

    mix = dict(status_mix(company_rows(db, head)))
    assert mix == {"active": 2, "dormant": 1}


def test_a_status_nobody_has_is_left_out(db, college, head):
    """The chart shows what exists, not every value the enum allows."""
    factories.make_company(db, college=college, status=CompanyStatus.ACTIVE)
    assert "blacklisted" not in dict(status_mix(company_rows(db, head)))


def test_the_status_order_is_fixed_so_the_chart_does_not_reshuffle(db, college, head):
    """And it is attention order, not declaration order - the same order the
    Companies list sorts by."""
    for status in (CompanyStatus.DORMANT, CompanyStatus.PRIORITY, CompanyStatus.ACTIVE):
        factories.make_company(db, college=college, status=status)

    first = [s for s, _ in status_mix(company_rows(db, head))]
    second = [s for s, _ in status_mix(company_rows(db, head))]
    assert first == second
    expected = [s.value for s in company_metrics.STATUS_ATTENTION_ORDER if s.value in first]
    assert first == expected


# --- engagement per company -------------------------------------------------


def test_a_companys_engagement_comes_from_its_contacts(db, college, head):
    """Built on the same scorer the HR directory uses, so a company's figure can
    never disagree with the contacts it is made of."""
    company = factories.make_company(db, college=college)
    contact = factories.make_hr_contact(db, company=company)
    factories.log_communication(
        db, college=college, company=company, contact=contact,
        response_received="received", communicated_at=datetime.utcnow(),
    )

    result = engagement_by_company(db, head)
    assert result[company.id]["contacts_scored"] == 1
    assert 0 <= result[company.id]["score"] <= 100


def test_a_contact_with_no_history_does_not_drag_a_company_down(db, college, head):
    """score_contact returns None for them rather than zero, and that has to
    survive the averaging."""
    company = factories.make_company(db, college=college)
    scored = factories.make_hr_contact(db, company=company)
    factories.make_hr_contact(db, company=company)  # never contacted
    factories.log_communication(
        db, college=college, company=company, contact=scored,
        response_received="received", communicated_at=datetime.utcnow(),
    )

    assert engagement_by_company(db, head)[company.id]["contacts_scored"] == 1


def test_a_company_with_no_contacts_is_absent_rather_than_zero(db, college, head):
    factories.make_company(db, college=college)
    assert engagement_by_company(db, head) == {}


def test_another_colleges_engagement_is_not_computed(db, college, other_college, head):
    theirs = factories.make_company(db, college=other_college)
    contact = factories.make_hr_contact(db, company=theirs)
    factories.log_communication(
        db, college=other_college, company=theirs, contact=contact,
        response_received="received", communicated_at=datetime.utcnow(),
    )
    assert engagement_by_company(db, head) == {}


# --- follow-up buckets ------------------------------------------------------


@freeze_time(FROZEN)
def test_followups_are_bucketed_by_how_late_they_are(db, college):
    company = factories.make_company(db, college=college)
    contacts = [
        factories.make_hr_contact(db, company=company, next_followup_date=at(-3)),
        factories.make_hr_contact(db, company=company, next_followup_date=at(1)),
        factories.make_hr_contact(db, company=company, next_followup_date=at(60)),
        factories.make_hr_contact(db, company=company, next_followup_date=None),
    ]
    buckets = {b["bucket"]: b["contacts"] for b in hr_metrics.followup_buckets(contacts, now=TODAY)}
    assert buckets["Overdue"] == 1
    assert buckets["Later"] == 1
    assert buckets["No follow-up set"] == 1


@freeze_time(FROZEN)
def test_a_followup_due_today_is_not_yet_overdue(db, college):
    """The same boundary every surface that says overdue shares."""
    company = factories.make_company(db, college=college)
    contact = factories.make_hr_contact(db, company=company, next_followup_date=at(0))
    buckets = {b["bucket"]: b["contacts"] for b in hr_metrics.followup_buckets([contact], now=TODAY)}
    assert buckets["Overdue"] == 0


def test_every_contact_lands_in_exactly_one_bucket(db, college):
    """They are drawn as a whole; a contact in two would make the parts exceed
    the total."""
    company = factories.make_company(db, college=college)
    contacts = [
        factories.make_hr_contact(db, company=company, next_followup_date=at(d))
        for d in (-30, -1, 0, 2, 90)
    ] + [factories.make_hr_contact(db, company=company, next_followup_date=None)]

    buckets = hr_metrics.followup_buckets(contacts, now=TODAY)
    assert sum(b["contacts"] for b in buckets) == len(contacts)


def test_the_buckets_are_always_present_even_when_empty(db):
    """A tile that drops a zero bucket changes shape as the data changes."""
    assert [b["bucket"] for b in hr_metrics.followup_buckets([], now=TODAY)] == [
        "Overdue",
        f"Due in {hr_metrics.DUE_SOON_DAYS} days",
        "Later",
        "No follow-up set",
    ]


# --- engagement mix ---------------------------------------------------------


def test_the_engagement_mix_counts_each_band():
    scores = {1: {"score": 90, "band": "responsive"}, 2: {"score": 60, "band": "warm"}}
    mix = {row["band"]: row["contacts"] for row in hr_metrics.engagement_mix(scores, 3)}
    assert mix["responsive"] == 1
    assert mix["warm"] == 1


def test_contacts_with_no_history_are_shown_rather_than_hidden():
    """They are the ones somebody should write to, so a mix that silently
    dropped them would hide the actionable half of the directory."""
    mix = hr_metrics.engagement_mix({1: {"score": 90, "band": "responsive"}}, 4)
    assert sum(row["contacts"] for row in mix) == 4


def test_an_empty_directory_mixes_to_nothing():
    assert sum(row["contacts"] for row in hr_metrics.engagement_mix({}, 0)) == 0
