"""Local foreground extraction; return an opaque copy, never modify the upload."""
from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from threading import Lock

from PIL import Image, ImageOps, UnidentifiedImageError

from .config import REPO_ROOT

MODEL = "birefnet-general-lite"
MAX_BYTES = 100 * 1024 * 1024
MAX_PIXELS = 32_000_000
processing_lock = Lock()


@lru_cache(maxsize=1)
def model_session():
    import os
    import onnxruntime as ort
    from rembg import new_session

    os.environ.setdefault("REMBG_HOME", str(REPO_ROOT / "data" / "models"))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    return new_session(MODEL, sess_opts=options, providers=["CPUExecutionProvider"])


def remove_background(source: bytes, gray: int) -> bytes:
    if not 0 <= gray <= 255:
        raise ValueError("Background must be between black (0) and white (255).")
    try:
        with Image.open(BytesIO(source)) as original:
            if original.format not in {"PNG", "JPEG", "WEBP"}:
                raise ValueError("Use a PNG, JPG, or WebP image.")
            if original.width * original.height > MAX_PIXELS:
                raise ValueError("Use an image up to 32 megapixels.")
            image = ImageOps.exif_transpose(original).convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Unable to read this image.") from exc

    # One CPU inference at a time prevents large uploads exhausting server memory.
    with processing_lock:
        mask = model_session().predict(image.convert("RGB"))[0].convert("L")
        if mask.size != image.size:
            mask = mask.resize(image.size, Image.Resampling.LANCZOS)
        from PIL import ImageChops
        mask = ImageChops.multiply(mask, image.getchannel("A"))
        output = Image.new("RGB", image.size, (gray, gray, gray))
        output.paste(image.convert("RGB"), (0, 0), mask)
        buffer = BytesIO()
        output.save(buffer, format="PNG")
        return buffer.getvalue()
