from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps

from .config import get_settings
from .models import (
    ProjectAsset,
    ProjectCharacter,
    ProjectManifest,
    ProjectSummary,
)
from .reviews import get_review, resolve_review_asset, sanitize_review_id

_ALLOWED_ASSET_TYPES = {
    "character_sheet",
    "single_still",
    "cinematic_shot_grid",
    "extracted_shot",
    "refined_shot",
    "other",
}
_ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def projects_root() -> Path:
    root = get_settings().reviews_dir.parent / "projects"
    root.mkdir(parents=True, exist_ok=True)
    return root


def sanitize_project_id(candidate: str) -> str:
    clean = "".join(ch for ch in candidate.lower() if ch in "0123456789abcdef")
    if len(clean) != 32:
        raise HTTPException(status_code=404, detail="Unknown project id.")
    return clean


def project_workspace(project_id: str) -> Path:
    return projects_root() / project_id


def _manifest_path(workspace: Path) -> Path:
    return workspace / "project.json"


def _write_manifest(workspace: Path, manifest: ProjectManifest) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    _manifest_path(workspace).write_text(manifest.model_dump_json(indent=2), encoding="utf-8")


def _load_manifest(workspace: Path) -> ProjectManifest:
    return ProjectManifest.model_validate(json.loads(_manifest_path(workspace).read_text(encoding="utf-8")))


def _safe_filename(filename: str, fallback: str) -> str:
    raw = Path(filename).name.strip() or fallback
    clean = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "-" for ch in raw).strip(".-_")
    clean = clean or fallback
    suffix = Path(clean).suffix.lower()
    if suffix not in _ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, and WebP images can be used as project assets.")
    return clean


def _unique_asset_path(workspace: Path, filename: str) -> Path:
    target_dir = workspace / "assets"
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / filename
    counter = 2
    while path.exists():
        base = Path(filename)
        path = target_dir / f"{base.stem}-{counter}{base.suffix}"
        counter += 1
    return path


def _dimensions(path: Path) -> tuple[int, int]:
    try:
        image = ImageOps.exif_transpose(Image.open(path))
        image.load()
    except OSError:
        raise HTTPException(status_code=400, detail=f"Unable to decode image: {path.name}") from None
    return image.width, image.height


def _asset_from_file(
    *,
    workspace: Path,
    source_path: Path,
    filename: str,
    asset_type: str,
    source_kind: str,
    label: str | None = None,
    public_url: str | None = None,
    storage_bucket: str | None = None,
    object_key: str | None = None,
    notes: str = "",
) -> ProjectAsset:
    if asset_type not in _ALLOWED_ASSET_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported project asset type.")
    safe_name = _safe_filename(filename, f"asset-{uuid4().hex[:8]}.png")
    target = _unique_asset_path(workspace, safe_name)
    shutil.copyfile(source_path, target)
    width, height = _dimensions(target)
    return ProjectAsset(
        asset_id=uuid4().hex,
        source_kind=source_kind,
        asset_type=asset_type,
        label=label or Path(target.name).stem.replace("-", " ").replace("_", " ").strip() or target.name,
        filename=target.name,
        width=width,
        height=height,
        asset_path=f"assets/{target.name}",
        storage_bucket=storage_bucket,
        object_key=object_key,
        public_url=public_url,
        notes=notes.strip(),
        created_at=datetime.now(timezone.utc),
    )


def create_project_from_review(review_id: str, title: str | None = None) -> ProjectManifest:
    review = get_review(sanitize_review_id(review_id))
    published = [image for image in review.images if image.approval_status == "published"]
    if not published:
        raise HTTPException(status_code=409, detail="Publish at least one approved review image before creating a project page.")

    project_id = uuid4().hex
    workspace = project_workspace(project_id)
    workspace.mkdir(parents=True, exist_ok=True)

    hero_image = published[0]
    hero_source = resolve_review_asset(review.review_id, hero_image.asset_path)
    hero_asset = _asset_from_file(
        workspace=workspace,
        source_path=hero_source,
        filename=Path(hero_image.asset_path).name,
        asset_type="single_still",
        source_kind="review_approved",
        label="Approved project look",
        public_url=hero_image.public_url,
        storage_bucket=hero_image.storage_bucket,
        object_key=hero_image.object_key,
        notes="Hero/look image created from the approved review publish step.",
    )

    now = datetime.now(timezone.utc)
    manifest = ProjectManifest(
        project_id=project_id,
        title=(title or review.title or "Untitled visual project").strip(),
        status="active",
        source_review_id=review.review_id,
        hero_asset_id=hero_asset.asset_id,
        assets=[hero_asset],
        characters=[],
        shot_grids=[],
        shot_frames=[],
        refinement_jobs=[],
        created_at=now,
        updated_at=now,
    )
    _write_manifest(workspace, manifest)
    return manifest


