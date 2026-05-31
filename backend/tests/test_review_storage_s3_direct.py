from __future__ import annotations

from pathlib import Path

from backend.config import get_settings
from backend.reviews import upload_to_review_storage


def test_review_storage_falls_back_to_direct_rustfs_s3_from_existing_env_keys(
    tmp_path: Path,
    monkeypatch,
) -> None:
    uploaded = tmp_path / "approved.png"
    uploaded.write_bytes(b"fake-png-bytes")
    calls = []

    def fake_put(url, *, headers, content, timeout):
        calls.append({"url": url, "headers": headers, "content": content, "timeout": timeout})

        class Response:
            status_code = 200
            text = ""

        return Response()

    monkeypatch.setenv("S3_ENDPOINT", "https://s3.v1su4.dev")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    monkeypatch.setenv("S3_FORCE_PATH_STYLE", "true")
    monkeypatch.setenv("S3_BUCKET", "splitter")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "test-access")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("SPLITTER_REVIEW_STORAGE_BUCKET", "splitter")
    monkeypatch.delenv("SPLITTER_MEDIA_API_URL", raising=False)
    monkeypatch.delenv("SPLITTER_MEDIA_API_TOKEN", raising=False)
    get_settings.cache_clear()
    monkeypatch.setattr("backend.reviews.httpx.put", fake_put)

    remote = upload_to_review_storage(
        image_path=uploaded,
        filename="approved.png",
        content_type="image/png",
        review_id="abc123",
        folder_kind="approved",
    )

    assert len(calls) == 1
    assert calls[0]["url"] == "https://s3.v1su4.dev/splitter/reviews/abc123/approved/approved.png"
    assert calls[0]["content"] == b"fake-png-bytes"
    assert calls[0]["headers"]["Content-Type"] == "image/png"
    assert calls[0]["headers"]["Authorization"].startswith("AWS4-HMAC-SHA256 Credential=test-access/")
    assert remote == {
        "bucket": "splitter",
        "object_key": "reviews/abc123/approved/approved.png",
        "public_url": "https://s3.v1su4.dev/splitter/reviews/abc123/approved/approved.png",
        "media_url": "",
    }
    get_settings.cache_clear()


def test_review_storage_creates_bucket_then_retries_when_bucket_is_missing(
    tmp_path: Path,
    monkeypatch,
) -> None:
    uploaded = tmp_path / "approved.png"
    uploaded.write_bytes(b"fake-png-bytes")
    calls = []

    def fake_put(url, *, headers, content, timeout):
        calls.append({"url": url, "content": content})

        class Response:
            text = ""
            status_code = 200

        if len(calls) == 1:
            Response.status_code = 404
            Response.text = "<Error><Code>NoSuchBucket</Code></Error>"
        return Response()

    monkeypatch.setenv("S3_ENDPOINT", "https://s3.v1su4.dev")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "test-access")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("SPLITTER_REVIEW_STORAGE_BUCKET", "splitter")
    get_settings.cache_clear()
    monkeypatch.setattr("backend.reviews.httpx.put", fake_put)

    remote = upload_to_review_storage(
        image_path=uploaded,
        filename="approved.png",
        content_type="image/png",
        review_id="abc123",
        folder_kind="approved",
    )

    assert [call["url"] for call in calls] == [
        "https://s3.v1su4.dev/splitter/reviews/abc123/approved/approved.png",
        "https://s3.v1su4.dev/splitter",
        "https://s3.v1su4.dev/splitter/reviews/abc123/approved/approved.png",
    ]
    assert calls[1]["content"] == b""
    assert remote and remote["storage_bucket" if False else "bucket"] == "splitter"
    get_settings.cache_clear()


def test_review_storage_reads_windows_utf8_bom_env_file_for_direct_s3(
    tmp_path: Path,
    monkeypatch,
) -> None:
    repo_env = Path(__file__).resolve().parents[2] / ".env"
    original = repo_env.read_bytes() if repo_env.exists() else None
    try:
        repo_env.write_bytes(
            (
                "\ufeffS3_ENDPOINT=https://s3.v1su4.dev\n"
                "S3_REGION=us-east-1\n"
                "S3_ACCESS_KEY_ID=test-access\n"
                "S3_SECRET_ACCESS_KEY=test-s..."
            ).encode("utf-8")
        )
        uploaded = tmp_path / "approved.png"
        uploaded.write_bytes(b"fake-png-bytes")
        calls = []

        def fake_put(url, *, headers, content, timeout):
            calls.append(url)

            class Response:
                status_code = 200
                text = ""

            return Response()

        for name in [
            "S3_ENDPOINT",
            "S3_REGION",
            "S3_BUCKET",
            "S3_ACCESS_KEY_ID",
            "S3_SECRET_ACCESS_KEY",
            "SPLITTER_MEDIA_API_URL",
            "SPLITTER_MEDIA_API_TOKEN",
        ]:
            monkeypatch.delenv(name, raising=False)
        get_settings.cache_clear()
        monkeypatch.setattr("backend.reviews.httpx.put", fake_put)

        remote = upload_to_review_storage(
            image_path=uploaded,
            filename="approved.png",
            content_type="image/png",
            review_id="abc123",
            folder_kind="approved",
        )

        assert calls == ["https://s3.v1su4.dev/splitter/reviews/abc123/approved/approved.png"]
        assert remote and remote["object_key"] == "reviews/abc123/approved/approved.png"
    finally:
        if original is None:
            repo_env.unlink(missing_ok=True)
        else:
            repo_env.write_bytes(original)
        get_settings.cache_clear()
