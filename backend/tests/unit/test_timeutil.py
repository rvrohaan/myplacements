"""app/core/timeutil.py - converting local questions into naive-UTC bounds.

Everything here is stored as naive UTC, but "today", "before the cutoff" and
"which day does this digest cover" are questions about the college's own clock.
In IST that is a 5h30m shift, so a local day starts at 18:30 UTC the evening
before - which is exactly the kind of off-by-one these tests exist to pin.
"""

from datetime import date, datetime, time, timedelta, timezone

import pytest
from freezegun import freeze_time

from app.core import timeutil

IST = timeutil.LOCAL_TZ


def test_the_suite_runs_in_ist():
    """Every expectation below is written for Asia/Kolkata, and conftest pins
    it. If the zone were silently UTC (no tzdata), the shifts would all be zero
    and these tests would pass while proving nothing."""
    assert IST.utcoffset(datetime(2026, 9, 12)) == timedelta(hours=5, minutes=30)


# --- day_bounds_utc ---------------------------------------------------------


def test_day_bounds_span_the_local_day_not_the_utc_one():
    start, end = timeutil.day_bounds_utc(date(2026, 9, 12))
    assert start == datetime(2026, 9, 11, 18, 30)
    assert end == datetime(2026, 9, 12, 18, 30)


def test_day_bounds_are_naive():
    """They are compared against stored columns, which carry no tzinfo. An
    aware value here would raise on comparison."""
    start, end = timeutil.day_bounds_utc(date(2026, 9, 12))
    assert start.tzinfo is None and end.tzinfo is None


def test_day_bounds_are_half_open():
    """One day's end must be the next day's start exactly, or a row lands in
    both days or neither."""
    _, end = timeutil.day_bounds_utc(date(2026, 9, 12))
    next_start, _ = timeutil.day_bounds_utc(date(2026, 9, 13))
    assert end == next_start


def test_day_bounds_cover_exactly_24_hours():
    start, end = timeutil.day_bounds_utc(date(2026, 9, 12))
    assert end - start == timedelta(days=1)


def test_a_late_evening_utc_timestamp_belongs_to_the_next_local_day():
    """22:00 UTC on the 11th is 03:30 IST on the 12th. Filing it against the
    UTC date would put it on the wrong day's digest."""
    stamp = datetime(2026, 9, 11, 22, 0)
    start, end = timeutil.day_bounds_utc(date(2026, 9, 12))
    assert start <= stamp < end


# --- to_local / to_naive_utc ------------------------------------------------


def test_to_local_reads_a_stored_timestamp_on_the_local_clock():
    assert timeutil.to_local(datetime(2026, 9, 12, 12, 0)) == datetime(
        2026, 9, 12, 17, 30, tzinfo=IST
    )


def test_to_local_passes_none_through():
    """Nullable columns go through here; None must not become 1970."""
    assert timeutil.to_local(None) is None


def test_to_local_respects_an_already_aware_value():
    aware = datetime(2026, 9, 12, 12, 0, tzinfo=timezone.utc)
    assert timeutil.to_local(aware) == datetime(2026, 9, 12, 17, 30, tzinfo=IST)


def test_to_naive_utc_strips_the_zone_after_converting():
    local = datetime(2026, 9, 12, 17, 30, tzinfo=IST)
    result = timeutil.to_naive_utc(local)
    assert result == datetime(2026, 9, 12, 12, 0)
    assert result.tzinfo is None


def test_local_and_utc_conversions_round_trip():
    original = datetime(2026, 9, 12, 6, 45)
    assert timeutil.to_naive_utc(timeutil.to_local(original)) == original


# --- parse_cutoff -----------------------------------------------------------


def test_parse_cutoff_reads_hh_mm_on_the_local_clock():
    assert timeutil.parse_cutoff("19:00", date(2026, 9, 12)) == datetime(
        2026, 9, 12, 19, 0, tzinfo=IST
    )


def test_parse_cutoff_accepts_a_bare_hour():
    assert timeutil.parse_cutoff("18", date(2026, 9, 12)) == datetime(
        2026, 9, 12, 18, 0, tzinfo=IST
    )


