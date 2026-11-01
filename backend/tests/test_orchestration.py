from io import BytesIO

from PIL import Image

from backend import background_jobs, backgrounds, orchestration, video_dispatch
from backend.config import get_settings
from backend.models import JobStatus
from backend.storage import read_state, update_state


def png(size=(8, 4), mode='RGB'):
    stream = BytesIO()
    Image.new(mode, size, (128, 128, 128) if mode == 'RGB' else (128, 128, 128, 255)).save(stream, format='PNG')
    return stream.getvalue()


def configured(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, 'trigger_secret_key', 'test-project-key')
    monkeypatch.setattr(settings, 'orchestration_token', 'test-callback-token')
    calls = []
    monkeypatch.setattr(orchestration, 'dispatch', lambda *args: calls.append(args) or 'run_test')
    return calls


def create(client):
    response = client.post('/api/storyboard/background-jobs', files={'file': ('shot.png', png(), 'image/png')}, data={'gray': 128})
    assert response.status_code == 202
    return response.json()['job_id']


def test_gpu_dispatch_callbacks_and_idempotent_completion(client, monkeypatch):
    calls = configured(monkeypatch)
    job_id = create(client)
    internal = background_jobs.read(job_id)
    assert calls == [('splitter-remove-background', job_id, internal['dispatch_id'])]
    assert internal['model'] == 'sam3'
    public = client.get(f'/api/storyboard/background-jobs/{job_id}').json()
    assert 'dispatch_id' not in public
    base = f'/internal/orchestration/backgrounds/{job_id}'
    assert client.get(base + '/source').status_code == 401
    headers = {'Authorization': 'Bearer test-callback-token', 'X-Splitter-Dispatch': internal['dispatch_id']}
    source = client.get(base + '/source', headers=headers)
    assert source.content == png()
    assert source.headers['x-splitter-gray'] == '128'
    claim = {'dispatch_id': internal['dispatch_id'], 'run_id': 'run_test'}
    assert client.patch(base, headers=headers, json={**claim, 'dispatch_id': 'stale', 'status': 'processing'}).status_code == 409
    assert client.patch(base, headers=headers, json={**claim, 'status': 'processing', 'stage': 'waiting-for-gpu'}).status_code == 200
    assert client.post(base + '/complete', headers=headers, data=claim, files={'file': ('output.png', png(mode='RGBA'))}).status_code == 400
    assert client.post(base + '/complete', headers=headers, data=claim, files={'file': ('output.png', png())}).status_code == 200
    # A lost HTTP response retried after completion cannot overwrite the output.
    assert client.post(base + '/complete', headers=headers, data=claim, files={'file': ('bad.png', b'bad')}).status_code == 200
    assert client.patch(base, headers=headers, json={**claim, 'status': 'failed'}).json()['status'] == 'completed'
    assert client.get(f'/api/storyboard/background-jobs/{job_id}/output').content == png()
    assert (background_jobs.root(job_id) / 'source').read_bytes() == png()


def test_background_errors_are_visible_and_do_not_use_hostinger_cpu(client, monkeypatch):
    monkeypatch.setattr(get_settings(), 'allow_cpu_background', False)
    assert client.post('/api/storyboard/remove-background', files={'file': ('shot.png', png())}).status_code == 409
    assert client.post('/api/storyboard/background-jobs', files={'file': ('shot.png', png())}).status_code == 503
    calls = configured(monkeypatch)
    assert client.post('/api/storyboard/background-jobs', files={'file': ('bad.png', b'bad')}).status_code == 400
    assert not calls
    monkeypatch.setattr(orchestration, 'dispatch', lambda *args: (_ for _ in ()).throw(RuntimeError('offline')))
    job_id = create(client)
    assert client.get(f'/api/storyboard/background-jobs/{job_id}').json()['status'] == 'failed'


def test_local_background_job_still_produces_opaque_copy(client, monkeypatch):
    class Session:
        def predict(self, image):
            return [Image.new('L', image.size, 0)]
    monkeypatch.setattr(backgrounds, 'model_session', lambda: Session())
    job_id = create(client)
    assert client.get(f'/api/storyboard/background-jobs/{job_id}').json()['status'] == 'completed'
    assert Image.open(BytesIO(client.get(f'/api/storyboard/background-jobs/{job_id}/output').content)).mode == 'RGB'


def test_video_job_dispatch_is_project_scoped_and_execution_is_idempotent(client, monkeypatch):
    calls = configured(monkeypatch)
    executions = []
    def process(job_id):
        executions.append(job_id)
        update_state(job_id, status=JobStatus.COMPLETED, stage='completed')
    monkeypatch.setattr(video_dispatch, 'process_job', process)
    response = client.post('/api/jobs', files={'file': ('clip.mp4', b'video')})
    job_id = response.json()['job']['job_id']
    assert calls[0][0] == 'splitter-process-video'
    payload = {'dispatch_id': calls[0][2], 'run_id': 'run_test'}
    endpoint = f'/internal/orchestration/videos/{job_id}/start'
    assert client.post(endpoint, json=payload).status_code == 401
    headers = {'Authorization': 'Bearer test-callback-token'}
    assert client.post(endpoint, headers=headers, json=payload).status_code == 200
    assert client.post(endpoint, headers=headers, json=payload).status_code == 200
    assert executions == [job_id]
    assert read_state(job_id).status == JobStatus.COMPLETED
