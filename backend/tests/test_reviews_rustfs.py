from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


def make_png(path: Path, color: tuple[int, int, int]) -> bytes:
    Image.new("RGB", (64, 36), color).save(path, format="PNG")
    return path.read_bytes()


def test_create_review_uses_splitter_bucket_with_reviews_prefix(
    tmp_path: Path,
    client: TestClient,
    monkeypatch,
) -> None:
    uploaded_calls = []

    def fake_upload_to_review_storage(*, image_path, filename, content_type, review_id):
        uploaded_calls.append(
            {
                "image_path": image_path,
                "filename": filename,
                "content_type": content_type,
                "review_id": review_id,
            }
        )
        object_key = f"reviews/{review_id}/images/{filename}"
        return {
            "bucket": "splitter",
            "object_key": object_key,
            "public_url": f"https://s3.v1su4.dev/splitter/{object_key}",
            "media_url": f"https://media.v1su4.dev/files/splitter/{object_key}",
        }

    monkeypatch.setattr("backend.reviews.upload_to_review_storage", fake_upload_to_review_storage)

    image_bytes = make_png(tmp_path / "frame-001.png", (220, 80, 80))
    response = client.post(
        "/api/reviews",
        data={"title": "RustFS review", "notes": "Store under splitter bucket."},
        files=[("files", ("frame-001.png", image_bytes, "image/png"))],
    )

    assert response.status_code == 200
    review = response.json()["review"]
    image = review["images"][0]
    review_id = review["review_id"]

    assert uploaded_calls[0]["review_id"] == review_id
    assert uploaded_calls[0]["filename"] == "frame-001.png"
    assert image["storage_bucket"] == "splitter"
    assert image["object_key"] == f"reviews/{review_id}/images/frame-001.png"
    assert not image["object_key"].startswith("splitter/")
    assert image["public_url"] == f"https://s3.v1su4.dev/splitter/reviews/{review_id}/images/frame-001.png"

    listing = client.get("/api/reviews")
    assert listing.status_code == 200
    summary = listing.json()["reviews"][0]
    assert summary["cover_public_url"] == image["public_url"]
