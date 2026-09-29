"""Bounded YouTube import before the existing scene-processing pipeline.

Follows Yippr's private cookie-file pattern; neither cookies nor raw downloader
output are put in job assets, API errors, or logs.
"""
from __future__ import annotations

import asyncio
import http.cookiejar
import logging
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import warnings
from threading import BoundedSemaphore
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException

from .config import get_settings
from .models import JobState, JobStatus, YouTubeJobRequest
from .processing import process_job, probe_duration, run_ffmpeg
from .storage import create_job, get_job_paths, read_state, update_state

_slots = BoundedSemaphore(2)
logger = logging.getLogger(__name__)


def canonical_youtube_url(raw: str) -> tuple[str, str]:
    try:
        url = urlsplit(raw.strip())
        if url.scheme != "https" or url.username or url.password or url.port not in (None, 443):
            raise ValueError
        if url.hostname in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
            if url.path == "/watch":
                video_id = parse_qs(url.query).get("v", [""])[0]
            else:
                match = re.fullmatch(r"/(?:shorts|embed|live)/([\w-]{11})/?", url.path, re.ASCII)
                video_id = match[1] if match else ""
        elif url.hostname == "youtu.be":
            video_id = url.path.strip("/")
        else:
            raise ValueError
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            raise ValueError
    except ValueError:
        raise HTTPException(400, "Enter an HTTPS YouTube video link. Playlists and other websites are not supported.") from None
    # Drop tracking parameters, playlist IDs, fragments and start offsets. A job
    # always downloads one complete video via the YouTube extractor.
    return f"https://www.youtube.com/watch?v={video_id}", video_id


def create_youtube_job(payload: YouTubeJobRequest) -> JobState:
    url, video_id = canonical_youtube_url(payload.url)
    if payload.use_cookies and not get_settings().youtube_cookies_file:
        raise HTTPException(503, "YouTube cookies are not configured on this server. Import without cookies or ask the operator to configure a private cookie file.")
    paths = create_job(
        f"youtube-{video_id}.mp4", split_mode=payload.split_mode,
        target_count=payload.target_count, interval_seconds=payload.interval_seconds,
    )
    return update_state(
        paths.job_id,
        stage="download-queued",
        source_ready=False,
        source_url=url,
        clip_start_seconds=payload.clip_start_seconds,
        clip_end_seconds=payload.clip_end_seconds,
    )


def copy_youtube_cookies(destination: Path) -> None:
    source = get_settings().youtube_cookies_file
    if not source or not source.is_file():
        raise ValueError("The server's private YouTube cookie file is unavailable. Ask the operator to refresh it.")
    if source.stat().st_size > 1024 * 1024:
        raise ValueError("The server's YouTube cookie file is too large. Export only YouTube cookies.")
    try:
        jar = http.cookiejar.MozillaCookieJar(str(source))
        # MozillaCookieJar treats Netscape's common session expiry `0` as
        # expired. Preserve session cookies, then filter actual expired ones.
        # Its malformed-line warning can include cookie data: suppress it.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            jar.load(ignore_discard=True, ignore_expires=True)
        filtered = http.cookiejar.MozillaCookieJar(str(destination))
        for cookie in jar:
            if cookie.expires == 0:
                cookie.expires = None
                cookie.discard = True
            if cookie.is_expired():
                continue
            domain = cookie.domain.lstrip(".").lower()
            if domain == "youtube.com" or domain.endswith(".youtube.com"):
                filtered.set_cookie(cookie)
        if not list(filtered):
            raise ValueError
        destination.touch(mode=0o600)
        filtered.save(ignore_discard=True, ignore_expires=False)
    except (OSError, ValueError, http.cookiejar.LoadError):
        raise ValueError("The server needs a fresh Netscape-format YouTube cookie export. Cookie contents are never shown here.") from None


def _match_filters(clip_start: float | None, clip_end: float | None) -> str:
    settings = get_settings()
    max_duration = settings.youtube_max_duration_seconds
    if clip_end is not None:
        span = clip_end - (clip_start or 0.0)
        if span <= max_duration:
            return "!is_live & !is_upcoming"
    elif clip_start is not None:
        return "!is_live & !is_upcoming"
    return f"!is_live & !is_upcoming & duration <= {max_duration}"


