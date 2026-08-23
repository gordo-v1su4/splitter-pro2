from __future__ import annotations

import io
import zipfile

from PIL import Image


def _png_bytes() -> bytes:
    canvas = Image.new("RGB", (360, 360), color="#f4f4f5")
    buffer = io.BytesIO()
    canvas.save(buffer, format="PNG")
    return buffer.getvalue()


def test_fixed_grid_split_returns_zip_and_panels(client):
    response = client.post(
        "/api/image-split/fixed-grid",
        files={"file": ("board.png", _png_bytes(), "image/png")},
        data={"rows": 3, "cols": 3, "gutter_px": 6},
    )
    assert response.status_code == 200
    manifest = response.json()["manifest"]
    assert manifest["rows"] == 3
    assert manifest["cols"] == 3
    assert len(manifest["panels"]) == 9

    split_id = manifest["split_id"]
    asset = manifest["panels"][0]["asset_path"]
    panel = client.get(f"/api/image-split/{split_id}/panels/{asset}")
    assert panel.status_code == 200
    assert panel.headers["content-type"].startswith("image/")

    zipped = client.get(f"/api/image-split/{split_id}/export.zip")
    assert zipped.status_code == 200
    assert zipped.headers["content-type"] == "application/zip"
    assert zipped.content[:2] == b"PK"


def test_auto_split_accepts_image(client):
    response = client.post(
        "/api/image-split/auto",
        files={"file": ("board.png", _png_bytes(), "image/png")},
        data={"gutter_px": 0, "sensitivity": 0.55},
    )
    assert response.status_code == 200
    manifest = response.json()["manifest"]
    assert manifest["mode"] == "auto"
    assert len(manifest["panels"]) >= 1


def test_openapi_docs_available(client):
    response = client.get("/docs")
    assert response.status_code == 200


def test_google_sheets_integration_stub(client):
    response = client.post(
        "/api/integrations/google-sheets",
        data={"sheets_url": "https://example.com/sheet"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["recorded"] is True
    assert payload["sheets_url_digest"]


def test_batch_fixed_grid_nested_panel_paths_and_zip(client):
    response = client.post(
        "/api/image-split/batch/fixed-grid",
        files=[
            ("files", ("a.png", _png_bytes(), "image/png")),
            ("files", ("b.png", _png_bytes(), "image/png")),
        ],
        data={"rows": 2, "cols": 2, "gutter_px": 0},
    )
    assert response.status_code == 200
    manifest = response.json()["manifest"]
    assert manifest["total_sources"] == 2
    assert len(manifest["panels"]) == 8

    batch_id = manifest["batch_id"]
    nested = next(p for p in manifest["panels"] if "/" in p["asset_path"])
    panel = client.get(f"/api/image-split/{batch_id}/panels/{nested['asset_path']}")
    assert panel.status_code == 200
    assert panel.headers["content-type"].startswith("image/")

    zipped = client.get(f"/api/image-split/{batch_id}/export.zip")
    assert zipped.status_code == 200
    assert zipped.headers["content-type"] == "application/zip"
    assert zipped.content[:2] == b"PK"

    selected_assets = [manifest["panels"][1]["asset_path"], manifest["panels"][6]["asset_path"]]
    selected = client.post(
        f"/api/image-split/{batch_id}/export-selected.zip",
        json={"asset_paths": selected_assets},
    )
    assert selected.status_code == 200
    with zipfile.ZipFile(io.BytesIO(selected.content)) as archive:
        assert archive.namelist() == selected_assets


def test_selected_panel_export_rejects_empty_or_unsafe_paths(client):
    response = client.post(
        "/api/image-split/batch/fixed-grid",
        files=[("files", ("a.png", _png_bytes(), "image/png"))],
        data={"rows": 2, "cols": 2, "gutter_px": 0},
    )
    batch_id = response.json()["manifest"]["batch_id"]

    empty = client.post(
        f"/api/image-split/{batch_id}/export-selected.zip",
        json={"asset_paths": []},
    )
    assert empty.status_code == 422

    unsafe = client.post(
        f"/api/image-split/{batch_id}/export-selected.zip",
        json={"asset_paths": ["../panel-001.png"]},
    )
    assert unsafe.status_code == 400