@pytest.mark.parametrize(
    "raw",
    [None, "", "   ", "garbage", "25:00", "19:99", "seven pm", ":", "-1:00"],
    ids=["none", "empty", "blank", "words", "hour-25", "minute-99", "prose", "colon", "negative"],
)
def test_a_bad_cutoff_falls_back_rather_than_raising(raw):
    """A mistyped college setting must degrade to the default, not take the
    whole daily-update feature down."""
    assert timeutil.parse_cutoff(raw, date(2026, 9, 12)) == datetime(
        2026, 9, 12, 19, 0, tzinfo=IST
    )


def test_the_default_cutoff_is_seven_pm():
    assert timeutil.DEFAULT_CUTOFF == "19:00"


# --- is_past_cutoff ---------------------------------------------------------


def test_before_the_cutoff_is_not_late():
    at = datetime(2026, 9, 12, 18, 59, tzinfo=IST)
    assert timeutil.is_past_cutoff("19:00", date(2026, 9, 12), at=at) is False


def test_after_the_cutoff_is_late():
    at = datetime(2026, 9, 12, 19, 1, tzinfo=IST)
    assert timeutil.is_past_cutoff("19:00", date(2026, 9, 12), at=at) is True


def test_exactly_on_the_cutoff_is_not_late():
    """The comparison is strict (>), so filing on the minute counts as on time."""
    at = datetime(2026, 9, 12, 19, 0, tzinfo=IST)
    assert timeutil.is_past_cutoff("19:00", date(2026, 9, 12), at=at) is False


@freeze_time("2026-09-12 14:00:00")  # 19:30 IST
def test_is_past_cutoff_uses_the_local_clock_when_no_time_is_given():
    assert timeutil.is_past_cutoff("19:00", date(2026, 9, 12)) is True


# --- overdue_before ---------------------------------------------------------


def test_overdue_before_is_local_midnight_of_that_date():
    assert timeutil.overdue_before(date(2026, 9, 20)) == datetime(2026, 9, 20, 0, 0)


def test_overdue_before_is_naive():
    assert timeutil.overdue_before(date(2026, 9, 20)).tzinfo is None


def test_overdue_before_does_not_apply_the_timezone_shift():
    """The regression this function documents. next_followup_date is a *day*
    from a date input, stored as naive local midnight - never a UTC instant.
    Running it through day_bounds_utc would make every age read a day short."""
    day = date(2026, 9, 20)
    assert timeutil.overdue_before(day) != timeutil.day_bounds_utc(day)[0]
    assert timeutil.overdue_before(day) == datetime.combine(day, time.min)


def test_a_followup_due_today_is_not_yet_overdue():
    """Stored as today 00:00. It must not read as overdue from one minute past
    midnight on the morning it is due."""
    today = date(2026, 9, 20)
    due_today = datetime.combine(today, time.min)
    assert not (due_today < timeutil.overdue_before(today))


def test_a_followup_due_yesterday_is_overdue():
    today = date(2026, 9, 20)
    due_yesterday = datetime.combine(today - timedelta(days=1), time.min)
    assert due_yesterday < timeutil.overdue_before(today)


@freeze_time("2026-09-12 19:00:00")  # 00:30 IST on the 13th
def test_overdue_before_defaults_to_the_local_today():
    assert timeutil.overdue_before() == datetime(2026, 9, 13, 0, 0)


# --- local_today ------------------------------------------------------------


@freeze_time("2026-09-12 19:00:00")
def test_local_today_can_differ_from_the_utc_date():
    """19:00 UTC is already tomorrow in IST. Using the UTC date here would file
    an evening update against yesterday."""
    assert datetime.utcnow().date() == date(2026, 9, 12)
    assert timeutil.local_today() == date(2026, 9, 13)


@freeze_time("2026-09-12 10:00:00")
def test_local_today_matches_utc_during_the_working_day():
    assert timeutil.local_today() == date(2026, 9, 12)