def get_project(project_id: str) -> ProjectManifest:
    workspace = project_workspace(sanitize_project_id(project_id))
    if not _manifest_path(workspace).is_file():
        raise HTTPException(status_code=404, detail="Project not found.")
    return _load_manifest(workspace)


def list_projects() -> list[ProjectSummary]:
    summaries: list[ProjectSummary] = []
    for manifest_file in sorted(projects_root().glob("*/project.json"), key=lambda path: path.stat().st_mtime, reverse=True):
        manifest = _load_manifest(manifest_file.parent)
        hero = next((asset for asset in manifest.assets if asset.asset_id == manifest.hero_asset_id), None)
        summaries.append(
            ProjectSummary(
                project_id=manifest.project_id,
                title=manifest.title,
                status=manifest.status,
                source_review_id=manifest.source_review_id,
                hero_asset_path=hero.asset_path if hero else None,
                hero_public_url=hero.public_url if hero else None,
                asset_count=len(manifest.assets),
                character_count=len(manifest.characters),
                shot_grid_count=len(manifest.shot_grids),
                shot_frame_count=len(manifest.shot_frames),
                updated_at=manifest.updated_at,
                created_at=manifest.created_at,
            )
        )
    return summaries


def add_uploaded_asset(
    project_id: str,
    upload: UploadFile,
    asset_type: str,
    label: str = "",
    notes: str = "",
    character_name: str = "",
) -> ProjectManifest:
    workspace = project_workspace(sanitize_project_id(project_id))
    if not _manifest_path(workspace).is_file():
        raise HTTPException(status_code=404, detail="Project not found.")
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Project asset needs a filename.")

    incoming_dir = workspace / "incoming"
    incoming_dir.mkdir(parents=True, exist_ok=True)
    incoming = incoming_dir / _safe_filename(upload.filename, "upload.png")
    with incoming.open("wb") as handle:
        shutil.copyfileobj(upload.file, handle)
    upload.file.close()

    asset = _asset_from_file(
        workspace=workspace,
        source_path=incoming,
        filename=incoming.name,
        asset_type=asset_type,
        source_kind="upload",
        label=label.strip() or None,
        notes=notes,
    )
    incoming.unlink(missing_ok=True)

    manifest = _load_manifest(workspace)
    manifest.assets.append(asset)
    if asset.asset_type == "character_sheet":
        name = character_name.strip() or asset.label or "Unnamed character"
        manifest.characters.append(
            ProjectCharacter(
                character_id=uuid4().hex,
                name=name,
                sheet_asset_id=asset.asset_id,
                crop_asset_id=None,
                look_label=asset.label,
                notes=notes.strip(),
                created_at=datetime.now(timezone.utc),
            )
        )
    manifest.updated_at = datetime.now(timezone.utc)
    _write_manifest(workspace, manifest)
    return manifest


def resolve_project_asset(project_id: str, asset_path: str) -> Path:
    workspace = project_workspace(sanitize_project_id(project_id)).resolve()
    if not workspace.is_dir():
        raise HTTPException(status_code=404, detail="Project not found.")
    normalized = Path(asset_path.replace("\\", "/").strip("/"))
    if normalized.is_absolute() or ".." in normalized.parts:
        raise HTTPException(status_code=400, detail="Invalid asset path.")
    candidate = (workspace / normalized).resolve()
    try:
        candidate.relative_to(workspace)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid asset path.") from None
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="Asset not found.")
    return candidate
