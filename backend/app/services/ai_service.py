import json
import re
from datetime import date, datetime
from typing import Optional

import anthropic

from app.core.config import settings


def _get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


async def generate_company_profile(company) -> str:
    client = _get_client()
    prompt = f"""Generate a comprehensive placement cell profile for the following company. Include hiring history insights, likely job roles, typical eligibility criteria, interview process, and student preparation tips.

Company Details:
- Name: {company.name}
- Sector: {company.sector or 'N/A'}
- Domain: {company.domain or 'N/A'}
- Location: {company.location or 'N/A'}
- Size: {company.size or 'N/A'}
- Products/Services: {company.products_services or 'N/A'}
- Salary Range: {company.salary_min or 'N/A'} - {company.salary_max or 'N/A'} LPA
- Preferred Branches: {company.preferred_branches or 'All'}
- Min CGPA: {company.min_cgpa or 'N/A'}

Provide a structured profile with sections: Company Overview, Hiring Pattern, Typical Roles, Eligibility Criteria, Interview Process, Preparation Tips."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


async def generate_student_gap_report(student, company_id: Optional[int], db) -> str:
    client = _get_client()

    company_context = ""
    if company_id:
        from app.models.company import Company
        company = db.query(Company).filter(Company.id == company_id).first()
        if company:
            company_context = f"""
Target Company:
- Name: {company.name}
- Domain: {company.domain or 'N/A'}
- Min CGPA: {company.min_cgpa or 'N/A'}
- Preferred Branches: {company.preferred_branches or 'All'}
- Salary: {company.salary_min or 'N/A'} - {company.salary_max or 'N/A'} LPA"""

    prompt = f"""Analyze this student's profile and generate a skill gap report with actionable improvement suggestions.

Student Profile:
- Branch: {student.branch}
- CGPA: {student.cgpa or 'N/A'}
- Backlogs: {student.backlogs}
- Skills: {student.skills or 'Not listed'}
- Certifications: {student.certifications or 'None'}
- Internships: {student.internships or 'None'}
- Projects: {student.projects or 'None'}
- Placement Status: {student.placement_status.value}
{company_context}

Provide: 1) Skill gaps identified, 2) Priority improvements, 3) Recommended certifications, 4) Interview preparation focus areas, 5) Resume improvement tips."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


async def draft_hr_email(company_name: str, hr_name: str, purpose: str, officer_name: str) -> str:
    client = _get_client()
    prompt = f"""Draft a professional placement outreach email.

Context:
- Company: {company_name}
- HR Contact: {hr_name}
- Purpose: {purpose}
- Placement Officer: {officer_name}

Write a concise, professional email suitable for a college placement cell to reach out to this HR contact."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


async def generate_interview_questions(job_role: str, company_name: str, domain: str) -> list[str]:
    client = _get_client()
    prompt = f"""Generate 15 likely interview questions for:
- Job Role: {job_role}
- Company: {company_name}
- Domain: {domain}

Include technical, behavioural, and HR questions. Return as a numbered list."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    text = message.content[0].text
    lines = [l.strip() for l in text.split("\n") if l.strip() and l.strip()[0].isdigit()]
    return lines


def _extract_json(text: str):
    """Pull the first JSON array/object out of a model response, tolerating
    markdown code fences or surrounding prose."""
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text
    match = re.search(r"(\[.*\]|\{.*\})", candidate, re.DOTALL)
    if not match:
        raise ValueError("No JSON found in model response")
    return json.loads(match.group(1))


async def generate_interview_prep(job_role: str, company_name: str, domain: str) -> list[dict]:
    """Mock-interview questions paired with answer guidance, for the student
    practice view. Returns a list of {question, answer} dicts."""
    client = _get_client()
    prompt = f"""Generate 12 likely interview questions WITH model answer guidance for a student preparing for:
- Job Role: {job_role}
- Company: {company_name}
- Domain: {domain}

Mix technical, behavioural, and HR questions. For each, give concise answer guidance
(key points the student should cover, ~2-4 sentences; for behavioural questions suggest a STAR-style structure).

Return ONLY a JSON array, no prose, in this exact shape:
[{{"question": "...", "answer": "..."}}, ...]"""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    data = _extract_json(message.content[0].text)
    # Keep only well-formed pairs.
    return [
        {"question": str(item["question"]), "answer": str(item["answer"])}
        for item in data
        if isinstance(item, dict) and item.get("question") and item.get("answer")
    ]


