"""Outbound notifications.

Email goes through Resend's HTTP API - the same mechanism MyOBE uses - so no
SMTP connection has to be held open from inside a request handler. Senders
return a status string and never raise: provisioning a user must not fail
because a mail vendor is down, so the caller records the outcome on the invite
and the UI offers the link for manual sharing instead.

SMS and WhatsApp are not automated yet. Both need lead-time registrations in
India (DLT for SMS, a Meta-approved template for WhatsApp) and neither users
nor students carry a phone number in the schema today, so the UI shares links
from the sender's own device via a wa.me handoff.
"""

import logging
from html import escape

from app.core.config import settings

logger = logging.getLogger(__name__)

# Delivery outcomes recorded on UserInvite.email_status.
SENT = "sent"
FAILED = "failed"
SKIPPED = "skipped"

# Student backing accounts use placeholder addresses on this domain; nothing
# sent there could ever arrive. See students._backing_email.
_UNDELIVERABLE_DOMAIN = "no-login.myplacement.app"


def email_enabled() -> bool:
    """True when a provider key is configured. Without one we still generate
    links - the admin shares them by hand - so this is not an error."""
    return bool(settings.RESEND_API_KEY.strip())


def is_deliverable(address: str | None) -> bool:
    """False for the synthetic addresses on login-less student accounts."""
    if not address or "@" not in address:
        return False
    return not address.lower().endswith(_UNDELIVERABLE_DOMAIN)


def send_email(to: str, subject: str, html: str, text: str) -> str:
    """Deliver one message. Returns SENT, FAILED or SKIPPED."""
    if not email_enabled():
        logger.warning("RESEND_API_KEY not set - email to %s not sent", to)
        return SKIPPED
    if not is_deliverable(to):
        return SKIPPED
    try:
        import resend  # imported lazily so the app boots without the dependency
    except ImportError:
        # A missing dependency looks nothing like a vendor outage, so say so
        # rather than letting it fall into the generic handler below.
        logger.error(
            "The 'resend' package is not installed, so email to %s was not sent. "
            "Run: pip install -r requirements.txt",
            to,
        )
        return FAILED

    try:
        resend.api_key = settings.RESEND_API_KEY.strip()
        payload = {
            "from": settings.MAIL_FROM,
            "to": [to],
            "subject": subject,
            "html": html,
            "text": text,
        }
        reply_to = settings.MAIL_REPLY_TO.strip()
        if reply_to:
            payload["reply_to"] = reply_to
        resend.Emails.send(payload)
        return SENT
    except Exception as exc:  # vendor/network trouble must not break the request
        logger.error("Resend error sending to %s: %s", to, exc)
        return FAILED


def _expiry_phrase(hours: int) -> str:
    if hours % 24 == 0:
        days = hours // 24
        return f"{days} day{'s' if days != 1 else ''}"
    return f"{hours} hour{'s' if hours != 1 else ''}"


def send_invite_email(
    to: str,
    name: str,
    college_name: str | None,
    url: str,
    expires_hours: int,
    is_reset: bool = False,
) -> str:
    """Password-setup link, for a new account or a re-issued one."""
    greeting = f"Hi {name}," if name else "Hi,"
    who = college_name or "MyPlacement.AI"
    expiry = _expiry_phrase(expires_hours)

    if is_reset:
        subject = "Set a new password for MyPlacement.AI"
        lead = f"A new password-setup link has been issued for your {who} account on MyPlacement.AI."
        cta = "Set my password"
    else:
        subject = f"You have been added to MyPlacement.AI by {who}"
        lead = f"{who} has added you to MyPlacement.AI, its placement management system."
        cta = "Set my password"

    text = (
        f"{greeting}\n\n"
        f"{lead}\n\n"
        f"Choose your password here (the link expires in {expiry} and can be used once):\n"
        f"{url}\n\n"
        "If you weren't expecting this, you can safely ignore this email."
    )
    html = (
        f"<p>{escape(greeting)}</p>"
        f"<p>{escape(lead)}</p>"
        f'<p><a href="{escape(url, quote=True)}" style="display:inline-block;padding:10px 24px;'
        'background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">'
        f"{cta}</a></p>"
        f'<p style="color:#64748b;font-size:.85em;">The link expires in {expiry} and can be used '
        "once. If you weren't expecting this, ignore this email.</p>"
    )
    return send_email(to, subject, html, text)


