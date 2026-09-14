"""app/services/allocation.py - proposing company owners.

This replaced a prompt that collapsed at real scale, and its whole value is that
it is deterministic: the same database must propose the same allocation twice,
and a head has to be able to read why. So the tests pin three families of
property rather than just arithmetic.

* **Importance** ranks companies. The trap here is free-text `mou_status`,
  where half the vocabulary records the *absence* of an agreement - crediting
  "Not started" as though it were signed is the bug NO_MOU exists to prevent.
* **Fit** ranks officers for one company, and must be outbid by workload once
  an officer has taken their share - that is what makes target_companies behave
  like the soft ceiling the feature promises.
* **Determinism**, because an unchanged database proposing a different answer
  on refresh destroys trust in the whole feature.

Companies and officers are stubbed: score_importance reads a handful of fields
and hr_contacts, none of which needs a session.
"""

from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.models.company import CompanyStatus
from app.services import allocation
from app.services.allocation import Importance, propose_allocations, score_fit, score_importance

TODAY = date(2026, 9, 12)


def contact(*, strength=None, followup_in_days=None):
    followup = None
    if followup_in_days is not None:
        followup = datetime(2026, 9, 12) + timedelta(days=followup_in_days)
    return SimpleNamespace(relationship_strength=strength, next_followup_date=followup)


def company(**kw):
    return SimpleNamespace(
        id=kw.pop("id", 1),
        name=kw.pop("name", "Acme"),
        status=kw.pop("status", CompanyStatus.NEW),
        mou_status=kw.pop("mou_status", None),
        previous_visit_count=kw.pop("previous_visit_count", 0),
        location=kw.pop("location", None),
        sector=kw.pop("sector", None),
        domain=kw.pop("domain", None),
        hr_contacts=kw.pop("hr_contacts", []),
        **kw,
    )


def officer(**kw):
    return SimpleNamespace(
        id=kw.pop("id", 1),
        region=kw.pop("region", None),
        sector_expertise=kw.pop("sector_expertise", None),
        target_companies=kw.pop("target_companies", 0),
        **kw,
    )


def score(**kw) -> int:
    return score_importance(company(**kw), TODAY).score


# --- token matching ---------------------------------------------------------


def test_noise_words_do_not_count_as_a_match():
    """Every company in the database is "India Pvt Ltd"; matching on that would
    make every officer a perfect fit for everything."""
    assert allocation._tokens("India Pvt Ltd") == set()


def test_single_characters_are_dropped():
    assert allocation._tokens("a b Bengaluru") == {"bengaluru"}


def test_tokens_are_lowercased_and_split_on_punctuation():
    assert allocation._tokens("Bengaluru, Karnataka") == {"bengaluru", "karnataka"}


def test_no_value_yields_no_tokens():
    assert allocation._tokens(None, "") == set()


def test_an_alias_bridges_loose_expertise_and_a_formal_sector():
    """Officers write "IT"; sectors are recorded as "Information Technology"."""
    assert allocation._shared_term(allocation._tokens("IT"), allocation._tokens("Information Technology"))


@pytest.mark.parametrize(
    ("expertise", "sector"),
    [
        ("BFSI", "Banking and Finance"),
        ("core", "Mechanical Manufacturing"),
        ("edtech", "Education Technology"),
        ("auto", "Automotive"),
        ("healthtech", "Healthcare"),
    ],
)
def test_the_alias_table_covers_the_sectors_a_cell_tracks(expertise, sector):
    assert allocation._shared_term(allocation._tokens(expertise), allocation._tokens(sector))


def test_unrelated_terms_do_not_match():
    assert allocation._shared_term(allocation._tokens("BFSI"), allocation._tokens("Mechanical")) is None


def test_the_reported_shared_term_is_stable():
    """It goes into the reasoning line, so a company with several matches must
    always report the same one or the text churns between runs."""
    left = allocation._tokens("Bengaluru Mysuru")
    right = allocation._tokens("Mysuru Bengaluru")
    assert allocation._shared_term(left, right) == allocation._shared_term(left, right)
    assert allocation._shared_term(left, right) == "bengaluru"


# --- importance: status and MOU ---------------------------------------------


def test_a_priority_company_outranks_an_active_one():
    assert score(status=CompanyStatus.PRIORITY) > score(status=CompanyStatus.ACTIVE)


