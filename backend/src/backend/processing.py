from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import timezone
from pathlib import Path
from fractions import Fraction

from fastapi import HTTPException
from PIL import Image, ImageOps
from scenedetect import AdaptiveDetector, ContentDetector, SceneManager, open_video

from .config import get_settings
from .models import JobManifest, JobStatus, SegmentRecord
from .storage import get_job_paths, load_manifest, now_utc, save_manifest, update_state


@dataclass(slots=True)
class SegmentBoundary:
    index: int
    start_frame: int
    end_frame: int
    start_seconds: float
    end_seconds: float
    frame_rate: float

    @property
    def duration_seconds(self) -> float:
        return max(0.0, self.end_seconds - self.start_seconds)

    @property
    def frame_duration(self) -> float:
        return 1.0 / self.frame_rate if self.frame_rate > 0 else 1.0 / 24.0

    @property
    def frame_count(self) -> int:
        return max(0, self.end_frame - self.start_frame)

    @property
    def boundary_guard(self) -> float:
        return min(self.frame_duration * 0.5, max(self.duration_seconds / 3, 0.001))

    @property
    def extraction_duration(self) -> float:
        return max(self.frame_duration * 0.5, self.duration_seconds)

    @property
    def thumbnail_seconds(self) -> float:
        """Prefer the temporal midpoint of the shot so stills sit on stable frames, not cut edges."""
        if self.duration_seconds <= 0:
            return self.start_seconds
        margin = max(self.boundary_guard, self.frame_duration * 2.0)
        mid = self.start_seconds + self.duration_seconds * 0.5
        lo = self.start_seconds + margin
        hi = self.end_seconds - margin
        if hi <= lo:
            span = max(self.frame_duration, self.duration_seconds)
            return min(
                max(mid, self.start_seconds),
                max(self.start_seconds, self.end_seconds - span * 0.5),
            )
        return min(max(mid, lo), hi)


def merge_short_segments(segments: list[SegmentBoundary], min_frames: int) -> list[SegmentBoundary]:
    """Join runs shorter than ``min_frames`` into a neighbor to remove double-triggered cuts."""
    if min_frames <= 0 or len(segments) <= 1:
        return segments

    merged: list[SegmentBoundary] = []
    acc = segments[0]
    for nxt in segments[1:]:
        if acc.frame_count < min_frames or nxt.frame_count < min_frames:
            acc = SegmentBoundary(
                index=acc.index,
                start_frame=acc.start_frame,
                end_frame=nxt.end_frame,
                start_seconds=acc.start_seconds,
                end_seconds=nxt.end_seconds,
                frame_rate=acc.frame_rate,
            )
        else:
            merged.append(acc)
            acc = nxt
    merged.append(acc)

    return [
        SegmentBoundary(
            index=i + 1,
            start_frame=s.start_frame,
            end_frame=s.end_frame,
            start_seconds=s.start_seconds,
            end_seconds=s.end_seconds,
            frame_rate=s.frame_rate,
        )
        for i, s in enumerate(merged)
    ]


def run_ffmpeg(command: list[str]) -> None:
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "ffmpeg command failed")


def probe_duration(video_path: Path) -> float:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(video_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "ffprobe command failed")
    payload = json.loads(completed.stdout)
    return float(payload["format"]["duration"])


def probe_video_stats(video_path: Path) -> tuple[float, float, int]:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate,r_frame_rate,nb_read_frames,nb_frames:format=duration",
        "-of",
        "json",
        str(video_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "ffprobe command failed")
    payload = json.loads(completed.stdout)
    stream = payload["streams"][0]
    frame_rate = stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "24/1"
    total_frames = int(stream.get("nb_read_frames") or stream.get("nb_frames") or 0)
    duration_seconds = float(payload["format"]["duration"])
    return duration_seconds, float(Fraction(frame_rate)), total_frames


