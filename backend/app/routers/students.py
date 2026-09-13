import secrets
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import String, case, cast, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.core.security import get_password_hash
from app.models.offer import Offer, OfferStatus
from app.models.student import PlacementStatus, RiskCategory, Student
from app.models.user import User, UserRole
from app.schemas.student import (
    EnableLoginRequest,
    EnableLoginResult,
    StudentCreate,
    StudentFilterOptions,
    StudentOut,
    StudentUpdate,
)
from app.services.ai_service import generate_student_gap_report
from app.services.invites import issue_and_deliver
from app.services.excel_io import XLSX_MEDIA_TYPE, Column, build_workbook, parse_rows
from app.services import skills
from app.services.placement import LIVE_STATUSES
from app.services.student_scoring import assess

router = APIRouter(prefix="/students", tags=["students"])


def _search_filter(search: str):
    """Match the free-text box against roll number, branch and the student's name.
    full_name lives on the backing user account, so the caller must have joined
    users (see ``_student_query``)."""
    like = f"%{search}%"
    return (
        Student.roll_number.ilike(like)
        | Student.branch.ilike(like)
        | User.full_name.ilike(like)
    )


def _backing_email(roll_number: str, college_id: int | None) -> str:
    """Placeholder address for a login-less student account. Scoped by college so
    the same roll number in two colleges doesn't collide on users.email (which is
    globally unique)."""
    return f"{roll_number.lower()}@c{college_id}.no-login.myplacement.app"


def _get_owned_student(db: Session, student_id: int, current_user: User) -> Student:
    """Fetch a student by id, restricted to the caller's college (super_admin,
    which has no college_id, sees all). 404 if it isn't in scope."""
    q = db.query(Student).filter(Student.id == student_id)
    if current_user.college_id:
        q = q.filter(Student.college_id == current_user.college_id)
    student = q.first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student

# Columns the student list can be ordered by, keyed by the name the UI sends.
# Whitelisted so the query parameter can never reach an arbitrary attribute.
SortKey = Literal[
    "id",
    "full_name",
    "roll_number",
    "branch",
    "batch_year",
    "cgpa",
    "backlogs",
    "skills",
    "placement_status",
    "risk_category",
    "login_enabled",
]

# Sorts that read a column off the backing user account, so the query has to
# join users whether or not anything is being searched.
_USER_SORTS = {"full_name", "login_enabled"}

# Both status columns are enums, so ordering by the stored value would follow
# the order the members happen to be declared in. Rank them by how much
# attention a student needs instead — ascending puts the actionable rows
# (still unplaced, highest risk) at the top, which is what someone clicking
# these headers is after.
_PLACEMENT_ORDER = (
    PlacementStatus.UNPLACED,
    PlacementStatus.PLACED,
    PlacementStatus.HIGHER_STUDIES,
    PlacementStatus.OPTED_OUT,
)

_RISK_ORDER = (RiskCategory.HIGH, RiskCategory.MEDIUM, RiskCategory.LOW)


def _enum_rank(column, members):
    """CASE ranking for an enum column. The column is a Postgres enum holding
    the member *names* ("UNPLACED"), which is what SQLAlchemy persists, so the
    comparison casts to text — matching on the members themselves sends their
    lowercase values, which the enum type rejects."""
    return case(
        {member.name: rank for rank, member in enumerate(members)},
        value=cast(column, String),
        else_=len(members),
    )


# Text columns sort on lower(), so "cse" lands beside "CSE" rather than after
# every capitalised value. It also keeps the order identical across
# environments, whose collations disagree about case.
_SORT_COLUMNS = {
    "id": Student.id,
    "full_name": func.lower(User.full_name),
    "roll_number": func.lower(Student.roll_number),
    "branch": func.lower(Student.branch),
    "batch_year": Student.batch_year,
    "cgpa": Student.cgpa,
    "backlogs": Student.backlogs,
    "skills": func.lower(Student.skills),
    "placement_status": _enum_rank(Student.placement_status, _PLACEMENT_ORDER),
    "risk_category": _enum_rank(Student.risk_category, _RISK_ORDER),
    "login_enabled": User.is_active,
}