def test_an_active_company_outranks_a_new_one():
    assert score(status=CompanyStatus.ACTIVE) > score(status=CompanyStatus.NEW)


@pytest.mark.parametrize("mou", ["signed", "Active", "RENEWED", "executed", "in force"])
def test_a_live_agreement_scores_fully(mou):
    assert score(mou_status=mou) == 15


@pytest.mark.parametrize(
    "mou",
    ["", "none", "No", "nil", "na", "n/a", "not signed", "Not started", "expired",
     "lapsed", "terminated", "cancelled", "rejected", "declined", None],
)
def test_words_recording_the_absence_of_an_mou_score_nothing(mou):
    """The bug NO_MOU exists to prevent: treating any non-empty mou_status as
    "has an MOU" credits "Terminated" as though it were a signature."""
    assert score(mou_status=mou) == 0


def test_an_agreement_under_negotiation_scores_between_the_two():
    """Worth an owner, worth less than a signature."""
    assert 0 < score(mou_status="in discussion") < score(mou_status="signed")


def test_the_mou_reason_quotes_the_status():
    reasons = score_importance(company(mou_status="signed"), TODAY).reasons
    assert any("MOU signed" in r for r in reasons)


# --- importance: visits and warmth ------------------------------------------


def test_previous_visits_raise_importance():
    assert score(previous_visit_count=3) > score(previous_visit_count=1) > score()


def test_the_visit_credit_is_capped():
    """A company that visited twenty times must not swamp every other signal."""
    assert score(previous_visit_count=5) == score(previous_visit_count=50)


def test_the_visit_reason_reads_as_english():
    """Published in the proposal a head reads, so "1 previous visits" shows."""
    assert "1 previous visit" in score_importance(company(previous_visit_count=1), TODAY).reasons
    assert "2 previous visits" in score_importance(company(previous_visit_count=2), TODAY).reasons


def test_a_warm_hr_contact_raises_importance():
    warm = score(hr_contacts=[contact(strength=5)])
    lukewarm = score(hr_contacts=[contact(strength=3)])
    cold = score(hr_contacts=[contact(strength=1)])
    assert warm > lukewarm > cold


def test_the_warmest_contact_is_the_one_that_counts():
    """One cold contact at a company with a strong champion must not drag it
    down - the best relationship is the one that will open the door."""
    assert score(hr_contacts=[contact(strength=1), contact(strength=5)]) == score(
        hr_contacts=[contact(strength=5)]
    )


def test_having_any_contact_at_all_is_worth_something():
    assert score(hr_contacts=[contact()]) > score(hr_contacts=[])


# --- importance: follow-up urgency ------------------------------------------


def test_an_overdue_followup_dominates():
    """The single largest signal, because it is the only one that is someone
    waiting on us right now."""
    assert score(hr_contacts=[contact(followup_in_days=-5)]) > score(
        hr_contacts=[contact(followup_in_days=3)]
    )


def test_followup_urgency_decays_with_distance():
    overdue = score(hr_contacts=[contact(followup_in_days=-1)])
    this_week = score(hr_contacts=[contact(followup_in_days=3)])
    this_month = score(hr_contacts=[contact(followup_in_days=20)])
    later = score(hr_contacts=[contact(followup_in_days=90)])
    assert overdue > this_week > this_month > later


def test_a_followup_due_today_is_not_yet_overdue():
    reasons = score_importance(company(hr_contacts=[contact(followup_in_days=0)]), TODAY).reasons
    assert not any("overdue" in r for r in reasons)


def test_the_soonest_followup_across_contacts_is_the_one_used():
    both = score(hr_contacts=[contact(followup_in_days=60), contact(followup_in_days=-5)])
    assert both == score(hr_contacts=[contact(followup_in_days=-5), contact(followup_in_days=60)])


def test_the_overdue_reason_names_the_number_of_days():
    reasons = score_importance(company(hr_contacts=[contact(followup_in_days=-5)]), TODAY).reasons
    assert "follow-up 5d overdue" in reasons


# --- priority bands ---------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [(100, "high"), (45, "high"), (44, "normal"), (18, "normal"), (17, "low"), (0, "low")],
)
def test_priority_bands(value, expected):
    assert Importance(score=value, reasons=()).priority == expected


# --- fit --------------------------------------------------------------------


def test_a_region_match_scores():
    fit, reasons = score_fit(company(location="Bengaluru"), officer(region="Bengaluru South"))
    assert fit == allocation.REGION_WEIGHT
    assert any("region match" in r for r in reasons)