def probe_has_audio(video_path: Path) -> bool:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=index",
        "-of",
        "json",
        str(video_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        return False
    payload = json.loads(completed.stdout)
    return bool(payload.get("streams"))


def format_seconds(seconds: float) -> str:
    total_millis = int(round(seconds * 1000))
    hours, remainder = divmod(total_millis, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def build_segments(video_path: Path, duration_seconds: float, frame_rate: float, total_frames: int) -> list[SegmentBoundary]:
    """Run PySceneDetect and return cuts in **frames** (seconds on segments are derived for display/ffmpeg)."""
    settings = get_settings()
    if settings.scene_detector == "content":
        detector = ContentDetector(
            threshold=settings.scene_threshold,
            min_scene_len=settings.min_scene_len_frames,
        )
    else:
        detector = AdaptiveDetector(
            adaptive_threshold=settings.adaptive_threshold,
            min_scene_len=settings.min_scene_len_frames,
            min_content_val=settings.min_content_val,
            window_width=settings.adaptive_window_width,
            luma_only=settings.adaptive_luma_only,
        )

    video = open_video(str(video_path), backend=settings.scenedetect_backend)
    scene_manager = SceneManager()
    scene_manager.add_detector(detector)
    scene_manager.detect_scenes(video=video, show_progress=False)
    scene_list = scene_manager.get_scene_list(start_in_scene=False)
    if not scene_list:
        return [
            SegmentBoundary(
                index=1,
                start_frame=0,
                end_frame=total_frames,
                start_seconds=0.0,
                end_seconds=duration_seconds,
                frame_rate=frame_rate,
            )
        ]

    segments: list[SegmentBoundary] = []
    for index, (start, end) in enumerate(scene_list, start=1):
        start_frame = max(0, int(start.get_frames()))
        end_frame = min(total_frames, int(end.get_frames()))
        start_seconds = max(0.0, float(start.get_seconds()))
        end_seconds = min(duration_seconds, float(end.get_seconds()))
        if end_seconds <= start_seconds or end_frame <= start_frame:
            continue
        segments.append(
            SegmentBoundary(
                index=index,
                start_frame=start_frame,
                end_frame=end_frame,
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                frame_rate=frame_rate,
            )
        )

    if not segments:
        return [
            SegmentBoundary(
                index=1,
                start_frame=0,
                end_frame=total_frames,
                start_seconds=0.0,
                end_seconds=duration_seconds,
                frame_rate=frame_rate,
            )
        ]

    return merge_short_segments(segments, settings.merge_short_scene_frames)


def extract_clip(video_path: Path, output_path: Path, segment: SegmentBoundary) -> None:
    audio_end = segment.start_seconds + (segment.frame_count / segment.frame_rate)
    has_audio = probe_has_audio(video_path)
    if has_audio:
        filter_complex = (
            f"[0:v]trim=start_frame={segment.start_frame}:end_frame={segment.end_frame},"
            f"setpts=PTS-STARTPTS[v];"
            f"[0:a]atrim=start={segment.start_seconds:.6f}:end={audio_end:.6f},"
            f"asetpts=PTS-STARTPTS[a]"
        )
        command = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(video_path),
            "-filter_complex",
            filter_complex,
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    else:
        filter_complex = (
            f"[0:v]trim=start_frame={segment.start_frame}:end_frame={segment.end_frame},"
            f"setpts=PTS-STARTPTS[v]"
        )
        command = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(video_path),
            "-filter_complex",
            filter_complex,
            "-map",
            "[v]",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    run_ffmpeg(command)


def extract_thumbnail(video_path: Path, output_path: Path, timestamp: float) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(video_path),
        "-ss",
        f"{timestamp:.6f}",
        "-frames:v",
        "1",
        "-q:v",
        "2",
        str(output_path),
    ]
    run_ffmpeg(command)


def build_segment_keyframe(job_id: str, segment_index: int, timestamp_seconds: float) -> Path:
    """Extract the exact visible playhead frame from a completed segment clip."""
    paths = get_job_paths(job_id)
    manifest = load_manifest(job_id)
    segment = next((item for item in manifest.segments if item.index == segment_index), None)
    if segment is None:
        raise HTTPException(status_code=404, detail=f"Segment {segment_index} is not part of this job.")

    frame_duration = 1.0 / manifest.frame_rate if manifest.frame_rate > 0 else 1.0 / 24.0
    latest_frame = max(0.0, segment.duration_seconds - frame_duration)
    timestamp = min(max(0.0, timestamp_seconds), latest_frame)
    timestamp_ms = round(timestamp * 1000)
    output_path = paths.job_dir / "exports" / "playhead-keyframes" / f"segment-{segment_index:03d}-{timestamp_ms:08d}ms.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not output_path.exists():
        extract_thumbnail(paths.job_dir / segment.clip_path, output_path, timestamp)
    return output_path


def reassemble_clips(job_dir: Path, clip_paths: list[Path]) -> Path:
    concat_file = job_dir / "concat.txt"
    concat_lines = [f"file '{clip_path.name}'" for clip_path in clip_paths]
    concat_file.write_text("\n".join(concat_lines), encoding="utf-8")

    output_path = job_dir / "reassembled.mp4"
    command = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_file),
        "-c",
        "copy",
        str(output_path),
    ]
    run_ffmpeg(command)
    return output_path