async def generate_exam_questions(job_role: Optional[str], company_name: str, domain: str) -> list[dict]:
    """Mock screening-exam MCQs for the written/online test rounds held before
    interviews. With no job_role, produces the company's GENERAL screening paper
    (e.g. TCS NQT / Infosys aptitude style). Returns {category, question,
    options, correct_index, explanation} dicts."""
    client = _get_client()
    if job_role:
        target = f"""Generate 15 multiple-choice questions for a mock placement screening examination
(the online/written aptitude test round held BEFORE the interviews) for:
- Job Role: {job_role}
- Company: {company_name}
- Domain: {domain}

Mix categories the way campus screening tests do:
- Quantitative Aptitude (~4)
- Logical Reasoning (~4)
- Verbal Ability (~3)
- Technical fundamentals for the role/domain (~4)"""
    else:
        target = f"""Generate 15 multiple-choice questions for a mock GENERAL placement screening examination
(the standardized online aptitude test the company gives ALL applicants before any role-specific rounds) for:
- Company: {company_name}
- Domain: {domain}

If this company runs a well-known standardized campus test (e.g. TCS NQT, Infosys aptitude test,
Wipro NLTH, Accenture cognitive assessment), model the sections, question style and difficulty on
that pattern and name the categories after its sections. Otherwise use the typical campus screening mix:
- Quantitative Aptitude (~5)
- Logical Reasoning (~5)
- Verbal Ability (~4)
- Basic computer/programming fundamentals (~1), only if this company screens for them"""

    prompt = f"""{target}

Each question must have exactly 4 options, exactly one correct answer, and a 1-2 sentence
explanation of why that answer is correct.

Return ONLY a JSON array, no prose, in this exact shape:
[{{"category": "Quantitative Aptitude", "question": "...", "options": ["...", "...", "...", "..."], "correct_index": 0, "explanation": "..."}}, ...]"""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    data = _extract_json(message.content[0].text)
    out: list[dict] = []
    for item in data:
        if not isinstance(item, dict) or not item.get("question"):
            continue
        options = item.get("options")
        if not isinstance(options, list) or len(options) < 2:
            continue
        options = [str(o) for o in options]
        try:
            correct = int(item["correct_index"])
        except (KeyError, TypeError, ValueError):
            continue
        if not 0 <= correct < len(options):
            continue
        out.append(
            {
                "category": str(item.get("category") or "General"),
                "question": str(item["question"]),
                "options": options,
                "correct_index": correct,
                "explanation": str(item.get("explanation") or "").strip(),
            }
        )
    return out


async def parse_roster_sheet(grid: list[list]) -> list[dict]:
    """Fallback parser for a round roster whose columns we couldn't identify
    deterministically. Hands the raw grid (first row = headers) to Claude and
    asks for a normalized list of {roll_number, name, status, ctc}."""
    client = _get_client()
    prompt = f"""You are parsing a spreadsheet of students for ONE interview round of a campus placement drive.
For each student row identify their roll/registration number, name, whether they PASSED this round, and any offered CTC/package (in LPA) if a column for it exists.

The sheet (the first row is the header row):
{json.dumps(grid, indent=2, default=str)}

Rules:
- roll_number: the student's roll / registration / enrolment number, as a string. Required — skip any row without one.
- name: full name if present, else null.
- status: "passed" if the row shows the student cleared/passed/was selected/qualified; "failed" if rejected/failed/not cleared; "absent" if the student did not turn up / was a no-show / withdrew; null if the sheet only lists who appeared with no outcome column.
- ctc: the package as a number in LPA if such a column exists for that row, else null.

Return ONLY a JSON array, no prose, in this exact shape:
[{{"roll_number": "...", "name": "...", "status": "passed", "ctc": 12.5}}, ...]"""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    data = _extract_json(message.content[0].text)
    out: list[dict] = []
    for item in data:
        if not isinstance(item, dict) or not item.get("roll_number"):
            continue
        status = item.get("status")
        ctc = item.get("ctc")
        try:
            ctc = float(ctc) if ctc not in (None, "") else None
        except (TypeError, ValueError):
            ctc = None
        out.append(
            {
                "roll_number": str(item["roll_number"]).strip(),
                "name": str(item["name"]).strip() if item.get("name") else None,
                "status": str(status).strip().lower() if status else None,
                "ctc": ctc,
            }
        )
    return out


