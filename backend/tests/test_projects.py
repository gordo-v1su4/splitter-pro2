from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


def make_png(path: Path, color: tuple[int, int, int]) -> bytes:
    Image.new("RGB", (96, 54), color).save(path, format="PNG")
    return path.read_bytes()


def create_published_review(tmp_path: Path, client: TestClient, monkeypatch) -> str:
    def fake_upload_to_review_storage(*, image_path, filename, content_type, review_id, folder_kind="images"):
        object_key = f"reviews/{review_id}/{folder_kind}/{filename}"
        return {
            "bucket": "splitter",
            "object_key": object_key,
            "public_url": f"https://s3.v1su4.dev/splitter/{object_key}",
            "media_url": "",
        }

    monkeypatch.setattr("backend.reviews.upload_to_review_storage", fake_upload_to_review_storage)
    image_bytes = make_png(tmp_path / "approved-look.png", (120, 80, 220))
    create = client.post(
        "/api/reviews",
        data={"title": "Purple hair cold open"},
        files=[("files", ("approved-look.png", image_bytes, "image/png"))],
    )
    assert create.status_code == 200
    review_id = create.json()["review"]["review_id"]
    assert client.post(f"/api/reviews/{review_id}/images/1/approve").status_code == 200
    assert client.post(f"/api/reviews/{review_id}/publish-approved").status_code == 200
    return review_id


def test_create_project_page_from_published_review(tmp_path: Path, client: TestClient, monkeypatch) -> None:
    review_id = create_published_review(tmp_path, client, monkeypatch)

    response = client.post(f"/api/reviews/{review_id}/project")

    assert response.status_code == 200
    project = response.json()["project"]
    assert project["source_review_id"] == review_id
    assert project["title"] == "Purple hair cold open"
    assert project["hero_asset_id"] == project["assets"][0]["asset_id"]
    hero = project["assets"][0]
    assert hero["asset_type"] == "single_still"
    assert hero["source_kind"] == "review_approved"
    assert hero["label"] == "Approved project look"
    assert hero["width"] == 96
    assert hero["height"] == 54
    assert hero["object_key"] == f"reviews/{review_id}/approved/approved-look.png"

    listed = client.get("/api/projects")
    assert listed.status_code == 200
    assert listed.json()["projects"][0]["project_id"] == project["project_id"]


def test_project_upload_character_sheet_creates_character_card(tmp_path: Path, client: TestClient, monkeypatch) -> None:
    review_id = create_published_review(tmp_path, client, monkeypatch)
    project = client.post(f"/api/reviews/{review_id}/project").json()["project"]
    sheet_bytes = make_png(tmp_path / "juan-character-sheet.png", (80, 180, 120))

    response = client.post(
        f"/api/projects/{project['project_id']}/assets",
        data={
            "asset_type": "character_sheet",
            "label": "Juan model sheet",
            "character_name": "Juan",
            "notes": "Keep intact as the continuity reference.",
        },
        files={"file": ("juan-character-sheet.png", sheet_bytes, "image/png")},
    )

    assert response.status_code == 200
    updated = response.json()["project"]
    sheet_assets = [asset for asset in updated["assets"] if asset["asset_type"] == "character_sheet"]
    assert len(sheet_assets) == 1
    assert updated["characters"][0]["name"] == "Juan"
    assert updated["characters"][0]["sheet_asset_id"] == sheet_assets[0]["asset_id"]


def test_project_upload_rejects_unknown_asset_type(tmp_path: Path, client: TestClient, monkeypatch) -> None:
    review_id = create_published_review(tmp_path, client, monkeypatch)
    project = client.post(f"/api/reviews/{review_id}/project").json()["project"]
    image_bytes = make_png(tmp_path / "not-a-grid.png", (80, 180, 120))

    response = client.post(
        f"/api/projects/{project['project_id']}/assets",
        data={"asset_type": "storyboard"},
        files={"file": ("not-a-grid.png", image_bytes, "image/png")},
    )

    assert response.status_code == 400
