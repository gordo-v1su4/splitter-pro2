FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
RUN uv pip install --system torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu129
RUN uv pip install --system fastapi==0.135.2 uvicorn==0.42.0 python-multipart==0.0.22 pillow==12.1.1 'numpy==1.26.4' 'einops==0.8.1' 'sam3 @ git+https://github.com/facebookresearch/sam3.git@f1647e8d0c1d280991f4d1b7d974c2704537fe66'
WORKDIR /app
RUN uv pip install --system pycocotools==2.0.10 scipy==1.16.3 psutil==7.1.0 && python -c "from sam3.model_builder import build_sam3_image_model; from sam3.model.sam3_image_processor import Sam3Processor"
COPY app.py inference.py /app/
ENV SAM3_CHECKPOINT=/models/sam3.pt WORK_DIR=/work GPU_LOCK=/gpu-lock/stack-structure-gpu.lock
CMD ["uv", "run", "--no-project", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