async def review_resume(student) -> str:
    """AI resume review from the student's structured profile (spec §5)."""
    client = _get_client()
    prompt = f"""You are a placement-cell career coach reviewing a student's resume content.
Base your review on the structured profile below (treat it as the resume's substance).

Student Profile:
- Branch: {student.branch}
- CGPA: {student.cgpa or 'N/A'}
- Backlogs: {student.backlogs}
- Skills: {student.skills or 'Not listed'}
- Certifications: {student.certifications or 'None'}
- Internships: {student.internships or 'None'}
- Projects: {student.projects or 'None'}
- Placement Preference: {student.placement_preference or 'N/A'}

Provide a structured review with sections:
1) Overall impression, 2) Strengths, 3) Gaps & red flags,
4) Section-by-section suggestions (skills, projects, internships, certifications),
5) Concrete rewrite examples (turn weak bullet points into strong, quantified ones),
6) Top 3 priorities before applying."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


async def draft_escalation_reply(
    escalation_note: str,
    highlights: Optional[str],
    blockers: Optional[str],
    officer_name: str,
    leader_name: str,
) -> str:
    """A first draft of leadership's answer to an escalation raised in a daily update.

    Deliberately short and decisive: this is a reply an officer reads on their
    phone, and it is a starting point the leader edits before sending, not a
    message that goes out on its own.
    """
    client = _get_client()
    prompt = f"""You are helping {leader_name}, who leads placements at an Indian
engineering college, reply to an escalation raised by {officer_name}, one of their
placement officers, in today's daily update.

The escalation:
{escalation_note}

What else the officer reported today:
- Highlights: {highlights or 'nothing recorded'}
- Blockers: {blockers or 'nothing recorded'}

Draft the reply. Requirements:
- One or two sentences, under 40 words.
- Give a clear direction or decision, and name the next action.
- Plain, direct, collegial - the way a senior colleague answers on a busy day.
- No greeting, no sign-off, no preamble. Return only the reply text itself.
- Do not invent facts, dates, names or numbers that are not in the escalation.
- If the escalation genuinely cannot be decided without more information, ask the
  one specific question that would unblock it."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text.strip()


# ---------------------------------------------------------------------------
# Opportunity scan
#
# The one call in this file that reaches outside Anthropic: it hands Claude the
# server-side web_search / web_fetch tools and asks for job and internship
# postings from the last 24 hours. Everything runs on Anthropic's side, so the
# backend still has no scraper, no HTTP client for job boards, and nothing that
# breaks the day a job site changes its markup.
#
# Two things make this call shaped differently from the rest of the file:
#   * it is a plain `def`, not `async def`. The SDK calls here are blocking, and
#     a search turn can run a minute - long enough that awaiting it on the event
#     loop would stall every other request. Callers run it in a threadpool.
#   * a server-tool turn can stop with `stop_reason == "pause_turn"` partway
#     through, which has to be resumed or the answer is silently truncated.
# ---------------------------------------------------------------------------

JOB_SCAN_MODEL = "claude-opus-5"
# Hard ceilings on the billable part. Web search is charged per search on top of
# tokens, so the cost of one scan is bounded by these two numbers.
JOB_SCAN_MAX_SEARCHES = 12
JOB_SCAN_MAX_FETCHES = 5
# The server-side sampling loop pauses roughly every 10 iterations.
JOB_SCAN_MAX_CONTINUATIONS = 3
# A broad scan runs a dozen searches and routinely takes three to five
# minutes, so the SDK's ten-minute default is left roughly intact rather
# than cutting a search short that was about to return.
JOB_SCAN_TIMEOUT_SECONDS = 600.0

# Links printed by the search-filtering code the tools run for themselves.
_URL_RE = re.compile(r"https?://[^\s\"'<>\)\]]+")


class ScanUnavailable(RuntimeError):
    """The scan could not run - no key, or the search itself failed.

    Distinct from "the scan ran and found nothing", which is a normal result.
    """


def _text_blocks(content) -> list[str]:
    return [
        b.text for b in content
        if getattr(b, "type", None) == "text" and getattr(b, "text", "")
    ]


def _parse_lead_json(content) -> list:
    """Read the JSON array out of a tool-using response.

    The final answer is usually the last text block, but commentary between tool
    calls arrives as text too, so try the blocks newest-first and take the first
    one that parses. A greedy scan over the whole concatenation would happily
    swallow a stray bracket from that commentary.
    """
    for text in reversed(_text_blocks(content)):
        try:
            data = _extract_json(text)
        except (ValueError, json.JSONDecodeError):
            continue
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("leads"), list):
            return data["leads"]
    return []


