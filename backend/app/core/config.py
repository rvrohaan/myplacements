from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://postgres:password@localhost:5432/myplacements"
    SECRET_KEY: str = "changethis"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7 days
    ANTHROPIC_API_KEY: str = ""
    ENVIRONMENT: str = "development"
    # Apex domain that colleges live under as subdomains, e.g. rit.myplacements.in.
    # The leftmost label of the Host header is matched against College.code.
    BASE_DOMAIN: str = "myplacements.in"
    # Reserved subdomain for the platform console where super_admins sign in
    # (admin.myplacements.in). The apex itself is a public marketing site.
    ADMIN_SUBDOMAIN: str = "admin"
    # Where uploaded files (e.g. student resumes) are stored, relative to the
    # backend working dir. Served read-only at /api/uploads.
    UPLOAD_DIR: str = "uploads"
    MAX_RESUME_MB: int = 5

    # --- Outbound email -----------------------------------------------------
    # Delivery goes through Resend's HTTP API (the same mechanism MyOBE uses),
    # so no SMTP connection is held open from a request handler. With no key
    # set, invites still work - the UI falls back to sharing the link by hand.
    RESEND_API_KEY: str = ""
    MAIL_FROM: str = "MyPlacement.AI <noreply@myplacements.in>"
    # Where replies land. The From address is a no-reply, but people do reply
    # to invites, so point them at a mailbox somebody actually reads.
    MAIL_REPLY_TO: str = ""

    # --- Password-setup links -----------------------------------------------
    # How long a link stays valid. Students get a longer window because logins
    # are switched on in bulk, often well ahead of an orientation session.
    INVITE_EXPIRY_HOURS: int = 168  # 7 days
    STUDENT_INVITE_EXPIRY_HOURS: int = 720  # 30 days
    # Scheme for links we put in messages. http only for local development.
    LINK_SCHEME: str = "https"

    # --- Daily updates ------------------------------------------------------
    # Timestamps are stored naive UTC throughout, but "today", the filing cutoff
    # and the digest window are all local questions for a college. See
    # app/core/timeutil.py.
    LOCAL_TIMEZONE: str = "Asia/Kolkata"
    # Shared secret for the unattended scheduler endpoint
    # (POST /api/daily-updates/cron/run). Blank disables the endpoint entirely.
    CRON_TOKEN: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
