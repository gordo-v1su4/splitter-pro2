from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
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


def _storage_folder(review_id: str, folder_kind: str = "images") -> str:
    settings = get_settings()
    prefix = "/".join(part.strip("/") for part in settings.review_storage_prefix.split("/") if part.strip("/"))
    safe_kind = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in folder_kind).strip("-_")
    safe_kind = safe_kind or "images"
    return f"{prefix}/{review_id}/{safe_kind}" if prefix else f"{review_id}/{safe_kind}"


def _raw_env(name: str) -> str | None:
    value = os.environ.get(name)
    if value:
        return value
    env_file = Path(__file__).resolve().parents[3] / ".env"
    if not env_file.is_file():
        return None
    for line in env_file.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, raw_value = stripped.split("=", 1)
        if key.strip().lstrip("\ufeff") == name:
            return raw_value.strip().strip('"').strip("'") or None
    return None


def _get_env_any(*names: str) -> str | None:
    for name in names:
        value = _raw_env(name)
        if value:
            return value
    return None


def _aws_signature_key(secret_key: str, date_stamp: str, region: str, service: str) -> bytes:
    key_date = hmac.new(("AWS4" + secret_key).encode("utf-8"), date_stamp.encode("utf-8"), hashlib.sha256).digest()
    key_region = hmac.new(key_date, region.encode("utf-8"), hashlib.sha256).digest()
    key_service = hmac.new(key_region, service.encode("utf-8"), hashlib.sha256).digest()
    return hmac.new(key_service, b"aws4_request", hashlib.sha256).digest()


def _create_direct_s3_bucket(
    *,
    endpoint: str,
    host: str,
    bucket: str,
    region: str,
    access_key: str,
    secret_key: str,
) -> None:
    payload_hash = hashlib.sha256(b"").hexdigest()
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    canonical_uri = f"/{bucket}"
    canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join(["PUT", canonical_uri, "", canonical_headers, signed_headers, payload_hash])
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signing_key = _aws_signature_key(secret_key, date_stamp, region, "s3")
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    response = httpx.put(
        f"{endpoint}/{bucket}",
        headers={
            "Authorization": (
                "AWS4-HMAC-SHA256 "
                f"Credential={access_key}/{credential_scope}, "
                f"SignedHeaders={signed_headers}, Signature={signature}"
            ),
            "Host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
        },
        content=b"",
        timeout=60.0,
    )
    if response.status_code >= 400 and "BucketAlreadyOwnedByYou" not in response.text:
        raise HTTPException(status_code=502, detail=f"Review storage bucket creation failed: {response.text[:200]}")


