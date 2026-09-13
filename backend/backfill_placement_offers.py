"""Backfill the placement offers that a pre-fix bug dropped.

``_sync_placement_offer`` used to stand aside whenever a student had *any* real
offer row, including a rejected or still-pending one. A student marked placed by
hand — the Students page, not a drive — who had earlier been rejected somewhere
therefore ended up with their package recorded **only** on the student row: the
Students table showed it, and every offer-based figure (the Offers tab's highest
and median CTC, the offer counts, the company and role breakdowns) never saw it.

The code is fixed, but a fix that only runs on save leaves existing rows wrong
until somebody happens to re-save each one. This repairs them in one pass.

Dry run by default — it prints what it would do and writes nothing::

    python backfill_placement_offers.py
    python backfill_placement_offers.py --apply
"""

import sys

from app.core.database import SessionLocal
from app.models.offer import Offer, OfferStatus
from app.models.student import PlacementStatus, Student
from app.services.placement import LIVE_STATUSES

APPLY = "--apply" in sys.argv


def main() -> None:
    db = SessionLocal()
    try:
        placed = (
            db.query(Student)
            .filter(Student.placement_status == PlacementStatus.PLACED)
            .all()
        )
        repaired = 0
        for student in placed:
            offers = db.query(Offer).filter(Offer.student_id == student.id).all()
            if any(o.status in LIVE_STATUSES for o in offers):
                continue  # a live offer already records this placement
            placeholder = next(
                (o for o in offers if o.drive_id is None and o.company_id is None), None
            )
            if placeholder is not None and placeholder.ctc == student.placement_ctc:
                continue
            action = "update" if placeholder is not None else "create"
            print(
                f"  {action:6} placeholder for {student.roll_number} "
                f"(college {student.college_id}) at {student.placement_ctc} LPA"
            )
            repaired += 1
            if not APPLY:
                continue
            if placeholder is None:
                placeholder = Offer(student_id=student.id, drive_id=None)
                db.add(placeholder)
            placeholder.ctc = student.placement_ctc
            placeholder.status = OfferStatus.ACCEPTED

        if APPLY:
            db.commit()
            print(f"\nRepaired {repaired} placement(s).")
        else:
            print(
                f"\nDry run: {repaired} placement(s) would be repaired. "
                "Re-run with --apply to write them."
            )
    finally:
        db.close()


if __name__ == "__main__":
    main()
