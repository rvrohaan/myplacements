"""app/services/daily_metrics.py - what the system already knows about a day.

The point of the daily update is that officers should not retype numbers the
database can produce. A self-reported "made 12 calls" is worth very little; 12
counted from the communication log is worth reading. So everything countable is
computed here, and the officer types only judgement.

Two hazards run through all of it:

* **Every stored timestamp is naive UTC, and a "day" is a local question.** In
  IST a local day starts at 18:30 UTC the evening before, so an evening call
  lands on tomorrow's digest unless the bounds are converted. Passing a bare
  date into a query is silently wrong by five and a half hours.
* **Thresholds are imported from the analytics router, never restated**, so the
  digest and the dashboards cannot disagree about what "stale" means.
"""

from datetime import date, datetime, timedelta

import pytest

from app.models.communication import CommunicationType
from app.models.offer import Offer, OfferStatus
from app.models.student import RiskCategory
from app.models.user import UserRole
from app.services import daily_metrics
from app.services.daily_metrics import (
    build_prompts,
    coordinator_day_metrics,
    filer_kind,
    has_activity,
    metrics_for,
    officer_day_metrics,
    standing_counts,
)
from tests import factories

# A local day, and two instants inside it. 2026-09-14 in IST runs from
# 2026-09-13 18:30 UTC to 2026-09-14 18:30 UTC.
DAY = date(2026, 9, 14)
MIDDAY_UTC = datetime(2026, 9, 14, 6, 0)
#: 22:00 UTC on the 13th is 03:30 IST on the 14th - inside the local day, but on
#: the previous UTC date. The case a bare-date query gets wrong.
LATE_EVENING_BEFORE = datetime(2026, 9, 13, 22, 0)
#: 19:00 UTC on the 14th is 00:30 IST on the 15th - already tomorrow locally.
AFTER_LOCAL_MIDNIGHT = datetime(2026, 9, 14, 19, 0)


@pytest.fixture
def head(db, college):
    return factories.make_user(db, college=college, role=UserRole.PRO_CHANCELLOR)


@pytest.fixture
def officer(db, college):
    return factories.make_officer(db, college=college)


@pytest.fixture
def company(db, college, officer):
    company = factories.make_company(db, college=college)
    factories.assign_company(db, company=company, officer=officer)
    return company


def day_metrics(db, officer, day=DAY):
    return officer_day_metrics(db, officer.user, officer, day)


# --- the local day ----------------------------------------------------------


def test_a_call_made_in_the_middle_of_the_day_counts(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer, communicated_at=MIDDAY_UTC
    )
    assert day_metrics(db, officer)["calls"] == 0  # default type is email
    assert day_metrics(db, officer)["emails"] == 1


def test_an_early_hours_call_belongs_to_the_local_day_it_happened_in(db, college, officer, company):
    """22:00 UTC on the 13th is 03:30 IST on the 14th. Filing it against the UTC
    date would put it on the wrong day's digest."""
    factories.log_communication(
        db, college=college, company=company, officer=officer,
        communicated_at=LATE_EVENING_BEFORE,
    )
    assert day_metrics(db, officer)["communications"] == 1


def test_something_after_local_midnight_belongs_to_tomorrow(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer,
        communicated_at=AFTER_LOCAL_MIDNIGHT,
    )
    assert day_metrics(db, officer)["communications"] == 0
    assert day_metrics(db, officer, DAY + timedelta(days=1))["communications"] == 1


def test_yesterday_is_not_counted_as_today(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer,
        communicated_at=MIDDAY_UTC - timedelta(days=1),
    )
    assert day_metrics(db, officer)["communications"] == 0


# --- an officer's own work --------------------------------------------------


@pytest.mark.parametrize(
    ("comm_type", "key"),
    [
        (CommunicationType.CALL, "calls"),
        (CommunicationType.EMAIL, "emails"),
        (CommunicationType.MEETING, "meetings"),
        (CommunicationType.WHATSAPP, "whatsapp"),
        (CommunicationType.LINKEDIN, "linkedin"),
    ],
)
def test_each_channel_is_counted_separately(db, college, officer, company, comm_type, key):
    factories.log_communication(
        db, college=college, company=company, officer=officer,
        comm_type=comm_type, communicated_at=MIDDAY_UTC,
    )
    assert day_metrics(db, officer)[key] == 1


def test_a_heads_log_on_the_officers_company_is_not_the_officers_work(db, college, officer, company, head):
    """Contact was made, but it is not work this officer did - and the update is
    a record of what they did."""
    factories.log_communication(
        db, college=college, company=company, logged_by=head, communicated_at=MIDDAY_UTC
    )
    assert day_metrics(db, officer)["communications"] == 0