def _upload_to_direct_s3(
    *,
    image_path: Path,
    filename: str,
    content_type: str,
    review_id: str,
    folder_kind: str,
) -> dict[str, str] | None:
    endpoint = _get_env_any("SPLITTER_S3_ENDPOINT", "S3_ENDPOINT")
    access_key = _get_env_any("SPLITTER_S3_ACCESS_KEY_ID", "S3_ACCESS_KEY_ID")
    secret_key = _get_env_any("SPLITTER_S3_SECRET_ACCESS_KEY", "S3_SECRET_ACCESS_KEY")
    if not endpoint or not access_key or not secret_key:
        return None

    settings = get_settings()
    region = _get_env_any("SPLITTER_S3_REGION", "S3_REGION") or "us-east-1"
    bucket = settings.review_storage_bucket.strip() or _get_env_any("SPLITTER_S3_BUCKET", "S3_BUCKET") or "splitter"
    folder = _storage_folder(review_id, folder_kind)
    object_key = f"{folder}/{filename}"
    endpoint = endpoint.rstrip("/")
    encoded_key = "/".join(quote(part, safe="") for part in object_key.split("/"))
    url = f"{endpoint}/{bucket}/{encoded_key}"
    canonical_uri = f"/{bucket}/{encoded_key}"
    payload = image_path.read_bytes()
    payload_hash = hashlib.sha256(payload).hexdigest()
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    host = endpoint.removeprefix("https://").removeprefix("http://")
    canonical_headers = (
        f"content-type:{content_type}\n"
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join(
        ["PUT", canonical_uri, "", canonical_headers, signed_headers, payload_hash]
    )
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signing_key = _aws_signature_key(secret_key, date_stamp, region, "s3")
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    authorization = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    response = httpx.put(
        url,
        headers={
            "Authorization": authorization,
            "Content-Type": content_type,
            "Host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
        },
        content=payload,
        timeout=60.0,
    )
    if response.status_code >= 400 and "NoSuchBucket" in response.text:
        _create_direct_s3_bucket(endpoint=endpoint, host=host, bucket=bucket, region=region, access_key=access_key, secret_key=secret_key)
        response = httpx.put(
            url,
            headers={
                "Authorization": authorization,
                "Content-Type": content_type,
                "Host": host,
                "x-amz-content-sha256": payload_hash,
                "x-amz-date": amz_date,
            },
            content=payload,
            timeout=60.0,
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Review storage upload failed: {response.text[:200]}")
    return {
        "bucket": bucket,
        "object_key": object_key,
        "public_url": url,
        "media_url": "",
    }


def upload_to_review_storage(
    *,
    image_path: Path,
    filename: str,
    content_type: str,
    review_id: str,
    folder_kind: str = "images",
) -> dict[str, str] | None:
    """Upload a review image to RustFS when storage is configured.

    Object keys are rooted inside the configured bucket. For the default
    splitter bucket that means reviews/<review_id>/images/<uploaded-file> —
    never splitter/reviews/... because splitter is already the bucket name.
    """
    settings = get_settings()
    bucket = settings.review_storage_bucket.strip() or "splitter"
    folder = _storage_folder(review_id, folder_kind)
    if settings.media_api_url and settings.media_api_token:
        url = settings.media_api_url.rstrip("/") + "/upload"
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
    return _upload_to_direct_s3(
        image_path=image_path,
        filename=filename,
        content_type=content_type,
        review_id=review_id,
        folder_kind=folder_kind,
    )


def _load_manifest(workspace: Path) -> ReviewManifest:
    raw = json.loads(_manifest_path(workspace).read_text(encoding="utf-8"))
    return ReviewManifest.model_validate(raw)


def _content_type_for_path(path: Path) -> str:
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }[path.suffix.lower()]


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
        images.append(
            ReviewImage(
                index=index,
                label=Path(filename).name,
                asset_path=f"images/{filename}",
                width=image.width,
                height=image.height,
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


def set_review_image_approval(review_id: str, image_index: int, approval_status: str, rejection_reason: str | None = None) -> ReviewManifest:
    if approval_status not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="Unsupported review image approval status.")
    workspace = review_workspace(sanitize_review_id(review_id))
    if not _manifest_path(workspace).is_file():
        raise HTTPException(status_code=404, detail="Review not found.")

    manifest = _load_manifest(workspace)
    for image in manifest.images:
        if image.index == image_index:
            image.approval_status = approval_status
            if approval_status == "rejected":
                image.rejection_reason = rejection_reason.strip() if rejection_reason and rejection_reason.strip() else None
            elif approval_status == "approved":
                image.rejection_reason = None
            manifest.updated_at = datetime.now(timezone.utc)
            _write_manifest(workspace, manifest)
            return manifest
    raise HTTPException(status_code=404, detail="Review image not found.")


def publish_approved_review_images(review_id: str) -> ReviewManifest:
    workspace = review_workspace(sanitize_review_id(review_id))
    if not _manifest_path(workspace).is_file():
        raise HTTPException(status_code=404, detail="Review not found.")

    manifest = _load_manifest(workspace)
    changed = False
    for image in manifest.images:
        if image.approval_status != "approved":
            continue
        image_path = workspace / image.asset_path
        if not image_path.is_file():
            raise HTTPException(status_code=404, detail=f"Review image asset missing: {image.asset_path}")
        remote_asset = upload_to_review_storage(
            image_path=image_path,
            filename=Path(image.asset_path).name,
            content_type=_content_type_for_path(image_path),
            review_id=manifest.review_id,
            folder_kind="approved",
        )
        if remote_asset:
            image.storage_bucket = remote_asset.get("bucket")
            image.object_key = remote_asset.get("object_key")
            image.public_url = remote_asset.get("public_url")
            image.media_url = remote_asset.get("media_url")
        image.approval_status = "published"
        changed = True

    if changed:
        manifest.updated_at = datetime.now(timezone.utc)
        _write_manifest(workspace, manifest)
    return manifest


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
