from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import get_settings
from .models import ErrorResponse, JobCreatedResponse, JobResultResponse, JobState, JobStatus
from .processing import process_job
from .storage import create_job, load_manifest, read_state, resolve_asset


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def healthcheck() -> dict[str, str]:
        return {"status": "ok"}

    @app.post(
        "/api/jobs",
        response_model=JobCreatedResponse,
        responses={400: {"model": ErrorResponse}},
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
    )
    def get_job(job_id: str) -> JobState:
        return read_state(job_id)

    @app.get(
        "/api/jobs/{job_id}/result",
        response_model=JobResultResponse,
        responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
    )
    def get_job_result(job_id: str) -> JobResultResponse:
        state = read_state(job_id)
        if state.status != JobStatus.COMPLETED:
            raise HTTPException(
                status_code=409,
                detail=f"Job {job_id} is {state.status}. Wait until it completes.",
            )
        return JobResultResponse(manifest=load_manifest(job_id))

    @app.get("/api/jobs/{job_id}/assets/{asset_path:path}")
    def get_job_asset(job_id: str, asset_path: str) -> FileResponse:
        return FileResponse(resolve_asset(job_id, asset_path))

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
