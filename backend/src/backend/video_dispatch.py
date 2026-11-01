import json

from fastapi import HTTPException
from filelock import FileLock, Timeout

from . import orchestration
from .models import JobStatus
from .processing import process_job
from .storage import _atomic_write_json, get_job_paths, read_state, update_state
from .youtube import download_and_process


def dispatch_video(job_id, youtube=False, use_cookies=False):
    path = get_job_paths(job_id).job_dir / 'orchestration.json'
    state = {'dispatch_id': orchestration.new_dispatch(), 'run_id': None, 'youtube': youtube, 'use_cookies': use_cookies}
    _atomic_write_json(path, state)
    try:
        run_id = orchestration.dispatch('splitter-process-video', job_id, state['dispatch_id'])
        with FileLock(str(path.with_suffix('.lock'))):
            state = json.loads(path.read_text())
            state['run_id'] = run_id
            _atomic_write_json(path, state)
    except Exception:
        update_state(job_id, status=JobStatus.FAILED, stage='dispatch-failed', error='Unable to queue video processing. Please retry.')


def execute(job_id):
    directory = get_job_paths(job_id).job_dir
    try:
        with FileLock(str(directory / '.execution.lock'), timeout=0):
            if read_state(job_id).status == JobStatus.COMPLETED:
                return
            request = json.loads((directory / 'orchestration.json').read_text())
            if request['youtube']:
                download_and_process(job_id, request['use_cookies'])
            else:
                process_job(job_id)
    except Timeout:
        pass  # Existing execution owns the OS lock; never start a second one.


def start(job_id, payload, background_tasks):
    directory = get_job_paths(job_id).job_dir
    path = directory / 'orchestration.json'
    if not path.is_file():
        raise HTTPException(409, 'Job was not dispatched through Trigger')
    with FileLock(str(path.with_suffix('.lock'))):
        orchestration.claim(path, payload.get('dispatch_id', ''), payload.get('run_id', ''))
    if read_state(job_id).status != JobStatus.COMPLETED:
        background_tasks.add_task(execute, job_id)
    return read_state(job_id)