def _result_urls(content) -> tuple[set, int]:
    """Every URL the model was actually shown, and how many searches it ran.

    Server-tool failures do not raise: a result block's ``content`` is a list on
    success and an error object on failure, so the shape has to be checked
    before it is walked.

    These tool versions filter results dynamically, which means some searches run
    inside the code-execution sandbox and come back as stdout rather than as a
    search-result block. Plain stdout is scraped for links too - without that,
    perfectly real postings would be flagged unverified purely because of how the
    model chose to fetch them. Encrypted results stay opaque, so the flag can
    still be a false alarm; it warns, it never drops a lead.
    """
    urls: set = set()
    searches = 0

    def collect(item):
        url = getattr(item, "url", None)
        if url is None and isinstance(item, dict):
            url = item.get("url")
        if url:
            urls.add(str(url))

    for block in content:
        kind = getattr(block, "type", None)
        if kind == "server_tool_use":
            if getattr(block, "name", None) in ("web_search", "web_fetch"):
                searches += 1
        elif kind == "web_search_tool_result":
            results = getattr(block, "content", None)
            if isinstance(results, list):
                for item in results:
                    collect(item)
        elif kind == "web_fetch_tool_result":
            result = getattr(block, "content", None)
            if result is not None and not isinstance(result, list):
                collect(result)
        elif kind == "code_execution_tool_result":
            result = getattr(block, "content", None)
            stdout = getattr(result, "stdout", None)
            if stdout:
                urls.update(_URL_RE.findall(stdout))
    return urls, searches


def _clean(value, limit: int) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"n/a", "na", "none", "unknown", "null"}:
        return None
    return text[:limit]


def _parse_posted_date(value) -> Optional[date]:
    text = _clean(value, 32)
    if not text:
        return None
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _build_scan_prompt(
    *,
    branches: list,
    known_companies: list,
    limit: int,
    today: date,
) -> str:
    known = ", ".join(known_companies[:80]) or "nothing yet"
    disciplines = ", ".join(branches) or "the usual engineering branches"
    return f"""You are scouting fresher hiring for a group of Indian engineering colleges.
Today is {today.isoformat()}.

Search the web for job and internship openings **posted or refreshed in the last 24 hours**
that an engineering placement cell would want to know about.

What matters here:
- Fresher, entry-level and campus-hire roles, and internships open to current students.
- Openings anywhere in India, and remote ones. **Do not narrow by city.** Campus hiring is
  national: a TCS opening in Kolkata still recruits from a Bangalore campus, so where the
  job sits is information to report, never a reason to leave it out.
- Relevance to these disciplines: {disciplines}.
- Mass recruiters and off-campus drives matter as much as individual postings, because one
  drive can take students from every college on this list.

Spend your searches on breadth, not on proof. Run several distinct searches - large
employers' own career pages, off-campus and fresher hiring announcements, internship
listings, and the disciplines named above - and judge recency from the dates and snippets
the search results themselves carry. Do not open each posting to confirm a timestamp; that
buys little and costs the coverage this is for. Prefer the employer's own careers site over
an aggregator whenever both carry the same opening. Skip staffing-agency reposts, unpaid
"work for exposure" ads, and anything that asks candidates for a fee.

Openings already found in the last few days, at: {known}
A genuinely new posting at one of those employers is still worth reporting, but prioritise
openings that are not already on the list.

Return AT MOST {limit} openings, as a JSON array and nothing else. Each element:
{{
  "company_name": "employer's name",
  "role_title": "the role as posted",
  "lead_type": "job" or "internship",
  "location": "city, or Remote, or 'Multiple locations'",
  "work_mode": "onsite" | "hybrid" | "remote" | null,
  "eligibility": "degree/branch/CGPA/batch requirements as posted, or null",
  "compensation": "salary or stipend as posted, or null",
  "posted_at": "YYYY-MM-DD the posting went up, or null if not stated",
  "posted_label": "the source's own wording, e.g. '3 hours ago', or null",
  "source_name": "where you found it, e.g. 'Infosys careers'",
  "source_url": "the direct link to the posting",
  "summary": "one sentence, under 200 characters, on what this is and who it suits",
  "confidence": "high" | "medium" | "low"
}}

Rules:
- Every source_url must be a link you actually opened or saw in a search result.
  Never construct, guess or complete a URL. If you cannot produce the real link
  for an opening, leave that opening out entirely.
- The target window is the last 24 hours. Careers sites often show no date at
  all, so a listing that is clearly current but undated may be included with
  confidence "low" and posted_at null - put whatever the source did say in
  posted_label. Anything you can see is older than a few days is out.
- Set confidence "high" only when the source states a date inside the last 24 hours.
- Do not report the same opening twice.
- Aim for {limit} openings. A plausible recent opening marked "low" is more use
  here than an empty list: a person reviews every one of these before anything is
  acted on, and the cost of a weak lead is one dismissed card.
- If you genuinely found nothing recent, return [].
- Return only the JSON array - no preamble, and nothing after it."""


