"""Database engine + session factory for the PA Audit Tool backend."""
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

# Load backend/.env (harmless if missing; hosted platforms use real env vars).
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DEFAULT_URL = "postgresql+psycopg://postgres:1234@localhost:5433/pa_audit_tool"


def _normalise(url: str) -> str:
    """Accept plain postgres:// URLs (Neon, Render, Vercel) and force the psycopg driver."""
    url = url.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _normalise(os.getenv("DATABASE_URL", DEFAULT_URL))
SERVERLESS = bool(os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"))

engine_kwargs = {"pool_pre_ping": True, "future": True}
if SERVERLESS:
    # Serverless functions are short-lived; don't keep a pool between invocations.
    engine_kwargs["poolclass"] = NullPool
else:
    engine_kwargs.update(pool_size=5, max_overflow=10)

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
