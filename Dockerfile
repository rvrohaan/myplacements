# syntax=docker/dockerfile:1

# ---- Stage 1: build the React SPA ----
FROM node:20-slim AS frontend
WORKDIR /frontend
# Install deps against the lockfile first for better layer caching.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build   # Vite outputs to /frontend/dist

# ---- Stage 2: FastAPI backend that also serves the built SPA ----
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
# The compiled SPA is served by FastAPI from ./static (see app/main.py).
COPY --from=frontend /frontend/dist ./static
EXPOSE 8000
# Bind to Railway's injected $PORT in production; fall back to 8000 locally.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
