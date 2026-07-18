import json
import re
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


async def suggest_company_allocations(companies: list[dict], officers: list[dict]) -> list[dict]:
    """AI-driven bulk allocation of unassigned companies to placement officers.

    Weighs region/sector fit, existing relationship, officer workload vs target,
    company priority and follow-up urgency. Returns a list of
    {company_id, officer_id, priority, reasoning} proposals (one per company)."""
    client = _get_client()
    prompt = f"""You are the allocation engine for a college placement cell. Assign each
unassigned company to the single best-fit placement officer, balancing the whole team.

Weigh these factors when deciding the owner:
- Region: officer.region vs the company's location/region — prefer a regional match.
- Sector: officer.sector_expertise vs the company's sector/domain — prefer expertise fit.
- Existing relationship: keep warm relationships with one owner — favour fit where
  previous_visit_count is high, hr_relationship_strength (1-5) is strong, or there is an MOU.
- Officer workload: balance current_active_companies against target_companies; spread load
  and do not overload one officer while others sit idle.
- Priority companies: company.status == "priority" must go to an officer with strong sector
  fit and spare capacity; set its allocation priority to "high".
- Follow-up urgency: a soon or overdue next_followup_date raises the allocation priority.
- Placement target: treat target_companies as each officer's soft capacity ceiling.

Rules:
- Assign EVERY company to exactly one officer_id taken from the officers list below.
- priority must be one of "low", "normal", "high".
- reasoning: ONE short sentence naming the deciding factor(s).

Unassigned companies:
{json.dumps(companies, indent=2, default=str)}

Placement officers:
{json.dumps(officers, indent=2, default=str)}

Return ONLY a JSON array, no prose, in this exact shape:
[{{"company_id": 1, "officer_id": 2, "priority": "high", "reasoning": "..."}}, ...]"""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    data = _extract_json(message.content[0].text)
    proposals: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        try:
            company_id = int(item["company_id"])
            officer_id = int(item["officer_id"])
        except (KeyError, TypeError, ValueError):
            continue
        priority = str(item.get("priority", "normal")).lower()
        if priority not in ("low", "normal", "high"):
            priority = "normal"
        proposals.append(
            {
                "company_id": company_id,
                "officer_id": officer_id,
                "priority": priority,
                "reasoning": str(item.get("reasoning", "")).strip(),
            }
        )
    return proposals


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
