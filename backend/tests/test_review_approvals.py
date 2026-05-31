from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image


def make_png(path: Path, color: tuple[int, int, int]) -> bytes:
    Image.new("RGB", (64, 36), color).save(path, format="PNG")
    return path.read_bytes()


def test_review_images_start_pending_and_do_not_publish_until_approved(
    tmp_path: Path,
    client: TestClient,
    monkeypatch,
) -> None:
    uploaded_calls = []

    def fake_upload_to_review_storage(**kwargs):
        uploaded_calls.append(kwargs)
        return {}

    monkeypatch.setattr("backend.reviews.upload_to_review_storage", fake_upload_to_review_storage)

    image_bytes = make_png(tmp_path / "frame-001.png", (220, 80, 80))
    response = client.post(
        "/api/reviews",
        data={"title": "Mobile review", "notes": "Approve from Discord later."},
        files=[("files", ("frame-001.png", image_bytes, "image/png"))],
    )

    assert response.status_code == 200
    review = response.json()["review"]
    image = review["images"][0]
    assert image["approval_status"] == "pending"
    assert image["storage_bucket"] is None
    assert image["object_key"] is None
    assert image["public_url"] is None
    assert uploaded_calls == []


def test_publish_approved_uploads_only_approved_images_to_approved_prefix(
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

    first = make_png(tmp_path / "frame-001.png", (220, 80, 80))
    second = make_png(tmp_path / "frame-002.png", (80, 160, 220))
    create = client.post(
        "/api/reviews",
        data={"title": "Approval pass"},
        files=[
            ("files", ("frame-001.png", first, "image/png")),
            ("files", ("frame-002.png", second, "image/png")),
        ],
    )
    assert create.status_code == 200
    review_id = create.json()["review"]["review_id"]

    approve = client.post(f"/api/reviews/{review_id}/images/1/approve")
    assert approve.status_code == 200
    assert approve.json()["review"]["images"][0]["approval_status"] == "approved"
    assert approve.json()["review"]["images"][1]["approval_status"] == "pending"

    published = client.post(f"/api/reviews/{review_id}/publish-approved")
    assert published.status_code == 200
    review = published.json()["review"]

    assert len(uploaded_calls) == 1
    assert uploaded_calls[0]["filename"] == "frame-001.png"
    assert uploaded_calls[0]["folder_kind"] == "approved"
    first_image = review["images"][0]
    second_image = review["images"][1]
    assert first_image["approval_status"] == "published"
    assert first_image["object_key"] == f"reviews/{review_id}/approved/frame-001.png"
    assert not first_image["object_key"].startswith("splitter/")
    assert first_image["public_url"] == f"https://s3.v1su4.dev/splitter/reviews/{review_id}/approved/frame-001.png"
    assert second_image["approval_status"] == "pending"
    assert second_image["object_key"] is None


def test_reject_review_image_excludes_it_from_publish(
    tmp_path: Path,
    client: TestClient,
    monkeypatch,
) -> None:
    uploaded_calls = []

    def fake_upload_to_review_storage(**kwargs):
        uploaded_calls.append(kwargs)
        return {}

    monkeypatch.setattr("backend.reviews.upload_to_review_storage", fake_upload_to_review_storage)

    image_bytes = make_png(tmp_path / "frame-001.png", (220, 80, 80))
    create = client.post(
        "/api/reviews",
        data={"title": "Reject pass"},
        files=[("files", ("frame-001.png", image_bytes, "image/png"))],
    )
    assert create.status_code == 200
    review_id = create.json()["review"]["review_id"]

    reject = client.post(f"/api/reviews/{review_id}/images/1/reject")
    assert reject.status_code == 200
    assert reject.json()["review"]["images"][0]["approval_status"] == "rejected"

    published = client.post(f"/api/reviews/{review_id}/publish-approved")
    assert published.status_code == 200
    assert published.json()["review"]["images"][0]["approval_status"] == "rejected"
    assert uploaded_calls == []


def test_reject_review_image_can_store_optional_reason(
    tmp_path: Path,
    client: TestClient,
) -> None:
    image_bytes = make_png(tmp_path / "frame-001.png", (220, 80, 80))
    create = client.post(
        "/api/reviews",
        data={"title": "Reject reason pass"},
        files=[("files", ("frame-001.png", image_bytes, "image/png"))],
    )
    assert create.status_code == 200
    review_id = create.json()["review"]["review_id"]

    reject = client.post(
        f"/api/reviews/{review_id}/images/1/reject",
        json={"reason": "too vertical and hard to read"},
    )

    assert reject.status_code == 200
    image = reject.json()["review"]["images"][0]
    assert image["approval_status"] == "rejected"
    assert image["rejection_reason"] == "too vertical and hard to read"

    persisted = client.get(f"/api/reviews/{review_id}")
    assert persisted.json()["review"]["images"][0]["rejection_reason"] == "too vertical and hard to read"
