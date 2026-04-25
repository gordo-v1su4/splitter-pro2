from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SPLITTER_",
        env_file=".env",
        extra="ignore",
    )

    app_name: str = "Splitter Pro 2"
    data_dir: Path = Field(default_factory=lambda: REPO_ROOT / "data" / "jobs")
    frontend_dist_dir: Path = Field(default_factory=lambda: REPO_ROOT / "frontend" / "dist")
    allowed_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
        ]
    )
    scene_detector: str = "adaptive"
    # ContentDetector: frame-delta score; higher = fewer cuts (used when scene_detector=content).
    scene_threshold: float = 27.0
    # AdaptiveDetector: ratio threshold; lower = more cuts (more sensitive). Default in lib ~3.0.
    adaptive_threshold: float = 2.5
    # Frames: min run after a cut before another can register (PySceneDetect min_scene_len).
    min_scene_len_frames: int = 8
    # Minimum content score to count as a new scene; lower = more sensitive (frame-based score).
    min_content_val: float = 10.0
    # Frames on each side used for local mean; smaller = reacts faster to short shot changes (lib default 2).
    adaptive_window_width: int = 3
    adaptive_luma_only: bool = False
    # Merge only very short runs (frames) into a neighbor to drop spurious double-cuts.
    # Keep low so real short shots are not collapsed; set SPLITTER_MERGE_SHORT_SCENE_FRAMES=0 to disable.
    merge_short_scene_frames: int = 5
    # PySceneDetect decode backend ("opencv", "pyav", ...). Passed to scenedetect.open_video.
    scenedetect_backend: str = "opencv"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return settings