def test_a_sector_match_scores():
    fit, reasons = score_fit(company(sector="Information Technology"), officer(sector_expertise="IT"))
    assert fit == allocation.SECTOR_WEIGHT
    assert any("sector fit" in r for r in reasons)


def test_the_domain_counts_as_well_as_the_sector():
    fit, _ = score_fit(company(sector=None, domain="Software"), officer(sector_expertise="IT"))
    assert fit == allocation.SECTOR_WEIGHT


def test_both_signals_add_up():
    fit, reasons = score_fit(
        company(location="Bengaluru", sector="Information Technology"),
        officer(region="Bengaluru", sector_expertise="IT"),
    )
    assert fit == allocation.REGION_WEIGHT + allocation.SECTOR_WEIGHT
    assert len(reasons) == 2


def test_no_signal_scores_nothing_rather_than_failing():
    assert score_fit(company(), officer()) == (0, [])


def test_a_region_name_is_title_cased_in_the_reason():
    """Read by a head; "bengaluru" would look like a bug."""
    _, reasons = score_fit(company(location="bengaluru"), officer(region="BENGALURU"))
    assert "region match (Bengaluru)" in reasons


def test_load_outweighs_a_perfect_fit():
    """The property that makes target_companies a real ceiling: a fully loaded
    officer is outbid even by a rival with no signal at all."""
    assert allocation.LOAD_WEIGHT > allocation.REGION_WEIGHT + allocation.SECTOR_WEIGHT


# --- batch shares -----------------------------------------------------------


def test_shares_split_evenly_when_nobody_has_a_target():
    """target_companies defaults to 0, which means "nobody set one", not "give
    this officer no work"."""
    shares = allocation._batch_shares([officer(id=1), officer(id=2)], 10)
    assert shares[1] == shares[2] == 5


def test_shares_follow_the_targets_that_are_set():
    shares = allocation._batch_shares(
        [officer(id=1, target_companies=30), officer(id=2, target_companies=10)], 8
    )
    assert shares[1] == pytest.approx(6.0)
    assert shares[2] == pytest.approx(2.0)


def test_an_officer_without_a_target_gets_the_average_of_those_set():
    """The scenario the docstring calls out: a head fills in one target and
    leaves the rest blank, and must not watch that person take the whole batch."""
    shares = allocation._batch_shares(
        [officer(id=1, target_companies=10), officer(id=2), officer(id=3)], 30
    )
    assert shares[1] == pytest.approx(shares[2]) == pytest.approx(shares[3])


def test_every_officer_keeps_a_share_of_at_least_one():
    """A zero share would divide by zero in the load penalty."""
    shares = allocation._batch_shares(
        [officer(id=1, target_companies=1000), officer(id=2, target_companies=1)], 4
    )
    assert all(v >= 1.0 for v in shares.values())


def test_a_negative_target_is_treated_as_unset():
    shares = allocation._batch_shares([officer(id=1, target_companies=-5), officer(id=2)], 10)
    assert shares[1] == shares[2]


# --- propose_allocations ----------------------------------------------------


def test_nothing_to_do_returns_no_proposals():
    assert propose_allocations([], [officer()], {}, 10, today=TODAY) == ([], 0)


def test_no_officers_means_no_proposals_but_still_counts_the_companies():
    """The head is told what the cut left out even when nobody can own it."""
    proposals, considered = propose_allocations([company()], [], {}, 10, today=TODAY)
    assert proposals == []
    assert considered == 1


def test_the_most_important_companies_are_allocated_first():
    important = company(id=1, status=CompanyStatus.PRIORITY, mou_status="signed")
    dull = company(id=2)
    proposals, considered = propose_allocations([dull, important], [officer()], {}, 1, today=TODAY)
    assert [p.company.id for p in proposals] == [1]
    assert considered == 2


def test_the_limit_caps_the_batch():
    companies = [company(id=i) for i in range(1, 11)]
    proposals, considered = propose_allocations(companies, [officer()], {}, 3, today=TODAY)
    assert len(proposals) == 3
    assert considered == 10


def test_work_is_spread_rather_than_piled_on_one_officer():
    companies = [company(id=i) for i in range(1, 7)]
    officers = [officer(id=1), officer(id=2)]
    proposals, _ = propose_allocations(companies, officers, {}, 6, today=TODAY)
    counts = {o.id: sum(1 for p in proposals if p.officer.id == o.id) for o in officers}
    assert counts == {1: 3, 2: 3}