def test_companies_touched_counts_companies_not_calls(db, college, officer, company):
    """Three calls to one company is one relationship worked."""
    for _ in range(3):
        factories.log_communication(
            db, college=college, company=company, officer=officer, communicated_at=MIDDAY_UTC
        )
    metrics = day_metrics(db, officer)
    assert metrics["communications"] == 3
    assert metrics["companies_touched"] == 1


def test_a_company_the_officer_added_today_is_counted(db, college, officer):
    factories.make_company(
        db, college=college, created_by_id=officer.user_id, created_at=MIDDAY_UTC
    )
    assert day_metrics(db, officer)["new_companies"] == 1


def test_a_company_somebody_else_added_is_not(db, college, officer, head):
    factories.make_company(db, college=college, created_by_id=head.id, created_at=MIDDAY_UTC)
    assert day_metrics(db, officer)["new_companies"] == 0


def test_an_hr_contact_added_to_their_company_is_counted(db, college, officer, company):
    factories.make_hr_contact(db, company=company, created_at=MIDDAY_UTC)
    assert day_metrics(db, officer)["hr_contacts_added"] == 1


def test_a_contact_added_to_somebody_elses_company_is_not(db, college, officer):
    other = factories.make_company(db, college=college)
    factories.make_hr_contact(db, company=other, created_at=MIDDAY_UTC)
    assert day_metrics(db, officer)["hr_contacts_added"] == 0


def test_a_drive_running_today_is_counted(db, college, officer, company):
    factories.make_drive(db, college=college, company=company, drive_date=MIDDAY_UTC)
    assert day_metrics(db, officer)["drives_conducted"] == 1


def test_a_drive_set_up_today_is_counted_separately_from_one_running_today(db, college, officer, company):
    """Booking a drive and running it are different days' work."""
    factories.make_drive(
        db, college=college, company=company,
        drive_date=MIDDAY_UTC + timedelta(days=30), created_at=MIDDAY_UTC,
    )
    metrics = day_metrics(db, officer)
    assert metrics["drives_scheduled"] == 1
    assert metrics["drives_conducted"] == 0


def test_offers_today_are_counted_and_the_won_ones_marked(db, college, officer, company):
    drive = factories.make_drive(db, college=college, company=company)
    student = factories.make_student(db, college=college)
    db.add(
        Offer(student_id=student.id, drive_id=drive.id, company_id=company.id,
              status=OfferStatus.ACCEPTED, created_at=MIDDAY_UTC)
    )
    db.add(
        Offer(student_id=student.id, drive_id=drive.id, company_id=company.id,
              status=OfferStatus.REJECTED, created_at=MIDDAY_UTC)
    )
    db.flush()
    metrics = day_metrics(db, officer)
    assert metrics["offers"] == 2
    assert metrics["offers_won"] == 1


def test_an_officer_with_no_companies_gets_zeros_rather_than_an_error(db, college):
    """A newly-added officer files an update on their first morning."""
    fresh = factories.make_officer(db, college=college)
    metrics = day_metrics(db, fresh)
    assert metrics["companies_assigned"] == 0
    assert metrics["drives_conducted"] == 0


# --- where the officer stands -----------------------------------------------


def test_an_answered_followup_is_not_owed(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer,
        next_followup_date=datetime.utcnow() - timedelta(days=5),
        response_received="received",
    )
    assert day_metrics(db, officer)["overdue_followups"] == 0


def test_an_unanswered_overdue_followup_is_owed(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer,
        next_followup_date=datetime.utcnow() - timedelta(days=5),
    )
    metrics = day_metrics(db, officer)
    assert metrics["open_followups"] == 1
    assert metrics["overdue_followups"] == 1


def test_a_company_nobody_has_contacted_is_stale(db, college, officer, company):
    assert day_metrics(db, officer)["stale_companies"] == 1


def test_a_recently_contacted_company_is_not_stale(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer,
        communicated_at=datetime.utcnow() - timedelta(days=1),
    )
    assert day_metrics(db, officer)["stale_companies"] == 0


def test_staleness_counts_anybodys_contact_not_just_the_officers(db, college, officer, company, head):
    """It is a property of the relationship, not of who happened to call."""
    factories.log_communication(
        db, college=college, company=company, logged_by=head,
        communicated_at=datetime.utcnow() - timedelta(days=1),
    )
    assert day_metrics(db, officer)["stale_companies"] == 0


def test_a_company_untouched_past_the_threshold_is_stale(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer,
        communicated_at=datetime.utcnow() - timedelta(days=daily_metrics.STALE_AFTER_DAYS + 1),
    )
    assert day_metrics(db, officer)["stale_companies"] == 1


def test_targets_are_reported_with_progress(db, college):
    officer = factories.make_officer(db, college=college, target_companies=4, target_offers=10)
    for _ in range(2):
        company = factories.make_company(db, college=college)
        factories.assign_company(db, company=company, officer=officer)

    metrics = day_metrics(db, officer)
    assert metrics["target_companies"] == 4
    assert metrics["companies_assigned"] == 2
    assert metrics["target_companies_percent"] == 50


