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
    assert project["notes"] == ""
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


def test_create_project_page_preserves_review_notes_and_all_published_images(
    tmp_path: Path,
    client: TestClient,
    monkeypatch,
) -> None:
    def fake_upload_to_review_storage(*, image_path, filename, content_type, review_id, folder_kind="images"):
        object_key = f"reviews/{review_id}/{folder_kind}/{filename}"
        return {
            "bucket": "splitter",
            "object_key": object_key,
            "public_url": f"https://s3.v1su4.dev/splitter/{object_key}",
            "media_url": "",
        }

    monkeypatch.setattr("backend.reviews.upload_to_review_storage", fake_upload_to_review_storage)
    first = make_png(tmp_path / "approved-look.png", (120, 80, 220))
    second = make_png(tmp_path / "wide-shot-grid.png", (20, 40, 60))
    create = client.post(
        "/api/reviews",
        data={"title": "Purple hair cold open", "notes": "User said this is the look and camera style to preserve."},
        files=[
            ("files", ("approved-look.png", first, "image/png")),
            ("files", ("wide-shot-grid.png", second, "image/png")),
        ],
    )
    assert create.status_code == 200
    review_id = create.json()["review"]["review_id"]
    assert client.post(f"/api/reviews/{review_id}/images/1/approve").status_code == 200
    assert client.post(f"/api/reviews/{review_id}/images/2/approve").status_code == 200
    assert client.post(f"/api/reviews/{review_id}/publish-approved").status_code == 200

    response = client.post(f"/api/reviews/{review_id}/project")

    assert response.status_code == 200
    project = response.json()["project"]
    assert project["notes"] == "User said this is the look and camera style to preserve."
    assert [asset["filename"] for asset in project["assets"]] == ["approved-look.png", "wide-shot-grid.png"]
    assert [asset["source_kind"] for asset in project["assets"]] == ["review_approved", "review_approved"]
    assert project["hero_asset_id"] == project["assets"][0]["asset_id"]


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


def test_project_refinement_queue_records_keep_upscale_and_fix_actions(
    tmp_path: Path,
    client: TestClient,
    monkeypatch,
) -> None:
    review_id = create_published_review(tmp_path, client, monkeypatch)
    project = client.post(f"/api/reviews/{review_id}/project").json()["project"]
    asset_id = project["assets"][0]["asset_id"]

    keep = client.post(
        f"/api/projects/{project['project_id']}/refinements",
        json={"workflow_name": "keep_as_is", "input_asset_ids": [asset_id]},
    )
    upscale = client.post(
        f"/api/projects/{project['project_id']}/refinements",
        json={"workflow_name": "comfyui_upscale", "input_asset_ids": [asset_id], "settings_json": {"scale": 2}},
    )
    fix = client.post(
        f"/api/projects/{project['project_id']}/refinements",
        json={"workflow_name": "comfyui_face_fix", "input_asset_ids": [asset_id], "settings_json": {"crop_face": True}},
    )

    assert keep.status_code == 200
    assert upscale.status_code == 200
    assert fix.status_code == 200
    updated = fix.json()["project"]
    jobs = updated["refinement_jobs"]
    assert [job["workflow_name"] for job in jobs] == ["keep_as_is", "comfyui_upscale", "comfyui_face_fix"]
    assert jobs[0]["status"] == "accepted"
    assert jobs[1]["status"] == "queued"
    assert jobs[2]["status"] == "queued"
    assert jobs[2]["settings_json"]["crop_face"] is True


def test_project_refinement_queue_rejects_unknown_assets(tmp_path: Path, client: TestClient, monkeypatch) -> None:
    review_id = create_published_review(tmp_path, client, monkeypatch)
    project = client.post(f"/api/reviews/{review_id}/project").json()["project"]

    response = client.post(
        f"/api/projects/{project['project_id']}/refinements",
        json={"workflow_name": "comfyui_upscale", "input_asset_ids": ["missing-asset"]},
    )

    assert response.status_code == 400


def test_project_stack_endpoint_returns_dense_layout_readout_and_lanes(
    tmp_path: Path,
    client: TestClient,
    monkeypatch,
) -> None:
    review_id = create_published_review(tmp_path, client, monkeypatch)
    project = client.post(f"/api/reviews/{review_id}/project").json()["project"]
    project_id = project["project_id"]

    character_sheet = make_png(tmp_path / "juan-sheet.png", (80, 160, 90))
    character_response = client.post(
        f"/api/projects/{project_id}/assets",
        data={"asset_type": "character_sheet", "label": "Juan sheet", "character_name": "Juan"},
        files={"file": ("juan-sheet.png", character_sheet, "image/png")},
    )
    assert character_response.status_code == 200

    grid = make_png(tmp_path / "shot-grid.png", (20, 80, 140))
    grid_response = client.post(
        f"/api/projects/{project_id}/assets",
        data={"asset_type": "cinematic_shot_grid", "label": "Opening grid"},
        files={"file": ("shot-grid.png", grid, "image/png")},
    )
    assert grid_response.status_code == 200

    refined = make_png(tmp_path / "refined-frame.png", (180, 180, 80))
    refined_response = client.post(
        f"/api/projects/{project_id}/assets",
        data={"asset_type": "refined_shot", "label": "Final close-up"},
        files={"file": ("refined-frame.png", refined, "image/png")},
    )
    assert refined_response.status_code == 200
    refined_asset = next(asset for asset in refined_response.json()["project"]["assets"] if asset["filename"] == "refined-frame.png")

    queue_response = client.post(
        f"/api/projects/{project_id}/refinements",
        json={"workflow_name": "comfyui_upscale", "input_asset_ids": [project["assets"][0]["asset_id"]]},
    )
    assert queue_response.status_code == 200

    stack_response = client.get(f"/api/projects/{project_id}/stack")

    assert stack_response.status_code == 200
    payload = stack_response.json()
    assert payload["project"]["project_id"] == project_id
    assert payload["readout"] == {
        "asset_count": 4,
        "character_count": 1,
        "shot_grid_count": 1,
        "selected_count": 0,
        "refined_count": 1,
        "queued_refinement_count": 1,
        "completed_refinement_count": 0,
        "final_approved_count": 0,
        "video_ready": False,
        "next_action": "Finish queued refinement jobs.",
    }
    lanes = {lane["lane_id"]: lane for lane in payload["lanes"]}
    assert lanes["look"]["count"] == 1
    assert lanes["character"]["count"] == 1
    assert lanes["grid"]["count"] == 1
    assert lanes["refined"]["asset_ids"] == [refined_asset["asset_id"]]
    assert lanes["final"]["count"] == 0
