from pathlib import Path

from PIL import Image

from backend import storage
from backend.processing import (
    SegmentBoundary,
    build_contact_sheet,
    format_seconds,
    merge_short_segments,
)


def test_format_seconds_renders_timecode() -> None:
    assert format_seconds(0) == "00:00:00.000"
    assert format_seconds(61.234) == "00:01:01.234"


def test_merge_short_segments_joins_spurious_double_cut() -> None:
    fps = 30.0
    a = SegmentBoundary(1, 0, 100, 0.0, 100 / fps, fps)
    thin = SegmentBoundary(2, 100, 104, 100 / fps, 104 / fps, fps)
    b = SegmentBoundary(3, 104, 200, 104 / fps, 200 / fps, fps)
    merged = merge_short_segments([a, thin, b], min_frames=12)
    assert len(merged) == 2
    assert merged[0].end_frame == 104
    assert merged[1].start_frame == 104
    assert merged[0].index == 1 and merged[1].index == 2


def test_thumbnail_seconds_targets_midshot() -> None:
    fps = 30.0
    seg = SegmentBoundary(1, 0, 300, 0.0, 10.0, fps)
    ts = seg.thumbnail_seconds
    assert 4.5 < ts < 5.5


def test_build_contact_sheet_exports_16_by_9_canvas(tmp_path: Path) -> None:
    image_paths: list[Path] = []
    for index in range(3):
        source_path = tmp_path / f"frame-{index}.jpg"
        Image.new("RGB", (1280, 720), (index * 40, 120, 180)).save(source_path)
        image_paths.append(source_path)

    output_path = tmp_path / "contact-sheet.jpg"
    result = build_contact_sheet(output_path, image_paths)

    assert result == output_path
    with Image.open(output_path) as exported:
        assert exported.size == (2000, 900)


def test_atomic_write_json_retries_permission_error_once(tmp_path: Path, monkeypatch) -> None:
    target = tmp_path / "status.json"
    original_replace = Path.replace
    attempts = {"count": 0}

    def flaky_replace(self: Path, destination: Path) -> Path:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise PermissionError("busy")
        return original_replace(self, destination)

    monkeypatch.setattr(Path, "replace", flaky_replace)

    storage._atomic_write_json(target, {"status": "ok"})

    assert attempts["count"] == 2
    assert target.exists()