def test_progress_against_an_unset_target_reads_as_zero(db, college):
    """Documented rather than argued with. `_percent` says "no target set reads
    as 0", which keeps the tile a number rather than a blank - at the cost of
    an officer with no target looking like one who has achieved nothing. The
    raw counts sit beside it, so the ambiguity is visible rather than hidden."""
    officer = factories.make_officer(db, college=college, target_companies=0)
    metrics = day_metrics(db, officer)
    assert metrics["target_companies"] == 0
    assert metrics["target_companies_percent"] == 0


def test_progress_is_capped_at_a_hundred(db, college):
    """An officer holding triple their target reads as 100%, not 300% - the
    same reasoning the workload panel refuses a target comparison for."""
    officer = factories.make_officer(db, college=college, target_companies=1)
    for _ in range(3):
        company = factories.make_company(db, college=college)
        factories.assign_company(db, company=company, officer=officer)
    assert day_metrics(db, officer)["target_companies_percent"] == 100


# --- a coordinator's day ----------------------------------------------------


def test_a_coordinator_day_counts_training_not_outreach(db, college, head):
    """Their work is student readiness, so counting calls would report zero for
    somebody who had a full day."""
    module = factories.make_module(db, college=college, skills="Python")
    student = factories.make_student(db, college=college)
    factories.enrol(
        db, student=student, module=module, status="completed", completed_at=MIDDAY_UTC
    )

    metrics = coordinator_day_metrics(db, head, college.id, DAY)
    assert metrics["trainings_completed"] == 1


def test_enrolments_and_completions_are_counted_apart(db, college, head):
    module = factories.make_module(db, college=college)
    student = factories.make_student(db, college=college)
    factories.enrol(db, student=student, module=module, status="enrolled", created_at=MIDDAY_UTC)

    metrics = coordinator_day_metrics(db, head, college.id, DAY)
    assert metrics["trainings_enrolled"] == 1
    assert metrics["trainings_completed"] == 0


def test_a_module_added_today_is_counted(db, college, head):
    factories.make_module(db, college=college, created_at=MIDDAY_UTC)
    assert coordinator_day_metrics(db, head, college.id, DAY)["modules_added"] == 1


def test_students_at_risk_is_a_standing_count_not_a_daily_one(db, college, head):
    """It describes where the cohort is, so it is not bounded by the day."""
    student = factories.make_student(db, college=college)
    student.risk_category = RiskCategory.HIGH
    db.flush()
    assert coordinator_day_metrics(db, head, college.id, DAY)["students_at_risk"] == 1


def test_another_colleges_training_is_not_counted(db, college, other_college, head):
    module = factories.make_module(db, college=other_college)
    student = factories.make_student(db, college=other_college)
    factories.enrol(
        db, student=student, module=module, status="completed", completed_at=MIDDAY_UTC
    )
    assert coordinator_day_metrics(db, head, college.id, DAY)["trainings_completed"] == 0


# --- has_activity -----------------------------------------------------------


def test_a_day_with_nothing_logged_has_no_activity(db, college, officer):
    assert has_activity(day_metrics(db, officer)) is False


def test_a_day_with_one_call_has_activity(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer, communicated_at=MIDDAY_UTC
    )
    assert has_activity(day_metrics(db, officer)) is True


def test_standing_counts_alone_are_not_activity(db, college, officer, company):
    """Being owed three follow-ups is not something that happened today, and the
    digest's "filed but nothing moved" list depends on the difference."""
    factories.log_communication(
        db, college=college, company=company, officer=officer,
        next_followup_date=datetime.utcnow() - timedelta(days=3),
        communicated_at=MIDDAY_UTC - timedelta(days=10),
    )
    metrics = day_metrics(db, officer)
    assert metrics["overdue_followups"] == 1
    assert has_activity(metrics) is False


def test_no_metrics_at_all_is_not_activity(db):
    assert has_activity(None) is False
    assert has_activity({}) is False


# --- prompts ----------------------------------------------------------------


def test_an_officer_is_nudged_about_overdue_followups(db):
    prompts = build_prompts({"overdue_followups": 3}, "officer")
    assert any("3 follow-ups" in p and "past due" in p for p in prompts)


def test_the_nudge_reads_as_english_for_one(db):
    """These sit beside a form a person reads every evening."""
    prompts = build_prompts({"overdue_followups": 1}, "officer")
    assert any("1 follow-up is past due" in p for p in prompts)


def test_an_officer_with_nothing_logged_is_told_to_log_first(db):
    """The most useful nudge on the page: the update is meant to count work
    already recorded, so recording it is step one."""
    prompts = build_prompts({}, "officer")
    assert any("log them first" in p for p in prompts)