def send_daily_update_reminder(
    to: str,
    name: str,
    college_name: str | None,
    url: str,
    cutoff: str,
) -> str:
    """Nudge sent shortly before the filing deadline to whoever has not filed."""
    greeting = f"Hi {name}," if name else "Hi,"
    who = college_name or "MyPlacement.AI"

    text = (
        f"{greeting}\n\n"
        f"Your daily update for {who} is not in yet. It takes a minute - the call "
        f"and drive counts are filled in for you, so you only add the highlights, "
        f"anything blocking you, and tomorrow's plan.\n\n"
        f"File it here (today's cutoff is {cutoff}):\n{url}\n"
    )
    html = (
        f"<p>{escape(greeting)}</p>"
        f"<p>Your daily update for {escape(who)} is not in yet. It takes a minute - the "
        "call and drive counts are filled in for you, so you only add the highlights, "
        "anything blocking you, and tomorrow's plan.</p>"
        f'<p><a href="{escape(url, quote=True)}" style="display:inline-block;padding:10px 24px;'
        'background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">'
        "File my update</a></p>"
        f'<p style="color:#64748b;font-size:.85em;">Today\'s cutoff is {escape(cutoff)}.</p>'
    )
    return send_email(to, f"Daily update pending - {who}", html, text)


def _digest_rows_html(digest: dict) -> str:
    """One row per person who filed, newest concerns first."""
    rows = []
    for update in digest.get("updates", []):
        metrics = update.get("metrics") or {}
        counts = " &middot; ".join(
            f"{metrics[key]} {one if metrics[key] == 1 else many}"
            for key, one, many in (
                ("calls", "call", "calls"),
                ("meetings", "meeting", "meetings"),
                ("companies_touched", "company", "companies"),
                ("offers", "offer", "offers"),
            )
            if metrics.get(key)
        ) or "no recorded activity"
        flag = " &#9888;" if update.get("needs_escalation") else ""
        status = update.get("status") or ""
        rows.append(
            '<tr><td style="padding:6px 12px 6px 0;border-bottom:1px solid #e2e8f0;">'
            f"<strong>{escape(update.get('submitted_by_name') or 'Unknown')}</strong>{flag}"
            f'<br><span style="color:#64748b;font-size:.85em;">{counts}</span></td>'
            '<td style="padding:6px 0;border-bottom:1px solid #e2e8f0;color:#64748b;'
            f'font-size:.85em;white-space:nowrap;">{escape(status.replace("_", " "))}</td></tr>'
        )
    if not rows:
        return '<p style="color:#64748b;">Nobody filed an update today.</p>'
    return (
        '<table style="border-collapse:collapse;width:100%;max-width:520px;">'
        + "".join(rows)
        + "</table>"
    )


