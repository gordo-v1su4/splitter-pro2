from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class JobStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class SegmentRecord(BaseModel):
    index: int
    start_frame: int
    end_frame: int
    frame_count: int
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    clip_path: str
    thumbnail_path: str
    label: str


class ReconstructionAudit(BaseModel):
    original_frame_count: int
    reconstructed_frame_count: int
    expected_segment_frames: int
    frame_delta: int
    original_duration_seconds: float
    reconstructed_duration_seconds: float
    duration_delta_seconds: float


class JobManifest(BaseModel):
    job_id: str
    source_video: str
    duration_seconds: float
    frame_rate: float
    frame_count: int
    segment_count: int
    segments: list[SegmentRecord]
    reassembled_path: str | None = None
    keyframes_zip_path: str | None = None
    segments_zip_path: str | None = None
    contact_sheet_path: str | None = None
    reconstruction_audit: ReconstructionAudit | None = None
    created_at: datetime


class JobState(BaseModel):
    job_id: str
    status: JobStatus
    stage: str
    source_video: str
    created_at: datetime
    updated_at: datetime
    error: str | None = None
    duration_seconds: float | None = None
    segment_count: int = 0
    progress_completed: int = 0
    progress_total: int = 0


class JobCreatedResponse(BaseModel):
    job: JobState


class JobResultResponse(BaseModel):
    manifest: JobManifest


class ErrorResponse(BaseModel):
    detail: str = Field(..., examples=["Job is still processing."])
