import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import get_password_hash

from app.models.company import Company
from app.models.drive import (
    Drive,
    DriveParticipant,
    DriveRound,
    DriveRoundResult,
    DriveStatus,
    ParticipantStatus,
)
from app.models.offer import Offer, OfferStatus
from app.models.student import PlacementStatus, Student
from app.models.user import User, UserRole
from app.schemas.drive import (
    DriveCreate,
    DriveOut,
    DriveRoundOut,
    DriveRoundUpdate,
    DriveUpdate,
    ParticipantCreate,
    ParticipantOut,
    ParticipantUpdate,
    RoundUploadSummary,
)
from app.schemas.offer import OfferCreate, OfferOut
from app.routers.students import _backing_email
from app.services.excel_io import XLSX_MEDIA_TYPE, Column, build_workbook
from app.services.round_roster import TEMPLATE_HEADERS, extract_roster
from app.services import notify
from app.services.student_scoring import assess

router = APIRouter(prefix="/drives", tags=["drives"])

# A drive can't have an unbounded number of interview rounds; cap it defensively
# so a bad value can't spawn thousands of rows.
MAX_ROUNDS = 15


def _scope_drives(q, user: User):
    """Restrict a Drive query to the caller's tenant. Mirrors the filter
    companies.list_companies applies: a tenant user sees only their own college's
    drives, and a super_admin (no college of their own) sees everything."""
    if user.college_id:
        q = q.filter(Drive.college_id == user.college_id)
    return q


def _visible_drive(drive_id: int, db: Session, user: User) -> Drive:
    """The drive, or 404 - enforcing the tenant boundary on every single-row
    access. A 404 rather than a 403 so another college's drive doesn't leak its
    existence, the same rule companies._accessible_company follows. Drives that
    predate the college_id backfill carry NULL and stay visible to everyone."""
    drive = db.query(Drive).filter(Drive.id == drive_id).first()
    if not drive or (user.college_id and drive.college_id and drive.college_id != user.college_id):
        raise HTTPException(status_code=404, detail="Drive not found")
    return drive


def _sync_rounds(drive: Drive) -> None:
    """Make the drive's round rows match ``total_rounds``: add missing trailing
    rounds and drop surplus ones. Existing rounds keep their recorded counts."""
    target = drive.total_rounds or 0
    rounds = sorted(drive.rounds, key=lambda r: r.round_number)

    if len(rounds) > target:
        for extra in rounds[target:]:
            drive.rounds.remove(extra)
        rounds = rounds[:target]

    for number in range(len(rounds) + 1, target + 1):
        drive.rounds.append(DriveRound(round_number=number))


def _autofill_appeared(drive: Drive) -> None:
    """Convenience cascade: where a round has a passed count and the next round's
    appeared count is still empty, seed it with that passed count. Never
    overwrites an appeared count the officer has already set — both fields are
    theirs to edit."""
    rounds = sorted(drive.rounds, key=lambda r: r.round_number)
    for prev, nxt in zip(rounds, rounds[1:]):
        if prev.passed_count is not None and nxt.appeared_count is None:
            nxt.appeared_count = prev.passed_count


def _promote_due_drives(db: Session) -> None:
    """Lazy, time-based status transition: any ``upcoming`` drive whose date has
    arrived becomes ``ongoing``. Runs whenever drives are read so filters and
    counts reflect the promotion. Only upcoming → ongoing — ``cancelled`` and
    ``completed`` are left alone, and completion stays a manual action.

    A single bulk UPDATE keeps this cheap enough to run on every read. Note the
    comparison is against UTC now, matching how the app stores/compares times
    elsewhere.
    """
    updated = (
        db.query(Drive)
        .filter(
            Drive.status == DriveStatus.UPCOMING,
            Drive.drive_date.isnot(None),
            Drive.drive_date <= datetime.utcnow(),
        )
        .update({Drive.status: DriveStatus.ONGOING}, synchronize_session=False)
    )
    if updated:
        db.commit()


