## Learned User Preferences

- Keep the frontend a clean, compact dark-mode utility UI (not flashy), with the bright green accent retained and no layout shifting when uploading or starting processing.
- Preserve previously approved UI tweaks across edits; the user repeatedly had to correct regressions such as buttons growing thick again, swapped fonts, and moved export buttons.
- The Video tab's "Process video" button (half-height) is the approved reference style; never change it, and make Image Grids tab buttons match it instead.
- Use a single progress bar, and make progress bars and playback scrubbers animate smoothly rather than steppy or choppy.
- Sliders use a narrow rectangular thumb, never a circular knob; grid/panel previews keep a 16:9 aspect ratio, not square.
- Extracted stills are the primary output; video clips are secondary reference material the user still wants to play back and compare against the original.
- Scene/shot detection logic should reason in actual frames, not seconds.
- Deployment should be fully automated through GitHub Actions on push to main; do not tell the user to run manual server or terminal commands, and verify the live site after deploying.
- When asked to run the app, start both the backend and frontend dev servers and check it end-to-end in the browser.
- Heavy jobs like YouTube ripping and scene splitting can be run on the deployed server at splitter.serving.cloud when the local machine is busy.

## Learned Workspace Facts

- Repo layout: `frontend/` is React 19 + Vite + Tailwind v4 managed with bun; `backend/` is Python FastAPI served by uvicorn on port 8000, managed with uv, using PySceneDetect and yt-dlp.
- In local dev the Vite server proxies `/api` to the backend at `http://127.0.0.1:8000`.
- A single root `.env` is the app's env file; `docker-compose.yml` maps it into the container's `SPLITTER_*` variables.
- Production runs at splitter.serving.cloud on a Hostinger VPS from `/root/splitter-pro2`, deployed by `.github/workflows/deploy-hostinger.yml` (SSH, git pull, `docker compose up -d --build`) on every push to main.
- Public HTTPS on the VPS is the existing Hostinger Caddy stack (`caddy-hostinger` at `/docker/caddy-hostinger`). It joins Docker network `splitter-pro2_default` and reverse-proxies only `splitter.serving.cloud` to container `splitter-pro2-splitter-pro2-1:8000`. Do not add Traefik labels or route `serving.cloud` / `www.serving.cloud` to this app.
- Object storage is the homelab RustFS S3-compatible service at s3.v1su4.dev with path-style addressing.
- The image grid splitter assumes 16:9 source panels, derives rows/columns from 16:9 ratios, and supports multi-image upload returning all split panels.
- YouTube import supports an optional start/end time range and can split the result by camera/scene cuts; it relies on server-side downloader/cookie configuration.