def discover_job_leads(
    *,
    branches: Optional[list] = None,
    known_companies: Optional[list] = None,
    limit: int = 15,
    today: Optional[date] = None,
) -> tuple[list, dict]:
    """Search the web for openings posted in the last 24 hours.

    Platform-wide, not per college: campus hiring is national, so the same answer
    serves every tenant and scanning once is the whole point.

    Returns ``(postings, meta)``. Each posting is a validated dict ready to become
    a ``JobPosting``; ``verified`` on it is False when the model produced a URL
    that never appeared in a search or fetch result - the one failure mode that
    could otherwise turn an invented opening into a company record.

    Raises ``ScanUnavailable`` when there is no API key or the call fails.
    """
    if not settings.ANTHROPIC_API_KEY.strip():
        raise ScanUnavailable("No Anthropic API key configured")

    prompt = _build_scan_prompt(
        branches=branches or [],
        known_companies=known_companies or [],
        limit=limit,
        today=today or date.today(),
    )

    client = _get_client().with_options(timeout=JOB_SCAN_TIMEOUT_SECONDS)
    tools = [
        {"type": "web_search_20260209", "name": "web_search", "max_uses": JOB_SCAN_MAX_SEARCHES},
        {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": JOB_SCAN_MAX_FETCHES},
    ]
    messages = [{"role": "user", "content": prompt}]

    seen_urls: set = set()
    searches = 0
    try:
        for _ in range(JOB_SCAN_MAX_CONTINUATIONS + 1):
            response = client.messages.create(
                model=JOB_SCAN_MODEL,
                max_tokens=8000,
                tools=tools,
                messages=messages,
            )
            urls, used = _result_urls(response.content)
            seen_urls |= urls
            searches += used
            if response.stop_reason != "pause_turn":
                break
            # Resume the paused turn by replaying it. Appending a user message
            # like "continue" here would stop the server resuming on its own.
            messages = messages[:1] + [{"role": "assistant", "content": response.content}]
        else:
            raise ScanUnavailable("Search did not finish within the allowed continuations")
    except ScanUnavailable:
        raise
    except anthropic.APIError as exc:
        raise ScanUnavailable(f"Anthropic API error: {exc}") from exc
    except Exception as exc:  # noqa: BLE001 - reported to the caller as a failed scan
        raise ScanUnavailable(str(exc)) from exc

    leads = []
    for item in _parse_lead_json(response.content):
        if not isinstance(item, dict):
            continue
        name = _clean(item.get("company_name"), 200)
        if not name:
            continue
        url = _clean(item.get("source_url"), 500)
        if url and not url.lower().startswith(("http://", "https://")):
            url = None
        lead_type = str(item.get("lead_type") or "job").strip().lower()
        confidence = str(item.get("confidence") or "medium").strip().lower()
        leads.append(
            {
                "company_name": name,
                "role_title": _clean(item.get("role_title"), 200),
                "lead_type": lead_type if lead_type in ("job", "internship") else "job",
                "location": _clean(item.get("location"), 120),
                "work_mode": _clean(item.get("work_mode"), 40),
                "eligibility": _clean(item.get("eligibility"), 300),
                "compensation": _clean(item.get("compensation"), 120),
                "posted_at": _parse_posted_date(item.get("posted_at")),
                "posted_label": _clean(item.get("posted_label"), 60),
                "source_name": _clean(item.get("source_name"), 120),
                "source_url": url,
                "summary": _clean(item.get("summary"), 500),
                "confidence": confidence if confidence in ("high", "medium", "low") else "medium",
                # The hallucination guard: a link nobody ever showed the model.
                "verified": bool(url) and url in seen_urls,
            }
        )

    return leads[:limit], {"searches": searches, "sources": len(seen_urls), "model": JOB_SCAN_MODEL}
