"""A generated narrative for a dashboard, cached so it is paid for once.

Every other AI feature here is triggered by somebody asking for one thing: a gap
report for this student, skill weights for this role. A dashboard summary is
different — it belongs to the *college*, not to whoever opened the page, and a
placement head, a pro-chancellor and a principal looking at the same morning
would otherwise pay for three identical calls.

So a run is stored against ``(college_id, scope, period)`` and served from here
until something asks for a fresh one. ``period`` is a plain date string rather
than a timestamp: the facts underneath move in days, and a cache that expires in
minutes would bill for noise.

``facts`` keeps the exact numbers the narrative was written from. It is what
makes the text auditable months later — without it, a claim in the summary
cannot be checked against what was true when it was written.
"""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base


class DashboardInsight(Base):
    __tablename__ = "dashboard_insights"
    __table_args__ = (
        UniqueConstraint("college_id", "scope", "period", name="uq_insight_scope_period"),
    )

    id = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id"), nullable=False, index=True)

    #: Which dashboard this belongs to. "college" today; officer-scoped
    #: summaries would be "officer:<id>", which is why it is a string.
    scope = Column(String(64), nullable=False, default="college")
    #: The day the facts were read, as YYYY-MM-DD. See the module docstring.
    period = Column(String(10), nullable=False)

    #: The narrative itself, as a JSON list of paragraphs.
    narrative = Column(Text, nullable=True)
    #: The fact pack it was written from, as JSON. Kept for auditability.
    facts = Column(Text, nullable=False)
    #: The rule-written findings, as JSON. Shown when the model is unavailable,
    #: and the thing the narrative is checked against.
    findings = Column(Text, nullable=False)

    #: False when the model could not be reached or its reply failed the number
    #: check, and the rule-written findings are standing in. Surfaced in the UI
    #: rather than hidden — a summary nobody wrote is worth flagging.
    narrated = Column(Boolean, nullable=False, default=False)
    model = Column(String(64), nullable=True)

    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    generated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    college = relationship("College")
    generated_by = relationship("User")
