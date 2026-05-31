from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps

from .config import get_settings
from .models import ReviewImage, ReviewManifest, ReviewSummary

_MAX_REVIEW_IMAGES = 80
_ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def sanitize_review_id(candidate: str) -> str:
    clean = "".join(ch for ch in candidate.lower() if ch in "0123456789abcdef")
    if len(clean) != 32:
        raise HTTPException(status_code=404, detail="Unknown review id.")
    return clean


def review_workspace(review_id: str) -> Path:
    return get_settings().reviews_dir / review_id


def _safe_filename(filename: str, fallback_index: int) -> str:
    raw = Path(filename).name.strip()
    if not raw:
        raw = f"image-{fallback_index:03d}.png"
    stem = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "-" for ch in raw)
    stem = stem.strip(".-_") or f"image-{fallback_index:03d}.png"
    suffix = Path(stem).suffix.lower()
    if suffix not in _ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, and WebP images can be reviewed.")
    return stem


def _ensure_unique(name: str, used: set[str]) -> str:
    path = Path(name)
    candidate = name
    counter = 2
    while candidate.lower() in used:
        candidate = f"{path.stem}-{counter}{path.suffix}"
        counter += 1
    used.add(candidate.lower())
    return candidate


def _decode_image(upload: UploadFile) -> Image.Image:
    try:
        image = ImageOps.exif_transpose(Image.open(upload.file))
        image.load()
    except OSError:
        raise HTTPException(status_code=400, detail=f"Unable to decode image: {upload.filename or 'upload'}") from None
    finally:
        upload.file.close()

    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGB")
    return image


def _manifest_path(workspace: Path) -> Path:
    return workspace / "review.json"


def _write_manifest(workspace: Path, manifest: ReviewManifest) -> None:
    _manifest_path(workspace).write_text(manifest.model_dump_json(indent=2), encoding="utf-8")


def _storage_folder(review_id: str) -> str:
    settings = get_settings()
    prefix = "/".join(part.strip("/") for part in settings.review_storage_prefix.split("/") if part.strip("/"))
    return f"{prefix}/{review_id}/images" if prefix else f"{review_id}/images"


def upload_to_review_storage(*, image_path: Path, filename: str, content_type: str, review_id: str) -> dict[str, str] | None:
    """Upload a review image to RustFS via the media API when configured.

    Object keys are rooted inside the configured bucket. For the default
    splitter bucket that means reviews/<review_id>/images/<uploaded-file> —
    never splitter/reviews/... because splitter is already the bucket name.
    """
    settings = get_settings()
    if not settings.media_api_url or not settings.media_api_token:
        return None

    url = settings.media_api_url.rstrip("/") + "/upload"
    bucket = settings.review_storage_bucket.strip() or "splitter"
    folder = _storage_folder(review_id)
    with image_path.open("rb") as image_file:
        response = httpx.post(
            url,
            headers={"Authorization": f"Bearer {settings.media_api_token}"},
            data={"userId": "splitter", "bucket": bucket, "folder": folder},
            files={"file": (filename, image_file, content_type)},
            timeout=60.0,
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Review storage upload failed: {response.text[:200]}")
    payload = response.json()
    return {
        "bucket": payload.get("bucket") or bucket,
        "object_key": payload.get("objectKey") or payload.get("path") or "",
        "public_url": payload.get("publicUrl") or "",
        "media_url": payload.get("mediaUrl") or "",
    }


def _load_manifest(workspace: Path) -> ReviewManifest:
    raw = json.loads(_manifest_path(workspace).read_text(encoding="utf-8"))
    return ReviewManifest.model_validate(raw)


def create_review(title: str, notes: str, uploads: list[UploadFile]) -> ReviewManifest:
    if not uploads:
        raise HTTPException(status_code=400, detail="At least one image is required.")
    if len(uploads) > _MAX_REVIEW_IMAGES:
        raise HTTPException(status_code=400, detail=f"Too many images at once (maximum {_MAX_REVIEW_IMAGES}).")

    clean_title = title.strip() or "Untitled review"
    review_id = uuid4().hex
    workspace = review_workspace(review_id)
    images_dir = workspace / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    used_names: set[str] = set()
    images: list[ReviewImage] = []
    for index, upload in enumerate(uploads, start=1):
        if not upload.filename:
            raise HTTPException(status_code=400, detail="Every review image needs a filename.")
        filename = _ensure_unique(_safe_filename(upload.filename, index), used_names)
        image = _decode_image(upload)
        target = images_dir / filename
        save_format = "JPEG" if target.suffix.lower() in {".jpg", ".jpeg"} else target.suffix.lower().lstrip(".").upper()
        image.save(target, format=save_format)
        content_type = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }[target.suffix.lower()]
        remote_asset = upload_to_review_storage(
            image_path=target,
            filename=filename,
            content_type=content_type,
            review_id=review_id,
        )
        images.append(
            ReviewImage(
                index=index,
                label=Path(filename).name,
                asset_path=f"images/{filename}",
                width=image.width,
                height=image.height,
                storage_bucket=remote_asset.get("bucket") if remote_asset else None,
                object_key=remote_asset.get("object_key") if remote_asset else None,
                public_url=remote_asset.get("public_url") if remote_asset else None,
                media_url=remote_asset.get("media_url") if remote_asset else None,
            )
        )

    now = datetime.now(timezone.utc)
    manifest = ReviewManifest(
        review_id=review_id,
        title=clean_title,
        notes=notes.strip(),
        image_count=len(images),
        images=images,
        created_at=now,
        updated_at=now,
    )
    _write_manifest(workspace, manifest)
    return manifest


def get_review(review_id: str) -> ReviewManifest:
    workspace = review_workspace(sanitize_review_id(review_id))
    if not _manifest_path(workspace).is_file():
        raise HTTPException(status_code=404, detail="Review not found.")
    return _load_manifest(workspace)


def list_reviews() -> list[ReviewSummary]:
    root = get_settings().reviews_dir
    summaries: list[ReviewSummary] = []
    for manifest_file in sorted(root.glob("*/review.json"), key=lambda path: path.stat().st_mtime, reverse=True):
        manifest = _load_manifest(manifest_file.parent)
        summaries.append(
            ReviewSummary(
                review_id=manifest.review_id,
                title=manifest.title,
                notes=manifest.notes,
                image_count=manifest.image_count,
                created_at=manifest.created_at,
                updated_at=manifest.updated_at,
                cover_asset_path=manifest.images[0].asset_path if manifest.images else None,
                cover_public_url=manifest.images[0].public_url if manifest.images else None,
            )
        )
    return summaries


def resolve_review_asset(review_id: str, asset_path: str) -> Path:
    workspace = review_workspace(sanitize_review_id(review_id)).resolve()
    if not workspace.is_dir():
        raise HTTPException(status_code=404, detail="Review not found.")

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