def resolve_clip_window(duration: float, clip_start: float | None, clip_end: float | None) -> tuple[float, float]:
    start = clip_start or 0.0
    end = duration if clip_end is None else min(clip_end, duration)
    if start >= duration:
        raise ValueError("Clip start is beyond the downloaded video length.")
    if end <= start:
        raise ValueError("Clip end must be after clip start within the video.")
    return start, end


def _apply_clip_window(
    source: Path,
    download_dir: Path,
    duration: float,
    clip_start: float | None,
    clip_end: float | None,
) -> Path:
    """Trim a full download down to the requested clock window.

    yt-dlp's --download-sections flag hands the cut to ffmpeg, and YouTube
    throttles that single HTTP connection. The native downloader uses chunked
    range requests, then this trim keeps only the requested span.
    """
    settings = get_settings()
    start = clip_start or 0.0
    has_window = clip_end is not None or start > 0
    if has_window and start < duration - 0.05:
        window_start, window_end = resolve_clip_window(duration, clip_start, clip_end)
        if window_end - window_start > settings.youtube_max_duration_seconds:
            raise ValueError("Selected clip exceeds the server's duration limit. Choose a shorter range.")
        trimmed = download_dir / "clipped.mp4"
        trim_clip(source, trimmed, window_start, window_end)
        source.unlink(missing_ok=True)
        return trimmed
    if has_window and clip_end is not None:
        expected = clip_end - start
        if abs(duration - expected) > max(5.0, expected * 0.5):
            raise ValueError("Clip start is beyond the downloaded video length.")
    if duration > settings.youtube_max_duration_seconds:
        raise ValueError("This video exceeds the server's duration limit. Choose a shorter range or a shorter video.")
    return source


def trim_clip(source: Path, destination: Path, start: float, end: float) -> None:
    run_ffmpeg(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-ss",
            f"{start:.6f}",
            "-to",
            f"{end:.6f}",
            "-i",
            str(source),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            str(destination),
        ]
    )


def download_command(
    url: str,
    output: Path,
    cookies: Path | None,
    *,
    clip_start: float | None = None,
    clip_end: float | None = None,
) -> list[str]:
    settings = get_settings()
    command = [
        sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-cache-dir",
        "--no-playlist", "--no-colors", "--newline", "--progress", "--no-simulate",
        "--socket-timeout", "30", "--retries", "0", "--extractor-retries", "0", "--fragment-retries", "0",
        "--max-filesize", str(settings.youtube_max_bytes),
        "--match-filters", _match_filters(clip_start, clip_end),
        "--format", "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]",
        "--merge-output-format", "mp4", "--output", str(output),
        "--progress-template", "download:splitter:%(progress.downloaded_bytes)s:%(progress.total_bytes,progress.total_bytes_estimate)s",
        "--progress-template", "postprocess:splitter:preparing",
    ]
    if shutil.which("deno"):
        command.extend(["--js-runtimes", "deno"])
    elif shutil.which("node"):
        command.extend(["--js-runtimes", "node"])
    if cookies:
        command.extend(["--cookies", str(cookies)])
    return [*command, "--", url]


def safe_download_error(output: str) -> str:
    text = output.lower()
    if any(word in text for word in ("sign in", "not a bot", "cookies", "429", "login required")):
        return "YouTube requires sign-in or has rate-limited this server. Refresh the private YouTube cookies and try again later, or upload the video file. Nothing has been split."
    if any(word in text for word in ("private video", "unavailable", "copyright", "removed")):
        return "YouTube did not make this video available. Check that you can access it, or upload a local copy."
    if "match filter" in text or "filesize" in text:
        return "This video exceeds the server's import limits or is a live/upcoming stream. Use a shorter, smaller video file."
    return "YouTube download failed. Check the link, update yt-dlp on the server, or upload a local video file."


