FROM oven/bun:1.3.9 AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend ./
RUN bun run build

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY backend /app/backend
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
WORKDIR /app/backend
RUN uv sync --frozen --no-dev
ENV PATH="/app/backend/.venv/bin:${PATH}"
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
