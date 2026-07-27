from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from .config import get_settings
from .models import JobManifest, JobState, JobStatus


@dataclass(slots=True)
class JobPaths:
    job_id: str
    job_dir: Path
    source_file: Path
    clips_dir: Path
    thumbnails_dir: Path
    state_file: Path
    manifest_file: Path


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def sanitize_filename(filename: str | None) -> str:
    original = filename or "upload.mp4"
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", original).strip("-")
    return clean or "upload.mp4"


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.{uuid4().hex}.tmp")
    temp_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")

    last_error: PermissionError | None = None
    for attempt in range(6):
        try:
            temp_path.replace(path)
            return
        except PermissionError as exc:
            last_error = exc
            if attempt == 5:
                break
            time.sleep(0.03 * (attempt + 1))

    if temp_path.exists():
        temp_path.unlink(missing_ok=True)
    if last_error is not None:
        raise last_error


def _read_json(path: Path) -> dict[str, Any]:
    for attempt in range(6):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(0.03 * (attempt + 1))
    raise RuntimeError(f"Unable to read JSON file: {path}")


def create_job(upload: UploadFile) -> JobPaths:
    settings = get_settings()
    job_id = uuid4().hex
    job_dir = settings.data_dir / job_id
    source_dir = job_dir / "source"
    clips_dir = job_dir / "clips"
    thumbnails_dir = job_dir / "thumbnails"
    for directory in (source_dir, clips_dir, thumbnails_dir):
        directory.mkdir(parents=True, exist_ok=True)

    source_file = source_dir / sanitize_filename(upload.filename)
    paths = JobPaths(
        job_id=job_id,
        job_dir=job_dir,
        source_file=source_file,
        clips_dir=clips_dir,
        thumbnails_dir=thumbnails_dir,
        state_file=job_dir / "status.json",
        manifest_file=job_dir / "manifest.json",
    )
    created = now_utc()
    write_state(
        JobState(
            job_id=job_id,
            status=JobStatus.QUEUED,
            stage="upload-complete",
            source_video=source_file.name,
            created_at=created,
            updated_at=created,
        ),
        paths=paths,
    )
    return paths


def get_job_paths(job_id: str) -> JobPaths:
    settings = get_settings()
    job_dir = settings.data_dir / job_id
    if not job_dir.exists():
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")

    source_dir = job_dir / "source"
    source_files = sorted(source_dir.iterdir()) if source_dir.exists() else []
    if not source_files:
        raise HTTPException(status_code=500, detail=f"Source file missing for job {job_id}")

    return JobPaths(
        job_id=job_id,
        job_dir=job_dir,
        source_file=source_files[0],
        clips_dir=job_dir / "clips",
        thumbnails_dir=job_dir / "thumbnails",
        state_file=job_dir / "status.json",
        manifest_file=job_dir / "manifest.json",
    )


def read_state(job_id: str) -> JobState:
    paths = get_job_paths(job_id)
    payload = _read_json(paths.state_file)
    return JobState.model_validate(payload)


def write_state(state: JobState, paths: JobPaths | None = None) -> None:
    target = paths or get_job_paths(state.job_id)
    _atomic_write_json(target.state_file, state.model_dump(mode="json"))


def update_state(job_id: str, **changes: Any) -> JobState:
    current = read_state(job_id)
    updated = current.model_copy(
        update={
            **changes,
            "updated_at": now_utc(),
        }
    )
    write_state(updated)
    return updated


def save_manifest(manifest: JobManifest) -> None:
    paths = get_job_paths(manifest.job_id)
    _atomic_write_json(paths.manifest_file, manifest.model_dump(mode="json"))


def load_manifest(job_id: str) -> JobManifest:
    paths = get_job_paths(job_id)
    if not paths.manifest_file.exists():
        raise HTTPException(status_code=404, detail=f"Manifest not found for job {job_id}")
    payload = _read_json(paths.manifest_file)
    return JobManifest.model_validate(payload)


def resolve_asset(job_id: str, asset_path: str) -> Path:
    paths = get_job_paths(job_id)
    candidate = (paths.job_dir / asset_path).resolve()
    if paths.job_dir.resolve() not in candidate.parents and candidate != paths.job_dir.resolve():
        raise HTTPException(status_code=400, detail="Invalid asset path.")
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail=f"Asset not found: {asset_path}")
    return candidate
