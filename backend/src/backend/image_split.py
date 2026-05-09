from __future__ import annotations

import io
import zipfile
from pathlib import Path
from uuid import uuid4

import numpy as np
from PIL import Image, ImageOps

from fastapi import HTTPException, UploadFile

from .config import get_settings
from .models import (
    ImageSplitBatchManifest,
    ImageSplitBatchPanel,
    ImageSplitManifest,
    ImageSplitMode,
    ImageSplitPanel,
)

_MAX_FIXED_PANELS = 100
_MAX_AUTO_INTERNAL = 11
_MAX_IMAGE_PIXELS = 25_000_000
_MAX_BATCH_FILES = 32


def sanitize_split_id(candidate: str) -> str:
    clean = "".join(ch for ch in candidate.lower() if ch in "0123456789abcdef")
    if len(clean) != 32:
        raise HTTPException(status_code=404, detail="Unknown split id.")
    return clean


def split_workspace(split_id: str) -> Path:
    settings = get_settings()
    return settings.image_splits_dir / split_id


def resolve_split_asset(split_id: str, asset_path: str) -> Path:
    """Resolve a PNG under a split workspace; allows one subdirectory (batch) e.g. 000/panel-001.png."""

    workspace_base = split_workspace(sanitize_split_id(split_id)).resolve()
    if not workspace_base.is_dir():
        raise HTTPException(status_code=404, detail="Split not found.")

    normalized = Path(asset_path.replace("\\", "/").strip("/"))
    if normalized.is_absolute() or ".." in normalized.parts:
        raise HTTPException(status_code=400, detail="Invalid asset path.")

    candidate = (workspace_base / normalized).resolve()
    try:
        candidate.relative_to(workspace_base)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid asset path.") from None

    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="Asset not found.")
    return candidate


def export_split_zip(workspace: Path) -> bytes:
    paths = sorted(workspace.rglob("panel-*.png"))
    if not paths:
        raise HTTPException(status_code=404, detail="Panels missing for this split.")

    workspace = workspace.resolve()

    archive = io.BytesIO()
    with zipfile.ZipFile(archive, mode="w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for panel_path in paths:
            rel = panel_path.resolve().relative_to(workspace).as_posix()
            bundle.writestr(rel, panel_path.read_bytes())
    archive.seek(0)
    return archive.read()


def _enforce_pixel_budget(image: Image.Image) -> None:
    pixels = image.size[0] * image.size[1]
    if pixels > _MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=400, detail="Image is too large to process safely.")


def _open_normalized_image(upload: UploadFile) -> tuple[Image.Image, str]:
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Image file required.")

    raw = upload.file.read()
    upload.file.close()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload.")

    try:
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    except OSError:
        raise HTTPException(status_code=400, detail="Unable to decode image.") from None

    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGB")

    _enforce_pixel_budget(image)
    return image, upload.filename


def _smooth_signal(signal: np.ndarray, window: int) -> np.ndarray:
    values = signal.astype(np.float64, copy=False)
    half = window // 2
    padded = np.pad(values, half, mode="edge")
    kernel = np.ones(window, dtype=np.float64) / window
    return np.convolve(padded, kernel, mode="valid")


def _low_variance_runs(profile: np.ndarray, *, min_run: int, percentile: float) -> list[tuple[int, int]]:
    smoothed = _smooth_signal(profile, max(7, min_run))
    cutoff = float(np.percentile(smoothed, percentile))
    mask = smoothed <= cutoff

    spans: list[tuple[int, int]] = []
    index = 0
    upper = mask.size

    while index < upper:
        if not mask[index]:
            index += 1
            continue
        start = index
        index += 1
        while index < upper and mask[index]:
            index += 1
        end_run = index
        if end_run - start >= min_run:
            spans.append((start, end_run))
    return spans


