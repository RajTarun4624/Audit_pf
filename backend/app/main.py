"""PA Task Audit — FastAPI backend.

Endpoints
  GET    /api/health                 → {"ok": true, "database": "connected"}
  GET    /api/records                → {"ok": true, "records": [...], "count": n}
  GET    /api/records/{record_id}    → one audit with its non-pass checkpoints
  POST   /api/records                → save a submitted audit (JSON body = AuditIn)
  DELETE /api/records/{record_id}    → remove an audit (and its checkpoints)
  GET    /api/stats                  → verdict counts
  GET    /api/export/audits.csv      → every audit, one row each
  GET    /api/export/issues.csv      → every failed / N/A checkpoint with its note
  GET    /  (and *.html)              → the frontend pages in frontend/
"""
import csv
import io
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Query
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from . import models
from .database import Base, engine, get_db
from .schemas import AuditIn, AuditOut, Stats

ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIR = ROOT / "frontend"

_tables_ready = False


def ensure_tables() -> None:
    """Create tables on first use. Safe to call repeatedly (idempotent)."""
    global _tables_ready
    if _tables_ready:
        return
    Base.metadata.create_all(bind=engine)
    _tables_ready = True


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        ensure_tables()
    except SQLAlchemyError as exc:  # keep serving so /api/health can explain the problem
        print(f"[pa-audit] database not ready at startup: {exc}")
    yield


app = FastAPI(title="PA Task Audit API", version="3.0.0", lifespan=lifespan)

_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(SQLAlchemyError)
async def _db_error(_, exc: SQLAlchemyError):
    first_line = str(exc).splitlines()[0][:300] if str(exc) else exc.__class__.__name__
    return JSONResponse(status_code=503, content={"ok": False, "error": f"Database error: {first_line}"})


# ── API ───────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    try:
        ensure_tables()
        db.execute(text("select 1"))
        count = db.scalar(select(func.count(models.Audit.id)))
        return {"ok": True, "database": "connected", "records": count}
    except SQLAlchemyError as exc:
        first_line = str(exc).splitlines()[0][:300] if str(exc) else exc.__class__.__name__
        return JSONResponse(status_code=503, content={"ok": False, "database": "unreachable", "error": first_line})


def _out(a: models.Audit) -> dict:
    return AuditOut.model_validate(a).model_dump(mode="json")


def _parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(400, f"invalid date '{value}', expected YYYY-MM-DD")


def _apply_filters(stmt, auditor, verdict, queue, date_from, date_to, q):
    """Shared filters for the list and export endpoints. All are optional."""
    A = models.Audit
    if auditor:
        stmt = stmt.where(A.auditor.ilike(auditor))
    if verdict:
        stmt = stmt.where(A.verdict == verdict)
    if queue:
        stmt = stmt.where(A.queue_name.ilike(queue))
    if date_from:
        stmt = stmt.where(func.date(A.submitted_at) >= _parse_day(date_from))
    if date_to:
        stmt = stmt.where(func.date(A.submitted_at) <= _parse_day(date_to))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(A.record_id.ilike(like), A.batch_id.ilike(like), A.task_id.ilike(like),
                              A.queue_name.ilike(like), A.auditor.ilike(like), A.annotator.ilike(like)))
    return stmt


FilterParams = {
    "auditor": Query(None, description="exact QE name (case-insensitive)"),
    "verdict": Query(None, description="Approved | Conditional pass | Hold"),
    "queue": Query(None, description="exact queue name (case-insensitive)"),
    "date_from": Query(None, description="YYYY-MM-DD, submitted on/after"),
    "date_to": Query(None, description="YYYY-MM-DD, submitted on/before"),
    "q": Query(None, description="free text over record/batch/task/queue/QE/annotator"),
}


@app.get("/api/records")
def list_records(
    db: Session = Depends(get_db),
    auditor: str | None = FilterParams["auditor"], verdict: str | None = FilterParams["verdict"],
    queue: str | None = FilterParams["queue"], date_from: str | None = FilterParams["date_from"],
    date_to: str | None = FilterParams["date_to"], q: str | None = FilterParams["q"],
):
    ensure_tables()
    stmt = select(models.Audit).options(selectinload(models.Audit.checks)).order_by(models.Audit.submitted_at.desc())
    stmt = _apply_filters(stmt, auditor, verdict, queue, date_from, date_to, q)
    rows = db.scalars(stmt).all()
    return {"ok": True, "count": len(rows), "records": [_out(a) for a in rows]}


@app.get("/api/records/{record_id}")
def get_record(record_id: str, db: Session = Depends(get_db)):
    ensure_tables()
    a = db.scalar(
        select(models.Audit).options(selectinload(models.Audit.checks)).where(models.Audit.record_id == record_id)
    )
    if not a:
        raise HTTPException(404, "record not found")
    return {"ok": True, "record": _out(a)}


