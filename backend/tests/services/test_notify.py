"""app/services/notify.py - fanning an event out to the people who need it.

Two risks pull in opposite directions, and both are worse than a missing
notification.

* **A storm.** An officer uploading round results for forty students must not
  get forty rows. Repeats inside a short window are folded into one, retitled
  with the count - but only while the recipient has not read the row, because
  once they have seen it the next one is news.
* **A fan-out failure taking the request with it.** Nobody should fail to save a
  drive because a notification could not be written. Every event helper is
  wrapped so its failure is contained to itself.

The service also never commits: it writes rows into the caller's session and
lets the caller's transaction decide whether they happened at all.
"""

from datetime import datetime, timedelta

import pytest

from app.models.notification import HIGH, NORMAL, Notification
from app.models.user import UserRole
from app.services import notify as notify_service
from app.services.notify import notify
from tests import factories


@pytest.fixture
def head(db, college):
    return factories.make_user(db, college=college, role=UserRole.PRO_CHANCELLOR)


@pytest.fixture
def officer_user(db, college):
    return factories.make_officer(db, college=college).user


def rows_for(db, user):
    return db.query(Notification).filter(Notification.user_id == user.id).all()


def send(db, college, recipients, **kw):
    """One event, as one request.

    The flush matters. `_coalescable` reads under `no_autoflush` - deliberately,
    so a plain SELECT here cannot flush the caller's half-built objects and
    surface their IntegrityError from inside the fan-out. The consequence is
    that a row still pending in the session is invisible to the next event, so
    coalescing only applies across requests. Flushing here is what makes each
    call in a test represent a separate request, which is how the real callers
    arrive.
    """
    kw.setdefault("type", next(iter(sorted(notify_service.NOTIFICATION_TYPES))))
    kw.setdefault("title", "Something happened")
    created = notify(db, recipients=recipients, college_id=college.id, **kw)
    db.flush()
    return created


# --- who gets told ----------------------------------------------------------


def test_a_recipient_gets_a_row(db, college, head):
    assert send(db, college, [head]) == 1
    assert len(rows_for(db, head)) == 1


def test_nobody_is_told_what_they_just_did_themselves(db, college, head, officer_user):
    """The single most common source of noise."""
    assert send(db, college, [head, officer_user], actor=head) == 1
    assert rows_for(db, head) == []
    assert len(rows_for(db, officer_user)) == 1


def test_a_recipient_named_twice_is_told_once(db, college, head):
    """Leadership and the owning officer frequently overlap in a recipient
    list, and the caller should not have to deduplicate."""
    assert send(db, college, [head, head]) == 1


def test_a_deactivated_account_is_not_notified(db, college, head):
    head.is_active = False
    db.flush()
    assert send(db, college, [head]) == 0


def test_a_missing_recipient_is_skipped_rather_than_raising(db, college, head):
    """Resolvers return None when a company has no officer, and the call sites
    pass that straight through."""
    assert send(db, college, [None, head]) == 1


def test_students_are_not_notified_here(db, college):
    """The portal has its own surfaces; a staff notification is staff-shaped."""
    student = factories.make_student(db, college=college)
    assert send(db, college, [student.user]) == 0


def test_nobody_to_tell_is_not_an_error(db, college):
    assert send(db, college, []) == 0


# --- coalescing -------------------------------------------------------------


def test_repeats_inside_the_window_fold_into_one_row(db, college, head):
    """Forty round results must not become forty notifications."""
    for _ in range(3):
        send(db, college, [head], group_key="drive-7")
    rows = rows_for(db, head)
    assert len(rows) == 1
    assert rows[0].meta["count"] == 3


def test_a_folded_row_is_retitled_with_the_count(db, college, head):
    send(db, college, [head], group_key="drive-7", title="1 student selected")
    send(db, college, [head], group_key="drive-7", group_title="{count} students selected")
    assert rows_for(db, head)[0].title == "2 students selected"


def test_a_folded_row_can_widen_where_it_points(db, college, head):
    """A row that pointed at one student now stands for several."""
    send(db, college, [head], group_key="drive-7", link="/students/1")
    send(db, college, [head], group_key="drive-7", group_link="/drives/7")
    assert rows_for(db, head)[0].link == "/drives/7"


def test_a_folded_row_floats_back_to_the_top(db, college, head):
    send(db, college, [head], group_key="drive-7")
    original = rows_for(db, head)[0].created_at
    send(db, college, [head], group_key="drive-7")
    assert rows_for(db, head)[0].created_at >= original


def test_a_row_the_recipient_has_read_is_not_reused(db, college, head):
    """They have seen it, so the next one is news rather than a repeat."""
    send(db, college, [head], group_key="drive-7")
    read = rows_for(db, head)[0]
    read.read_at = datetime.utcnow()
    db.flush()

    send(db, college, [head], group_key="drive-7")
    assert len(rows_for(db, head)) == 2


def test_an_old_row_is_not_folded_into(db, college, head):
    """Ten minutes later is a separate event, not a repeat of the last one."""
    send(db, college, [head], group_key="drive-7")
    stale = rows_for(db, head)[0]
    stale.created_at = datetime.utcnow() - notify_service._COALESCE_WINDOW - timedelta(minutes=1)
    db.flush()

    send(db, college, [head], group_key="drive-7")
    assert len(rows_for(db, head)) == 2


