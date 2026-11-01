"""Read runtime secrets from stdin; write only fixed app-owned private env files."""
import json
import os
from pathlib import Path
import shlex
import sys

values = json.load(sys.stdin)
mode = sys.argv[1]
os.umask(0o077)


def environment(path, settings, shell=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text().splitlines() if path.exists() else []
    existing = [line for line in existing if line.split('=', 1)[0] not in settings]
    for key, value in settings.items():
        if '\n' in value or '\r' in value:
            raise ValueError('Invalid environment value')
        existing.append(f'{key}={shlex.quote(value) if shell else json.dumps(value)}')
    path.write_text('\n'.join(existing) + '\n')
    path.chmod(0o600)


if mode == 'worker':
    environment(Path('/opt/splitter-background-worker/.env'), {'WORKER_TOKEN': values['worker_token']})
    deploy = Path('/home/gordo/.config/splitter/trigger-deploy.env')
    environment(deploy, {
        'TRIGGER_ACCESS_TOKEN': values['trigger_pat'],
        'DOCKER_REGISTRY_USERNAME': values['registry_username'],
        'DOCKER_REGISTRY_PASSWORD': values['registry_password'],
        'TRIGGER_API_URL': 'https://trigger.v1su4.dev',
    }, shell=True)
    os.chown(deploy, 1000, 1000)
    os.chown(deploy.parent, 1000, 1000)
elif mode == 'hostinger':
    environment(Path('/root/splitter-pro2/.env'), {
        'SPLITTER_TRIGGER_SECRET_KEY': values['trigger_key'],
        'SPLITTER_ORCHESTRATION_TOKEN': values['worker_token'],
    })
else:
    raise ValueError('Unknown provision target')
print('Runtime configuration written; values withheld.')
