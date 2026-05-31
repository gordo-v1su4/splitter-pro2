# Local Visual Storyline to Review App Playbook

**Goal:** Run the original image-story pipeline locally up to human review: create a short story, create a character/reference sheet, generate consistent image stills locally through SwarmUI/Comfy, publish candidates into the review app, wait for approval/rejection, and stop there.

**Stop point:** Do not continue into video generation, final publishing, or downstream automation after the review step.

## Current plan

1. User provides a source/reference image.
2. Use that image as the creative seed for a made-up short story.
3. Create a character sheet first.
   - Preferred quality path: use ChatGPT image generation for the initial character sheet/reference if needed.
   - Local-first experiment path: use local tools after that sheet to keep the character consistent.
4. Build a visual storyline plan with:
   - `character_sheets`
   - `place_backgrounds`
   - `keyframes`
5. Keep stills video-native:
   - 16:9 landscape
   - 1280x720
   - deterministic seeds where possible
6. Try local generation first through the Windows desktop SwarmUI/Comfy pipeline.
   - Start with Z Image Turbo / Z Image local settings if available.
   - If local consistency is not good enough, note the failure mode before considering Nano Banana, Qwen image edit, or ChatGPT image edits.
7. Generate still images only.
8. Validate generated stills:
   - PNG exists
   - non-zero bytes
   - dimensions are 1280x720
   - optionally create a contact sheet
9. Publish generated candidates into the Splitter review app.
   - Use the review app upload API.
   - Review app can publish approved images to RustFS/S3 storage.
10. Wait for the review process.
    - Approved/rejected status is the decision point.
11. Stop.

## Local generation notes

Use the existing Windows desktop visual storyline harness when possible:

```powershell
Set-Location 'C:\Users\Gordo\Documents\Github\visual-storyline-pipeline-gordo'
uv run --with pyyaml scripts/swarmui_storyline_generate.py health
uv run --with pyyaml scripts/swarmui_storyline_generate.py generate examples/<plan>.yaml --dry-run
uv run --with pyyaml scripts/swarmui_storyline_generate.py generate examples/<plan>.yaml --timeout 420
```

Recommended quick local settings from the ComfyUI/SwarmUI playbook:

```yaml
generation_settings:
  model: Z_Image_Turbo_BF16
  images: 1
  steps: 9
  cfgscale: 1
  sampler: euler
  scheduler: beta
  sigmashift: 7
  negativeprompt: "blurry, low quality, distorted, watermark, text, bad anatomy, extra fingers"
```

## Review app notes

Desktop review app backend:

```powershell
Set-Location 'C:\Users\Gordo\Documents\Github\splitter-pro2\backend'
uv run --active uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Review API shape:

- `POST /api/reviews` with `files`, `title`, `notes`
- `POST /api/reviews/{review_id}/images/{image_index}/approve`
- `POST /api/reviews/{review_id}/images/{image_index}/reject`
- `POST /api/reviews/{review_id}/publish-approved`

## Open question for execution

Need the user-provided reference image before running the story/image generation path.
