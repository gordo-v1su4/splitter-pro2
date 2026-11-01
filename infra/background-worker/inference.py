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
        status(root / 'status.json', 'loading-sam3')
        import torch
        from sam3.model_builder import build_sam3_image_model
        from sam3.model.sam3_image_processor import Sam3Processor

        if not torch.cuda.is_available():
            raise RuntimeError('CUDA GPU is unavailable')
        started = time.monotonic()
        model = build_sam3_image_model(checkpoint_path=os.environ['SAM3_CHECKPOINT'], load_from_HF=False, device='cuda', enable_inst_interactivity=False)
        processor = Sam3Processor(model, device='cuda', confidence_threshold=0.3)
        with Image.open(root / 'source') as source:
            image = ImageOps.exif_transpose(source).convert('RGB')
        status(root / 'status.json', 'removing-background')
        with torch.inference_mode(), torch.autocast('cuda', dtype=torch.bfloat16):
            state = processor.set_image(image)
            result = processor.set_text_prompt(state=state, prompt=request.get('prompt', 'person'))
        masks = result.get('masks')
        if masks is None or masks.numel() == 0:
            raise RuntimeError('SAM 3 did not find a foreground subject. Try a different subject description.')
        # Preserve SAM's predicted boundary. No feathering, blur, erosion, or dilation.
        mask = masks.squeeze(1).any(dim=0).cpu().numpy().astype('uint8') * 255
        mask = Image.fromarray(mask).resize(image.size, Image.Resampling.NEAREST)
        gray = request['gray']
        output = Image.new('RGB', image.size, (gray, gray, gray))
        output.paste(image, (0, 0), mask)
        output.save(root / 'output.png', format='PNG')
        (root / 'metrics.json').write_text(json.dumps({'model': 'sam3', 'seconds': round(time.monotonic() - started, 3), 'peak_vram_bytes': torch.cuda.max_memory_allocated(), 'size': image.size}))
    # Parent marks completed only after this process has exited and released CUDA.


if __name__ == '__main__':
    run(sys.argv[1])
