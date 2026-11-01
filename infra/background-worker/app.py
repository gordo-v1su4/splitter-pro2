from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import hashlib
import hmac
from io import BytesIO
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from threading import Lock
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

ROOT = Path(os.environ.get('WORK_DIR', '/work'))
TOKEN = os.environ.get('WORKER_TOKEN', '')
MAX_BYTES = 100 * 1024 * 1024
executor = ThreadPoolExecutor(max_workers=1)
submissions = Lock()


def write(path, payload):
    temporary = path.with_suffix(f'.{uuid4().hex}.tmp')
    temporary.write_text(json.dumps(payload))
    temporary.replace(path)


def directory(job_id):
    if not re.fullmatch('[a-f0-9]{32}', job_id):
        raise HTTPException(404, 'Unknown job')
    return ROOT / job_id


def authorize(authorization: str = Header('')):
    if not TOKEN or not hmac.compare_digest(authorization, f'Bearer {TOKEN}'):
        raise HTTPException(401, 'Unauthorized')


def execute(root):
    try:
        with (root / 'inference.log').open('wb') as log:
            process = subprocess.run([sys.executable, str(Path(__file__).with_name('inference.py')), str(root)], stdout=log, stderr=log, timeout=3600)
        if process.returncode or not (root / 'output.png').is_file():
            raise RuntimeError('Background removal could not process this shot. The original is unchanged.')
        write(root / 'status.json', {'status': 'completed', 'stage': 'completed', 'model': 'birefnet-hr-matting'})
    except Exception:
        write(root / 'status.json', {'status': 'failed', 'stage': 'failed', 'error': 'Background removal could not process this shot. The original is unchanged.'})


@asynccontextmanager
async def lifespan(app):
    if not TOKEN:
        raise RuntimeError('WORKER_TOKEN is required')
    ROOT.mkdir(parents=True, exist_ok=True)
    # Interrupted runs stay explicit; a matching Trigger retry can resubmit them.
    for path in ROOT.glob('*/status.json'):
        if json.loads(path.read_text()).get('status') in {'queued', 'processing'}:
            write(path, {'status': 'failed', 'stage': 'interrupted', 'error': 'Worker restarted; retry the job.'})
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


@app.get('/health')
def health():
    return {'status': 'ok', 'model': 'birefnet-hr-matting', 'gpu_lifecycle': 'per-job-process'}


@app.post('/jobs/{job_id}', dependencies=[Depends(authorize)])
def create(job_id: str, file: UploadFile = File(...), gray: int = Form(255, ge=0, le=255), prompt: str = Form('person', min_length=1, max_length=160)):
    root = directory(job_id)
    source = file.file.read(MAX_BYTES + 1)
    if len(source) > MAX_BYTES:
        raise HTTPException(413, 'Use an image up to 100 MB')
    try:
        with Image.open(BytesIO(source)) as image:
            if image.format not in {'PNG', 'JPEG', 'WEBP'} or image.width * image.height > 32_000_000:
                raise ValueError()
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(400, 'Use a PNG, JPG, or WebP up to 32 megapixels')
    request = {'digest': hashlib.sha256(source).hexdigest(), 'gray': gray, 'prompt': prompt}
    with submissions:
        if root.exists():
            if json.loads((root / 'request.json').read_text()) != request:
                raise HTTPException(409, 'Job already exists with different input')
            state = json.loads((root / 'status.json').read_text())
            if state['status'] != 'failed':
                return state
        else:
            root.mkdir(parents=True)
            (root / 'source').write_bytes(source)
            write(root / 'request.json', request)
        write(root / 'status.json', {'status': 'queued', 'stage': 'queued'})
        executor.submit(execute, root)
    return {'status': 'queued', 'stage': 'queued'}


@app.get('/jobs/{job_id}', dependencies=[Depends(authorize)])
def state(job_id: str):
    path = directory(job_id) / 'status.json'
    if not path.is_file():
        raise HTTPException(404, 'Unknown job')
    return json.loads(path.read_text())


@app.get('/jobs/{job_id}/output', dependencies=[Depends(authorize)])
def output(job_id: str):
    root = directory(job_id)
    if not (root / 'status.json').is_file() or json.loads((root / 'status.json').read_text())['status'] != 'completed':
        raise HTTPException(409, 'Output is not ready')
    return FileResponse(root / 'output.png', media_type='image/png', headers={'Cache-Control': 'no-store'})