def test_different_groups_do_not_fold_together(db, college, head):
    send(db, college, [head], group_key="drive-7")
    send(db, college, [head], group_key="drive-8")
    assert len(rows_for(db, head)) == 2


def test_events_with_no_group_never_fold(db, college, head):
    """Most events are individually meaningful and grouping them would hide
    one behind another."""
    send(db, college, [head])
    send(db, college, [head])
    assert len(rows_for(db, head)) == 2


def test_one_persons_repeat_does_not_fold_into_anothers_row(db, college, head, officer_user):
    send(db, college, [head, officer_user], group_key="drive-7")
    send(db, college, [head, officer_user], group_key="drive-7")
    assert len(rows_for(db, head)) == 1
    assert len(rows_for(db, officer_user)) == 1


# --- the row itself ---------------------------------------------------------


def test_a_row_carries_what_the_bell_needs_to_render_it(db, college, head, officer_user):
    send(
        db,
        college,
        [head],
        actor=officer_user,
        title="Drive created",
        body="TCS, 12 Sept",
        link="/drives/7",
        entity_type="drive",
        entity_id=7,
        priority=HIGH,
    )
    row = rows_for(db, head)[0]
    assert (row.title, row.body, row.link) == ("Drive created", "TCS, 12 Sept", "/drives/7")
    assert (row.entity_type, row.entity_id) == ("drive", 7)
    assert row.actor_id == officer_user.id
    assert row.college_id == college.id
    assert row.read_at is None


def test_an_unknown_type_is_refused(db, college, head):
    """The type drives the icon and the filter, so an unrecognised one would
    render as nothing in particular."""
    with pytest.raises(ValueError, match="unknown notification type"):
        notify(db, type="not-a-real-type", recipients=[head], college_id=college.id, title="x")


def test_an_unknown_priority_is_refused(db, college, head):
    with pytest.raises(ValueError, match="unknown priority"):
        send(db, college, [head], priority="urgent")


def test_every_declared_type_is_accepted(db, college, head):
    for type_name in notify_service.NOTIFICATION_TYPES:
        assert notify(
            db, type=type_name, recipients=[head], college_id=college.id, title="x"
        ) == 1


# --- email ------------------------------------------------------------------


def test_a_normal_event_sends_no_email(db, college, head):
    """Most events are read in the bell. Mailing all of them is how people
    filter the sender into a folder."""
    send(db, college, [head], priority=NORMAL)
    assert rows_for(db, head)[0].email_status is None


def test_a_high_priority_event_attempts_an_email(db, college, head):
    """With no provider key configured it is SKIPPED rather than sent, which is
    the state conftest pins - the point is that the attempt was recorded."""
    send(db, college, [head], priority=HIGH)
    assert rows_for(db, head)[0].email_status is not None


def test_email_can_be_suppressed_for_an_event_that_mails_itself(db, college, head):
    """Some events already send their own mail elsewhere; without this the
    recipient would get two."""
    send(db, college, [head], priority=HIGH, email=False)
    assert rows_for(db, head)[0].email_status is None


def test_a_large_fan_out_stays_in_app_only(db, college):
    """An event reaching the whole college must not turn into a mail run inside
    a request."""
    recipients = [
        factories.make_user(db, college=college, role=UserRole.PLACEMENT_OFFICER)
        for _ in range(notify_service._MAX_INLINE_EMAILS + 1)
    ]
    send(db, college, recipients, priority=HIGH)
    assert all(r.email_status is None for user in recipients for r in rows_for(db, user))


# --- containment ------------------------------------------------------------


def test_a_fan_out_failure_does_not_reach_the_caller(db, college, head, monkeypatch):
    """Nobody should fail to save a drive because a notification could not be
    written."""

    @notify_service._never_fails
    def explode(_db):
        raise RuntimeError("the notification table is on fire")

    assert explode(db) == 0


def test_an_event_helper_returns_zero_when_it_fails(db, college, monkeypatch):
    """The wrapper is applied to the real helpers, not just available to them."""
    monkeypatch.setattr(
        notify_service, "_drive_audience", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    drive = factories.make_drive(db, college=college)
    assert notify_service.drive_created(db, drive=drive, actor=None) == 0


def test_notify_does_not_commit(db, college, head):
    """It writes into the caller's session and lets their transaction decide
    whether the event happened at all - so the row is pending, not committed,
    until somebody else says so."""
    created = notify(
        db,
        type=next(iter(sorted(notify_service.NOTIFICATION_TYPES))),
        recipients=[head],
        college_id=college.id,
        title="Something happened",
    )
    assert created == 1
    assert any(isinstance(obj, Notification) for obj in db.new)


def test_coalescing_only_applies_across_requests(db, college, head):
    """Stated rather than discovered. Two events in one request each get their
    own row, because the first is still pending when the second looks for it.
    In practice every call site is its own request, and a single event with
    many recipients is one notify() call rather than many."""
    notify_kwargs = dict(
        type=next(iter(sorted(notify_service.NOTIFICATION_TYPES))),
        recipients=[head],
        college_id=college.id,
        title="x",
        group_key="drive-7",
    )
    notify(db, **notify_kwargs)
    notify(db, **notify_kwargs)
    db.flush()
    assert len(rows_for(db, head)) == 2
