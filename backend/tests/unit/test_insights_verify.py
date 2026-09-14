"""app/services/insights.py - the guard on what the model is allowed to say.

This is the highest-stakes pure function in the codebase. A placement head reads
the narrative at the top of their dashboard as fact; if the model invents a
figure and `verify` waves it through, they act on a number nobody computed.

The contract is deliberately blunt: the narrative may quote only figures that
already appear in the findings, and one invented number discards the whole
narrative rather than the offending sentence.
"""

import pytest

from app.services import insights
from app.services.insights import Finding


def finding(headline: str, numbers: list | None = None, *, key: str = "k", severity: str = "watch"):
    return Finding(key=key, severity=severity, headline=headline, numbers=numbers or [])


# --- _numbers ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", set()),
        ("no figures here", set()),
        ("12 placements", {"12"}),
        ("12 placements and 3 offers", {"12", "3"}),
        ("a CGPA of 7.5", {"7.5"}),
        ("0 students", {"0"}),
    ],
)
def test_numbers_finds_the_figures(text, expected):
    assert insights._numbers(text) == expected


def test_thousands_separators_are_ignored():
    """So 1,240 in the prose matches 1240 in the finding rather than reading as
    two separate figures."""
    assert insights._numbers("1,240 students") == {"1240"}
    assert insights._numbers("1240 students") == {"1240"}


@pytest.mark.parametrize("written", ["7.5", "7.50", "7.500"])
def test_trailing_zeros_are_normalised_away(written):
    """The model writes 7.50 where the finding said 7.5. Same figure, and
    rejecting it would discard a correct narrative."""
    assert insights._numbers(f"average {written}") == {"7.5"}


def test_a_whole_number_written_as_a_decimal_normalises():
    assert insights._numbers("12.0 placements") == {"12"}


def test_a_year_is_a_figure_like_any_other():
    """The regression the allowed_numbers docstring records: a monthly headline
    names its month, and August 2026 put a year into the prose."""
    assert insights._numbers("August 2026") == {"2026"}


def test_digits_inside_words_still_count():
    """Being permissive here is the safe direction: a missed figure is a figure
    that goes unchecked."""
    assert insights._numbers("Q4 target") == {"4"}


# --- allowed_numbers --------------------------------------------------------


def test_figures_printed_in_a_headline_may_be_quoted_back():
    """They are already shown to the reader, so repeating one is not an
    invention - and deriving the set this way cannot drift from the findings."""
    allowed = insights.allowed_numbers([finding("12 students remain unplaced")])
    assert "12" in allowed


def test_the_numbers_list_is_honoured_on_top_of_the_headline():
    """For a figure a finding wants to permit without printing it."""
    allowed = insights.allowed_numbers([finding("most students are placed", numbers=[87])])
    assert "87" in allowed


def test_numbers_from_every_finding_are_pooled():
    allowed = insights.allowed_numbers(
        [finding("12 unplaced"), finding("3 drives this month")]
    )
    assert {"12", "3"} <= allowed


def test_a_month_name_in_a_headline_permits_its_year():
    """The exact case that used to throw away a correct write-up."""
    allowed = insights.allowed_numbers([finding("August 2026 closed with 6 placements")])
    assert {"2026", "6"} <= allowed


def test_no_findings_permits_no_figures():
    assert insights.allowed_numbers([]) == set()


def test_allowed_numbers_normalises_the_declared_list_too():
    """So a float 7.50 in numbers matches 7.5 in the prose."""
    assert "7.5" in insights.allowed_numbers([finding("average cgpa", numbers=[7.50])])


# --- verify -----------------------------------------------------------------


def test_a_narrative_quoting_only_supplied_figures_passes():
    findings = [finding("12 students remain unplaced")]
    ok, offending = insights.verify(["12 students still need attention."], findings)
    assert ok is True
    assert offending == set()


def test_a_narrative_with_no_figures_at_all_passes():
    """The prompt tells the model to use words for any quantity it was not
    given, so this is the expected shape of a careful answer."""
    ok, offending = insights.verify(["Two areas need attention."], [finding("12 unplaced")])
    assert ok is True


def test_an_invented_figure_fails():
    ok, offending = insights.verify(["Around 40 students need help."], [finding("12 unplaced")])
    assert ok is False
    assert offending == {"40"}


