from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


def make_png(path: Path, color: tuple[int, int, int]) -> bytes:
    Image.new("RGB", (64, 36), color).save(path, format="PNG")
    return path.read_bytes()


def test_publish_approved_review_uses_splitter_bucket_with_approved_reviews_prefix(
    tmp_path: Path,
    client: TestClient,
    monkeypatch,
) -> None:
    uploaded_calls = []

    def fake_upload_to_review_storage(*, image_path, filename, content_type, review_id, folder_kind="images"):
        uploaded_calls.append(
            {
                "image_path": image_path,
                "filename": filename,
                "content_type": content_type,
                "review_id": review_id,
                "folder_kind": folder_kind,
            }
        )
        object_key = f"reviews/{review_id}/{folder_kind}/{filename}"
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
        data={"title": "RustFS review", "notes": "Store under splitter bucket after approval."},
        files=[("files", ("frame-001.png", image_bytes, "image/png"))],
    )

    assert response.status_code == 200
    review_id = response.json()["review"]["review_id"]
    assert uploaded_calls == []

    approve = client.post(f"/api/reviews/{review_id}/images/1/approve")
    assert approve.status_code == 200
    publish = client.post(f"/api/reviews/{review_id}/publish-approved")
    assert publish.status_code == 200
    image = publish.json()["review"]["images"][0]

    assert uploaded_calls[0]["review_id"] == review_id
    assert uploaded_calls[0]["filename"] == "frame-001.png"
    assert uploaded_calls[0]["folder_kind"] == "approved"
    assert image["storage_bucket"] == "splitter"
    assert image["object_key"] == f"reviews/{review_id}/approved/frame-001.png"
    assert not image["object_key"].startswith("splitter/")
    assert image["public_url"] == f"https://s3.v1su4.dev/splitter/reviews/{review_id}/approved/frame-001.png"

    listing = client.get("/api/reviews")
    assert listing.status_code == 200
    summary = listing.json()["reviews"][0]
    assert summary["cover_public_url"] == image["public_url"]
