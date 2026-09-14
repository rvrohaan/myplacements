"""app/services/monthly.py - the month a report is about.

Period arithmetic done with timedelta rather than a calendar library, so the
edges worth checking are the ones where month lengths disagree: January from
March, a leap February, and December rolling into the next year.
"""

from datetime import datetime

import pytest

from app.services import insights, monthly
from app.services.insights import Finding, _numbers


# --- month_key --------------------------------------------------------------


def test_month_key_is_year_dash_month():
    assert monthly.month_key(datetime(2026, 9, 12)) == "2026-09"


def test_month_key_pads_a_single_digit_month():
    """So keys sort lexicographically, which several callers rely on."""
    assert monthly.month_key(datetime(2026, 1, 5)) == "2026-01"


def test_keys_sort_chronologically_as_strings():
    keys = [monthly.month_key(datetime(2026, m, 1)) for m in (12, 1, 9)]
    assert sorted(keys) == ["2026-01", "2026-09", "2026-12"]


# --- last_complete_month ----------------------------------------------------


def test_the_previous_month_is_the_one_a_report_can_cover():
    assert monthly.last_complete_month(datetime(2026, 9, 12)) == "2026-08"


def test_last_complete_month_on_the_first_of_the_month():
    """The boundary the `.replace(day=1)` exists for: on 1 September the last
    complete month is still August, not September."""
    assert monthly.last_complete_month(datetime(2026, 9, 1, 0, 0)) == "2026-08"


def test_last_complete_month_rolls_back_across_new_year():
    assert monthly.last_complete_month(datetime(2026, 1, 15)) == "2025-12"


def test_last_complete_month_after_a_short_february():
    """March back to February is where day-arithmetic goes wrong if the day is
    not pinned to the first."""
    assert monthly.last_complete_month(datetime(2026, 3, 31)) == "2026-02"


def test_last_complete_month_after_a_leap_february():
    assert monthly.last_complete_month(datetime(2024, 3, 15)) == "2024-02"


# --- recent_months ----------------------------------------------------------


def test_recent_months_starts_with_the_current_month():
    """The picker offers the month in progress - a head does want to look at it,
    they just cannot call it finished."""
    months = monthly.recent_months(3, today=datetime(2026, 9, 12))
    assert months[0]["key"] == "2026-09"


def test_recent_months_runs_newest_first():
    months = monthly.recent_months(3, today=datetime(2026, 9, 12))
    assert [m["key"] for m in months] == ["2026-09", "2026-08", "2026-07"]


def test_recent_months_returns_the_count_asked_for():
    assert len(monthly.recent_months(12, today=datetime(2026, 9, 12))) == 12


def test_recent_months_crosses_the_year_boundary():
    months = monthly.recent_months(3, today=datetime(2026, 1, 15))
    assert [m["key"] for m in months] == ["2026-01", "2025-12", "2025-11"]


def test_recent_months_steps_through_short_months_cleanly():
    """Twelve months back from 31 March must not skip February."""
    keys = [m["key"] for m in monthly.recent_months(13, today=datetime(2026, 3, 31))]
    assert keys[0] == "2026-03"
    assert "2026-02" in keys
    assert len(set(keys)) == 13


def test_recent_months_carries_a_human_label():
    months = monthly.recent_months(1, today=datetime(2026, 9, 12))
    assert months[0]["label"] == "September 2026"


# --- bounds -----------------------------------------------------------------


def test_bounds_span_the_whole_month():
    start, end = monthly.bounds("2026-09")
    assert start == datetime(2026, 9, 1)
    assert end == datetime(2026, 10, 1)


def test_bounds_are_half_open():
    """An event at midnight on the first belongs to the new month, not to both.
    The +32 days then .replace(day=1) trick exists for exactly this."""
    _, september_end = monthly.bounds("2026-09")
    october_start, _ = monthly.bounds("2026-10")
    assert september_end == october_start