def test_a_derived_percentage_fails_when_it_is_a_new_figure():
    """12 of 100 is 12%, and the model was told not to derive. The check catches
    this whenever the derivation produces a figure nobody supplied."""
    findings = [finding("12 students remain unplaced of 100")]
    ok, offending = insights.verify(["That is 88% of the cohort."], findings)
    assert ok is False
    assert offending == {"88"}


def test_the_guard_matches_figures_not_units():
    """A known limitation, recorded rather than asserted away: verify compares
    digits, so "12%" passes on the strength of a finding that said "12
    students". The prompt forbids re-deriving, but this function cannot tell a
    count from a percentage that happens to share its digits.

    Tightening it would mean parsing units out of free-text headlines. Worth
    knowing when reading a narrative that passed."""
    ok, _ = insights.verify(["That is 12% of the cohort."], [finding("12 unplaced")])
    assert ok is True


def test_a_rounded_figure_fails():
    ok, offending = insights.verify(["Roughly 8 on average."], [finding("average cgpa 7.5")])
    assert ok is False
    assert offending == {"8"}


def test_every_offending_figure_is_reported():
    """The caller logs these, so one bad narrative should explain itself fully
    rather than naming the first problem only."""
    ok, offending = insights.verify(["40 students, 9 drives."], [finding("12 unplaced")])
    assert ok is False
    assert offending == {"40", "9"}


def test_all_paragraphs_are_checked_not_just_the_first():
    """An invention in the closing paragraph is exactly as damaging."""
    ok, offending = insights.verify(
        ["12 students remain unplaced.", "We expect 30 offers next month."],
        [finding("12 unplaced")],
    )
    assert ok is False
    assert offending == {"30"}


def test_an_empty_narrative_passes():
    assert insights.verify([], [finding("12 unplaced")]) == (True, set())


def test_a_narrative_with_figures_and_no_findings_fails():
    """Nothing was supplied, so nothing may be quoted."""
    ok, offending = insights.verify(["We placed 40 students."], [])
    assert ok is False
    assert offending == {"40"}


def test_formatting_differences_do_not_fail_a_correct_narrative():
    """1,240 against 1240, and 7.50 against 7.5 - same figures, differently
    typeset. Failing these would discard good narratives for no reason."""
    findings = [finding("1240 students, average cgpa 7.5")]
    ok, _ = insights.verify(["1,240 students with an average of 7.50."], findings)
    assert ok is True


# --- the formatters the headlines are built from ----------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [(12, "12"), (12.0, "12"), (7.5, "7.5"), (0, "0"), (0.0, "0")],
)
def test_fmt_drops_a_meaningless_decimal(value, expected):
    """Headlines are published verbatim when the model is unavailable, so
    "12.0 placements" would be read by a person."""
    assert insights._fmt(value) == expected


@pytest.mark.parametrize(
    ("count", "expected"),
    [(1, "follow-up"), (0, "follow-ups"), (2, "follow-ups")],
)
def test_plural_agrees_with_the_count(count, expected):
    assert insights._plural(count, "follow-up") == expected


def test_plural_accepts_an_irregular_form():
    assert insights._plural(2, "company", "companies") == "companies"
    assert insights._plural(1, "company", "companies") == "company"


@pytest.mark.parametrize(
    ("part", "whole", "expected"),
    [(12, 100, 12.0), (1, 3, 33.3), (0, 10, 0.0), (10, 10, 100.0)],
)
def test_pct(part, whole, expected):
    assert insights._pct(part, whole) == expected


def test_pct_of_nothing_is_none_rather_than_zero():
    """A cohort with no students has no percentage; showing 0% would assert
    something false about it."""
    assert insights._pct(0, 0) is None


def test_severity_order_puts_urgent_first():
    """Findings are sorted by this, and the narrative leads with what needs
    acting on."""
    assert insights.SEVERITY_ORDER["urgent"] < insights.SEVERITY_ORDER["watch"]
    assert insights.SEVERITY_ORDER["watch"] < insights.SEVERITY_ORDER["good"]


def test_the_prompt_names_the_college_and_lists_every_finding():
    prompt = insights.build_prompt("RIT", [finding("12 unplaced", severity="urgent")])
    assert "RIT" in prompt
    assert "12 unplaced" in prompt
    assert "urgent" in prompt
