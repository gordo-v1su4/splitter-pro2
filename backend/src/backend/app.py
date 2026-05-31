from __future__ import annotations

import hashlib
import shutil

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

from . import image_split, reviews
from .config import get_settings
from .docs_theme import SWAGGER_UI_DARK_ROUTE, SWAGGER_UI_DARK_STYLESHEET_PATH, swagger_ui_dark_html
from .models import (
    ErrorResponse,
    ImageSplitBatchResponse,
    ImageSplitResponse,
    JobCreatedResponse,
    JobResultResponse,
    JobState,
    JobStatus,
    ReviewListResponse,
    ReviewResponse,
    SheetsStubResponse,
)
from .processing import process_job
from .storage import create_job, load_manifest, read_state, resolve_asset


OPENAPI_TAGS = [
    {"name": "Health", "description": "Liveness and readiness checks."},
    {"name": "Video jobs", "description": "Upload a video for PySceneDetect segmentation and exports."},
    {"name": "Image split", "description": "Storyboard-style image grid splitting (fixed or auto)."},
    {"name": "Reviews", "description": "Publish image sets into a local review board."},
    {"name": "Integrations", "description": "Optional integration hooks (currently stubbed)."},
]


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        description=(
            "Splitter Pro: local-first video scene detection and storyboard-style image panel splitting. "
            "Interactive API docs are served at `/docs` (Swagger UI)."
        ),
        version="0.2.0",
        openapi_tags=OPENAPI_TAGS,
        docs_url=None,
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get(SWAGGER_UI_DARK_ROUTE, include_in_schema=False)
    def swagger_ui_dark_css() -> FileResponse:
        return FileResponse(
            SWAGGER_UI_DARK_STYLESHEET_PATH,
            media_type="text/css",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    @app.get("/docs", include_in_schema=False)
    def swagger_documentation() -> HTMLResponse:
        return swagger_ui_dark_html(openapi_url=app.openapi_url, title=f"{settings.app_name} — API")

    @app.get("/api/health", tags=["Health"])
    def healthcheck() -> dict[str, str]:
        return {"status": "ok"}

    @app.post(
        "/api/jobs",
        response_model=JobCreatedResponse,
        responses={400: {"model": ErrorResponse}},
        tags=["Video jobs"],
    )
    async def create_job_endpoint(
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
    ) -> JobCreatedResponse:
        if not file.filename:
            raise HTTPException(status_code=400, detail="A video file is required.")

        paths = create_job(file)
        with paths.source_file.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)
        await file.close()
        background_tasks.add_task(process_job, paths.job_id)
        return JobCreatedResponse(job=read_state(paths.job_id))

    @app.get(
        "/api/jobs/{job_id}",
        response_model=JobState,
        responses={404: {"model": ErrorResponse}},
        tags=["Video jobs"],
    )
    def get_job(job_id: str) -> JobState:
        return read_state(job_id)

    @app.get(
        "/api/jobs/{job_id}/result",
        response_model=JobResultResponse,
        responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
        tags=["Video jobs"],
    )
    def get_job_result(job_id: str) -> JobResultResponse:
        state = read_state(job_id)
        if state.status != JobStatus.COMPLETED:
            raise HTTPException(
                status_code=409,
                detail=f"Job {job_id} is {state.status}. Wait until it completes.",
            )
        return JobResultResponse(manifest=load_manifest(job_id))

    @app.get("/api/jobs/{job_id}/assets/{asset_path:path}", tags=["Video jobs"])
    def get_job_asset(job_id: str, asset_path: str) -> FileResponse:
        return FileResponse(resolve_asset(job_id, asset_path))

    @app.post(
        "/api/image-split/fixed-grid",
        response_model=ImageSplitResponse,
        responses={400: {"model": ErrorResponse}},
        tags=["Image split"],
        summary="Split an image using a fixed row/column grid",
    )
    def split_image_fixed_grid(
        file: UploadFile = File(..., description="Source storyboard or contact sheet image."),
        rows: int = Form(3, ge=1, le=24, description="Number of rows in the grid."),
        cols: int = Form(3, ge=1, le=24, description="Number of columns in the grid."),
        gutter_px: int = Form(0, ge=0, le=96, description="Pixel gutter skipped between tiles."),
    ) -> ImageSplitResponse:
        manifest = image_split.run_fixed_grid_split(file, rows, cols, gutter_px)
        return ImageSplitResponse(manifest=manifest)

    @app.post(
        "/api/image-split/auto",
        response_model=ImageSplitResponse,
        responses={400: {"model": ErrorResponse}},
        tags=["Image split"],
        summary="Auto-detect panel gutters and split the image",
    )
    def split_image_auto(
        file: UploadFile = File(..., description="Source storyboard containing multiple tiled panels."),
        gutter_px: int = Form(
            0,
            ge=0,
            le=96,
            description="Estimated gutter thickness in pixels (0 lets the heuristic choose).",
        ),
        sensitivity: float = Form(
            0.55,
            ge=0.0,
            le=1.0,
            description="0 = conservative (fewer cuts), 1 = aggressive gutter detection.",
        ),
    ) -> ImageSplitResponse:
        manifest = image_split.run_auto_split(file, gutter_px, sensitivity)
        return ImageSplitResponse(manifest=manifest)

    def _safe_batch_fixed(files: list[UploadFile], rows: int, cols: int, gutter_px: int) -> ImageSplitBatchResponse:
        try:
            manifest = image_split.run_batch_fixed_grid(files, rows, cols, gutter_px)
            return ImageSplitBatchResponse(manifest=manifest)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 — return JSON instead of dropping the connection
            import logging

            logging.exception("batch fixed image split failed")
            raise HTTPException(
                status_code=500,
                detail="Image processing failed. Try smaller or fewer images, lower resolution, or reduce row/column count.",
            ) from exc

    def _safe_batch_auto(files: list[UploadFile], gutter_px: int, sensitivity: float) -> ImageSplitBatchResponse:
        try:
            manifest = image_split.run_batch_auto(files, gutter_px, sensitivity)
            return ImageSplitBatchResponse(manifest=manifest)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            import logging

            logging.exception("batch auto image split failed")
            raise HTTPException(
                status_code=500,
                detail="Image processing failed. Try smaller or fewer images, or lower the sensitivity.",
            ) from exc

    @app.post(
        "/api/image-split/batch/fixed-grid",
        response_model=ImageSplitBatchResponse,
        responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
        tags=["Image split"],
        summary="Split multiple images with the same fixed grid",
    )
    def split_images_batch_fixed_grid(
        files: list[UploadFile] = File(..., description="One or more PNG/JPEG/WebP images."),
        rows: int = Form(3, ge=1, le=24),
        cols: int = Form(3, ge=1, le=24),
        gutter_px: int = Form(0, ge=0, le=96),
    ) -> ImageSplitBatchResponse:
        return _safe_batch_fixed(files, rows, cols, gutter_px)

    @app.post(
        "/api/image-split/batch/auto",
        response_model=ImageSplitBatchResponse,
        responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
        tags=["Image split"],
        summary="Auto-split multiple images (same gutter/sensitivity per file)",
    )
    def split_images_batch_auto(
        files: list[UploadFile] = File(..., description="One or more PNG/JPEG/WebP images."),
        gutter_px: int = Form(0, ge=0, le=96),
        sensitivity: float = Form(0.55, ge=0.0, le=1.0),
    ) -> ImageSplitBatchResponse:
        return _safe_batch_auto(files, gutter_px, sensitivity)

    @app.get(
        "/api/image-split/{split_id}/panels/{asset_path:path}",
        tags=["Image split"],
        summary="Download a single exported panel PNG",
        response_model=None,
    )
    def download_split_panel(split_id: str, asset_path: str) -> FileResponse:
        resolved = image_split.resolve_split_asset(split_id, asset_path)
        return FileResponse(resolved, media_type="image/png")

    @app.get(
        "/api/image-split/{split_id}/export.zip",
        tags=["Image split"],
        summary="Download every panel inside a ZIP archive",
        response_model=None,
    )
    def download_split_bundle(split_id: str) -> Response:
        workspace = image_split.workspace_for_export(split_id)
        blob = image_split.export_split_zip(workspace)
        attachment = f"splitter-pro-panels-{split_id}.zip"
        return Response(
            content=blob,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{attachment}"'},
        )


    @app.post(
        "/api/reviews",
        response_model=ReviewResponse,
        responses={400: {"model": ErrorResponse}},
        tags=["Reviews"],
        summary="Publish images into a review gallery",
    )
    def create_review_endpoint(
        files: list[UploadFile] = File(..., description="PNG/JPEG/WebP images to review."),
        title: str = Form("Untitled review"),
        notes: str = Form(""),
    ) -> ReviewResponse:
        return ReviewResponse(review=reviews.create_review(title, notes, files))

    @app.get(
        "/api/reviews",
        response_model=ReviewListResponse,
        tags=["Reviews"],
        summary="List published image review galleries",
    )
    def list_reviews_endpoint() -> ReviewListResponse:
        return ReviewListResponse(reviews=reviews.list_reviews())

    @app.get(
        "/api/reviews/{review_id}",
        response_model=ReviewResponse,
        responses={404: {"model": ErrorResponse}},
        tags=["Reviews"],
        summary="Read one image review gallery",
    )
    def get_review_endpoint(review_id: str) -> ReviewResponse:
        return ReviewResponse(review=reviews.get_review(review_id))

    @app.post(
        "/api/reviews/{review_id}/images/{image_index}/approve",
        response_model=ReviewResponse,
        responses={404: {"model": ErrorResponse}},
        tags=["Reviews"],
        summary="Approve one review image for publishing",
    )
    def approve_review_image_endpoint(review_id: str, image_index: int) -> ReviewResponse:
        return ReviewResponse(review=reviews.set_review_image_approval(review_id, image_index, "approved"))

    @app.post(
        "/api/reviews/{review_id}/images/{image_index}/reject",
        response_model=ReviewResponse,
        responses={404: {"model": ErrorResponse}},
        tags=["Reviews"],
        summary="Reject one review image so it will not be published",
    )
    def reject_review_image_endpoint(review_id: str, image_index: int) -> ReviewResponse:
        return ReviewResponse(review=reviews.set_review_image_approval(review_id, image_index, "rejected"))

    @app.post(
        "/api/reviews/{review_id}/publish-approved",
        response_model=ReviewResponse,
        responses={404: {"model": ErrorResponse}, 502: {"model": ErrorResponse}},
        tags=["Reviews"],
        summary="Publish approved review images to RustFS-backed storage",
    )
    def publish_approved_review_images_endpoint(review_id: str) -> ReviewResponse:
        return ReviewResponse(review=reviews.publish_approved_review_images(review_id))

    @app.get(
        "/api/reviews/{review_id}/assets/{asset_path:path}",
        response_model=None,
        tags=["Reviews"],
        summary="Download a review image",
    )
    def get_review_asset(review_id: str, asset_path: str) -> FileResponse:
        return FileResponse(reviews.resolve_review_asset(review_id, asset_path))

    @app.post(
        "/api/integrations/google-sheets",
        response_model=SheetsStubResponse,
        tags=["Integrations"],
        summary="Record a Google Sheets URL for future automation (stub)",
    )
    def integrations_google_sheets_stub(
        sheets_url: str = Form("", description="Optional Sheets URL to hash for bookkeeping."),
    ) -> SheetsStubResponse:
        stripped = sheets_url.strip()
        if not stripped:
            return SheetsStubResponse(recorded=False, sheets_url_digest=None)

        digest = hashlib.sha256(stripped.encode("utf-8")).hexdigest()[:12]
        return SheetsStubResponse(recorded=True, sheets_url_digest=digest)

    @app.get("/{full_path:path}", response_model=None)
    def serve_frontend(full_path: str):
        dist_dir = settings.frontend_dist_dir
        if not dist_dir.exists():
            return JSONResponse(
                {
                    "message": "Frontend build not found. Run `bun run build` in frontend for production assets."
                }
            )

        requested = (dist_dir / full_path).resolve() if full_path else dist_dir / "index.html"
        if requested.is_file() and dist_dir.resolve() in requested.parents:
            return FileResponse(requested)
        return FileResponse(dist_dir / "index.html")

    return app


app = create_app()