def send_daily_digest_email(
    to: str,
    name: str,
    college_name: str | None,
    day,
    digest: dict,
    url: str,
) -> str:
    """The end-of-day roll-up for leadership: compliance, escalations, then the
    per-person detail. Exceptions lead, because that is what needs a decision."""
    greeting = f"Hi {name}," if name else "Hi,"
    who = college_name or "MyPlacement.AI"
    compliance = digest.get("compliance", {})
    attention = digest.get("attention", {})
    totals = digest.get("totals", {})

    filed = compliance.get("filed", 0)
    expected = compliance.get("expected", 0)
    late = compliance.get("late", 0)
    escalations = attention.get("escalations", [])
    not_filed = attention.get("not_filed", [])

    headline = f"{filed}/{expected} filed"
    if late:
        headline += f", {late} late"
    if escalations:
        headline += f", {len(escalations)} escalation{'s' if len(escalations) != 1 else ''}"

    activity = (
        f"{totals.get('calls', 0)} calls, {totals.get('meetings', 0)} meetings, "
        f"{totals.get('companies_touched', 0)} companies touched, "
        f"{totals.get('offers', 0)} offers"
    )

    text_lines = [
        greeting,
        "",
        f"Daily placement update for {who} - {day}",
        f"  {headline}",
        f"  {activity}",
    ]
    if escalations:
        text_lines += ["", "Needs your attention:"]
        text_lines += [
            f"  - {item.get('name')}: {item.get('escalation_note') or 'escalation flagged'}"
            for item in escalations
        ]
    if not_filed:
        text_lines += ["", "Did not file: " + ", ".join(p.get("name") or "?" for p in not_filed)]
    text_lines += ["", f"Full digest: {url}"]

    escalation_html = ""
    if escalations:
        items = "".join(
            f"<li><strong>{escape(item.get('name') or 'Unknown')}</strong>: "
            f"{escape(item.get('escalation_note') or 'escalation flagged')}</li>"
            for item in escalations
        )
        escalation_html = (
            '<div style="border-left:3px solid #f59e0b;padding:8px 14px;margin:16px 0;'
            'background:#fffbeb;">'
            '<p style="margin:0 0 6px;font-weight:700;">Needs your attention</p>'
            f'<ul style="margin:0;padding-left:18px;">{items}</ul></div>'
        )

    not_filed_html = ""
    if not_filed:
        names = ", ".join(escape(person.get("name") or "?") for person in not_filed)
        not_filed_html = (
            f'<p style="color:#b91c1c;margin:12px 0;"><strong>Did not file:</strong> {names}</p>'
        )

    html = (
        f"<p>{escape(greeting)}</p>"
        f"<p><strong>Daily placement update for {escape(who)} &mdash; {escape(str(day))}</strong></p>"
        f'<p style="font-size:1.05em;margin:4px 0;">{escape(headline)}</p>'
        f'<p style="color:#64748b;margin:4px 0 16px;">{escape(activity)}</p>'
        f"{escalation_html}{not_filed_html}"
        f"{_digest_rows_html(digest)}"
        f'<p style="margin-top:20px;"><a href="{escape(url, quote=True)}" '
        'style="display:inline-block;padding:10px 24px;background:#4f46e5;color:#fff;'
        'text-decoration:none;border-radius:8px;font-weight:700;">Open the digest</a></p>'
    )

    subject = f"{who} placement update - {headline}"
    return send_email(to, subject, html, "\n".join(text_lines))


def send_notification_email(
    to: str,
    name: str,
    college_name: str | None,
    title: str,
    body: str | None,
    url: str,
) -> str:
    """A single high-priority in-app notification, mirrored to email.

    Only the handful of events services.notify marks HIGH come through here -
    something that wants acting on before the end of the day - so the format is
    deliberately plain: the headline, the detail, and a link to the page that
    shows it.
    """
    greeting = f"Hi {name}," if name else "Hi,"
    who = college_name or "MyPlacement.AI"

    text = f"{greeting}\n\n{title}\n"
    if body:
        text += f"\n{body}\n"
    text += f"\nOpen it here:\n{url}\n"

    detail = f"<p>{escape(body)}</p>" if body else ""
    html = (
        f"<p>{escape(greeting)}</p>"
        f'<p style="font-size:1.05em;font-weight:700;margin:4px 0;">{escape(title)}</p>'
        f"{detail}"
        f'<p style="margin-top:20px;"><a href="{escape(url, quote=True)}" '
        'style="display:inline-block;padding:10px 24px;background:#4f46e5;color:#fff;'
        'text-decoration:none;border-radius:8px;font-weight:700;">Open MyPlacement.AI</a></p>'
        f'<p style="color:#64748b;font-size:.85em;">You are receiving this because it '
        f"needs attention today at {escape(who)}.</p>"
    )
    return send_email(to, f"{who}: {title}", html, text)
