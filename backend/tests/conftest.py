from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.config import get_settings


@pytest.fixture()
def temp_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    data_dir = tmp_path / "jobs"
    frontend_dist = tmp_path / "dist"
    frontend_dist.mkdir(parents=True, exist_ok=True)
    (frontend_dist / "index.html").write_text("<html><body>Splitter Pro 2</body></html>", encoding="utf-8")
    monkeypatch.setenv("SPLITTER_DATA_DIR", str(data_dir))
    monkeypatch.setenv("SPLITTER_FRONTEND_DIST_DIR", str(frontend_dist))
    monkeypatch.setenv("SPLITTER_SCENE_THRESHOLD", "12.0")
    get_settings.cache_clear()
    return data_dir


@pytest.fixture()
def client(temp_data_dir: Path):
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
    get_settings.cache_clear()
