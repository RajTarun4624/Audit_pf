"""Pydantic request/response shapes."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class CheckIn(BaseModel):
    check_id: str = Field(max_length=20)
    section: str = Field(default="", max_length=200)
    severity: str = Field(default="", max_length=20)
    result: str = Field(default="", max_length=20)
    note: str = Field(default="", max_length=4000)


class AuditIn(BaseModel):
    record_id: str = Field(min_length=4, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    submitted_at: Optional[datetime] = None
    task_id: str = Field(default="", max_length=200)
    queue_name: str = Field(default="", max_length=200)
    batch_id: str = Field(default="", max_length=300)
    auditor: str = Field(default="", max_length=200)
    annotator: str = Field(default="", max_length=200)
    annotation_date: str = Field(default="", max_length=20)
    audit_date: str = Field(default="", max_length=20)
    verdict: str = Field(default="", max_length=30)
    total_checks: int = 0
    passed: int = 0
    failed: int = 0
    na: int = 0
    critical_fails: int = 0
    major_fails: int = 0
    minor_fails: int = 0
    failed_checks: str = Field(default="", max_length=4000)
    checks: list[CheckIn] = Field(default_factory=list, max_length=200)

    @field_validator("verdict")
    @classmethod
    def _verdict(cls, v: str) -> str:
        allowed = {"Approved", "Conditional pass", "Hold", ""}
        if v not in allowed:
            raise ValueError("verdict must be Approved, Conditional pass or Hold")
        return v


class CheckOut(CheckIn):
    model_config = {"from_attributes": True}


class AuditOut(BaseModel):
    model_config = {"from_attributes": True}

    record_id: str
    submitted_at: datetime
    task_id: str
    queue_name: str
    batch_id: str
    auditor: str
    annotator: str
    annotation_date: str
    audit_date: str
    verdict: str
    total_checks: int
    passed: int
    failed: int
    na: int
    critical_fails: int
    major_fails: int
    minor_fails: int
    failed_checks: str
    checks: list[CheckOut]


class Stats(BaseModel):
    total: int
    approved: int
    conditional: int
    hold: int
