"""Normalisation and identity: skills, job postings, invite links, addresses.

Small functions, but each one decides whether two things are "the same". Getting
that wrong is quiet and expensive - a duplicated posting is a card the
chancellor reads twice, and a skill that fails to match is a student left out of
a shortlist they qualified for.
"""

import pytest

from app.core.config import settings
from app.models.user import UserRole
from app.services import invites, job_scan, notifications, skills


class FakeUser:
    def __init__(self, role):
        self.role = role


# --- skills.normalise / split_skills ----------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Python", "python"),
        ("  Python  ", "python"),
        ("PYTHON", "python"),
        ("Machine  Learning", "machine learning"),
        ("\tData\nScience ", "data science"),
    ],
)
def test_normalise_collapses_case_and_spacing(raw, expected):
    """The same skill arrives typed three different ways from three officers."""
    assert skills.normalise(raw) == expected


def test_split_skills_reads_a_comma_separated_field():
    assert skills.split_skills("Python, Java, SQL") == ["python", "java", "sql"]


def test_split_skills_drops_duplicates():
    """Otherwise a student who listed Python twice gets two provenance rows for
    one skill."""
    assert skills.split_skills("Python, python, PYTHON ") == ["python"]


def test_split_skills_preserves_the_order_typed():
    """The free-text column is rebuilt from this, so reordering it would churn
    the field on every save."""
    assert skills.split_skills("Zebra, Apple, Mango") == ["zebra", "apple", "mango"]


@pytest.mark.parametrize("raw", [None, "", "   ", ",", ", ,"])
def test_an_empty_skills_field_yields_nothing(raw):
    assert skills.split_skills(raw) == []


def test_blank_entries_between_commas_are_skipped():
    assert skills.split_skills("Python,,Java, ,SQL") == ["python", "java", "sql"]


def test_labels_map_the_normalised_form_back_to_what_was_typed():
    """Stored lowercased for comparison, displayed as the officer wrote it."""
    assert skills._labels("Python, Machine Learning") == {
        "python": "Python",
        "machine learning": "Machine Learning",
    }


def test_the_first_spelling_typed_wins_as_the_label():
    assert skills._labels("Python, PYTHON")["python"] == "Python"


def test_labels_of_an_empty_field_is_empty():
    assert skills._labels(None) == {}


# --- job_scan._norm / _norm_role --------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Infosys Ltd.", "infosys ltd"),
        ("TATA  CONSULTANCY", "tata consultancy"),
        ("Acme, Inc.", "acme inc"),
        ("  Wipro  ", "wipro"),
        (None, ""),
        ("", ""),
        ("!!!", ""),
    ],
)
def test_norm_flattens_punctuation_and_case(raw, expected):
    assert job_scan._norm(raw) == expected


@pytest.mark.parametrize(
    "title",
    [
        "Software Engineer (Job 32817)",
        "Software Engineer (R-55817-2026)",
        "Software Engineer [REQ-10087679]",
        "Software Engineer REQ 10087679",
        "Software Engineer job 32817",
    ],
)
def test_requisition_numbers_are_stripped_from_a_role(title):
    """One source prints the requisition number and the next does not, which
    would otherwise make one opening look like two."""
    assert job_scan._norm_role(title) == "software engineer"


def test_a_bracket_without_a_digit_is_part_of_the_role():
    """"(Backend)" really is the role, and dropping it would merge the backend
    and frontend openings into one."""
    assert job_scan._norm_role("Software Engineer (Backend)") == "software engineer backend"


def test_a_missing_role_normalises_to_nothing():
    assert job_scan._norm_role(None) == ""


# --- job_scan.posting_key ---------------------------------------------------


def test_the_same_opening_from_two_sources_shares_a_key():
    """The whole point: one opening listed on the careers page and on three
    aggregators must be one card, not four."""
    a = job_scan.posting_key("HARMAN", "Software Intern", "https://harman.com/careers/1")
    b = job_scan.posting_key("Harman ", "software  intern", "https://naukri.com/job/99")
    assert a == b


def test_two_different_roles_at_one_employer_stay_apart():
    a = job_scan.posting_key("HARMAN", "Software Intern", "https://x")
    b = job_scan.posting_key("HARMAN", "Mechanical Intern", "https://x")
    assert a != b


def test_the_same_role_at_two_employers_stays_apart():
    a = job_scan.posting_key("HARMAN", "Software Intern", "https://x")
    b = job_scan.posting_key("Infosys", "Software Intern", "https://x")
    assert a != b


def test_the_url_is_not_part_of_the_key():
    """Stated as a property, because including it is the obvious-looking change
    that would quietly reintroduce the duplicates."""
    a = job_scan.posting_key("HARMAN", "Software Intern", "https://one.example")
    b = job_scan.posting_key("HARMAN", "Software Intern", "https://two.example")
    assert a == b


