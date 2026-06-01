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
    approval_status: str = "pending"
    rejection_reason: str | None = None
    storage_bucket: str | None = None
    object_key: str | None = None
    public_url: str | None = None
    media_url: str | None = None


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
    cover_public_url: str | None = None
    pending_count: int = 0
    approved_count: int = 0
    rejected_count: int = 0
    published_count: int = 0


class ReviewResponse(BaseModel):
    review: ReviewManifest


class ReviewListResponse(BaseModel):
    reviews: list[ReviewSummary]


class ProjectAsset(BaseModel):
    asset_id: str
    source_kind: str
    asset_type: str
    label: str
    filename: str
    width: int
    height: int
    asset_path: str
    storage_bucket: str | None = None
    object_key: str | None = None
    public_url: str | None = None
    notes: str = ""
    created_at: datetime


class ProjectCharacter(BaseModel):
    character_id: str
    name: str
    sheet_asset_id: str
    crop_asset_id: str | None = None
    look_label: str | None = None
    notes: str = ""
    created_at: datetime


class ProjectShotGrid(BaseModel):
    shot_grid_id: str
    source_asset_id: str
    rows: int = 3
    cols: int = 3
    status: str = "intact"


class ProjectShotFrame(BaseModel):
    shot_frame_id: str
    shot_grid_id: str
    asset_id: str
    row: int
    col: int
    index: int
    selected: bool = False
    sequence_order: int | None = None


class ProjectRefinementJob(BaseModel):
    job_id: str
    input_asset_ids: list[str]
    reference_asset_ids: list[str] = []
    workflow_name: str
    status: str = "queued"
    result_asset_ids: list[str] = []
    settings_json: dict = Field(default_factory=dict)
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class ProjectManifest(BaseModel):
    project_id: str
    title: str
    notes: str = ""
    status: str = "active"
    source_review_id: str | None = None
    hero_asset_id: str | None = None
    assets: list[ProjectAsset] = []
    characters: list[ProjectCharacter] = []
    shot_grids: list[ProjectShotGrid] = []
    shot_frames: list[ProjectShotFrame] = []
    refinement_jobs: list[ProjectRefinementJob] = []
    created_at: datetime
    updated_at: datetime


class ProjectSummary(BaseModel):
    project_id: str
    title: str
    status: str
    source_review_id: str | None = None
    hero_asset_path: str | None = None
    hero_public_url: str | None = None
    asset_count: int = 0
    character_count: int = 0
    shot_grid_count: int = 0
    shot_frame_count: int = 0
    created_at: datetime
    updated_at: datetime


class ProjectResponse(BaseModel):
    project: ProjectManifest


class ProjectListResponse(BaseModel):
    projects: list[ProjectSummary]


class SheetsStubResponse(BaseModel):
    recorded: bool
    sheets_url_digest: str | None = Field(
        default=None,
        description="Short SHA-256 prefix of the submitted URL (URL is not persisted).",
    )