def _merge_close(indices: list[int], min_spacing: int) -> list[int]:
    if not indices:
        return []

    ordered = sorted(indices)
    merged = [ordered[0]]
    for value in ordered[1:]:
        if value - merged[-1] <= min_spacing:
            merged[-1] = (merged[-1] + value + 1) // 2
            continue
        merged.append(value)
    return merged


def _axis_separators(profile: np.ndarray, *, min_band: int, gutter_hint: int, sensitivity: float) -> list[int]:
    percentile = float(np.clip(24.0 + (1.0 - sensitivity) * 26.0, 14.0, 60.0))
    sep_run = max(2, gutter_hint)

    mids: list[int] = []
    scale = 1.0
    attempt = 0
    smoother_window = max(9, gutter_hint)

    while attempt < 6 and not mids:
        runs = _low_variance_runs(
            profile.astype(np.float64, copy=False) * scale,
            min_run=sep_run,
            percentile=percentile,
        )
        mids = [(start + end) // 2 for start, end in runs]
        mids = _merge_close(mids, max(min_band // 2, gutter_hint + 4))

        mids = [
            midpoint
            for midpoint in mids
            if min_band < midpoint < profile.shape[0] - min_band
        ]
        if mids:
            break
        percentile = min(62.5, percentile + 5.0)
        scale *= 0.9
        attempt += 1

    mids = sorted(set(mids))

    if len(mids) > _MAX_AUTO_INTERNAL:
        smoothed_series = _smooth_signal(profile.astype(np.float64), smoother_window)
        ranked = sorted(
            [(midpoint, float(smoothed_series[midpoint])) for midpoint in mids],
            key=lambda item: item[1],
        )
        mids = [point for point, _ in ranked[:_MAX_AUTO_INTERNAL]]

    return mids


def _integer_segments(span: int, slices: int, gutter: int) -> list[tuple[int, int]]:
    if slices <= 0:
        raise HTTPException(status_code=400, detail="Grid dimensions must be positive integers.")
    total_gutter = gutter * max(0, slices - 1)
    drawable = span - total_gutter
    if drawable <= slices:
        raise HTTPException(
            status_code=400,
            detail="Cannot fit the requested gutter with those grid dimensions.",
        )

    widths: list[int] = []
    base = drawable // slices
    remainder = drawable - base * slices
    for idx in range(slices):
        widths.append(base + (1 if idx < remainder else 0))

    cursor = 0
    segments: list[tuple[int, int]] = []
    for idx, width in enumerate(widths):
        start = cursor
        cursor += width
        segments.append((start, cursor))
        if idx < slices - 1:
            cursor += gutter

    return segments


def _fixed_boxes(image: Image.Image, rows: int, cols: int, gutter_px: int) -> tuple[int, int, list[tuple[int, int, int, int]]]:
    if rows * cols > _MAX_FIXED_PANELS:
        raise HTTPException(status_code=400, detail=f"Panels must stay under {_MAX_FIXED_PANELS}.")
    if rows <= 0 or cols <= 0:
        raise HTTPException(status_code=400, detail="Rows and cols must be positive integers.")

    width, height = image.size
    row_spans = _integer_segments(height, rows, gutter_px)
    col_spans = _integer_segments(width, cols, gutter_px)

    boxes: list[tuple[int, int, int, int]] = []
    for top, bottom in row_spans:
        for left, right in col_spans:
            boxes.append((left, top, right, bottom))
    return rows, cols, boxes


def _auto_boxes(
    image: Image.Image,
    *,
    gutter_px: int,
    sensitivity: float,
) -> tuple[int, int, list[tuple[int, int, int, int]]]:
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    height, width = gray.shape
    shortest = min(height, width)
    min_band = max(24, shortest // 18)
    gutter_hint = gutter_px if gutter_px > 0 else max(6, shortest // 256)

    row_profile = gray.var(axis=1)
    col_profile = gray.var(axis=0)

    row_mid = _axis_separators(
        row_profile,
        min_band=min_band,
        gutter_hint=gutter_hint,
        sensitivity=sensitivity,
    )
    col_mid = _axis_separators(
        col_profile,
        min_band=min_band,
        gutter_hint=gutter_hint,
        sensitivity=sensitivity,
    )

    row_edges = sorted({0, *row_mid, height})
    col_edges = sorted({0, *col_mid, width})

    min_span = max(18, gutter_hint)

    merged_rows: list[tuple[int, int]] = []
    for upper, lower in zip(row_edges[:-1], row_edges[1:], strict=False):
        if lower - upper < min_span:
            continue
        merged_rows.append((upper, lower))

    merged_cols: list[tuple[int, int]] = []
    for upper, lower in zip(col_edges[:-1], col_edges[1:], strict=False):
        if lower - upper < min_span:
            continue
        merged_cols.append((upper, lower))

    if not merged_rows:
        merged_rows = [(0, height)]
    if not merged_cols:
        merged_cols = [(0, width)]

    gutter_margin = max(0, gutter_px // 3)
    boxes: list[tuple[int, int, int, int]] = []

    for top, bottom in merged_rows:
        for left, right in merged_cols:
            left_trim = left + gutter_margin
            right_trim = right - gutter_margin
            top_trim = top + gutter_margin
            bottom_trim = bottom - gutter_margin

            left_trim = max(0, min(left_trim, width - 2))
            right_trim = max(left_trim + 1, min(right_trim, width))
            top_trim = max(0, min(top_trim, height - 2))
            bottom_trim = max(top_trim + 1, min(bottom_trim, height))

            boxes.append((left_trim, top_trim, right_trim, bottom_trim))

    boxes.sort(key=lambda bbox: (bbox[1], bbox[0]))
    return len(merged_rows), len(merged_cols), boxes


def _write_panels(workspace: Path, image: Image.Image, boxes: list[tuple[int, int, int, int]]) -> list[ImageSplitPanel]:
    workspace.mkdir(parents=True, exist_ok=True)
    panels: list[ImageSplitPanel] = []

    for index, bbox in enumerate(boxes, start=1):
        left, top, right, bottom = bbox
        cropped = image.crop((left, top, right, bottom))
        if cropped.mode not in {"RGB", "RGBA"}:
            cropped = cropped.convert("RGB")
        filename = f"panel-{index:03d}.png"
        target = workspace / filename
        cropped.save(target, format="PNG")
        panels.append(ImageSplitPanel(index=index, label=f"Panel {index}", asset_path=filename))

    return panels


def run_fixed_grid_split(upload: UploadFile, rows: int, cols: int, gutter_px: int) -> ImageSplitManifest:
    image, filename = _open_normalized_image(upload)
    rows_out, cols_out, boxes = _fixed_boxes(image, rows, cols, gutter_px)

    split_id = uuid4().hex
    workspace = split_workspace(split_id)
    panels = _write_panels(workspace, image, boxes)

    return ImageSplitManifest(
        split_id=split_id,
        source_filename=Path(filename).name,
        width=image.size[0],
        height=image.size[1],
        mode=ImageSplitMode.FIXED,
        rows=rows_out,
        cols=cols_out,
        gutter_px=gutter_px,
        panels=panels,
    )


def run_auto_split(upload: UploadFile, gutter_px: int, sensitivity: float) -> ImageSplitManifest:
    sensitivity = float(np.clip(sensitivity, 0.0, 1.0))
    image, filename = _open_normalized_image(upload)
    rows_out, cols_out, boxes = _auto_boxes(image, gutter_px=gutter_px, sensitivity=sensitivity)

    split_id = uuid4().hex
    workspace = split_workspace(split_id)
    panels = _write_panels(workspace, image, boxes)

    return ImageSplitManifest(
        split_id=split_id,
        source_filename=Path(filename).name,
        width=image.size[0],
        height=image.size[1],
        mode=ImageSplitMode.AUTO,
        rows=rows_out,
        cols=cols_out,
        gutter_px=gutter_px,
        panels=panels,
    )


def workspace_for_export(split_id: str) -> Path:
    workspace = split_workspace(sanitize_split_id(split_id)).resolve()
    if not workspace.is_dir():
        raise HTTPException(status_code=404, detail="Split not found.")
    return workspace


def run_batch_fixed_grid(
    uploads: list[UploadFile], rows: int, cols: int, gutter_px: int
) -> ImageSplitBatchManifest:
    if not uploads:
        raise HTTPException(status_code=400, detail="At least one image is required.")
    if len(uploads) > _MAX_BATCH_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many images at once (maximum {_MAX_BATCH_FILES}).",
        )

    batch_id = uuid4().hex
    workspace = split_workspace(batch_id)
    workspace.mkdir(parents=True, exist_ok=True)

    batch_panels: list[ImageSplitBatchPanel] = []
    source_names: list[str] = []
    global_index = 0

    for i, upload in enumerate(uploads):
        image, raw_name = _open_normalized_image(upload)
        name = Path(raw_name).name
        source_names.append(name)
        subdir = workspace / f"{i:03d}"
        _rows, _cols, boxes = _fixed_boxes(image, rows, cols, gutter_px)
        _ = (_rows, _cols)
        sub_panels = _write_panels(subdir, image, boxes)
        for sp in sub_panels:
            global_index += 1
            rel_asset = f"{i:03d}/{sp.asset_path}"
            batch_panels.append(
                ImageSplitBatchPanel(
                    index=global_index,
                    label=f"{name} · {sp.label}",
                    asset_path=rel_asset,
                    source_index=i,
                    source_filename=name,
                )
            )

    return ImageSplitBatchManifest(
        batch_id=batch_id,
        mode=ImageSplitMode.FIXED,
        rows=rows,
        cols=cols,
        gutter_px=gutter_px,
        sensitivity=None,
        source_filenames=source_names,
        total_sources=len(source_names),
        panels=batch_panels,
    )


def run_batch_auto(uploads: list[UploadFile], gutter_px: int, sensitivity: float) -> ImageSplitBatchManifest:
    if not uploads:
        raise HTTPException(status_code=400, detail="At least one image is required.")
    if len(uploads) > _MAX_BATCH_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many images at once (maximum {_MAX_BATCH_FILES}).",
        )

    sensitivity = float(np.clip(sensitivity, 0.0, 1.0))
    batch_id = uuid4().hex
    workspace = split_workspace(batch_id)
    workspace.mkdir(parents=True, exist_ok=True)

    batch_panels: list[ImageSplitBatchPanel] = []
    source_names: list[str] = []
    global_index = 0

    for i, upload in enumerate(uploads):
        image, raw_name = _open_normalized_image(upload)
        name = Path(raw_name).name
        source_names.append(name)
        subdir = workspace / f"{i:03d}"
        _rows, _cols, boxes = _auto_boxes(image, gutter_px=gutter_px, sensitivity=sensitivity)
        _ = (_rows, _cols)
        sub_panels = _write_panels(subdir, image, boxes)
        for sp in sub_panels:
            global_index += 1
            rel_asset = f"{i:03d}/{sp.asset_path}"
            batch_panels.append(
                ImageSplitBatchPanel(
                    index=global_index,
                    label=f"{name} · {sp.label}",
                    asset_path=rel_asset,
                    source_index=i,
                    source_filename=name,
                )
            )

    return ImageSplitBatchManifest(
        batch_id=batch_id,
        mode=ImageSplitMode.AUTO,
        rows=None,
        cols=None,
        gutter_px=gutter_px,
        sensitivity=sensitivity,
        source_filenames=source_names,
        total_sources=len(source_names),
        panels=batch_panels,
    )
