from __future__ import annotations

from datetime import datetime, timezone
import importlib

from fastapi.testclient import TestClient

from backend.models import JobManifest, JobState, JobStatus, SegmentRecord


def test_create_job_endpoint(monkeypatch, client: TestClient) -> None:
    app_module = importlib.import_module("backend.app")

    def fake_process(job_id: str) -> None:
        from backend.storage import save_manifest, update_state

        save_manifest(
            JobManifest(
                job_id=job_id,
                source_video="clip.mp4",
                duration_seconds=3.0,
                frame_rate=30.0,
                frame_count=90,
                segment_count=1,
                reassembled_path="clips/reassembled.mp4",
                keyframes_zip_path="exports/keyframes.zip",
                segments_zip_path="exports/segments.zip",
                contact_sheet_path="exports/contact-sheet.jpg",
                reconstruction_audit={
                    "original_frame_count": 90,
                    "reconstructed_frame_count": 90,
                    "expected_segment_frames": 90,
                    "frame_delta": 0,
                    "original_duration_seconds": 3.0,
                    "reconstructed_duration_seconds": 3.0,
                    "duration_delta_seconds": 0.0,
                },
                segments=[
                    SegmentRecord(
                        index=1,
                        start_frame=0,
                        end_frame=90,
                        frame_count=90,
                        start_seconds=0.0,
                        end_seconds=3.0,
                        duration_seconds=3.0,
                        clip_path="clips/segment-001.mp4",
                        thumbnail_path="thumbnails/segment-001.jpg",
                        label="00:00:00.000 - 00:00:03.000",
                    )
                ],
                created_at=datetime.now(timezone.utc),
            )
        )
        update_state(
            job_id,
            status=JobStatus.COMPLETED,
            stage="completed",
            duration_seconds=3.0,
            segment_count=1,
            progress_total=1,
            progress_completed=1,
        )

    monkeypatch.setattr(app_module, "process_job", fake_process)

    response = client.post(
        "/api/jobs",
        files={"file": ("clip.mp4", b"not-a-real-video", "video/mp4")},
    )
    assert response.status_code == 200
    payload = response.json()["job"]
    assert payload["status"] == "queued"

    job_state = client.get(f"/api/jobs/{payload['job_id']}")
    assert job_state.status_code == 200
    assert job_state.json()["status"] == "completed"

    result = client.get(f"/api/jobs/{payload['job_id']}/result")
    assert result.status_code == 200
    assert result.json()["manifest"]["segment_count"] == 1


def test_job_result_while_processing_returns_conflict(monkeypatch, client: TestClient) -> None:
    app_module = importlib.import_module("backend.app")

    def leave_processing(job_id: str) -> None:
        from backend.storage import update_state

        update_state(job_id, status=JobStatus.PROCESSING, stage="extracting-segments")

    monkeypatch.setattr(app_module, "process_job", leave_processing)
    response = client.post(
        "/api/jobs",
        files={"file": ("clip.mp4", b"still-not-a-real-video", "video/mp4")},
    )
    assert response.status_code == 200
    job_id = response.json()["job"]["job_id"]
    result = client.get(f"/api/jobs/{job_id}/result")
    assert result.status_code == 409


def test_create_job_accepts_equal_count_sampling_options(monkeypatch, client: TestClient) -> None:
    app_module = importlib.import_module("backend.app")
    captured: dict[str, object] = {}

    def capture_job(job_id: str) -> None:
        from backend.storage import read_state

        state = read_state(job_id)
        captured.update(
            split_mode=state.split_mode.value,
            target_count=state.target_count,
            interval_seconds=state.interval_seconds,
        )

    monkeypatch.setattr(app_module, "process_job", capture_job)
    response = client.post(
        "/api/jobs",
        files={"file": ("clip.mp4", b"video", "video/mp4")},
        data={"split_mode": "count", "target_count": "10", "interval_seconds": "7"},
    )

    assert response.status_code == 200
    assert response.json()["job"]["split_mode"] == "count"
    assert captured == {"split_mode": "count", "target_count": 10, "interval_seconds": 7.0}


def test_custom_contact_sheet_endpoint_passes_selected_clips_and_layout(monkeypatch, client: TestClient, tmp_path) -> None:
    app_module = importlib.import_module("backend.app")
    sheet_path = tmp_path / "selected-sheet.jpg"
    sheet_path.write_bytes(b"jpeg-sheet")
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        app_module,
        "read_state",
        lambda job_id: JobState(
            job_id=job_id,
            status=JobStatus.COMPLETED,
            stage="completed",
            source_video="clip.mp4",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        ),
    )

    def fake_build(job_id: str, segment_indices: list[int], rows: int, columns: int):
        captured.update(
            job_id=job_id,
            segment_indices=segment_indices,
            rows=rows,
            columns=columns,
        )
        return sheet_path

    monkeypatch.setattr(app_module, "build_custom_contact_sheet", fake_build)

    response = client.get(
        "/api/jobs/job-1/contact-sheet?segment_indices=3&segment_indices=1&rows=4&columns=5"
    )

    assert response.status_code == 200
    assert response.content == b"jpeg-sheet"
    assert response.headers["content-disposition"] == 'attachment; filename="splitter-selected-sheet-5x4.jpg"'
    assert captured == {
        "job_id": "job-1",
        "segment_indices": [3, 1],
        "rows": 4,
        "columns": 5,
    }


def test_playhead_keyframe_endpoint_passes_segment_and_timestamp(monkeypatch, client: TestClient, tmp_path) -> None:
    app_module = importlib.import_module("backend.app")
    frame_path = tmp_path / "playhead-frame.jpg"
    frame_path.write_bytes(b"jpeg-frame")
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        app_module,
        "read_state",
        lambda job_id: JobState(
            job_id=job_id,
            status=JobStatus.COMPLETED,
            stage="completed",
            source_video="clip.mp4",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        ),
    )

    def fake_build(job_id: str, segment_index: int, timestamp_seconds: float):
        captured.update(job_id=job_id, segment_index=segment_index, timestamp_seconds=timestamp_seconds)
        return frame_path

    monkeypatch.setattr(app_module, "build_segment_keyframe", fake_build)

    response = client.get("/api/jobs/job-1/segments/3/keyframe?timestamp_seconds=1.275")

    assert response.status_code == 200
    assert response.content == b"jpeg-frame"
    assert response.headers["content-disposition"] == 'attachment; filename="splitter-segment-003-1.275s.jpg"'
    assert captured == {"job_id": "job-1", "segment_index": 3, "timestamp_seconds": 1.275}
