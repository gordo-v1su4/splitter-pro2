from __future__ import annotations

from io import BytesIO
import json
import re
from uuid import uuid4

from fastapi import HTTPException
from filelock import FileLock
from PIL import Image, ImageOps, UnidentifiedImageError

from . import backgrounds, orchestration
from .config import get_settings
from .storage import _atomic_write_json


def root(job_id: str):
    if not re.fullmatch('[a-f0-9]{32}', job_id):
        raise HTTPException(404, 'Unknown background job')
    path = get_settings().background_jobs_dir / job_id
    if not (path / 'status.json').is_file():
        raise HTTPException(404, 'Unknown background job')
    return path


def read(job_id):
    return json.loads((root(job_id) / 'status.json').read_text())


def public(job_id):
    state = read(job_id)
    return {key: state.get(key) for key in ('job_id', 'status', 'stage', 'error', 'model', 'run_id')}


def create(source: bytes, gray: int, prompt: str):
    if len(source) > backgrounds.MAX_BYTES:
        raise HTTPException(413, 'Use an image up to 100 MB')
    try:
        with Image.open(BytesIO(source)) as image:
            if image.format not in {'PNG', 'JPEG', 'WEBP'} or image.width * image.height > backgrounds.MAX_PIXELS:
                raise ValueError()
            image.load()
            dimensions = ImageOps.exif_transpose(image).size
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(400, 'Use a PNG, JPG, or WebP up to 32 megapixels')
    settings = get_settings()
    if not settings.trigger_secret_key and not settings.allow_cpu_background:
        raise HTTPException(503, 'Background processing is not configured')
    job_id = uuid4().hex
    path = settings.background_jobs_dir / job_id
    path.mkdir(parents=True)
    (path / 'source').write_bytes(source)
    state = {'job_id': job_id, 'dispatch_id': orchestration.new_dispatch(), 'run_id': None,
             'status': 'queued', 'stage': 'queued', 'error': None, 'gray': gray, 'prompt': prompt,
             'model': 'birefnet-hr-matting' if settings.trigger_secret_key else 'birefnet-general-lite', 'size': list(dimensions)}
    _atomic_write_json(path / 'status.json', state)
    if settings.trigger_secret_key:
        try:
            run_id = orchestration.dispatch('splitter-remove-background', job_id, state['dispatch_id'])
            # A fast callback may already have updated status. Preserve its writes.
            with FileLock(str(path / '.lock')):
                current = read(job_id)
                current['run_id'] = run_id
                _atomic_write_json(path / 'status.json', current)
        except Exception:
            state.update(status='failed', stage='dispatch-failed', error='Unable to queue background removal. Please retry.')
            _atomic_write_json(path / 'status.json', state)
    return public(job_id)


def update(job_id, dispatch_id, run_id, patch):
    path = root(job_id)
    with FileLock(str(path / '.lock')):
        current = orchestration.claim(path / 'status.json', dispatch_id, run_id)
        if current['status'] == 'completed':
            return public(job_id)
        current.update({key: patch[key] for key in ('status', 'stage', 'error') if key in patch})
        _atomic_write_json(path / 'status.json', current)
    return public(job_id)


def complete(job_id, dispatch_id, run_id, data):
    path = root(job_id)
    with FileLock(str(path / '.lock')):
        current = orchestration.claim(path / 'status.json', dispatch_id, run_id)
        if current['status'] == 'completed':
            return public(job_id)
        with Image.open(BytesIO(data)) as output:
            if output.format != 'PNG' or output.mode != 'RGB' or list(output.size) != current['size']:
                raise HTTPException(400, 'Invalid processed image')
            output.verify()
        temporary = path / 'output.tmp'
        temporary.write_bytes(data)
        temporary.replace(path / 'output.png')
        current.update(status='completed', stage='completed', error=None)
        _atomic_write_json(path / 'status.json', current)
    return public(job_id)


def process_local(job_id):
    path = root(job_id)
    try:
        state = read(job_id)
        state.update(status='processing', stage='removing-background')
        _atomic_write_json(path / 'status.json', state)
        data = backgrounds.remove_background((path / 'source').read_bytes(), state['gray'])
        (path / 'output.png').write_bytes(data)
        state.update(status='completed', stage='completed')
    except Exception:
        state.update(status='failed', stage='failed', error='Unable to remove background. The original is unchanged.')
    _atomic_write_json(path / 'status.json', state)