def _order_by(sort: SortKey, order: str):
    """ORDER BY for the student list. Blank cells sort last whichever way the
    column points, so sorting by CGPA doesn't open on a screen of dashes, and
    id breaks ties — without it rows sharing a value (a whole branch shares a
    batch year) can shuffle between requests and repeat or skip across pages."""
    column = _SORT_COLUMNS[sort]
    direction = column.desc() if order == "desc" else column.asc()
    return [direction.nullslast(), Student.id.asc()]


def _student_query(
    db: Session,
    current_user: User,
    *,
    branch: Optional[str] = None,
    placement_status: Optional[PlacementStatus] = None,
    risk_category: Optional[RiskCategory] = None,
    min_cgpa: Optional[float] = None,
    batch_year: Optional[int] = None,
    has_backlogs: Optional[bool] = None,
    login_enabled: Optional[bool] = None,
    search: Optional[str] = None,
    sort: Optional[str] = None,
):
    """The filtered student query shared by the list and export endpoints, so
    an export always covers exactly what the screen is showing."""
    q = db.query(Student)
    if current_user.college_id:
        q = q.filter(Student.college_id == current_user.college_id)
    # One join to users covers the name search, the login filter and sorting by
    # either; joining a second time would raise.
    if search or login_enabled is not None or sort in _USER_SORTS:
        q = q.join(User, Student.user_id == User.id)
    if branch:
        # Exact (case-insensitive) match: the filter offers the branches that
        # exist, and a substring match would quietly fold "CSE" into
        # "CSE (AI & ML)" as well.
        q = q.filter(func.lower(Student.branch) == branch.strip().lower())
    if placement_status:
        q = q.filter(Student.placement_status == placement_status)
    if risk_category:
        q = q.filter(Student.risk_category == risk_category)
    if min_cgpa is not None:
        q = q.filter(Student.cgpa >= min_cgpa)
    if batch_year:
        q = q.filter(Student.batch_year == batch_year)
    if has_backlogs is not None:
        # backlogs defaults to 0 but older rows can hold NULL, which is "none"
        # for filtering purposes either way.
        q = q.filter(Student.backlogs > 0) if has_backlogs else q.filter(
            func.coalesce(Student.backlogs, 0) == 0
        )
    if login_enabled is not None:
        q = q.filter(User.is_active.is_(True) if login_enabled else User.is_active.isnot(True))
    if search:
        q = q.filter(_search_filter(search))
    return q


# Importable columns. full_name backs the auto-created login-less user.
STUDENT_IMPORT_COLUMNS = [
    Column("full_name", "full_name", required=True),
    Column("roll_number", "roll_number", required=True),
    Column("branch", "branch", required=True),
    Column("batch_year", "batch_year", kind="int", required=True),
    Column("cgpa", "cgpa", kind="float"),
    Column("backlogs", "backlogs", kind="int"),
    Column("skills", "skills"),
    Column("certifications", "certifications"),
    Column("internships", "internships"),
    Column("projects", "projects"),
    Column("resume_url", "resume_url"),
    Column("linkedin_url", "linkedin_url"),
    Column("github_url", "github_url"),
    Column("placement_preference", "placement_preference"),
    Column("location_preference", "location_preference"),
    Column("higher_studies_plan", "higher_studies_plan", kind="bool"),
]

# Export adds the derived/read-only fields after the importable ones.
STUDENT_EXPORT_COLUMNS = STUDENT_IMPORT_COLUMNS + [
    Column("placement_status", "placement_status", importable=False),
    Column("readiness_score", "readiness_score", importable=False),
    Column("risk_category", "risk_category", importable=False),
]