async def stop_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        if os.name == "nt":
            killer = await asyncio.create_subprocess_exec(
                "taskkill", "/PID", str(process.pid), "/T", "/F",
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            await killer.wait()
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        await process.wait()


async def run_download(
    job_id: str,
    url: str,
    output: Path,
    cookies: Path | None,
    *,
    clip_start: float | None = None,
    clip_end: float | None = None,
) -> None:
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
    process = await asyncio.create_subprocess_exec(
        *download_command(url, output, cookies, clip_start=clip_start, clip_end=clip_end),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        **options,
    )
    tail = ""

    async def read_output() -> None:
        nonlocal tail
        assert process.stdout is not None
        while line := await process.stdout.readline():
            text = line.decode("utf-8", errors="replace").strip()
            tail = (tail + "\n" + text)[-8192:]
            if text == "splitter:preparing":
                update_state(job_id, stage="preparing-video")
            elif text.startswith("splitter:"):
                fields = text.split(":")
                try:
                    done = max(0, int(float(fields[1])))
                    total = max(done, int(float(fields[2])))
                except (ValueError, IndexError):
                    continue
                update_state(job_id, downloaded_bytes=done, download_total_bytes=total)
        await process.wait()

    async def enforce_size() -> None:
        while True:
            size = sum(path.stat().st_size for path in output.parent.iterdir() if path.is_file())
            if size > get_settings().youtube_max_bytes:
                raise ValueError("Download exceeded the server's size limit. Use a smaller video file.")
            await asyncio.sleep(0.5)

    reader = asyncio.create_task(read_output())
    guard = asyncio.create_task(enforce_size())
    try:
        done, _ = await asyncio.wait({reader, guard}, timeout=get_settings().youtube_timeout_seconds, return_when=asyncio.FIRST_COMPLETED)
        if not done:
            raise ValueError("YouTube download timed out. Try again later or upload a video file.")
        for task in done:
            task.result()
        if process.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
            raise ValueError(safe_download_error(tail))
        if output.stat().st_size > get_settings().youtube_max_bytes:
            raise ValueError("Download exceeded the server's size limit. Use a smaller video file.")
    finally:
        await stop_process(process)
        for task in (reader, guard):
            task.cancel()
        await asyncio.gather(reader, guard, return_exceptions=True)


async def download_and_process(job_id: str, use_cookies: bool) -> None:
    if not _slots.acquire(blocking=False):
        update_state(job_id, status=JobStatus.FAILED, stage="download-failed", error="Two downloads are already running. Try again after one finishes.")
        return
    try:
        paths = get_job_paths(job_id)
        update_state(job_id, status=JobStatus.PROCESSING, stage="downloading-video")
        # Both cookies and intermediate downloads live outside the served assets.
        with tempfile.TemporaryDirectory(prefix="splitter-youtube-") as private_dir:
            private = Path(private_dir)
            cookies = private / "cookies.txt" if use_cookies else None
            if cookies:
                copy_youtube_cookies(cookies)
            download_dir = private / "video"
            download_dir.mkdir()
            output = download_dir / "source.mp4"
            state = read_state(job_id)
            await run_download(
                job_id,
                state.source_url or "",
                output,
                cookies,
                clip_start=state.clip_start_seconds,
                clip_end=state.clip_end_seconds,
            )
            update_state(job_id, stage="preparing-video")
            duration = await asyncio.to_thread(probe_duration, output)
            if duration <= 0:
                raise ValueError("Downloaded video has no usable duration.")
            output = await asyncio.to_thread(_apply_clip_window, output, download_dir, duration, state.clip_start_seconds, state.clip_end_seconds)
            await asyncio.to_thread(shutil.move, str(output), str(paths.source_file))
        update_state(job_id, source_ready=True, error=None, progress_completed=0, progress_total=0)
    except ValueError as error:
        update_state(job_id, status=JobStatus.FAILED, stage="download-failed", error=str(error))
        return
    except Exception:
        logger.exception("YouTube import failed for job %s", job_id)
        update_state(job_id, status=JobStatus.FAILED, stage="download-failed", error="Video import could not finish. Check the downloader and private cookie configuration, or upload a file.")
        return
    finally:
        _slots.release()
    await asyncio.to_thread(process_job, job_id)