def build_zip_archive(output_path: Path, base_dir: Path, members: list[Path]) -> Path | None:
    if not members:
        return None
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for member in members:
            archive.write(member, arcname=member.relative_to(base_dir).as_posix())
    return output_path


def select_contact_sheet_images(image_paths: list[Path], slots: int = 20) -> list[Path]:
    if len(image_paths) <= slots:
        return image_paths
    if slots <= 1:
        return [image_paths[0]]

    selected_indexes = {0, len(image_paths) - 1}
    for position in range(1, slots - 1):
        index = round(position * (len(image_paths) - 1) / (slots - 1))
        selected_indexes.add(index)
    return [image_paths[index] for index in sorted(selected_indexes)[:slots]]


def build_contact_sheet(
    output_path: Path,
    image_paths: list[Path],
    columns: int = 5,
    rows: int = 4,
    *,
    crop_to_fill: bool = False,
) -> Path | None:
    if not image_paths:
        return None
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cell_width, cell_height = 400, 225
    canvas_width, canvas_height = columns * cell_width, rows * cell_height
    padding = 0
    gap = 0
    slot_width = cell_width
    slot_height = cell_height

    sheet = Image.new("RGB", (canvas_width, canvas_height), "#09090b")
    selected_images = select_contact_sheet_images(image_paths, slots=columns * rows)

    for slot_index in range(columns * rows):
        x = padding + (slot_index % columns) * (slot_width + gap)
        y = padding + (slot_index // columns) * (slot_height + gap)

        slot = Image.new("RGB", (slot_width, slot_height), "#09090b")
        if slot_index < len(selected_images):
            with Image.open(selected_images[slot_index]) as source_image:
                image = source_image.convert("RGB")
                if crop_to_fill:
                    image = ImageOps.fit(image, (slot_width, slot_height), method=Image.Resampling.LANCZOS)
                else:
                    image = ImageOps.contain(image, (slot_width, slot_height), method=Image.Resampling.LANCZOS)
                image_x = (slot_width - image.width) // 2
                image_y = max(0, (slot_height - image.height) // 2)
                slot.paste(image, (image_x, image_y))
        sheet.paste(slot, (x, y))

    sheet.save(output_path, quality=92)
    return output_path


def evenly_spaced_segment_timestamps(
    segments: list[SegmentRecord],
    selected_indices: list[int],
    sample_count: int,
    frame_rate: float,
) -> list[float]:
    """Sample the selected clips as one ordered, concatenated timeline."""
    if sample_count <= 0:
        raise ValueError("sample_count must be positive")

    selected_set = set(selected_indices)
    selected = [segment for segment in segments if segment.index in selected_set]
    unknown = selected_set.difference(segment.index for segment in selected)
    if unknown:
        raise HTTPException(status_code=400, detail="One or more selected clips are not part of this job.")
    if not selected:
        raise HTTPException(status_code=400, detail="Select at least one clip for the custom sheet.")

    durations = [max(0.0, segment.duration_seconds) for segment in selected]
    total_duration = sum(durations)
    if total_duration <= 0:
        raise HTTPException(status_code=400, detail="The selected clips do not contain usable video duration.")

    frame_duration = 1.0 / frame_rate if frame_rate > 0 else 1.0 / 24.0
    timestamps: list[float] = []
    for sample_index in range(sample_count):
        target = (sample_index + 0.5) * total_duration / sample_count
        elapsed = 0.0
        for segment_index, (segment, duration) in enumerate(zip(selected, durations, strict=True)):
            is_last = segment_index == len(selected) - 1
            if target < elapsed + duration or is_last:
                local_time = min(max(0.0, target - elapsed), duration)
                guard = min(max(frame_duration, 0.001), duration / 4.0)
                lower = segment.start_seconds + guard
                upper = segment.end_seconds - guard
                timestamp = segment.start_seconds + local_time
                if upper < lower:
                    timestamp = segment.start_seconds + duration / 2.0
                else:
                    timestamp = min(max(timestamp, lower), upper)
                timestamps.append(timestamp)
                break
            elapsed += duration
    return timestamps


def build_custom_contact_sheet(job_id: str, segment_indices: list[int], rows: int, columns: int) -> Path:
    paths = get_job_paths(job_id)
    manifest = load_manifest(job_id)
    sample_count = rows * columns
    timestamps = evenly_spaced_segment_timestamps(
        manifest.segments,
        segment_indices,
        sample_count,
        manifest.frame_rate,
    )

    selection_key = ",".join(str(index) for index in sorted(set(segment_indices)))
    digest = hashlib.sha256(f"{rows}x{columns}:{selection_key}".encode("utf-8")).hexdigest()[:10]
    output_path = paths.job_dir / "exports" / f"selected-sheet-{columns}x{rows}-{digest}.jpg"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="sheet-frames-", dir=output_path.parent) as frame_dir:
        frame_paths: list[Path] = []
        for frame_index, timestamp in enumerate(timestamps, start=1):
            frame_path = Path(frame_dir) / f"frame-{frame_index:03d}.jpg"
            extract_thumbnail(paths.source_file, frame_path, timestamp)
            frame_paths.append(frame_path)
        built = build_contact_sheet(
            output_path,
            frame_paths,
            columns=columns,
            rows=rows,
            crop_to_fill=True,
        )
    if built is None:
        raise HTTPException(status_code=500, detail="Unable to render the selected contact sheet.")
    return built


def build_reconstruction_audit(
    original_duration_seconds: float,
    original_frame_count: int,
    reassembled_path: Path | None,
    segments: list[SegmentBoundary],
) -> dict[str, float | int] | None:
    if not reassembled_path:
        return None
    reconstructed_duration_seconds, _, reconstructed_frame_count = probe_video_stats(reassembled_path)
    expected_segment_frames = sum(segment.frame_count for segment in segments)
    return {
        "original_frame_count": original_frame_count,
        "reconstructed_frame_count": reconstructed_frame_count,
        "expected_segment_frames": expected_segment_frames,
        "frame_delta": reconstructed_frame_count - original_frame_count,
        "original_duration_seconds": original_duration_seconds,
        "reconstructed_duration_seconds": reconstructed_duration_seconds,
        "duration_delta_seconds": reconstructed_duration_seconds - original_duration_seconds,
    }


def process_job(job_id: str) -> None:
    paths = get_job_paths(job_id)
    try:
        update_state(job_id, status=JobStatus.PROCESSING, stage="detecting-scenes", error=None)
        duration_seconds, frame_rate, total_frames = probe_video_stats(paths.source_file)
        segments = build_segments(paths.source_file, duration_seconds, frame_rate, total_frames)
        update_state(
            job_id,
            stage="extracting-segments",
            duration_seconds=duration_seconds,
            progress_total=len(segments),
            progress_completed=0,
        )

        records: list[SegmentRecord] = []
        clip_paths: list[Path] = []
        thumbnail_paths: list[Path] = []
        for segment in segments:
            clip_name = f"clips/segment-{segment.index:03d}.mp4"
            thumbnail_name = f"thumbnails/segment-{segment.index:03d}.jpg"
            clip_path = paths.job_dir / clip_name
            thumbnail_path = paths.job_dir / thumbnail_name
            extract_clip(paths.source_file, clip_path, segment)
            extract_thumbnail(paths.source_file, thumbnail_path, segment.thumbnail_seconds)
            clip_paths.append(clip_path)
            thumbnail_paths.append(thumbnail_path)
            records.append(
                SegmentRecord(
                    index=segment.index,
                    start_frame=segment.start_frame,
                    end_frame=segment.end_frame,
                    frame_count=segment.frame_count,
                    start_seconds=segment.start_seconds,
                    end_seconds=segment.end_seconds,
                    duration_seconds=segment.duration_seconds,
                    clip_path=clip_name.replace("\\", "/"),
                    thumbnail_path=thumbnail_name.replace("\\", "/"),
                    label=f"{format_seconds(segment.start_seconds)} - {format_seconds(segment.end_seconds)}",
                )
            )
            update_state(job_id, progress_completed=segment.index)

        reassembled_path = reassemble_clips(paths.clips_dir, clip_paths) if clip_paths else None
        keyframes_zip_path = build_zip_archive(
            paths.job_dir / "exports" / "keyframes.zip",
            paths.job_dir,
            thumbnail_paths,
        )
        segments_zip_path = build_zip_archive(
            paths.job_dir / "exports" / "segments.zip",
            paths.job_dir,
            clip_paths,
        )
        contact_sheet_path = build_contact_sheet(
            paths.job_dir / "exports" / "contact-sheet.jpg",
            thumbnail_paths,
        )
        reconstruction_audit = build_reconstruction_audit(
            original_duration_seconds=duration_seconds,
            original_frame_count=total_frames,
            reassembled_path=reassembled_path,
            segments=segments,
        )

        manifest = JobManifest(
            job_id=job_id,
            source_video=paths.source_file.name,
            duration_seconds=duration_seconds,
            frame_rate=frame_rate,
            frame_count=total_frames,
            segment_count=len(records),
            segments=records,
            reassembled_path=(
                reassembled_path.relative_to(paths.job_dir).as_posix() if reassembled_path else None
            ),
            keyframes_zip_path=(
                keyframes_zip_path.relative_to(paths.job_dir).as_posix() if keyframes_zip_path else None
            ),
            segments_zip_path=(
                segments_zip_path.relative_to(paths.job_dir).as_posix() if segments_zip_path else None
            ),
            contact_sheet_path=(
                contact_sheet_path.relative_to(paths.job_dir).as_posix() if contact_sheet_path else None
            ),
            reconstruction_audit=reconstruction_audit,
            created_at=now_utc().astimezone(timezone.utc),
        )
        save_manifest(manifest)
        update_state(
            job_id,
            status=JobStatus.COMPLETED,
            stage="completed",
            segment_count=len(records),
            progress_completed=len(records),
        )
    except HTTPException:
        raise
    except Exception as exc:
        update_state(job_id, status=JobStatus.FAILED, stage="failed", error=str(exc))
        raise
