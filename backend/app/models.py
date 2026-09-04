"""SQLAlchemy tables: one row per submitted audit, one row per non-pass checkpoint."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Audit(Base):
    __tablename__ = "audits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    record_id: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    task_id: Mapped[str] = mapped_column(String(200), default="")
    queue_name: Mapped[str] = mapped_column(String(200), default="")
    batch_id: Mapped[str] = mapped_column(String(300), default="")
    auditor: Mapped[str] = mapped_column(String(200), default="", index=True)
    annotator: Mapped[str] = mapped_column(String(200), default="")
    annotation_date: Mapped[str] = mapped_column(String(20), default="")
    audit_date: Mapped[str] = mapped_column(String(20), default="")

    verdict: Mapped[str] = mapped_column(String(30), default="", index=True)
    total_checks: Mapped[int] = mapped_column(Integer, default=0)
    passed: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    na: Mapped[int] = mapped_column(Integer, default=0)
    critical_fails: Mapped[int] = mapped_column(Integer, default=0)
    major_fails: Mapped[int] = mapped_column(Integer, default=0)
    minor_fails: Mapped[int] = mapped_column(Integer, default=0)
    failed_checks: Mapped[str] = mapped_column(Text, default="")

    checks: Mapped[list["AuditCheck"]] = relationship(
        back_populates="audit", cascade="all, delete-orphan", order_by="AuditCheck.id"
    )


class AuditCheck(Base):
    __tablename__ = "audit_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    audit_id: Mapped[int] = mapped_column(ForeignKey("audits.id", ondelete="CASCADE"), index=True, nullable=False)
    check_id: Mapped[str] = mapped_column(String(20), nullable=False)
    section: Mapped[str] = mapped_column(String(200), default="")
    severity: Mapped[str] = mapped_column(String(20), default="")
    result: Mapped[str] = mapped_column(String(20), default="")
    note: Mapped[str] = mapped_column(Text, default="")

    audit: Mapped[Audit] = relationship(back_populates="checks")
