"""app/services/ai_service.py - reading model output.

Everything here parses text the model wrote, which makes it untrusted input: it
is not a protocol, it is a suggestion. Two of these functions exist because of
production failures the comments record - `_response_text` after a thinking
block broke student matching on Sonnet 5, and `_parse_lead_json` after
inter-tool commentary got mistaken for the answer - so those cases are pinned
first.

No network: nothing here calls a model. The blocks are stubbed in the shape the
SDK returns them.
"""

import json
from datetime import date
from types import SimpleNamespace

import pytest

from app.services import ai_service


def text_block(text: str):
    return SimpleNamespace(type="text", text=text)


def thinking_block(thinking: str = "let me think"):
    """What extended thinking puts in front of the answer."""
    return SimpleNamespace(type="thinking", thinking=thinking)


def reply(*blocks):
    return SimpleNamespace(content=list(blocks))


# --- _extract_json ----------------------------------------------------------


def test_plain_json_parses():
    assert ai_service._extract_json('{"a": 1}') == {"a": 1}


def test_a_json_array_parses():
    assert ai_service._extract_json("[1, 2, 3]") == [1, 2, 3]


def test_a_markdown_fence_is_stripped():
    """Models add these unprompted however firmly the prompt says not to."""
    assert ai_service._extract_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_an_unlabelled_fence_is_stripped():
    assert ai_service._extract_json('```\n{"a": 1}\n```') == {"a": 1}


def test_surrounding_prose_is_ignored():
    raw = 'Here is what I found:\n{"a": 1}\nHope that helps!'
    assert ai_service._extract_json(raw) == {"a": 1}


def test_json_spanning_several_lines_parses():
    assert ai_service._extract_json('{\n  "a": 1,\n  "b": [2, 3]\n}') == {"a": 1, "b": [2, 3]}


def test_nested_structures_survive_the_greedy_match():
    """The regex is greedy to the last bracket, which is what makes nesting
    work - a lazy match would stop at the first inner brace."""
    raw = '{"outer": {"inner": [1, 2]}}'
    assert ai_service._extract_json(raw) == {"outer": {"inner": [1, 2]}}


def test_no_json_at_all_raises_valueerror():
    """Callers catch ValueError specifically; anything else escapes as a 500."""
    with pytest.raises(ValueError):
        ai_service._extract_json("I could not answer that.")


def test_an_empty_response_raises_valueerror():
    with pytest.raises(ValueError):
        ai_service._extract_json("")


def test_malformed_json_raises_rather_than_returning_junk():
    """JSONDecodeError is a subclass of ValueError, so callers already handle it."""
    with pytest.raises(ValueError):
        ai_service._extract_json('{"a": }')


# --- _text_blocks / _response_text ------------------------------------------


def test_a_single_text_block_reads_as_itself():
    assert ai_service._response_text(reply(text_block("hello"))) == "hello"


def test_a_thinking_block_before_the_answer_is_skipped():
    """The regression this function exists for. Indexing content[0].text raises
    AttributeError once the model starts with a ThinkingBlock, which is what
    broke student matching on the move to Sonnet 5."""
    message = reply(thinking_block(), text_block("the answer"))
    assert ai_service._response_text(message) == "the answer"


def test_several_text_blocks_are_joined():
    message = reply(text_block("first"), text_block("second"))
    assert ai_service._response_text(message) == "first\nsecond"


def test_empty_text_blocks_are_dropped():
    """An empty block would otherwise contribute a blank line that changes the
    string a caller then parses."""
    message = reply(text_block("real"), text_block(""))
    assert ai_service._response_text(message) == "real"


def test_a_reply_with_no_text_at_all_is_the_empty_string():
    """Not a crash: a tool-only turn is a legitimate reply."""
    assert ai_service._response_text(reply(thinking_block())) == ""


def test_blocks_without_a_type_are_ignored():
    """getattr with a default, so an unfamiliar block from a newer SDK is
    skipped rather than raising."""
    odd = SimpleNamespace(text="sneaky")
    assert ai_service._text_blocks([odd, text_block("real")]) == ["real"]


# --- _parse_lead_json -------------------------------------------------------


def test_a_lead_array_is_read():
    message = reply(text_block('[{"company_name": "Acme"}]'))
    assert ai_service._parse_lead_json(message.content) == [{"company_name": "Acme"}]


def test_a_leads_object_is_unwrapped():
    message = reply(text_block('{"leads": [{"company_name": "Acme"}]}'))
    assert ai_service._parse_lead_json(message.content) == [{"company_name": "Acme"}]


def test_the_last_parsable_block_wins():
    """Commentary between tool calls arrives as text too. The final answer is
    the newest block that parses, not the first thing that looks like JSON."""
    message = reply(
        text_block('Let me search. Partial: [{"company_name": "Wrong"}]'),
        text_block('[{"company_name": "Right"}]'),
    )
    assert ai_service._parse_lead_json(message.content) == [{"company_name": "Right"}]


def test_unparsable_trailing_commentary_falls_back_to_an_earlier_block():
    message = reply(
        text_block('[{"company_name": "Acme"}]'),
        text_block("Those are the results I found."),
    )
    assert ai_service._parse_lead_json(message.content) == [{"company_name": "Acme"}]