def test_a_busy_officer_is_not_told_they_did_nothing(db):
    prompts = build_prompts({"calls": 4}, "officer")
    assert not any("log them first" in p for p in prompts)


def test_a_coordinator_gets_their_own_prompts(db):
    prompts = build_prompts({"students_at_risk": 5}, "coordinator")
    assert any("5 students are flagged high-risk" in p for p in prompts)


def test_prompts_are_capped_so_they_are_read(db):
    """A wall of warnings gets ignored."""
    noisy = {"overdue_followups": 9, "stale_companies": 9}
    assert len(build_prompts(noisy, "officer")) <= 3


def test_a_clean_day_gets_no_prompts(db):
    assert build_prompts({"calls": 3, "overdue_followups": 0, "stale_companies": 0}, "officer") == []


# --- who files what ---------------------------------------------------------


def test_an_officer_with_a_card_files_an_officer_update(db, college, officer):
    assert filer_kind(officer.user, officer) == "officer"


def test_an_officer_account_with_no_card_files_nothing(db, college):
    """There would be nothing to attribute the work to - the same rule
    /analytics/my-work applies."""
    user = factories.make_user(db, college=college, role=UserRole.PLACEMENT_OFFICER)
    assert filer_kind(user, None) is None


def test_a_coordinator_files_a_coordinator_update(db, college):
    user = factories.make_user(db, college=college, role=UserRole.DEPARTMENT_COORDINATOR)
    assert filer_kind(user, None) == "coordinator"


@pytest.mark.parametrize(
    "role", [UserRole.PRO_CHANCELLOR, UserRole.PRINCIPAL, UserRole.SUPER_ADMIN, UserRole.STUDENT]
)
def test_nobody_else_files_a_daily_update(db, college, role):
    user = factories.make_user(db, college=college, role=role)
    assert filer_kind(user, None) is None


def test_metrics_for_dispatches_on_the_kind(db, college, officer, head):
    officer_metrics = metrics_for(db, officer.user, officer, "officer", DAY)
    coordinator_metrics = metrics_for(db, head, None, "coordinator", DAY)
    assert "companies_assigned" in officer_metrics
    assert "students_tracked" in coordinator_metrics


# --- the college-wide worry list --------------------------------------------


def test_an_overdue_followup_is_on_the_standing_list(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer,
        next_followup_date=datetime.utcnow() - timedelta(days=5),
    )
    assert standing_counts(db, college.id)["overdue_followups"] == 1


def test_an_answered_one_is_not(db, college, officer, company):
    factories.log_communication(
        db, college=college, company=company, officer=officer,
        next_followup_date=datetime.utcnow() - timedelta(days=5),
        response_received="received",
    )
    assert standing_counts(db, college.id)["overdue_followups"] == 0


def test_a_company_nobody_owns_is_on_the_list(db, college):
    factories.make_company(db, college=college)
    assert standing_counts(db, college.id)["unassigned_companies"] == 1


def test_an_assigned_company_is_not(db, college, officer, company):
    assert standing_counts(db, college.id)["unassigned_companies"] == 0


def test_a_blacklisted_company_is_nobodys_problem(db, college):
    """Not worth an owner, so counting it would make the backlog look permanent."""
    from app.models.company import CompanyStatus

    factories.make_company(db, college=college, status=CompanyStatus.BLACKLISTED)
    counts = standing_counts(db, college.id)
    assert counts["unassigned_companies"] == 0
    assert counts["stale_companies"] == 0


def test_a_lead_awaiting_review_is_on_the_list(db, college):
    factories.make_company(
        db, college=college, source="officer_lead", review_status="pending"
    )
    assert standing_counts(db, college.id)["pending_lead_reviews"] == 1


def test_another_colleges_worries_are_not_counted(db, college, other_college):
    factories.make_company(db, college=other_college)
    assert standing_counts(db, college.id)["unassigned_companies"] == 0


def test_an_empty_college_has_nothing_owed(db, college):
    assert standing_counts(db, college.id) == {
        "overdue_followups": 0,
        "stale_companies": 0,
        "pending_lead_reviews": 0,
        "unassigned_companies": 0,
    }


# --- shared thresholds ------------------------------------------------------


def test_the_stale_threshold_is_the_analytics_one(db):
    """Imported rather than restated, so the digest and the dashboards cannot
    disagree about what stale means."""
    from app.routers.analytics import STALE_AFTER_DAYS

    assert daily_metrics.STALE_AFTER_DAYS is STALE_AFTER_DAYS


def test_the_won_offer_statuses_are_the_analytics_ones(db):
    from app.routers.analytics import WON_OFFER_STATUSES

    assert daily_metrics.WON_OFFER_STATUSES is WON_OFFER_STATUSES
