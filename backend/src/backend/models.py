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


class ImageSplitPanel(BaseModel):
    index: int
    label: str
    asset_path: str


class ImageSplitMode(StrEnum):
    FIXED = "fixed"
    AUTO = "auto"


class ImageSplitManifest(BaseModel):
    split_id: str
    source_filename: str
    width: int
    height: int
    mode: ImageSplitMode
    rows: int
    cols: int
    gutter_px: int
    panels: list[ImageSplitPanel]


class ImageSplitResponse(BaseModel):
    manifest: ImageSplitManifest


class ImageSplitBatchPanel(BaseModel):
    index: int
    label: str
    asset_path: str
    source_index: int
    source_filename: str


class ImageSplitBatchManifest(BaseModel):
    batch_id: str
    mode: ImageSplitMode
    rows: int | None = None
    cols: int | None = None
    gutter_px: int
    sensitivity: float | None = None
    source_filenames: list[str]
    total_sources: int
    panels: list[ImageSplitBatchPanel]


class ImageSplitBatchResponse(BaseModel):
    manifest: ImageSplitBatchManifest


class ReviewImage(BaseModel):
    index: int
    label: str
    asset_path: str
    width: int
    height: int


class ReviewManifest(BaseModel):
    review_id: str
    title: str
    notes: str = ""
    image_count: int
    images: list[ReviewImage]
    created_at: datetime
    updated_at: datetime


class ReviewSummary(BaseModel):
    review_id: str
    title: str
    notes: str = ""
    image_count: int
    created_at: datetime
    updated_at: datetime
    cover_asset_path: str | None = None


class ReviewResponse(BaseModel):
    review: ReviewManifest


class ReviewListResponse(BaseModel):
    reviews: list[ReviewSummary]


class SheetsStubResponse(BaseModel):
    recorded: bool
    sheets_url_digest: str | None = Field(
        default=None,
        description="Short SHA-256 prefix of the submitted URL (URL is not persisted).",
    )
