from pathlib import Path

from PIL import Image

from backend import storage
from backend.processing import build_contact_sheet, format_seconds


def test_format_seconds_renders_timecode() -> None:
    assert format_seconds(0) == "00:00:00.000"
    assert format_seconds(61.234) == "00:01:01.234"


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