@router.get("", response_model=list[DriveOut])
def list_drives(
    status: Optional[DriveStatus] = None,
    company_id: Optional[int] = None,
    skip: int = 0,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _promote_due_drives(db)  # flip any drives whose start date has arrived
    q = _scope_drives(db.query(Drive), current_user)
    if status:
        q = q.filter(Drive.status == status)
    if company_id:
        q = q.filter(Drive.company_id == company_id)
    return q.order_by(Drive.drive_date.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=DriveOut, status_code=201)
def create_drive(
    payload: DriveCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    data = payload.model_dump()
    if data.get("total_rounds") is not None:
        data["total_rounds"] = max(0, min(data["total_rounds"], MAX_ROUNDS))
    company = db.query(Company).filter(Company.id == data["company_id"]).first()
    if not company or (
        current_user.college_id and company.college_id and company.college_id != current_user.college_id
    ):
        raise HTTPException(status_code=404, detail="Company not found")
    # Stamp the tenant, without which the drive is invisible to every scoped
    # query. The company is the authority; a super_admin has no college of their
    # own to fall back on.
    drive = Drive(**data, college_id=company.college_id or current_user.college_id)
    db.add(drive)
    _sync_rounds(drive)
    db.flush()  # assign drive.id for the notification's deep link
    notify.drive_created(db, drive=drive, actor=current_user)
    db.commit()
    db.refresh(drive)
    return drive


@router.get("/{drive_id}", response_model=DriveOut)
def get_drive(drive_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _promote_due_drives(db)  # flip any drives whose start date has arrived
    return _visible_drive(drive_id, db, current_user)


@router.put("/{drive_id}", response_model=DriveOut)
def update_drive(
    drive_id: int,
    payload: DriveUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    drive = _visible_drive(drive_id, db, current_user)
    updates = payload.model_dump(exclude_none=True)
    if "total_rounds" in updates:
        updates["total_rounds"] = max(0, min(updates["total_rounds"], MAX_ROUNDS))
    was_status = drive.status
    moved = any(
        field in updates and updates[field] != getattr(drive, field)
        for field in ("drive_date", "registration_deadline")
    )
    for field, value in updates.items():
        setattr(drive, field, value)
    # Keep the round rows in step with any change to the planned round count.
    if "total_rounds" in updates:
        _sync_rounds(drive)

    # Cancelling is the urgent one - registered students have to be told - so it
    # wins if a single edit does both.
    if drive.status == DriveStatus.CANCELLED and was_status != DriveStatus.CANCELLED:
        notify.drive_cancelled(db, drive=drive, actor=current_user)
    elif moved:
        notify.drive_rescheduled(db, drive=drive, actor=current_user)
    db.commit()
    db.refresh(drive)
    return drive


@router.get("/{drive_id}/rounds", response_model=list[DriveRoundOut])
def list_rounds(drive_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    drive = _visible_drive(drive_id, db, current_user)
    return sorted(drive.rounds, key=lambda r: r.round_number)


@router.put("/{drive_id}/rounds/{round_id}", response_model=DriveRoundOut)
def update_round(
    drive_id: int,
    round_id: int,
    payload: DriveRoundUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _visible_drive(drive_id, db, current_user)
    rnd = db.query(DriveRound).filter(
        DriveRound.id == round_id, DriveRound.drive_id == drive_id
    ).first()
    if not rnd:
        raise HTTPException(status_code=404, detail="Round not found")

    fields = payload.model_dump(exclude_unset=True)
    if "name" in fields:
        rnd.name = fields["name"]
    if "appeared_count" in fields:
        appeared = fields["appeared_count"]
        if appeared is not None and appeared < 0:
            raise HTTPException(status_code=400, detail="Appeared count cannot be negative")
        rnd.appeared_count = appeared
    if "passed_count" in fields:
        passed = fields["passed_count"]
        if passed is not None and passed < 0:
            raise HTTPException(status_code=400, detail="Passed count cannot be negative")
        rnd.passed_count = passed
        rnd.conducted_at = datetime.utcnow() if passed is not None else None

    # Cross-field check against the round's final appeared count for this update.
    if rnd.passed_count is not None and rnd.appeared_count is not None and rnd.passed_count > rnd.appeared_count:
        raise HTTPException(
            status_code=400,
            detail=f"Passed count cannot exceed the {rnd.appeared_count} who appeared",
        )

    # Recording a result can seed the next round's appeared count (only if empty).
    _autofill_appeared(rnd.drive)
    db.commit()
    db.refresh(rnd)
    return rnd


@router.get("/rounds/results-template")
def round_results_template(_: User = Depends(get_current_user)):
    """Blank workbook officers fill with a round's roster (Roll Number, Name,
    Status, CTC) and upload back."""
    columns = [Column(header=h, attr=h.lower().replace(" ", "_")) for h in TEMPLATE_HEADERS]
    buffer = build_workbook(columns, [], "Round Results")
    return StreamingResponse(
        buffer,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=round_results_template.xlsx"},
    )


async def _read_roster(file: Optional[UploadFile]) -> tuple[list[dict], bool]:
    if file is None:
        return [], False
    content = await file.read()
    if not content:
        return [], False
    return await extract_roster(content)


@router.post("/{drive_id}/rounds/{round_id}/results", response_model=RoundUploadSummary)
async def upload_round_results(
    drive_id: int,
    round_id: int,
    appeared_file: Optional[UploadFile] = File(None),
    passed_file: Optional[UploadFile] = File(None),
    combined_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ingest a round's roster from one or more .xlsx files and reconcile every
    student's status.

    Accepts either a single ``combined_file`` (a Status column marks pass/fail)
    or an ``appeared_file`` plus optional ``passed_file`` (whose rows may carry a
    CTC). Matches rows to students by roll number, adds any who weren't yet in the
    drive, and updates per-student status — including auto-withdrawing anyone who
    cleared the previous round but is absent here.
    """
    drive = _visible_drive(drive_id, db, current_user)
    rnd = db.query(DriveRound).filter(DriveRound.id == round_id, DriveRound.drive_id == drive_id).first()
    if not rnd:
        raise HTTPException(status_code=404, detail="Round not found")
    if appeared_file is None and passed_file is None and combined_file is None:
        raise HTTPException(status_code=400, detail="Upload at least one roster file")

    appeared_rows, ai_a = await _read_roster(appeared_file)
    passed_rows, ai_p = await _read_roster(passed_file)
    combined_rows, ai_c = await _read_roster(combined_file)

    # Merge the files into an appeared roster and a pass/fail (+ctc) verdict per
    # roll. Rows flagged "absent" are no-shows: kept out of the appeared set so
    # they lead to a withdrawal, never a rejection.
    appeared: dict[str, Optional[str]] = {}
    passed: dict[str, dict] = {}
    absent: set[str] = set()

    def _roll(row: dict) -> str:
        return str(row["roll_number"]).strip()

    for row in combined_rows:
        roll = _roll(row)
        if row.get("status") == "absent":
            absent.add(roll)
            continue
        appeared.setdefault(roll, row.get("name"))
        if row.get("status") is not None:
            passed[roll] = {"passed": row["status"] == "passed", "ctc": row.get("ctc")}
    for row in appeared_rows:
        roll = _roll(row)
        if row.get("status") == "absent":
            absent.add(roll)
            continue
        appeared.setdefault(roll, row.get("name"))
        if row.get("status") is not None and roll not in passed:
            passed[roll] = {"passed": row["status"] == "passed", "ctc": row.get("ctc")}
    for row in passed_rows:
        roll = _roll(row)
        appeared.setdefault(roll, row.get("name"))
        passed[roll] = {"passed": True, "ctc": row.get("ctc")}

    # If a roll shows up both appeared and absent, the appearance wins.
    absent -= set(appeared.keys())

    summary = _apply_round_results(db, drive, rnd, appeared, passed, absent, current_user)
    # One notification for the upload, never one per student: a roster can carry
    # several hundred.
    notify.drive_round_results(
        db, drive=drive, round_number=rnd.round_number, summary=summary, actor=current_user
    )
    db.commit()
    summary["used_ai"] = ai_a or ai_p or ai_c
    summary["round_number"] = rnd.round_number
    return RoundUploadSummary(**summary)


def _reconcile_participant_status(
    db: Session, participant: DriveParticipant, rnd: DriveRound, final_round_number: int, result: DriveRoundResult
) -> None:
    """Roll this round's result up into the participant's overall status, applying
    the placement/offer side effects when they cross into or out of 'selected'."""
    if result.appeared and result.passed is True:
        new = ParticipantStatus.SELECTED if rnd.round_number >= final_round_number else ParticipantStatus.IN_PROCESS
    elif result.appeared and result.passed is False:
        new = ParticipantStatus.REJECTED
    else:  # appeared, outcome not yet decided
        new = ParticipantStatus.ATTENDED

    old = participant.status
    if new == old:
        return
    participant.status = new
    if new == ParticipantStatus.SELECTED:
        _record_selection(db, participant, participant.student, result.ctc)
    elif old == ParticipantStatus.SELECTED:
        _undo_selection(db, rnd.drive_id, participant.student)


def _eliminated_before(db: Session, participant: DriveParticipant, round_number: int) -> bool:
    """Has this student already dropped out of the drive before ``round_number``?
    True if they failed an earlier round or have withdrawn — used to ignore stale
    rows when a full roster is re-uploaded for a later round."""
    failed_prior = (
        db.query(DriveRoundResult)
        .join(DriveRound, DriveRoundResult.round_id == DriveRound.id)
        .filter(
            DriveRoundResult.participant_id == participant.id,
            DriveRound.round_number < round_number,
            DriveRoundResult.passed.is_(False),
        )
        .first()
        is not None
    )
    return failed_prior or participant.status == ParticipantStatus.WITHDRAWN


def _create_stub_student(
    db: Session, roll: str, name: Optional[str], college_id: Optional[int]
) -> Student:
    """Add a minimal student record for a roll number that appeared in a round
    roster but wasn't yet in the database, mirroring the login-less backing user
    that ``students.import_students`` creates. Branch and batch year are
    placeholders the roster doesn't carry ('Unknown' / 0) for the officer to fill
    in later; the profile is enough to track the student through the drive."""
    backing_user = User(
        email=_backing_email(roll, college_id),
        full_name=name or roll,
        hashed_password=get_password_hash(secrets.token_urlsafe(32)),
        role=UserRole.STUDENT,
        college_id=college_id,
        is_active=False,
    )
    db.add(backing_user)
    db.flush()  # assign backing_user.id without committing yet

    student = Student(
        user_id=backing_user.id,
        roll_number=roll,
        branch="Unknown",
        batch_year=0,  # batch_year is a non-null int; 0 is the "unknown" sentinel
        college_id=college_id,
    )
    student.readiness_score, student.risk_category = assess(
        student.cgpa, student.backlogs, student.skills, PlacementStatus.UNPLACED
    )
    db.add(student)
    db.flush()  # assign student.id for the participant FK below
    return student


def _apply_round_results(
    db: Session, drive: Drive, rnd: DriveRound, appeared: dict, passed: dict, absent: set, current_user: User
) -> dict:
    """Create/refresh participants and per-round results for an uploaded roster,
    reconcile statuses, auto-withdraw no-shows, and refresh the round's counts."""
    college_id = drive.college_id if drive.college_id is not None else current_user.college_id
    final_round_number = max((r.round_number for r in drive.rounds), default=rnd.round_number)

    def _match(roll: str) -> Optional[Student]:
        q = db.query(Student).filter(Student.roll_number == roll)
        if college_id is not None:
            q = q.filter(Student.college_id == college_id)
        return q.first()

    created_students = 0
    created = 0
    skipped = 0
    appeared_rolls: set[str] = set()

    for roll, name in appeared.items():
        student = _match(roll)
        if not student:
            # The roster lists a student we don't have on file yet — create a
            # minimal profile (with a login-less backing account) so they're
            # tracked through the drive instead of being silently dropped.
            student = _create_stub_student(db, roll, name, college_id)
            created_students += 1

        participant = db.query(DriveParticipant).filter(
            DriveParticipant.drive_id == drive.id, DriveParticipant.student_id == student.id
        ).first()

        # A student already knocked out in an earlier round shouldn't re-enter just
        # because they're still listed in a re-uploaded roster. Skip them, and drop
        # any result a previous (buggy) upload left on this round so counts heal.
        if participant is not None and _eliminated_before(db, participant, rnd.round_number):
            stale = db.query(DriveRoundResult).filter(
                DriveRoundResult.round_id == rnd.id, DriveRoundResult.participant_id == participant.id
            ).first()
            if stale:
                db.delete(stale)
            skipped += 1
            continue

        appeared_rolls.add(roll)
        if not participant:
            participant = DriveParticipant(
                drive_id=drive.id, student_id=student.id, status=ParticipantStatus.REGISTERED
            )
            db.add(participant)
            db.flush()
            created += 1

        result = db.query(DriveRoundResult).filter(
            DriveRoundResult.round_id == rnd.id, DriveRoundResult.participant_id == participant.id
        ).first()
        if not result:
            result = DriveRoundResult(round_id=rnd.id, participant_id=participant.id)
            db.add(result)
        result.appeared = True
        verdict = passed.get(roll)
        if verdict is not None:
            result.passed = verdict["passed"]
            if verdict.get("ctc") is not None:
                result.ctc = verdict["ctc"]
        db.flush()
        _reconcile_participant_status(db, participant, rnd, final_round_number, result)

    # No-shows explicitly flagged "absent": drop any result they have for this
    # round (e.g. left over from an earlier upload) so they aren't counted as
    # appeared. Their status is settled by the auto-withdraw pass below.
    for roll in absent:
        student = _match(roll)
        if not student:
            continue
        participant = db.query(DriveParticipant).filter(
            DriveParticipant.drive_id == drive.id, DriveParticipant.student_id == student.id
        ).first()
        if not participant:
            continue
        stale = db.query(DriveRoundResult).filter(
            DriveRoundResult.round_id == rnd.id, DriveRoundResult.participant_id == participant.id
        ).first()
        if stale:
            db.delete(stale)
            db.flush()

    # Auto-withdraw: cleared the previous round but did not turn up for this one.
    withdrawn = 0
    prev_round = next((r for r in drive.rounds if r.round_number == rnd.round_number - 1), None)
    if prev_round:
        prev_passed = db.query(DriveRoundResult).filter(
            DriveRoundResult.round_id == prev_round.id, DriveRoundResult.passed.is_(True)
        ).all()
        for pr in prev_passed:
            part = pr.participant
            roll = part.student.roll_number if part.student else None
            if roll and roll not in appeared_rolls and part.status != ParticipantStatus.WITHDRAWN:
                if part.status == ParticipantStatus.SELECTED:
                    _undo_selection(db, drive.id, part.student)
                part.status = ParticipantStatus.WITHDRAWN
                withdrawn += 1

    # Refresh the round's aggregate counts from the actual per-student results.
    results = db.query(DriveRoundResult).filter(DriveRoundResult.round_id == rnd.id).all()
    rnd.appeared_count = sum(1 for x in results if x.appeared)
    rnd.passed_count = sum(1 for x in results if x.passed is True)
    if rnd.conducted_at is None:
        rnd.conducted_at = datetime.utcnow()
    _autofill_appeared(drive)

    return {
        "appeared": rnd.appeared_count,
        "passed": rnd.passed_count,
        "withdrawn": withdrawn,
        "created_participants": created,
        "created_students": created_students,
        "skipped_eliminated": skipped,
        "unmatched": [],
    }


@router.get("/{drive_id}/participants", response_model=list[ParticipantOut])
def list_participants(
    drive_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    _visible_drive(drive_id, db, current_user)
    return db.query(DriveParticipant).filter(DriveParticipant.drive_id == drive_id).all()


@router.post("/{drive_id}/participants", response_model=ParticipantOut, status_code=201)
def add_participant(
    drive_id: int,
    payload: ParticipantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _visible_drive(drive_id, db, current_user)
    existing = db.query(DriveParticipant).filter(
        DriveParticipant.drive_id == drive_id,
        DriveParticipant.student_id == payload.student_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Student already registered for this drive")
    participant = DriveParticipant(drive_id=drive_id, student_id=payload.student_id)
    db.add(participant)
    db.commit()
    db.refresh(participant)
    return participant


@router.put("/{drive_id}/participants/{participant_id}", response_model=ParticipantOut)
def update_participant_status(
    drive_id: int,
    participant_id: int,
    payload: ParticipantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _visible_drive(drive_id, db, current_user)
    participant = db.query(DriveParticipant).filter(
        DriveParticipant.id == participant_id,
        DriveParticipant.drive_id == drive_id
    ).first()
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    old_status = participant.status
    participant.status = payload.status
    if payload.rejection_reason:
        participant.rejection_reason = payload.rejection_reason

    student = db.query(Student).filter(Student.id == participant.student_id).first()

    if payload.status == ParticipantStatus.SELECTED:
        _record_selection(db, participant, student, payload.ctc)
        if old_status != ParticipantStatus.SELECTED:
            notify.drive_selection(
                db,
                drive=participant.drive,
                student_name=student.full_name if student else None,
                actor=current_user,
            )
    elif old_status == ParticipantStatus.SELECTED:
        # A previous selection was undone — drop its offer and re-evaluate placement.
        _undo_selection(db, drive_id, student)

    db.commit()
    db.refresh(participant)
    return participant


def _record_selection(db: Session, participant: DriveParticipant, student: Student | None, ctc: float | None) -> None:
    """Mark the selected student placed and upsert a drive-linked, accepted offer.
    The Student row drives placement/CTC analytics; the Offer row feeds offer counts."""
    if not student:
        return
    drive = participant.drive
    student.placement_status = PlacementStatus.PLACED
    if ctc is not None:
        student.placement_ctc = ctc
    student.readiness_score, student.risk_category = assess(
        student.cgpa, student.backlogs, student.skills, PlacementStatus.PLACED
    )

    offer = (
        db.query(Offer)
        .filter(Offer.student_id == student.id, Offer.drive_id == participant.drive_id)
        .first()
    )
    if offer is None:
        offer = Offer(student_id=student.id, drive_id=participant.drive_id, role=drive.job_role if drive else None)
        db.add(offer)
    if ctc is not None:
        offer.ctc = ctc
    offer.status = OfferStatus.ACCEPTED


def _undo_selection(db: Session, drive_id: int, student: Student | None) -> None:
    """Remove this drive's offer for the student; if nothing else keeps them placed,
    revert them to unplaced."""
    if not student:
        return
    offer = (
        db.query(Offer)
        .filter(Offer.student_id == student.id, Offer.drive_id == drive_id)
        .first()
    )
    if offer:
        db.delete(offer)
        db.flush()
    remaining = db.query(Offer).filter(Offer.student_id == student.id).count()
    if not remaining:
        student.placement_status = PlacementStatus.UNPLACED
        student.placement_ctc = None
        student.readiness_score, student.risk_category = assess(
            student.cgpa, student.backlogs, student.skills, PlacementStatus.UNPLACED
        )


@router.post("/{drive_id}/offers", response_model=OfferOut, status_code=201)
def create_offer(
    drive_id: int,
    payload: OfferCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    drive = _visible_drive(drive_id, db, current_user)
    offer = Offer(**payload.model_dump(), drive_id=drive_id)
    db.add(offer)
    notify.drive_offer(db, drive=drive, actor=current_user)
    db.commit()
    db.refresh(offer)
    return offer


@router.get("/{drive_id}/offers", response_model=list[OfferOut])
def list_offers(drive_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _visible_drive(drive_id, db, current_user)
    return db.query(Offer).filter(Offer.drive_id == drive_id).all()