def test_a_well_matched_officer_stops_absorbing_everything():
    """Even with a perfect region and sector match, the load penalty has to take
    over once they have had their share."""
    companies = [company(id=i, location="Bengaluru", sector="IT") for i in range(1, 7)]
    officers = [officer(id=1, region="Bengaluru", sector_expertise="IT"), officer(id=2)]
    proposals, _ = propose_allocations(companies, officers, {}, 6, today=TODAY)
    taken_by_matched = sum(1 for p in proposals if p.officer.id == 1)
    assert taken_by_matched < 6


def test_the_officer_carrying_a_backlog_is_not_handed_the_first_company():
    """active_counts carries in what earlier rounds left behind, so an officer
    already over the team average starts at a disadvantage."""
    companies = [company(id=i) for i in range(1, 5)]
    officers = [officer(id=1), officer(id=2)]
    proposals, _ = propose_allocations(companies, officers, {1: 20, 2: 0}, 4, today=TODAY)
    assert proposals[0].officer.id == 2


def test_an_existing_backlog_is_worked_off_not_compounded():
    """Over an odd batch the imbalance actually shifts a company across. On an
    even batch the per-batch share pulls it back to a level split, which is the
    intended behaviour - the backlog tilts the order, it does not starve anyone."""
    companies = [company(id=i) for i in range(1, 4)]
    officers = [officer(id=1), officer(id=2)]
    proposals, _ = propose_allocations(companies, officers, {1: 20, 2: 0}, 3, today=TODAY)
    assert sum(1 for p in proposals if p.officer.id == 2) > sum(
        1 for p in proposals if p.officer.id == 1
    )


def test_the_same_input_proposes_the_same_allocation_twice():
    """The headline promise over the prompt this replaced. A head who refreshes
    and sees a different answer will not trust any of it."""
    companies = [company(id=i) for i in range(1, 8)]
    officers = [officer(id=1), officer(id=2), officer(id=3)]
    first, _ = propose_allocations(companies, officers, {}, 7, today=TODAY)
    second, _ = propose_allocations(companies, officers, {}, 7, today=TODAY)
    assert [(p.company.id, p.officer.id) for p in first] == [
        (p.company.id, p.officer.id) for p in second
    ]


def test_ties_are_broken_by_company_id_so_ordering_is_stable():
    """Thousands of untouched companies all score identically."""
    companies = [company(id=i) for i in (5, 3, 9, 1)]
    proposals, _ = propose_allocations(companies, [officer()], {}, 4, today=TODAY)
    assert [p.company.id for p in proposals] == [1, 3, 5, 9]


def test_every_proposal_carries_a_priority_and_a_reason():
    proposals, _ = propose_allocations([company()], [officer()], {}, 1, today=TODAY)
    assert proposals[0].priority in {"high", "normal", "low"}
    assert proposals[0].reasoning.endswith(".")


def test_a_company_with_no_signal_says_so_rather_than_going_blank():
    proposals, _ = propose_allocations([company()], [officer()], {}, 1, today=TODAY)
    assert proposals[0].reasoning == "Balanced by workload - no region or sector signal."


def test_the_reason_keeps_proper_nouns_capitalised():
    """str.capitalize() would lower-case the rest and turn Bengaluru into
    bengaluru."""
    proposals, _ = propose_allocations(
        [company(location="Bengaluru")], [officer(region="Bengaluru")], {}, 1, today=TODAY
    )
    assert "Bengaluru" in proposals[0].reasoning


def test_a_reason_line_is_kept_short():
    """It sits in a table cell, so at most three clauses."""
    rich = company(
        status=CompanyStatus.PRIORITY,
        mou_status="signed",
        previous_visit_count=4,
        location="Bengaluru",
        sector="IT",
        hr_contacts=[contact(strength=5, followup_in_days=-3)],
    )
    proposals, _ = propose_allocations(
        [rich], [officer(region="Bengaluru", sector_expertise="IT")], {}, 1, today=TODAY
    )
    assert proposals[0].reasoning.count(";") <= 2


def test_a_negative_limit_allocates_nothing():
    proposals, considered = propose_allocations([company()], [officer()], {}, -1, today=TODAY)
    assert proposals == []
    assert considered == 1
