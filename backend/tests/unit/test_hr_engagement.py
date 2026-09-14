"""app/services/hr_engagement.py - how likely is this contact to write back?

The score is a prediction, not a commendation, and several of its rules exist
specifically to stop it flattering a relationship. Those are the ones worth
pinning: None for a contact with no history (not zero), unresolved outreach kept
out of the denominator, and the staleness cap that stops a great record from
reading "warm" a year after anyone last spoke.

Communications are stubbed rather than built in the database: the function takes
any iterable of row-shaped objects, and every test here is about arithmetic.
"""

from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from app.services import hr_engagement as eng

NOW = datetime(2026, 9, 12, 12, 0)


def comm(*, days_ago: float = 1, response: str | None = None, followup: datetime | None = None):
    """One communication row, as much of it as the scorer reads."""
    return SimpleNamespace(
        communicated_at=NOW - timedelta(days=days_ago),
        response_received=response,
        next_followup_date=followup,
    )


def score(comms, now: datetime = NOW):
    return eng.score_contact(comms, now=now)


# --- no history -------------------------------------------------------------


def test_a_contact_with_no_communications_scores_none():
    """Not zero. Zero would rank a brand-new contact below one who has ignored
    us for a year - wrong, and demoralising to whoever just added them."""
    assert eng.score_contact([]) is None


def test_score_many_drops_contacts_with_no_history():
    """They render as "no history yet", so they must not appear as a score."""
    result = eng.score_many({1: [comm(response="received")], 2: []}, now=NOW)
    assert set(result) == {1}


def test_score_many_agrees_with_scoring_one_at_a_time():
    rows = [comm(days_ago=3, response="received"), comm(days_ago=10)]
    assert eng.score_many({7: rows}, now=NOW)[7] == score(rows)


# --- _recency_factor --------------------------------------------------------


def test_a_reply_today_is_full_recency():
    assert eng._recency_factor(0) == 1.0


def test_recency_decays_linearly_to_the_stale_horizon():
    assert eng._recency_factor(eng.STALE_DAYS / 2) == pytest.approx(0.5)


def test_recency_is_zero_past_the_horizon():
    assert eng._recency_factor(eng.STALE_DAYS) == 0.0
    assert eng._recency_factor(eng.STALE_DAYS * 5) == 0.0


def test_no_reply_at_all_is_zero_recency():
    assert eng._recency_factor(None) == 0.0


# --- responsiveness ---------------------------------------------------------


def test_replying_to_everything_is_full_responsiveness():
    result = score([comm(response="received"), comm(days_ago=20, response="received")])
    assert result["components"]["responsiveness"] == 100


def test_ignoring_everything_is_zero_responsiveness():
    result = score([comm(response="no_response"), comm(days_ago=20, response="no_response")])
    assert result["components"]["responsiveness"] == 0


def test_awaited_outreach_is_left_out_of_the_denominator():
    """An unanswered mail from this morning is not yet evidence of anything.
    Counting it would make logging a message drop the score of a contact who
    has done nothing wrong."""
    settled = [comm(days_ago=5, response="received"), comm(days_ago=6, response="no_response")]
    with_pending = settled + [comm(days_ago=0), comm(days_ago=0)]
    assert score(settled)["components"]["responsiveness"] == 50
    assert score(with_pending)["components"]["responsiveness"] == 50


def test_nothing_resolved_yet_scores_the_half_we_know():
    """Contact was made; silence has not yet become refusal."""
    result = score([comm(days_ago=1), comm(days_ago=2)])
    assert result["components"]["responsiveness"] == 50


def test_awaited_count_is_reported():
    result = score([comm(response="received"), comm(days_ago=0), comm(days_ago=0)])
    assert result["total_logged"] == 3
    assert result["replied"] == 1
    assert result["awaited"] == 2


def test_an_unknown_response_value_counts_as_neither():
    """The vocabulary is written by the router; anything else is no answer
    either way rather than a crash."""
    result = score([comm(response="maybe?"), comm(days_ago=2, response="received")])
    assert result["components"]["responsiveness"] == 100
    assert result["awaited"] == 1


# --- consistency ------------------------------------------------------------


def test_one_flurry_scores_worse_than_steady_contact():
    """Six mails in a week and six mails over six months both total six. They
    describe very different relationships."""
    flurry = [comm(days_ago=d, response="received") for d in (1, 2, 3, 4, 5, 6)]
    steady = [comm(days_ago=d * 30, response="received") for d in range(6)]
    assert score(steady)["components"]["consistency"] > score(flurry)["components"]["consistency"]


def test_consistency_counts_distinct_months_inside_the_window():
    steady = [comm(days_ago=d * 30, response="received") for d in range(6)]
    assert score(steady)["components"]["consistency"] == 100


