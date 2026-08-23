from __future__ import annotations

import subprocess
import time
from pathlib import Path

from fastapi.testclient import TestClient
import cv2
import numpy as np


def build_sample_video(target: Path) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=320x180:d=1",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=320x180:d=1",
        "-f",
        "lavfi",
        "-i",
        "color=c=green:s=320x180:d=1",
        "-filter_complex",
        "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]",
        "-map",
        "[v]",
        str(target),
    ]
    subprocess.run(command, check=True)


def test_real_video_pipeline(client: TestClient, tmp_path: Path) -> None:
    video_path = tmp_path / "sample.mp4"
    build_sample_video(video_path)

    with video_path.open("rb") as handle:
        response = client.post(
            "/api/jobs",
            files={"file": ("sample.mp4", handle, "video/mp4")},
        )

    assert response.status_code == 200
    job = response.json()["job"]
    assert job["status"] == "queued"

    status_payload = job
    for _ in range(30):
        status_response = client.get(f"/api/jobs/{job['job_id']}")
        assert status_response.status_code == 200
        status_payload = status_response.json()
        if status_payload["status"] == "completed":
            break
        time.sleep(0.1)

    assert status_payload["status"] == "completed"
    assert status_payload["segment_count"] >= 1

    manifest_response = client.get(f"/api/jobs/{job['job_id']}/result")
    assert manifest_response.status_code == 200
    manifest = manifest_response.json()["manifest"]
    assert manifest["segments"]
    assert manifest["segment_count"] >= 3
    assert manifest["reassembled_path"] == "clips/reassembled.mp4"
    assert manifest["keyframes_zip_path"] == "exports/keyframes.zip"
    assert manifest["segments_zip_path"] == "exports/segments.zip"
    assert manifest["contact_sheet_path"] == "exports/contact-sheet.jpg"
    assert manifest["frame_count"] > 0
    assert abs(manifest["frame_rate"] - 25.0) < 0.1
    assert manifest["reconstruction_audit"]["original_frame_count"] == manifest["frame_count"]
    assert manifest["reconstruction_audit"]["expected_segment_frames"] == manifest["frame_count"]
    assert abs(manifest["reconstruction_audit"]["frame_delta"]) <= 1

    first_segment = manifest["segments"][0]
    assert first_segment["frame_count"] == first_segment["end_frame"] - first_segment["start_frame"]
    clip = client.get(f"/api/jobs/{job['job_id']}/assets/{first_segment['clip_path']}")
    image = client.get(f"/api/jobs/{job['job_id']}/assets/{first_segment['thumbnail_path']}")
    reassembled = client.get(f"/api/jobs/{job['job_id']}/assets/{manifest['reassembled_path']}")
    keyframes_zip = client.get(f"/api/jobs/{job['job_id']}/assets/{manifest['keyframes_zip_path']}")
    segments_zip = client.get(f"/api/jobs/{job['job_id']}/assets/{manifest['segments_zip_path']}")
    contact_sheet = client.get(f"/api/jobs/{job['job_id']}/assets/{manifest['contact_sheet_path']}")
    assert clip.status_code == 200
    assert image.status_code == 200
    assert reassembled.status_code == 200
    assert keyframes_zip.status_code == 200
    assert segments_zip.status_code == 200
    assert contact_sheet.status_code == 200

    decoded = cv2.imdecode(np.frombuffer(image.content, dtype=np.uint8), cv2.IMREAD_COLOR)
    mean_bgr = decoded.mean(axis=(0, 1))
    assert mean_bgr[2] > mean_bgr[1]
    assert mean_bgr[2] > mean_bgr[0]


def test_real_video_pipeline_extracts_exact_even_count(client: TestClient, tmp_path: Path) -> None:
    video_path = tmp_path / "even-sample.mp4"
    build_sample_video(video_path)

    with video_path.open("rb") as handle:
        response = client.post(
            "/api/jobs",
            files={"file": ("even-sample.mp4", handle, "video/mp4")},
            data={"split_mode": "count", "target_count": "10", "interval_seconds": "5"},
        )

    assert response.status_code == 200
    job_id = response.json()["job"]["job_id"]
    status_payload: dict[str, object] = {}
    for _ in range(30):
        status_payload = client.get(f"/api/jobs/{job_id}").json()
        if status_payload["status"] == "completed":
            break
        time.sleep(0.1)

    assert status_payload["status"] == "completed"
    manifest = client.get(f"/api/jobs/{job_id}/result").json()["manifest"]
    assert manifest["split_mode"] == "count"
    assert manifest["target_count"] == 10
    assert manifest["segment_count"] == 10
    assert sum(segment["frame_count"] for segment in manifest["segments"]) == manifest["frame_count"]
    assert all(
        client.get(f"/api/jobs/{job_id}/assets/{segment['thumbnail_path']}").status_code == 200
        for segment in manifest["segments"]
    )
