FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
RUN uv pip install --system torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu129
RUN uv pip install --system fastapi==0.135.2 uvicorn==0.42.0 python-multipart==0.0.22 pillow==12.1.1 numpy==1.26.4 einops==0.8.1 transformers==4.46.3 timm==1.0.30 kornia==0.8.2
WORKDIR /app
RUN python -c "from transformers import AutoModelForImageSegmentation; from torchvision import transforms"
COPY app.py inference.py /app/
ENV BIREFNET_MODEL=/models/birefnet-hr-matting WORK_DIR=/work GPU_LOCK=/gpu-lock/stack-structure-gpu.lock
CMD ["uv", "run", "--no-project", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