def test_a_posting_with_no_role_falls_back_to_its_link():
    """Nothing to match on, so the link is all that is left."""
    key = job_scan.posting_key("HARMAN", None, "https://harman.com/careers/1")
    assert key == "harman|url:https://harman.com/careers/1"


def test_two_untitled_postings_at_one_employer_are_told_apart_by_link():
    a = job_scan.posting_key("HARMAN", None, "https://one.example")
    b = job_scan.posting_key("HARMAN", None, "https://two.example")
    assert a != b


def test_a_key_stays_readable():
    """Deliberately not hashed - a key you can eyeball is worth more here than
    the bytes saved."""
    assert job_scan.posting_key("HARMAN", "Software Intern", None) == "harman|software intern"


def test_a_requisition_number_does_not_split_one_opening():
    a = job_scan.posting_key("HARMAN", "Software Intern (REQ-10087679)", "https://x")
    b = job_scan.posting_key("HARMAN", "Software Intern", "https://y")
    assert a == b


# --- invites ----------------------------------------------------------------


def test_a_token_hashes_consistently():
    assert invites.hash_token("abc") == invites.hash_token("abc")


def test_different_tokens_hash_differently():
    assert invites.hash_token("abc") != invites.hash_token("abd")


def test_the_raw_token_is_not_recoverable_from_the_hash():
    """Only the hash is stored, so a database leak must not yield live links."""
    raw = "a-secret-token"
    assert raw not in invites.hash_token(raw)


def test_the_hash_is_hex_sha256():
    digest = invites.hash_token("abc")
    assert len(digest) == 64
    assert set(digest) <= set("0123456789abcdef")


def test_students_get_the_longer_expiry_window():
    """Their logins are switched on in bulk, often well before an orientation
    session where anyone actually redeems the link."""
    student = invites.expiry_hours_for(FakeUser(UserRole.STUDENT))
    officer = invites.expiry_hours_for(FakeUser(UserRole.PLACEMENT_OFFICER))
    assert student == settings.STUDENT_INVITE_EXPIRY_HOURS
    assert officer == settings.INVITE_EXPIRY_HOURS
    assert student > officer


@pytest.mark.parametrize(
    "role",
    [UserRole.PRINCIPAL, UserRole.PRO_CHANCELLOR, UserRole.SUPER_ADMIN,
     UserRole.PLACEMENT_OFFICER, UserRole.DEPARTMENT_COORDINATOR],
)
def test_every_staff_role_gets_the_staff_window(role):
    assert invites.expiry_hours_for(FakeUser(role)) == settings.INVITE_EXPIRY_HOURS


def test_the_token_is_long_enough_that_guessing_is_not_a_threat():
    """The link stands in for a password, which is only defensible at this size."""
    assert invites._TOKEN_BYTES >= 32


# --- notifications ----------------------------------------------------------


def test_a_real_address_is_deliverable():
    assert notifications.is_deliverable("head@rit.edu") is True


def test_a_synthetic_student_address_is_not_deliverable():
    """Login-less student accounts carry an address nothing could ever reach.
    Sending there would look like a delivery failure rather than a design."""
    assert notifications.is_deliverable("1rv001@no-login.myplacement.app") is False


def test_the_undeliverable_check_ignores_case():
    assert notifications.is_deliverable("X@NO-LOGIN.MYPLACEMENT.APP") is False


@pytest.mark.parametrize("address", [None, "", "not-an-address", "  "])
def test_a_missing_or_malformed_address_is_not_deliverable(address):
    assert notifications.is_deliverable(address) is False


def test_email_is_disabled_without_a_provider_key():
    """conftest pins RESEND_API_KEY empty. Not an error - invites still mint
    links, and the admin shares them by hand."""
    assert notifications.email_enabled() is False


def test_sending_without_a_key_is_skipped_not_failed():
    """The distinction matters: SKIPPED is a configuration state, FAILED would
    put a vendor outage in the logs that never happened."""
    result = notifications.send_email("head@rit.edu", "subject", "<p>hi</p>", "hi")
    assert result == notifications.SKIPPED


def test_sending_to_an_undeliverable_address_is_skipped():
    result = notifications.send_email("x@no-login.myplacement.app", "s", "<p>h</p>", "h")
    assert result == notifications.SKIPPED


@pytest.mark.parametrize(
    ("hours", "expected"),
    [
        (24, "1 day"),
        (48, "2 days"),
        (168, "7 days"),
        (720, "30 days"),
        (1, "1 hour"),
        (6, "6 hours"),
        (36, "36 hours"),
    ],
)
def test_the_expiry_phrase_reads_like_english(hours, expected):
    """It goes into a message a person reads, so "1 days" would be visible."""
    assert notifications._expiry_phrase(hours) == expected