@pytest.mark.parametrize(
    ("key", "expected_end"),
    [
        ("2026-01", datetime(2026, 2, 1)),
        ("2026-02", datetime(2026, 3, 1)),
        ("2024-02", datetime(2024, 3, 1)),
        ("2026-12", datetime(2027, 1, 1)),
    ],
    ids=["31-day", "28-day", "leap-29-day", "december-rollover"],
)
def test_bounds_handle_every_month_length(key, expected_end):
    """The +32 days must land inside the next month for a 31-day month and
    still land there for February - both directions of the same off-by-one."""
    assert monthly.bounds(key)[1] == expected_end


def test_a_malformed_key_raises_rather_than_guessing():
    """These come from a query string; a silent fallback would report on the
    wrong month without saying so."""
    with pytest.raises(ValueError):
        monthly.bounds("not-a-month")


# --- label / is_current -----------------------------------------------------


def test_label_is_the_month_in_words():
    assert monthly.label("2026-09") == "September 2026"


def test_the_month_in_progress_is_current():
    assert monthly.is_current("2026-09", today=datetime(2026, 9, 12)) is True


def test_a_finished_month_is_not_current():
    assert monthly.is_current("2026-08", today=datetime(2026, 9, 12)) is False


def test_a_future_month_is_not_current():
    assert monthly.is_current("2026-10", today=datetime(2026, 9, 12)) is False


# --- _delta_phrase ----------------------------------------------------------
# These strings are published verbatim when the model is unavailable, so they
# have to read like English, and the figures they are allowed to use must match
# what they actually print (insights.verify checks exactly that).


def test_a_rise_reads_as_up_from():
    phrase, numbers = monthly._delta_phrase(6, 2, "placement")
    assert phrase == "6 placements, up from 2 the month before"
    assert set(numbers) == {"6", "2"}


def test_a_fall_reads_as_down_from():
    phrase, _ = monthly._delta_phrase(2, 6, "placement")
    assert phrase == "2 placements, down from 6 the month before"


def test_no_change_says_so_rather_than_up_from_the_same_number():
    phrase, numbers = monthly._delta_phrase(4, 4, "placement")
    assert phrase == "4 placements, unchanged from the month before"
    assert numbers == ["4"]


def test_the_noun_agrees_with_the_count():
    phrase, _ = monthly._delta_phrase(1, 0, "placement")
    assert phrase.startswith("1 placement,")


def test_a_drop_to_zero_is_phrased_normally():
    phrase, _ = monthly._delta_phrase(0, 5, "drive")
    assert phrase == "0 drives, down from 5 the month before"


@pytest.mark.parametrize(("now", "before"), [(6, 2), (2, 6), (4, 4), (0, 5), (1, 0)])
def test_the_declared_numbers_cover_every_figure_in_the_phrase(now, before):
    """The contract insights.verify enforces. The phrase is published as a
    finding headline, and the returned list is what the narrative may quote. If
    the phrase printed a figure the list omitted, an honest quote of it would
    read as an invention and the whole write-up would be discarded."""
    phrase, numbers = monthly._delta_phrase(now, before, "placement")
    declared = set()
    for value in numbers:
        declared |= _numbers(str(value))
    assert _numbers(phrase) <= declared


def test_a_delta_phrase_survives_the_narrative_check():
    """End to end through the real guard, since that is where it matters."""
    phrase, numbers = monthly._delta_phrase(6, 2, "placement")
    findings = [Finding(key="k", severity="watch", headline=phrase, numbers=numbers)]
    assert insights.verify([f"We recorded {phrase}."], findings) == (True, set())


def test_won_counts_only_settled_offers():
    """Imported from the offer model rather than restated, so the monthly report
    and the analytics tiles cannot drift apart."""
    from app.models.offer import OfferStatus

    assert set(monthly.WON) == {OfferStatus.ACCEPTED, OfferStatus.JOINED}
