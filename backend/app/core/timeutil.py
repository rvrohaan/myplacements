"""Local-time helpers for the daily-update feature.

Every timestamp in this project is stored as a naive UTC value
(``datetime.utcnow()``), which is fine for ordering but useless for answering
local questions. "What did you do today?", "was this filed before 7pm?" and
"which day does this digest cover?" are all questions about the college's own
clock: in IST a 19:00 cutoff is 13:30 UTC, and the local day starts at 18:30 UTC
the previous evening.

So this module converts in one direction only - it takes a *local* day or time
and produces the naive-UTC bounds to compare stored columns against. Nothing
here changes how anything is stored.
"""

import logging
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.config import settings

logger = logging.getLogger(__name__)

UTC = timezone.utc


def _load_zone(name: str):
    """Resolve the configured zone, falling back to UTC if the platform has no
    Olson database. ``tzdata`` is pinned in requirements.txt precisely so this
    fallback never fires in a deployed image - but a missing OS package should
    degrade one feature's clock, not stop the service from booting."""
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        logger.error(
            "Timezone %r unavailable (is tzdata installed?) - daily updates will "
            "use UTC, so cutoffs and day boundaries will be wrong.",
            name,
        )
        return UTC


# Single college group, single timezone. If colleges ever span timezones this
# becomes a per-College column and these helpers take one as an argument.
LOCAL_TZ = _load_zone(settings.LOCAL_TIMEZONE)

# Used when a college has no cutoff configured.
DEFAULT_CUTOFF = "19:00"


def local_now() -> datetime:
    """Current time on the college's clock (tz-aware)."""
    return datetime.now(LOCAL_TZ)


def local_today() -> date:
    """The date it is locally - not the UTC date, which can differ by a day."""
    return local_now().date()


def to_local(naive_utc: datetime | None) -> datetime | None:
    """Read a stored naive-UTC timestamp back on the local clock."""
    if naive_utc is None:
        return None
    if naive_utc.tzinfo is None:
        naive_utc = naive_utc.replace(tzinfo=UTC)
    return naive_utc.astimezone(LOCAL_TZ)


def to_naive_utc(aware: datetime) -> datetime:
    """Back to the shape the database columns use."""
    return aware.astimezone(UTC).replace(tzinfo=None)


def day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    """Naive-UTC half-open range ``[start, end)`` covering one local day.

    For Asia/Kolkata, 2026-09-12 spans 2026-09-11 18:30 to 2026-09-12 18:30 UTC.
    Compare stored columns against these, never against ``day`` itself.
    """
    start_local = datetime.combine(day, time.min, tzinfo=LOCAL_TZ)
    end_local = datetime.combine(day + timedelta(days=1), time.min, tzinfo=LOCAL_TZ)
    return to_naive_utc(start_local), to_naive_utc(end_local)


def parse_cutoff(hhmm: str | None, day: date) -> datetime:
    """The filing deadline for ``day`` as a tz-aware local instant.

    A malformed or missing value falls back to the default rather than raising:
    a bad setting must not take the whole feature down.
    """
    raw = (hhmm or "").strip() or DEFAULT_CUTOFF
    try:
        hours, _, minutes = raw.partition(":")
        parsed = time(int(hours), int(minutes or 0))
    except (TypeError, ValueError):
        hours, _, minutes = DEFAULT_CUTOFF.partition(":")
        parsed = time(int(hours), int(minutes))
    return datetime.combine(day, parsed, tzinfo=LOCAL_TZ)


def is_past_cutoff(hhmm: str | None, day: date, at: datetime | None = None) -> bool:
    """Whether ``at`` (default now) falls after ``day``'s cutoff."""
    return (at or local_now()) > parse_cutoff(hhmm, day)
