from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


def make_png(path: Path, color: tuple[int, int, int]) -> bytes:
    Image.new("RGB", (64, 36), color).save(path, format="PNG")
    return path.read_bytes()


def test_create_review_gallery_uploads_images_and_lists_review(tmp_path: Path, client: TestClient) -> None:
    first = make_png(tmp_path / "frame-001.png", (220, 80, 80))
    second = make_png(tmp_path / "frame-002.png", (80, 160, 220))

    response = client.post(
        "/api/reviews",
        data={"title": "Opening image pass", "notes": "Pick the strongest keyframe."},
        files=[
            ("files", ("frame-001.png", first, "image/png")),
            ("files", ("frame-002.png", second, "image/png")),
        ],
    )

    assert response.status_code == 200
    review = response.json()["review"]
    assert review["title"] == "Opening image pass"
    assert review["notes"] == "Pick the strongest keyframe."
    assert review["image_count"] == 2
    assert [image["label"] for image in review["images"]] == ["frame-001.png", "frame-002.png"]
    assert review["images"][0]["asset_path"] == "images/frame-001.png"

    listing = client.get("/api/reviews")
    assert listing.status_code == 200
    assert listing.json()["reviews"][0]["review_id"] == review["review_id"]

    detail = client.get(f"/api/reviews/{review['review_id']}")
    assert detail.status_code == 200
    assert detail.json()["review"]["images"][1]["label"] == "frame-002.png"

    asset = client.get(f"/api/reviews/{review['review_id']}/assets/images/frame-001.png")
    assert asset.status_code == 200
    assert asset.headers["content-type"] == "image/png"


def test_create_review_gallery_requires_images(client: TestClient) -> None:
    response = client.post("/api/reviews", data={"title": "empty"})

    assert response.status_code == 422