@app.post("/api/records", status_code=201)
def create_record(payload: AuditIn, db: Session = Depends(get_db)):
    ensure_tables()
    existing = db.scalar(
        select(models.Audit).options(selectinload(models.Audit.checks)).where(models.Audit.record_id == payload.record_id)
    )
    if existing:
        # Idempotent: a retried upload of the same audit is not an error.
        return JSONResponse(status_code=200, content={"ok": True, "duplicate": True, "record": _out(existing)})

    data = payload.model_dump(exclude={"checks"})
    data["submitted_at"] = payload.submitted_at or datetime.now(timezone.utc)
    audit = models.Audit(**data)
    audit.checks = [models.AuditCheck(**c.model_dump()) for c in payload.checks]
    db.add(audit)
    db.commit()
    db.refresh(audit)
    return {"ok": True, "record": _out(audit)}


@app.delete("/api/records/{record_id}")
def delete_record(record_id: str, db: Session = Depends(get_db)):
    ensure_tables()
    a = db.scalar(select(models.Audit).where(models.Audit.record_id == record_id))
    if not a:
        raise HTTPException(404, "record not found")
    db.delete(a)
    db.commit()
    return {"ok": True, "removed": record_id}


@app.get("/api/stats", response_model=Stats)
def stats(db: Session = Depends(get_db)):
    ensure_tables()
    rows = db.execute(select(models.Audit.verdict, func.count()).group_by(models.Audit.verdict)).all()
    by = {v: n for v, n in rows}
    return Stats(
        total=sum(by.values()),
        approved=by.get("Approved", 0),
        conditional=by.get("Conditional pass", 0),
        hold=by.get("Hold", 0),
    )


# ── CSV exports (handy for the owner: open in Excel without the UI) ───────
AUDIT_COLS = [
    "record_id", "submitted_at", "task_id", "queue_name", "batch_id", "auditor", "annotator",
    "annotation_date", "audit_date", "verdict", "total_checks", "passed", "failed", "na",
    "critical_fails", "major_fails", "minor_fails", "failed_checks",
]


def _csv_response(rows: list[dict], cols: list[str], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    buf.write("﻿")  # BOM so Excel opens UTF-8 correctly
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore", lineterminator="\r\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in cols})
    disposition = 'attachment; filename="' + filename + '"'
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"content-disposition": disposition},
    )


@app.get("/api/export/audits.csv")
def export_audits(
    db: Session = Depends(get_db),
    auditor: str | None = FilterParams["auditor"], verdict: str | None = FilterParams["verdict"],
    queue: str | None = FilterParams["queue"], date_from: str | None = FilterParams["date_from"],
    date_to: str | None = FilterParams["date_to"], q: str | None = FilterParams["q"],
):
    ensure_tables()
    stmt = _apply_filters(select(models.Audit).order_by(models.Audit.submitted_at.desc()), auditor, verdict, queue, date_from, date_to, q)
    rows = db.scalars(stmt).all()
    stamp = datetime.now().strftime("%Y%m%d")
    data = []
    for a in rows:
        d = {c: getattr(a, c) for c in AUDIT_COLS}
        d["submitted_at"] = a.submitted_at.isoformat()
        data.append(d)
    return _csv_response(data, AUDIT_COLS, f"pa_audits_{stamp}.csv")


@app.get("/api/export/issues.csv")
def export_issues(
    db: Session = Depends(get_db),
    auditor: str | None = FilterParams["auditor"], verdict: str | None = FilterParams["verdict"],
    queue: str | None = FilterParams["queue"], date_from: str | None = FilterParams["date_from"],
    date_to: str | None = FilterParams["date_to"], q: str | None = FilterParams["q"],
):
    ensure_tables()
    stmt = (
        select(
            models.Audit.record_id, models.Audit.batch_id, models.AuditCheck.check_id, models.AuditCheck.section,
            models.AuditCheck.severity, models.AuditCheck.result, models.AuditCheck.note,
        )
        .join(models.AuditCheck, models.AuditCheck.audit_id == models.Audit.id)
        .order_by(models.Audit.submitted_at.desc(), models.AuditCheck.id)
    )
    rows = db.execute(_apply_filters(stmt, auditor, verdict, queue, date_from, date_to, q)).all()
    cols = ["record_id", "batch_id", "check_id", "section", "severity", "result", "note"]
    stamp = datetime.now().strftime("%Y%m%d")
    return _csv_response([dict(zip(cols, r)) for r in rows], cols, f"pa_audit_issues_{stamp}.csv")


# ── Frontend (static pages) — mounted last so /api/* routes win ───────────
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