def test_no_parsable_json_returns_an_empty_list():
    """A scan that returns nothing is a normal result, not an error."""
    assert ai_service._parse_lead_json(reply(text_block("nothing found")).content) == []


def test_an_object_that_is_not_a_lead_list_is_rejected():
    """Shape matters: a dict without `leads` is not an answer."""
    assert ai_service._parse_lead_json(reply(text_block('{"status": "ok"}')).content) == []


def test_no_content_at_all_returns_an_empty_list():
    assert ai_service._parse_lead_json([]) == []


# --- _result_urls -----------------------------------------------------------


def search_use(name: str = "web_search"):
    return SimpleNamespace(type="server_tool_use", name=name)


def search_result(*urls: str):
    return SimpleNamespace(
        type="web_search_tool_result",
        content=[SimpleNamespace(url=u) for u in urls],
    )


def test_urls_the_model_was_shown_are_collected():
    urls, searches = ai_service._result_urls(
        [search_use(), search_result("https://a.example/job", "https://b.example/job")]
    )
    assert urls == {"https://a.example/job", "https://b.example/job"}
    assert searches == 1


def test_each_tool_call_counts_as_a_search():
    _, searches = ai_service._result_urls([search_use(), search_use("web_fetch")])
    assert searches == 2


def test_an_unrelated_server_tool_is_not_counted_as_a_search():
    _, searches = ai_service._result_urls([search_use("code_execution")])
    assert searches == 0


def test_a_failed_search_does_not_raise():
    """On failure the result's `content` is an error object, not a list. Walking
    it blindly is the bug the shape check prevents - and a scan must degrade,
    not explode."""
    failed = SimpleNamespace(
        type="web_search_tool_result",
        content=SimpleNamespace(type="web_search_tool_result_error", error_code="max_uses"),
    )
    urls, searches = ai_service._result_urls([search_use(), failed])
    assert urls == set()
    assert searches == 1


def test_urls_are_scraped_from_sandbox_stdout():
    """Some searches run inside code execution and come back as stdout. Without
    this, real postings would be flagged unverified purely because of how the
    model chose to fetch them."""
    block = SimpleNamespace(
        type="code_execution_tool_result",
        content=SimpleNamespace(stdout="found https://c.example/job and more"),
    )
    urls, _ = ai_service._result_urls([block])
    assert "https://c.example/job" in urls


def test_a_dict_shaped_result_is_read_too():
    block = SimpleNamespace(type="web_search_tool_result", content=[{"url": "https://d.example"}])
    urls, _ = ai_service._result_urls([block])
    assert urls == {"https://d.example"}


def test_a_fetch_result_contributes_its_url():
    block = SimpleNamespace(
        type="web_fetch_tool_result",
        content=SimpleNamespace(url="https://e.example/posting"),
    )
    urls, _ = ai_service._result_urls([block])
    assert urls == {"https://e.example/posting"}


def test_empty_content_yields_nothing_and_no_error():
    assert ai_service._result_urls([]) == (set(), 0)


# --- _clean -----------------------------------------------------------------


@pytest.mark.parametrize(
    "placeholder", ["n/a", "N/A", "na", "none", "None", "unknown", "UNKNOWN", "null"]
)
def test_placeholder_words_become_none(placeholder):
    """Models write these instead of omitting a field. Storing the literal
    string "N/A" as a company location would then be shown to a user."""
    assert ai_service._clean(placeholder, 100) is None


def test_whitespace_is_trimmed():
    assert ai_service._clean("  Bengaluru  ", 100) == "Bengaluru"


def test_an_empty_string_becomes_none():
    assert ai_service._clean("   ", 100) is None


def test_none_stays_none():
    assert ai_service._clean(None, 100) is None


def test_values_are_truncated_to_the_column_limit():
    """These land in String columns; an over-long value would fail the insert."""
    assert ai_service._clean("x" * 500, 10) == "x" * 10


def test_a_non_string_is_coerced():
    assert ai_service._clean(12345, 100) == "12345"


def test_a_word_merely_containing_a_placeholder_survives():
    """`nanotech` must not be discarded for starting with `na`."""
    assert ai_service._clean("Nanotech Labs", 100) == "Nanotech Labs"


# --- _parse_posted_date -----------------------------------------------------


def test_an_iso_date_parses():
    assert ai_service._parse_posted_date("2026-09-12") == date(2026, 9, 12)


def test_a_full_timestamp_is_truncated_to_its_date():
    assert ai_service._parse_posted_date("2026-09-12T10:30:00Z") == date(2026, 9, 12)


@pytest.mark.parametrize(
    "value",
    [None, "", "n/a", "unknown", "12 September 2026", "09/12/2026", "yesterday", "2026-13-45"],
)
def test_anything_else_is_none_rather_than_an_exception(value):
    """A posting with an unreadable date is still a real posting; dropping the
    whole lead over its date field would lose the opportunity."""
    assert ai_service._parse_posted_date(value) is None


def test_the_scan_unavailable_error_is_distinct_from_finding_nothing():
    """"The scan could not run" and "the scan found nothing" must not be the
    same signal - one is a fault to surface, the other a normal quiet day."""
    assert issubclass(ai_service.ScanUnavailable, RuntimeError)
    assert ai_service._parse_lead_json([]) == []
