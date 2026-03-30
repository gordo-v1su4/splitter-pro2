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
    scene_threshold: float = 24.0
    adaptive_threshold: float = 3.0
    min_scene_len_frames: int = 4
    min_content_val: float = 12.0
    adaptive_window_width: int = 2


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return settings
