"""One GPU process per shot: OS exit frees all CUDA memory, including on failure."""
import fcntl
import json
import os
from pathlib import Path
import sys
import time

from PIL import Image, ImageOps


def status(path, stage):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps({'status': 'processing', 'stage': stage}))
    temporary.replace(path)


def run(directory):
    root = Path(directory)
    request = json.loads((root / 'request.json').read_text())
    status(root / 'status.json', 'waiting-for-gpu')
    lock_path = Path(os.environ['GPU_LOCK'])
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        status(root / 'status.json', 'loading-birefnet')
        import torch
        from torchvision import transforms
        from transformers import AutoModelForImageSegmentation

        if not torch.cuda.is_available():
            raise RuntimeError('CUDA GPU is unavailable')
        started = time.monotonic()
        model = AutoModelForImageSegmentation.from_pretrained(
            os.environ.get('BIREFNET_MODEL', '/models/birefnet-hr-matting'),
            trust_remote_code=True, local_files_only=True,
        ).eval().cuda().half()
        with Image.open(root / 'source') as source:
            image = ImageOps.exif_transpose(source).convert('RGB')
        status(root / 'status.json', 'removing-background')
        transform = transforms.Compose([
            transforms.Resize((2048, 2048)), transforms.ToTensor(),
            transforms.Normalize([.485, .456, .406], [.229, .224, .225]),
        ])
        with torch.inference_mode():
            prediction = model(transform(image).unsqueeze(0).cuda().half())[-1].sigmoid().cpu()[0].squeeze()
        # Use the model's detailed alpha, without thresholding or added feathering.
        # Only the inference tensor is resized; source pixels keep their native geometry.
        mask = transforms.ToPILImage()(prediction).resize(image.size, Image.Resampling.LANCZOS)
        gray = request['gray']
        output = Image.new('RGB', image.size, (gray, gray, gray))
        output.paste(image, (0, 0), mask)
        output.save(root / 'output.png', format='PNG')
        (root / 'metrics.json').write_text(json.dumps({'model': 'birefnet-hr-matting', 'seconds': round(time.monotonic() - started, 3), 'peak_vram_bytes': torch.cuda.max_memory_allocated(), 'size': image.size}))
    # Parent marks completed only after this process has exited and released CUDA.


if __name__ == '__main__':
    run(sys.argv[1])
