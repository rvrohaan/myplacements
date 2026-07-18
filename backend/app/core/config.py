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

    class Config:
        env_file = ".env"


settings = Settings()
