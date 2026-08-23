from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from backend import storage
from backend.processing import (
    SegmentBoundary,
    build_count_segments,
    build_contact_sheet,
    build_interval_segments,
    evenly_spaced_segment_timestamps,
    format_seconds,
    merge_short_segments,
)
from backend.models import SegmentRecord


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


def test_count_segments_cover_every_frame_in_exact_equal_total() -> None:
    segments = build_count_segments(duration_seconds=10.0, frame_rate=10.0, total_frames=100, target_count=6)

    assert len(segments) == 6
    assert segments[0].start_frame == 0
    assert segments[-1].end_frame == 100
    assert sum(segment.frame_count for segment in segments) == 100
    assert max(segment.frame_count for segment in segments) - min(segment.frame_count for segment in segments) <= 1


def test_interval_segments_keep_short_tail_and_cover_every_frame() -> None:
    segments = build_interval_segments(duration_seconds=10.0, frame_rate=10.0, total_frames=100, interval_seconds=3.0)

    assert [segment.frame_count for segment in segments] == [30, 30, 30, 10]
    assert segments[-1].end_seconds == 10.0
    assert sum(segment.frame_count for segment in segments) == 100


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


def test_build_contact_sheet_keeps_every_dynamic_grid_cell_16_by_9(tmp_path: Path) -> None:
    source_path = tmp_path / "portrait.jpg"
    Image.new("RGB", (900, 1200), (40, 120, 180)).save(source_path)

    output_path = tmp_path / "contact-sheet-3x3.jpg"
    build_contact_sheet(output_path, [source_path] * 9, columns=3, rows=3, crop_to_fill=True)

    with Image.open(output_path) as exported:
        assert exported.size == (1200, 675)


def test_evenly_spaced_timestamps_treat_selected_clips_as_one_timeline() -> None:
    segments = [
        SegmentRecord(
            index=1,
            start_frame=0,
            end_frame=30,
            frame_count=30,
            start_seconds=0.0,
            end_seconds=1.0,
            duration_seconds=1.0,
            clip_path="clips/segment-001.mp4",
            thumbnail_path="thumbnails/segment-001.jpg",
            label="one",
        ),
        SegmentRecord(
            index=2,
            start_frame=300,
            end_frame=390,
            frame_count=90,
            start_seconds=10.0,
            end_seconds=13.0,
            duration_seconds=3.0,
            clip_path="clips/segment-002.mp4",
            thumbnail_path="thumbnails/segment-002.jpg",
            label="two",
        ),
    ]

    timestamps = evenly_spaced_segment_timestamps(segments, [2, 1], sample_count=4, frame_rate=30.0)

    assert timestamps == [0.5, 10.5, 11.5, 12.5]


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


def test_read_state_retries_permission_error_once(tmp_path: Path, monkeypatch) -> None:
    target = tmp_path / "status.json"
    target.write_text(
        """{
          "job_id": "test-job",
          "status": "completed",
          "stage": "complete",
          "source_video": "source.mp4",
          "created_at": "2026-07-26T12:00:00Z",
          "updated_at": "2026-07-26T12:00:01Z"
        }""",
        encoding="utf-8",
    )
    original_read_text = Path.read_text
    attempts = {"count": 0}

    def flaky_read_text(self: Path, *args, **kwargs) -> str:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise PermissionError("busy")
        return original_read_text(self, *args, **kwargs)

    monkeypatch.setattr(storage, "get_job_paths", lambda _job_id: SimpleNamespace(state_file=target))
    monkeypatch.setattr(Path, "read_text", flaky_read_text)

    state = storage.read_state("test-job")

    assert attempts["count"] == 2
    assert state.status.value == "completed"
