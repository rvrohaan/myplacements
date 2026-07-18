from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

# pool_pre_ping tests each pooled connection before use and transparently
# reconnects if the server dropped it — required for scale-to-zero Postgres
# (e.g. Neon), where the DB suspends on idle and stale connections would
# otherwise fail the first request after a wake. pool_recycle drops connections
# older than 5 min so none outlive the suspend window.
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
