from io import BytesIO

import pytest
from PIL import Image

from backend import backgrounds


def source_image():
    output = BytesIO()
    Image.new("RGB", (8, 4), (200, 50, 30)).save(output, format="PNG")
    return output.getvalue()


@pytest.mark.parametrize("gray", [0, 128, 255])
def test_background_copy_is_opaque_and_preserves_foreground(monkeypatch, client, gray):
    class Session:
        def predict(self, image):
            mask = Image.new("L", image.size, 0)
            mask.paste(255, (0, 0, 4, 4))
            return [mask]
    monkeypatch.setattr(backgrounds, "model_session", lambda: Session())
    original = source_image()
    response = client.post("/api/storyboard/remove-background", files={"file": ("shot.png", original, "image/png")}, data={"gray": gray})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    result = Image.open(BytesIO(response.content))
    assert result.mode == "RGB"
    assert result.size == (8, 4)
    assert result.getpixel((0, 0)) == (200, 50, 30)
    assert result.getpixel((7, 0)) == (gray, gray, gray)
    assert original == source_image()


def test_background_rejects_invalid_image_and_shade(client):
    path = "/api/storyboard/remove-background"
    assert client.post(path, files={"file": ("bad.png", b"not an image")}).status_code == 400
    assert client.post(path, files={"file": ("shot.png", source_image())}, data={"gray": 256}).status_code == 422


def test_model_failure_is_recoverable(monkeypatch, client):
    def fail():
        raise RuntimeError("test model unavailable")
    monkeypatch.setattr(backgrounds, "model_session", fail)
    response = client.post("/api/storyboard/remove-background", files={"file": ("shot.png", source_image())})
    assert response.status_code == 503
    assert "try again" in response.json()["detail"]
