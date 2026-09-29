from __future__ import annotations

import importlib
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

from backend import youtube
from backend.config import get_settings
from backend.models import YouTubeJobRequest
from backend.storage import read_state

URL = "https://www.youtube.com/watch?v=i380DwcJxxM"


@pytest.mark.parametrize("url", [
    "https://youtu.be/i380DwcJxxM?si=tracking", URL + "&list=ignored&t=10",
    "https://m.youtube.com/shorts/i380DwcJxxM", "https://youtube.com/embed/i380DwcJxxM",
])
def test_normalizes_single_video(url):
    assert youtube.canonical_youtube_url(url) == (URL, "i380DwcJxxM")


@pytest.mark.parametrize("url", [
    "https://youtube.com.evil.test/watch?v=i380DwcJxxM", "file:///etc/passwd",
    "https://127.0.0.1/watch?v=i380DwcJxxM", "https://youtube.com/playlist?list=abc",
    "https://user:secret@youtube.com/watch?v=i380DwcJxxM", "http://youtu.be/i380DwcJxxM",
    "https://youtube.com:8443/watch?v=i380DwcJxxM", "https://youtube.com/watch?v=../file",
])
def test_rejects_other_sources(url):
    with pytest.raises(HTTPException):
        youtube.canonical_youtube_url(url)


def test_url_endpoint_is_pollable_before_source_exists(client, monkeypatch):
    app_module = importlib.import_module("backend.app")
    async def hold_job(*args):
        pass
    monkeypatch.setattr(app_module, "download_and_process", hold_job)
    response = client.post("/api/jobs/youtube", json={"url": URL, "split_mode": "count", "target_count": 7})
    assert response.status_code == 202
    job = response.json()["job"]
    assert job["source_ready"] is False
    assert job["stage"] == "download-queued"
    assert client.get(f"/api/jobs/{job['job_id']}").json()["target_count"] == 7
    assert client.get(f"/api/jobs/{job['job_id']}/assets/source/{job['source_video']}").status_code == 404
    assert client.post("/api/jobs/youtube", json={"url": "https://localhost/"}).status_code == 400
    assert client.post("/api/jobs/youtube", json={"url": URL, "target_count": 100}).status_code == 422


def test_youtube_clip_range_validation(client):
    response = client.post(
        "/api/jobs/youtube",
        json={"url": URL, "clip_start_seconds": 120, "clip_end_seconds": 60},
    )
    assert response.status_code == 422


def test_download_command_keeps_native_downloader_for_clips(tmp_path):
    command = youtube.download_command(URL, tmp_path / "source.mp4", None, clip_start=90, clip_end=150)
    assert "--download-sections" not in command
    assert "--force-keyframes-at-cuts" not in command


def test_download_command_start_only_clip_also_uses_native_downloader(tmp_path):
    command = youtube.download_command(URL, tmp_path / "source.mp4", None, clip_start=25 * 60 + 15, clip_end=None)
    assert "--download-sections" not in command


def test_cookie_copy_is_private_filtered_and_does_not_mutate_source(temp_data_dir, tmp_path, monkeypatch):
    source = tmp_path / "source.cookies.txt"
    content = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tprivate-value\n.evil.test\tTRUE\t/\tTRUE\t0\tOTHER\tother-value\n"
    source.write_text(content)
    monkeypatch.setenv("SPLITTER_YOUTUBE_COOKIES_FILE", str(source))
    get_settings.cache_clear()
    destination = tmp_path / "copy.cookies.txt"
    youtube.copy_youtube_cookies(destination)
    assert "OTHER" not in destination.read_text()
    assert "SID" in destination.read_text()
    assert source.read_text() == content
    assert not list(temp_data_dir.glob("**/*cookies*"))


@pytest.mark.asyncio
async def test_failed_download_keeps_pollable_error_and_never_processes(temp_data_dir, monkeypatch):
    job = youtube.create_youtube_job(YouTubeJobRequest(url=URL))
    async def fail(*args, **kwargs):
        raise ValueError(youtube.safe_download_error("ERROR: sign in not a bot cookie=SECRET"))
    monkeypatch.setattr(youtube, "run_download", fail)
    monkeypatch.setattr(youtube, "process_job", lambda _: pytest.fail("Must not split an incomplete download"))
    await youtube.download_and_process(job.job_id, False)
    state = read_state(job.job_id)
    assert state.status == "failed"
    assert state.source_ready is False
    assert "sign-in" in state.error
    assert "SECRET" not in state.error


@pytest.mark.asyncio
async def test_downloader_timeout_terminates_child(temp_data_dir, tmp_path, monkeypatch):
    job = youtube.create_youtube_job(YouTubeJobRequest(url=URL))
    monkeypatch.setenv("SPLITTER_YOUTUBE_TIMEOUT_SECONDS", "1")
    get_settings.cache_clear()
    monkeypatch.setattr(
        youtube,
        "download_command",
        lambda *args, **kwargs: [sys.executable, "-c", "import time; time.sleep(60)"],
    )
    with pytest.raises(ValueError, match="timed out"):
        await youtube.run_download(job.job_id, URL, tmp_path / "source.mp4", None)


@pytest.mark.asyncio
async def test_downloaded_fixture_flows_through_real_scene_pipeline(temp_data_dir, tmp_path, monkeypatch):
    async def fixture_download(job_id, url, output, cookies, **kwargs):
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
            "testsrc2=size=160x90:rate=24:duration=2", "-c:v", "libx264", str(output),
        ], check=True)
    monkeypatch.setattr(youtube, "run_download", fixture_download)
    job = youtube.create_youtube_job(YouTubeJobRequest(url=URL, split_mode="count", target_count=2))
    await youtube.download_and_process(job.job_id, False)
    state = read_state(job.job_id)
    assert state.status == "completed", state.error
    assert state.source_ready is True
    assert state.segment_count == 2
    assert len(list((temp_data_dir / job.job_id / "clips").glob("segment-*.mp4"))) == 2


@pytest.mark.asyncio
async def test_clip_range_trims_before_splitting(temp_data_dir, monkeypatch):
    async def fixture_download(job_id, url, output, cookies, *, clip_start=None, clip_end=None):
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
            "testsrc2=size=160x90:rate=24:duration=4", "-c:v", "libx264", str(output),
        ], check=True)

    monkeypatch.setattr(youtube, "run_download", fixture_download)
    job = youtube.create_youtube_job(
        YouTubeJobRequest(url=URL, split_mode="count", target_count=2, clip_start_seconds=1.0, clip_end_seconds=3.0),
    )
    await youtube.download_and_process(job.job_id, False)
    state = read_state(job.job_id)
    assert state.status == "completed", state.error
    assert state.source_ready is True


def test_command_has_bounded_single_video_and_cookie_file_only(temp_data_dir, tmp_path):
    command = youtube.download_command(URL, tmp_path / "source.mp4", tmp_path / "private.cookies.txt")
    assert "--no-playlist" in command
    assert "--ignore-config" in command
    assert "--no-check-certificate" not in command
    assert command[-2:] == ["--", URL]
    assert "--cookies-from-browser" not in command
    assert command[command.index("--cookies") + 1].endswith("private.cookies.txt")