@router.get("", response_model=list[StudentOut])
def list_students(
    response: Response,
    branch: Optional[str] = None,
    placement_status: Optional[PlacementStatus] = None,
    risk_category: Optional[RiskCategory] = None,
    min_cgpa: Optional[float] = None,
    batch_year: Optional[int] = None,
    has_backlogs: Optional[bool] = None,
    login_enabled: Optional[bool] = None,
    search: Optional[str] = None,
    sort: SortKey = "roll_number",
    order: Literal["asc", "desc"] = "asc",
    skip: int = 0,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One page of students, ordered by ``sort``/``order``. The total row count
    for the current filters is returned in the ``X-Total-Count`` header so
    callers can paginate."""
    q = _student_query(
        db,
        current_user,
        branch=branch,
        placement_status=placement_status,
        risk_category=risk_category,
        min_cgpa=min_cgpa,
        batch_year=batch_year,
        has_backlogs=has_backlogs,
        login_enabled=login_enabled,
        search=search,
        sort=sort,
    )
    response.headers["X-Total-Count"] = str(q.count())
    return q.order_by(*_order_by(sort, order)).offset(skip).limit(limit).all()


@router.get("/filter-options", response_model=StudentFilterOptions)
def student_filter_options(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The branch and batch values actually on file for this college, so the
    filter dropdowns only offer choices that can return a row. Branches that
    differ only by case or padding ("CSE", " cse ") are one option, matching
    how the branch filter compares them."""
    q = db.query(Student.branch, Student.batch_year)
    if current_user.college_id:
        q = q.filter(Student.college_id == current_user.college_id)

    branches: dict[str, str] = {}
    batch_years: set[int] = set()
    for branch, batch_year in q.distinct().all():
        if branch and branch.strip():
            # First spelling seen wins as the label; the key is what the filter
            # actually matches on.
            branches.setdefault(branch.strip().lower(), branch.strip())
        if batch_year:
            batch_years.add(batch_year)

    return StudentFilterOptions(
        branches=sorted(branches.values(), key=str.lower),
        # Newest batch first: it's the one being placed right now.
        batch_years=sorted(batch_years, reverse=True),
    )


@router.post("", response_model=StudentOut, status_code=201)
def create_student(payload: StudentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if (
        db.query(Student)
        .filter(
            Student.roll_number == payload.roll_number,
            Student.college_id == current_user.college_id,
        )
        .first()
    ):
        raise HTTPException(status_code=400, detail="Roll number already exists")

    data = payload.model_dump()
    full_name = data.pop("full_name", None)
    user_id = data.pop("user_id", None)

    if user_id is None:
        if not full_name:
            raise HTTPException(status_code=400, detail="full_name is required when no user account is linked")
        # Create a login-less backing user so the profile satisfies the user_id FK.
        backing_user = User(
            email=_backing_email(payload.roll_number, current_user.college_id),
            full_name=full_name,
            hashed_password=get_password_hash(secrets.token_urlsafe(32)),
            role=UserRole.STUDENT,
            college_id=current_user.college_id,
            is_active=False,
        )
        db.add(backing_user)
        db.flush()  # assign backing_user.id without committing yet
        user_id = backing_user.id

    student = Student(**data, user_id=user_id, college_id=current_user.college_id)
    db.add(student)
    db.flush()  # assign student.id so the skill rows can point at it
    # Skills go in as provenance rows and come back out as the cached column;
    # see services/skills.py. Student.skills is never assigned directly.
    skills.record(db, student, data.get("skills"), source=skills.OFFICER,
                  evidence=f"Entered by {current_user.full_name or current_user.email}")
    # New students are unplaced by default; derive their readiness & risk.
    student.readiness_score, student.risk_category = assess(
        student.cgpa, student.backlogs, student.skills, PlacementStatus.UNPLACED
    )
    db.commit()
    db.refresh(student)
    return student


@router.get("/export")
def export_students(
    branch: Optional[str] = None,
    placement_status: Optional[PlacementStatus] = None,
    risk_category: Optional[RiskCategory] = None,
    min_cgpa: Optional[float] = None,
    batch_year: Optional[int] = None,
    has_backlogs: Optional[bool] = None,
    login_enabled: Optional[bool] = None,
    search: Optional[str] = None,
    sort: SortKey = "roll_number",
    order: Literal["asc", "desc"] = "asc",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download the (optionally filtered) student list as an .xlsx file. Takes
    the same filters and sort as the list endpoint, so the workbook holds what
    the screen was showing, in the order it was showing it."""
    q = _student_query(
        db,
        current_user,
        branch=branch,
        placement_status=placement_status,
        risk_category=risk_category,
        min_cgpa=min_cgpa,
        batch_year=batch_year,
        has_backlogs=has_backlogs,
        login_enabled=login_enabled,
        search=search,
        sort=sort,
    )

    buffer = build_workbook(STUDENT_EXPORT_COLUMNS, q.order_by(*_order_by(sort, order)).all(), "Students")
    return StreamingResponse(
        buffer,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=students.xlsx"},
    )


@router.get("/import-template")
def student_import_template(_: User = Depends(get_current_user)):
    """Download a header-only workbook to fill in for bulk import."""
    buffer = build_workbook(STUDENT_IMPORT_COLUMNS, [], "Students")
    return StreamingResponse(
        buffer,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=students_template.xlsx"},
    )


@router.post("/import")
def import_students(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk-create students from an uploaded .xlsx. Existing roll numbers are skipped.

    Each student gets a login-less backing user (mirrors ``create_student``).
    """
    try:
        rows = parse_rows(file.file.read(), STUDENT_IMPORT_COLUMNS)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not rows:
        raise HTTPException(
            status_code=400,
            detail="No data rows found. The sheet has the right headers but no "
                   "students under them - fill in a row per student and re-upload.",
        )

    created = 0
    skipped = 0
    errors: list[dict] = []
    seen_rolls: set[str] = set()

    for entry in rows:
        data = entry["data"]
        roll = data.get("roll_number")
        # Skip duplicates (within the file or already in THIS college) before
        # validating, so a re-uploaded sheet is idempotent rather than noisy.
        already_exists = roll and (
            roll in seen_rolls
            or db.query(Student)
            .filter(Student.roll_number == roll, Student.college_id == current_user.college_id)
            .first()
        )
        if already_exists:
            skipped += 1
            continue
        if entry["errors"]:
            errors.append({"row": entry["row"], "errors": entry["errors"]})
            continue

        seen_rolls.add(roll)
        full_name = data.pop("full_name")
        data["backlogs"] = data.get("backlogs") or 0
        data["higher_studies_plan"] = data.get("higher_studies_plan") or False

        backing_user = User(
            email=_backing_email(roll, current_user.college_id),
            full_name=full_name,
            hashed_password=get_password_hash(secrets.token_urlsafe(32)),
            role=UserRole.STUDENT,
            college_id=current_user.college_id,
            is_active=False,
        )
        db.add(backing_user)
        db.flush()  # assign backing_user.id without committing yet

        student = Student(**data, user_id=backing_user.id, college_id=current_user.college_id)
        student.readiness_score, student.risk_category = assess(
            student.cgpa, student.backlogs, student.skills, PlacementStatus.UNPLACED
        )
        db.add(student)
        created += 1

    db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}


@router.get("/{student_id}", response_model=StudentOut)
def get_student(
    student_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    return _get_owned_student(db, student_id, current_user)


@router.get("/{student_id}/skills")
def get_student_skills(
    student_id: int, db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One student's skills with what backs each: trained, officer-entered, or
    the student's own word. The distinction the free-text column cannot hold."""
    student = _get_owned_student(db, student_id, current_user)
    return {"skills": skills.grouped(db, student.id)}


def _sync_placement_offer(db: Session, student: Student) -> None:
    """Keep one placeholder offer in sync with the student's placement status, so
    marking a student placed surfaces them in the offers table (and the
    offer-based analytics counts).

    The placeholder is the row with **neither drive nor company** — nobody said
    where the offer came from. Anything carrying either is a real offer, created
    through the drives API or recorded on the Offers screen, and is left alone:
    overwriting its package with whatever is on the student row would quietly
    rewrite a recorded fact.

    Only a **live** real offer suppresses the placeholder. A rejected or
    still-pending offer is not a record of this placement, so standing aside for
    one used to lose the placement from the offer table altogether: a student
    marked placed at 20 LPA by hand, who had earlier been rejected somewhere,
    was shown at 20 on the Students page and left out of every offer-based
    figure — the package simply vanished from the analytics. LIVE_STATUSES is
    imported rather than restated so this cannot drift from the rule
    ``sync_student_placement`` and the placement rate already use.
    """
    offers = db.query(Offer).filter(Offer.student_id == student.id).all()
    placeholder = next((o for o in offers if o.drive_id is None and o.company_id is None), None)
    has_real_offer = any(
        (o.drive_id is not None or o.company_id is not None) and o.status in LIVE_STATUSES
        for o in offers
    )

    if student.placement_status == PlacementStatus.PLACED:
        # A live real offer already records this placement — a placeholder beside
        # it would double-count the student in the offer totals.
        if has_real_offer:
            if placeholder is not None:
                db.delete(placeholder)
            return
        if placeholder is None:
            placeholder = Offer(student_id=student.id, drive_id=None)
            db.add(placeholder)
        placeholder.ctc = student.placement_ctc
        placeholder.status = OfferStatus.ACCEPTED
    elif placeholder is not None:
        # No longer placed — drop the auto-created placement offer.
        db.delete(placeholder)


@router.put("/{student_id}", response_model=StudentOut)
def update_student(
    student_id: int, payload: StudentUpdate, db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = _get_owned_student(db, student_id, current_user)
    provided = payload.model_dump(exclude_none=True)

    # full_name lives on the backing user account, not the student row.
    full_name = provided.pop("full_name", None)
    if full_name is not None and student.user:
        student.user.full_name = full_name

    # Roll numbers are unique within a college; reject a clash with a different
    # student in the same college.
    new_roll = provided.get("roll_number")
    if new_roll and new_roll != student.roll_number:
        clash = (
            db.query(Student)
            .filter(
                Student.roll_number == new_roll,
                Student.id != student.id,
                Student.college_id == student.college_id,
            )
            .first()
        )
        if clash:
            raise HTTPException(status_code=400, detail="Roll number already exists")

    # Skills are held as provenance rows, so an edit to the field is recorded as
    # this officer's view rather than written straight to the cached column. It
    # replaces only their own rows: a skill the student earned in training is not
    # theirs to delete.
    new_skills = provided.pop("skills", None)

    for field, value in provided.items():
        setattr(student, field, value)
    if new_skills is not None:
        skills.record(db, student, new_skills, source=skills.OFFICER,
                      evidence=f"Entered by {current_user.full_name or current_user.email}")
    # A package only makes sense for a placed student; clear it otherwise.
    if student.placement_status != PlacementStatus.PLACED:
        student.placement_ctc = None
    # Re-derive readiness & risk from the new values, unless risk was set
    # explicitly in this request (manual override wins).
    if "risk_category" not in provided:
        student.readiness_score, student.risk_category = assess(
            student.cgpa, student.backlogs, student.skills, student.placement_status
        )
    # Mirror the placement into the offers table.
    _sync_placement_offer(db, student)
    db.commit()
    db.refresh(student)
    return student


# Staff roles allowed to switch on student logins.
STAFF_ROLES = (UserRole.PRINCIPAL, UserRole.PRO_CHANCELLOR, UserRole.DEPUTY_PRO_CHANCELLOR, UserRole.PLACEMENT_OFFICER)


def _enable_student_login(db: Session, student: Student, actor: User) -> EnableLoginResult:
    """Activate the student's backing account and mint a one-time link they use
    to choose their own password.

    No temporary password is created, so nothing that keeps working leaves this
    building: the link expires, is single-use, and a re-issue kills the old one.
    """
    user = student.user
    user.is_active = True
    user.must_reset_password = True
    issued = issue_and_deliver(db, user, actor)
    return EnableLoginResult(
        student_id=student.id,
        roll_number=student.roll_number,
        full_name=student.full_name,
        invite_url=issued.url,
        expires_at=issued.expires_at,
    )


@router.post("/enable-login", response_model=list[EnableLoginResult])
def enable_login_bulk(
    payload: EnableLoginRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*STAFF_ROLES)),
):
    """Bulk-activate student logins. Returns one password-setup link each."""
    q = db.query(Student).filter(Student.id.in_(payload.student_ids))
    if current_user.college_id:
        q = q.filter(Student.college_id == current_user.college_id)
    results = [_enable_student_login(db, s, current_user) for s in q.all() if s.user]
    db.commit()
    return results


@router.post("/{student_id}/enable-login", response_model=EnableLoginResult)
def enable_login(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*STAFF_ROLES)),
):
    """Activate one student's login and return their password-setup link."""
    student = _get_owned_student(db, student_id, current_user)
    if not student.user:
        raise HTTPException(status_code=400, detail="Student has no backing account")
    result = _enable_student_login(db, student, current_user)
    db.commit()
    return result


@router.post("/{student_id}/gap-report")
async def get_gap_report(
    student_id: int,
    company_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = _get_owned_student(db, student_id, current_user)
    report = await generate_student_gap_report(student, company_id, db)
    return {"report": report}
