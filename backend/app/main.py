import os
import re

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.database import Base, engine
from app.core.migrations import run_migrations
from app.routers import (
    analytics,
    auth,
    colleges,
    communications,
    companies,
    drives,
    officers,
    portal,
    students,
    training,
    users,
)

import app.models  # ensure all models are registered before create_all

Base.metadata.create_all(bind=engine)
run_migrations(engine)  # add columns to pre-existing tables

app = FastAPI(title="MyPlacement.AI", version="1.0.0", docs_url="/api/docs", redoc_url="/api/redoc")

# Allow the apex domain and any college subdomain (in prod), plus localhost and
# *.localhost subdomains (in dev). Regex is required because the set of tenant
# subdomains is open-ended.
_base = re.escape(settings.BASE_DOMAIN)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=rf"https?://([a-z0-9-]+\.)*({_base}|localhost)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(colleges.router, prefix="/api")
app.include_router(companies.router, prefix="/api")
app.include_router(students.router, prefix="/api")
app.include_router(drives.router, prefix="/api")
app.include_router(officers.router, prefix="/api")
app.include_router(communications.router, prefix="/api")
app.include_router(training.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(portal.router, prefix="/api")

# Serve uploaded files (student resumes) read-only. Under /api so the dev proxy
# forwards it and it stays same-origin in production.
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "MyPlacement.AI"}