def test_communications_older_than_the_window_do_not_count_for_consistency():
    rows = [comm(days_ago=5, response="received"), comm(days_ago=400, response="received")]
    # Only the recent one falls inside six months: 1 of 6 months touched.
    assert score(rows)["components"]["consistency"] == 17


# --- reliability ------------------------------------------------------------


def test_no_promised_followups_is_full_reliability():
    """Scoring us, not them: having promised nothing is not a failure."""
    assert score([comm(response="received")])["components"]["reliability"] == 100


def test_a_kept_followup_date_in_the_future_is_not_overdue():
    rows = [comm(days_ago=1, followup=NOW + timedelta(days=3))]
    assert score(rows)["components"]["reliability"] == 100
    assert score(rows)["overdue_followups"] == 0


def test_a_lapsed_followup_costs_reliability():
    rows = [comm(days_ago=30, followup=NOW - timedelta(days=10))]
    assert score(rows)["components"]["reliability"] == 0
    assert score(rows)["overdue_followups"] == 1


def test_a_followup_due_today_is_not_yet_late():
    """A promise is broken once its day has passed, not from midnight on the
    morning it is due - the rule timeutil.overdue_before exists to enforce."""
    today_midnight = datetime(NOW.year, NOW.month, NOW.day)
    rows = [comm(days_ago=30, followup=today_midnight)]
    assert score(rows)["overdue_followups"] == 0


def test_a_followup_is_forgiven_once_they_replied():
    """If the contact answered, the promised chase is moot."""
    rows = [comm(days_ago=30, response="received", followup=NOW - timedelta(days=10))]
    assert score(rows)["overdue_followups"] == 0
    assert score(rows)["components"]["reliability"] == 100


def test_reliability_is_the_share_of_promises_kept():
    rows = [
        comm(days_ago=30, followup=NOW - timedelta(days=10)),
        comm(days_ago=29, followup=NOW + timedelta(days=10)),
    ]
    assert score(rows)["components"]["reliability"] == 50


# --- the staleness cap ------------------------------------------------------


def test_a_perfect_but_abandoned_relationship_cannot_read_warm():
    """The rule the docstring argues for. Responsiveness is a ratio with no
    sense of time, so without the cap a contact who answered everything a year
    ago still scores warm on the strength of that history."""
    rows = [comm(days_ago=400, response="received"), comm(days_ago=420, response="received")]
    result = score(rows)
    assert result["stale"] is True
    assert result["band"] != "warm"
    assert result["score"] < 50


def test_recent_contact_is_not_stale():
    result = score([comm(days_ago=3, response="received")])
    assert result["stale"] is False


def test_the_cap_only_lowers_a_score():
    """min(), not an assignment - a bad stale score must not be raised to 49."""
    rows = [comm(days_ago=400, response="no_response")]
    assert score(rows)["score"] <= 49


def test_days_since_contact_is_reported_for_the_ui():
    result = score([comm(days_ago=10, response="received")])
    assert result["days_since_contact"] == 10
    assert result["days_since_reply"] == 10


# --- bands ------------------------------------------------------------------


def test_a_responsive_contact_lands_in_the_top_band():
    rows = [comm(days_ago=d * 25, response="received") for d in range(6)]
    result = score(rows)
    assert result["band"] == "responsive"
    assert result["score"] >= 75


def test_a_contact_who_never_replies_is_cold():
    rows = [comm(days_ago=d, response="no_response") for d in (1, 2, 3)]
    assert score(rows)["band"] == "cold"


@pytest.mark.parametrize(
    ("value", "expected"),
    [(100, "responsive"), (75, "responsive"), (74, "warm"), (50, "warm"),
     (49, "slow"), (25, "slow"), (24, "cold"), (0, "cold")],
)
def test_band_thresholds(value, expected):
    assert next(name for floor, name in eng.BANDS if value >= floor) == expected


# --- shape ------------------------------------------------------------------


def test_the_weights_sum_to_one_hundred():
    """Otherwise the score is not on the 0-100 scale the bands assume."""
    assert sum(eng.WEIGHTS.values()) == 100


def test_components_are_returned_so_the_ui_can_explain_the_number():
    result = score([comm(response="received")])
    assert set(result["components"]) == set(eng.WEIGHTS)
    assert all(0 <= v <= 100 for v in result["components"].values())


def test_the_score_stays_on_a_nought_to_hundred_scale():
    cases = [
        [comm(response="received")],
        [comm(days_ago=400, response="no_response", followup=NOW - timedelta(days=390))],
        [comm(days_ago=d, response="received") for d in range(1, 40)],
    ]
    for rows in cases:
        assert 0 <= score(rows)["score"] <= 100


def test_rows_with_no_timestamp_do_not_crash_the_scorer():
    """communicated_at is nullable, and an import can leave it blank."""
    rows = [SimpleNamespace(communicated_at=None, response_received="received", next_followup_date=None)]
    result = score(rows)
    assert result["last_contacted_at"] is None
    assert result["stale"] is True
