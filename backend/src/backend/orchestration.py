"""Project-scoped Trigger dispatch and authenticated, idempotent callback guards."""
from __future__ import annotations

import hmac
import json
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import HTTPException, Request

from .config import get_settings
from .storage import _atomic_write_json


def authorize(request: Request):
    token = get_settings().orchestration_token
    if not token or not hmac.compare_digest(request.headers.get('authorization', ''), f'Bearer {token}'):
        raise HTTPException(401, 'Unauthorized')


def dispatch(task: str, job_id: str, dispatch_id: str):
    settings = get_settings()
    with httpx.Client(timeout=30) as client:
        response = client.post(f'{settings.trigger_api_url.rstrip("/")}/api/v1/tasks/{task}/trigger',
            headers={'Authorization': f'Bearer {settings.trigger_secret_key}'},
            json={'payload': {'jobId': job_id, 'dispatchId': dispatch_id}, 'options': {
                'idempotencyKey': f'{task}:{job_id}:{dispatch_id}', 'tags': ['user:splitter', f'job:{job_id}']}})
        response.raise_for_status()
        return response.json()['id']


def claim(path: Path, dispatch_id: str, run_id: str):
    state = json.loads(path.read_text())
    if not hmac.compare_digest(state['dispatch_id'], dispatch_id) or not run_id.startswith('run_'):
        raise HTTPException(409, 'Stale processing request')
    if state.get('run_id') and state['run_id'] != run_id:
        raise HTTPException(409, 'Another run owns this job')
    if not state.get('run_id'):
        state['run_id'] = run_id
        _atomic_write_json(path, state)
    return state


def new_dispatch():
    return uuid4().hex
