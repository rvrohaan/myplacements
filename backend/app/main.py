import os
import re

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
    daily_updates,
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
    # Pagination total on list endpoints; custom response headers are hidden from
    # JS unless explicitly exposed.
    expose_headers=["X-Total-Count"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(colleges.router, prefix="/api")
app.include_router(companies.router, prefix="/api")
app.include_router(students.router, prefix="/api")
app.include_router(drives.router, prefix="/api")
app.include_router(officers.router, prefix="/api")
app.include_router(communications.router, prefix="/api")
app.include_router(daily_updates.router, prefix="/api")
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


# Serve the built React SPA in production. The Docker build compiles the frontend
# and copies it to ./static; when that directory is present we serve its hashed
# assets and fall back to index.html for every non-API route so client-side
# routing (deep links, page refresh) works. In local dev the directory is absent
# and Vite serves the frontend via its own proxy, so this block is a no-op.
_STATIC_DIR = "static"
if os.path.isdir(_STATIC_DIR):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(_STATIC_DIR, "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # Never let the SPA fallback mask the API: an unmatched /api path here
        # means a genuine 404, not an index.html page.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        # Serve a real static file when one matches (e.g. favicon); otherwise
        # return index.html and let React Router handle the route.
        candidate = os.path.join(_STATIC_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_STATIC_DIR, "index.html"))
