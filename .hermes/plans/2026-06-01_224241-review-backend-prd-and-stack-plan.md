# Review Backend + Project Stack PRD and Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Continue Splitter Pro 2 from the current deployed review/project flow into a structured review backend that treats reviews, project assets, refinement decisions, and final video-prep approvals as one durable production stack.

**Architecture:** Keep the current local-first FastAPI manifest architecture, but formalize it into a project-stack model: review intake creates evidence, approved/published images become project assets, project assets move through typed lanes, refinement jobs produce result assets, and final approval gates video generation. The UI should keep the dense Project Studio layout, with the backend providing clear data structures for each panel/readout instead of one-off frontend derivations.

**Tech Stack:** FastAPI + Pydantic + JSON manifests on disk, RustFS/S3-compatible storage bucket `splitter`, React 19 + Vite 8 + Tailwind CSS v4 + shadcn-style primitives, `uv` for Python tooling, `bun` for frontend tooling.

---

## 1. Current Context

Project repo: `/root/Github/splitter-pro2`

Known live state from previous verification:
- Branch: `main`
- Latest known commit: `f5ac5ef feat: densify project studio layout`
- Live health: `https://splitter.serving.cloud/api/health` returns `{"status":"ok"}`
- Backend tests: 30 passed in the prior run
- Frontend command: `bun run test && bun run build` passed in the prior run
- Current UI has a dense `Project Studio` page in `frontend/src/components/review-workspace.tsx` with lanes/readouts for Overview, Characters, Shot grids, Refinement, Approvals, and Video prep.

Important storage convention:
- Use bucket `splitter`.
- Object keys start with `reviews/...`, not `splitter/reviews/...`.
- Hostinger deploy secrets live in server-local `.env` beside compose, not in repo.

Current backend primitives:
- `ReviewManifest` and `ReviewImage` in `backend/src/backend/models.py`
- `ProjectManifest`, `ProjectAsset`, `ProjectCharacter`, `ProjectShotGrid`, `ProjectShotFrame`, `ProjectRefinementJob` in `backend/src/backend/models.py`
- Review publishing in `backend/src/backend/reviews.py`
- Project creation/uploads/refinement queue in `backend/src/backend/projects.py`
- API routes in `backend/src/backend/app.py`
- Tests in `backend/tests/test_review_approvals.py` and `backend/tests/test_projects.py`

---

## 2. Problem Statement

The review backend currently works, but the product is beginning to outgrow a simple image approval tool. The user’s desired direction is a combined review + project tool with an app-like stack layout:

1. Upload generated images for review.
2. Approve/reject images with reasons.
3. Publish approved images to durable storage.
4. Promote published review images into a working project.
5. Preserve project stack structure: approved look, character sheets, shot grids, extracted frames, refined frames, final approvals, and video-prep state.
6. Route specific assets through keep/upscale/face-fix workflows.
7. Track results, errors, and final acceptance in a backend model that the dense UI can render cleanly.

Right now, the frontend has already started modeling the app layout, but the backend should become the source of truth for the stack structure, status counts, lanes, refinement lifecycle, and eventual video generation readiness.

---

## 3. Product Vision

Build Splitter Pro 2’s review backend into a local-first visual production control plane.

The core object is no longer just a review or a project. It is a project stack:

- Intake layer: generated image batches, review notes, decision history.
- Source layer: published approved images copied from review storage.
- Structure layer: character sheets, shot grids, extracted frames, continuity notes.
- Refinement layer: keep/upscale/face-fix jobs, external ComfyUI handoff metadata, results.
- Approval layer: final selected stills with explicit video-readiness decisions.
- Output layer: future final video generation jobs.

The dense UI should feel like an operator workstation: left navigation/status, central asset matrix, right-side live manifest/actions/log. The backend should expose enough clean data that the UI does not need to infer business state from raw arrays forever.

---

## 4. Users and Jobs To Be Done

Primary user: visual/storyline operator reviewing AI-generated images and preparing final video inputs.

Jobs:
- As an operator, I want to upload many generated images and quickly approve/reject them so I can isolate the good outputs.
- As an operator, I want approved images stored durably so they do not disappear from local temp state.
- As an operator, I want a project page created from good review images so I can keep refining without losing the reasoning from review.
- As an operator, I want a project stack layout that shows where each image sits: hero/look, character, grid, extracted shot, refined shot, final approval.
- As an operator, I want to send weak-but-promising frames through upscale or face-fix workflows and keep strong frames as-is.
- As an operator, I want final video-prep to be gated by explicit approved refined/kept frames, not by whatever happened to be uploaded.

---

## 5. Non-goals For This Iteration

Do not build full external ComfyUI execution yet unless explicitly requested during implementation.

Do not replace the manifest-based backend with a database yet.

Do not redesign the whole main app shell. Keep the current dense Project Studio direction and improve backend support under it.

Do not add authentication/user accounts in this phase.

Do not store secrets in the repo.

---

## 6. Proposed Backend Product Model

### 6.1 Review model

Keep current review model, but add decision history.

Current:
- `ReviewManifest`
- `ReviewImage`

Add:
- `ReviewDecision`
  - `decision_id: str`
  - `image_index: int`
  - `from_status: str | None`
  - `to_status: str`
  - `reason: str = ""`
  - `created_at: datetime`

Why:
- Backend can answer “why was this image rejected/approved?” without relying only on the latest `rejection_reason` field.
- UI can show a review audit trail later.

### 6.2 Project stack model

Keep `ProjectManifest`, but add explicit stack and computed readout models.

Add enums/constants:
- asset type:
  - `character_sheet`
  - `single_still`
  - `cinematic_shot_grid`
  - `extracted_shot`
  - `refined_shot`
  - `final_video_frame`
  - `other`
- workflow:
  - `keep_as_is`
  - `comfyui_upscale`
  - `comfyui_face_fix`
- refinement status:
  - `accepted`
  - `queued`
  - `processing`
  - `completed`
  - `failed`
  - `cancelled`
- approval status for final project assets:
  - `candidate`
  - `needs_fix`
  - `final_approved`
  - `rejected`

Add to `ProjectAsset`:
- `approval_status: str = "candidate"`
- `source_asset_id: str | None = None` for result lineage
- `source_job_id: str | None = None` for refinement output lineage
- `stack_lane: str | None = None` optional backend lane hint: `look`, `character`, `grid`, `selected`, `refined`, `final`, `hold`

Add `ProjectStackReadout` response model:
- `asset_count: int`
- `character_count: int`
- `shot_grid_count: int`
- `selected_count: int`
- `refined_count: int`
- `queued_refinement_count: int`
- `completed_refinement_count: int`
- `final_approved_count: int`
- `video_ready: bool`
- `next_action: str`

Add `ProjectLane` response model:
- `lane_id: str`
- `label: str`
- `description: str`
- `asset_ids: list[str]`
- `count: int`

Add `ProjectStackResponse` or embed into `ProjectResponse`:
- `project: ProjectManifest`
- `readout: ProjectStackReadout`
- `lanes: list[ProjectLane]`

Design choice:
- Keep `ProjectManifest` backward-compatible on disk.
- Computed readout/lanes can be generated at response time from manifest data.
- This avoids migration risk and lets the current frontend continue working.

---

## 7. API Requirements

### 7.1 Current routes to keep

- `POST /api/reviews`
- `GET /api/reviews`
- `GET /api/reviews/{review_id}`
- `POST /api/reviews/{review_id}/images/{image_index}/approve`
- `POST /api/reviews/{review_id}/images/{image_index}/reject`
- `POST /api/reviews/{review_id}/publish-approved`
- `POST /api/reviews/{review_id}/project`
- `GET /api/projects`
- `GET /api/projects/{project_id}`
- `POST /api/projects/{project_id}/assets`
- `POST /api/projects/{project_id}/refinements`

### 7.2 New route: stack readout

`GET /api/projects/{project_id}/stack`

Returns:
```json
{
  "project": { "project_id": "..." },
  "readout": {
    "asset_count": 8,
    "character_count": 1,
    "shot_grid_count": 2,
    "selected_count": 5,
    "refined_count": 3,
    "queued_refinement_count": 1,
    "completed_refinement_count": 2,
    "final_approved_count": 3,
    "video_ready": false,
    "next_action": "Approve at least 6 final frames before video prep."
  },
  "lanes": [
    { "lane_id": "look", "label": "Approved look", "description": "Published review images", "asset_ids": ["..."], "count": 2 },
    { "lane_id": "character", "label": "Characters", "description": "Intact character sheets", "asset_ids": ["..."], "count": 1 },
    { "lane_id": "grid", "label": "Shot grids", "description": "Cinematic grid blocks", "asset_ids": ["..."], "count": 2 },
    { "lane_id": "selected", "label": "Selected shots", "description": "Extracted frames", "asset_ids": ["..."], "count": 2 },
    { "lane_id": "refined", "label": "Refined shots", "description": "ComfyUI results", "asset_ids": ["..."], "count": 1 },
    { "lane_id": "final", "label": "Video prep", "description": "Final approved frames", "asset_ids": ["..."], "count": 0 }
  ]
}
```

### 7.3 New route: update project asset decision

`POST /api/projects/{project_id}/assets/{asset_id}/decision`

Payload:
```json
{
  "approval_status": "final_approved",
  "notes": "Use for act 1 close-up after face fix.",
  "stack_lane": "final"
}
```

Rules:
- Unknown project returns 404.
- Unknown asset returns 404.
- Unsupported approval status returns 400.
- Updating notes appends/overwrites based on a clear decision; start with overwrite to keep scope simple.
- `final_approved` assets count toward video readiness.

### 7.4 New route: complete refinement job

`POST /api/projects/{project_id}/refinements/{job_id}/complete`

Payload:
```json
{
  "result_asset_ids": ["..."],
  "status": "completed",
  "notes": "Upscale output accepted from ComfyUI manual upload."
}
```

Initial implementation can support manual result mapping only.

Rules:
- Unknown job returns 404.
- Result asset IDs must exist in the project.
- Job status becomes `completed`.
- Job `updated_at` changes.
- Referenced result assets should receive `source_job_id` if that field is added.

### 7.5 Optional later route: create video-prep package

`POST /api/projects/{project_id}/video-prep`

Not in first implementation phase unless requested.

Purpose:
- Collect final-approved frames into an ordered manifest.
- Produce a package the future video generator can consume.

---

## 8. UI/Layout Requirements

Continue the current dense Project Studio layout. Backend work should make this layout more trustworthy and easier to extend.

### 8.1 Layout structure

Left rail:
- Overview
- Characters
- Shot grids
- Refinement
- Approvals
- Video prep

Main panel:
- Approved look / hero preview
- Project notes / next operator action
- Refinement routing matrix
- Character cards
- Shot grid cards
- Selected/refined/final shot lane

Right rail:
- Live readout
- Add project asset
- Refinement log
- Terminal-style status feed

### 8.2 Backend-supported labels

Move these from UI inference toward backend readout:
- Asset count
- Character count
- Grid count
- Selected/refined count
- Queued/completed refinement count
- Final approved count
- `next_action`
- `video_ready`

### 8.3 UX acceptance criteria

- Opening a project shows the same dense layout as now.
- Counts in the left and right rails come from backend stack/readout data when available.
- If backend stack route fails, frontend can fall back to existing local derivation.
- Asset decision changes update immediately in the UI after API response.
- Final-approved assets become visually distinct from candidates.

---

## 9. Data Storage Requirements

Keep disk manifests as source of truth:

- Reviews: `data/reviews/{review_id}/review.json`
- Projects: `data/projects/{project_id}/project.json`
- Project assets: `data/projects/{project_id}/assets/...`

Storage publishing:
- Review approved images publish to RustFS/S3-compatible storage.
- Bucket: `splitter`
- Keys: `reviews/{review_id}/{folder_kind}/{filename}`
- Do not duplicate bucket name in object keys.

Compatibility:
- Existing project manifests without new fields must still load.
- New Pydantic fields must have defaults.
- Tests should cover old-minimal manifests if practical.

---

## 10. Implementation Plan

### Task 1: Add backend model defaults for stack-aware assets

**Objective:** Extend `ProjectAsset` safely with approval/lineage/lane fields.

**Files:**
- Modify: `backend/src/backend/models.py`
- Test: `backend/tests/test_projects.py`

**Steps:**
1. Add fields to `ProjectAsset`:
   - `approval_status: str = "candidate"`
   - `source_asset_id: str | None = None`
   - `source_job_id: str | None = None`
   - `stack_lane: str | None = None`
2. Add test that creates a project and asserts existing assets default to `candidate`.
3. Run:
   - `cd backend && uv run pytest tests/test_projects.py -v`
4. Expected:
   - Project tests pass.

### Task 2: Add project stack/readout models

**Objective:** Define response models for backend-driven layout counts and lanes.

**Files:**
- Modify: `backend/src/backend/models.py`
- Test: `backend/tests/test_projects.py`

**Steps:**
1. Add `ProjectStackReadout`.
2. Add `ProjectLane`.
3. Add `ProjectStackResponse`.
4. Keep `ProjectResponse` unchanged for compatibility.
5. Run model import tests with:
   - `cd backend && uv run pytest tests/test_projects.py -v`

### Task 3: Add stack computation helper

**Objective:** Compute lanes/readout from a `ProjectManifest` in one backend function.

**Files:**
- Modify: `backend/src/backend/projects.py`
- Test: `backend/tests/test_projects.py`

**Implementation sketch:**
- Add `build_project_stack(manifest: ProjectManifest) -> tuple[ProjectStackReadout, list[ProjectLane]]`.
- Lane rules:
  - `look`: `source_kind == "review_approved"` or `asset_type == "single_still"`
  - `character`: `asset_type == "character_sheet"`
  - `grid`: `asset_type == "cinematic_shot_grid"`
  - `selected`: `asset_type == "extracted_shot"`
  - `refined`: `asset_type == "refined_shot"`
  - `final`: `approval_status == "final_approved"` or `stack_lane == "final"`
- `video_ready`: start with `final_approved_count >= 1`; later raise threshold if needed.
- `next_action` examples:
  - no assets: `Add or publish project assets.`
  - no character sheets: `Add character sheets for continuity.`
  - queued jobs exist: `Finish queued refinement jobs.`
  - no final approvals: `Approve final frames for video prep.`
  - ready: `Ready for video prep.`

**Validation:**
- Test project with hero, character sheet, extracted shot, refined shot.
- Assert readout counts and lanes.

### Task 4: Add `GET /api/projects/{project_id}/stack`

**Objective:** Expose computed stack readout to frontend.

**Files:**
- Modify: `backend/src/backend/app.py`
- Modify: `backend/src/backend/projects.py`
- Test: `backend/tests/test_projects.py`

**Steps:**
1. Add `get_project_stack(project_id: str) -> ProjectStackResponse` in `projects.py`.
2. Add FastAPI route in `app.py`.
3. Test 200 response for valid project.
4. Test 404 response for missing project.
5. Run:
   - `cd backend && uv run pytest tests/test_projects.py -v`

### Task 5: Add project asset decision endpoint

**Objective:** Let UI mark assets as candidate/needs-fix/final-approved/rejected and optionally move lanes.

**Files:**
- Modify: `backend/src/backend/models.py`
- Modify: `backend/src/backend/projects.py`
- Modify: `backend/src/backend/app.py`
- Test: `backend/tests/test_projects.py`

**Steps:**
1. Add `ProjectAssetDecisionRequest` with:
   - `approval_status: str`
   - `notes: str | None = None`
   - `stack_lane: str | None = None`
2. Add `_ALLOWED_PROJECT_ASSET_APPROVAL_STATUSES`.
3. Implement `update_project_asset_decision(project_id, asset_id, request)`.
4. Update `manifest.updated_at`.
5. Return `ProjectResponse` or `ProjectStackResponse`; choose `ProjectResponse` for minimal frontend disruption.
6. Tests:
   - Mark asset `final_approved`.
   - Reject unsupported status.
   - Reject unknown asset.

### Task 6: Add refinement completion endpoint

**Objective:** Track manual ComfyUI workflow results without building full automation yet.

**Files:**
- Modify: `backend/src/backend/models.py`
- Modify: `backend/src/backend/projects.py`
- Modify: `backend/src/backend/app.py`
- Test: `backend/tests/test_projects.py`

**Steps:**
1. Add `ProjectRefinementCompletionRequest` with:
   - `result_asset_ids: list[str]`
   - `status: str = "completed"`
   - `notes: str = ""`
2. Implement `complete_refinement(project_id, job_id, request)`.
3. Validate result assets exist.
4. Set job status/status error appropriately.
5. Set `source_job_id` on result assets where possible.
6. Tests:
   - Completing queued job with uploaded result asset changes status to completed.
   - Unknown job returns 404.
   - Unknown result asset returns 400.

### Task 7: Add frontend API types/functions

**Objective:** Wire frontend to stack/readout and decision endpoints without redesigning UI yet.

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Test: `frontend/src/App.test.tsx`

**Steps:**
1. Add interfaces:
   - `ProjectStackReadout`
   - `ProjectLane`
   - `ProjectStackResponse`
   - `ProjectAssetDecisionRequest` if useful.
2. Add functions:
   - `fetchProjectStack(projectId)`
   - `updateProjectAssetDecision(projectId, assetId, payload)`
   - `completeProjectRefinement(projectId, jobId, payload)`
3. Add mock fetch test coverage where appropriate.
4. Run:
   - `cd frontend && bun run test`

### Task 8: Use backend readout in Project Studio

**Objective:** Keep the current layout, but replace fragile derived counters with backend-provided readout when available.

**Files:**
- Modify: `frontend/src/components/review-workspace.tsx`
- Test: `frontend/src/App.test.tsx`

**Steps:**
1. Add state for `activeProjectStack` or include stack payload when opening project.
2. On `openProject`, fetch project and stack, or fetch stack only if response includes project.
3. Use readout values for:
   - left rail counts
   - right rail readout
   - next action block
   - video-ready indicator
4. Fall back to existing local derivation if stack route fails.
5. Add tests that mock stack route and assert readout appears.
6. Run:
   - `cd frontend && bun run test`

### Task 9: Add asset final approval controls in Project Studio

**Objective:** Allow the operator to mark selected/refined images as final-approved or needs-fix from the dense UI.

**Files:**
- Modify: `frontend/src/components/review-workspace.tsx`
- Modify: `frontend/src/lib/api.ts`
- Test: `frontend/src/App.test.tsx`

**Steps:**
1. Add buttons on `AssetDecisionCard` or a new final-lane card:
   - `Final`
   - `Needs fix`
   - `Reject`
2. Call `updateProjectAssetDecision`.
3. Refresh project/stack from response.
4. Visually distinguish `final_approved` with green/ready styling.
5. Test request payload and success message.

### Task 10: Validation and deploy

**Objective:** Prove the feature works before claiming completion.

**Commands:**
```bash
cd /root/Github/splitter-pro2/backend
uv run pytest

cd /root/Github/splitter-pro2/frontend
bun run test
bun run build

cd /root/Github/splitter-pro2
git status --short
```

If implementing live:
1. Commit with a focused message, e.g. `feat: add project stack backend readout`.
2. Push to `main` only when tests pass.
3. Watch GitHub Actions deploy.
4. Verify live:
   - `curl -fsS https://splitter.serving.cloud/api/health`
   - `curl -fsS https://splitter.serving.cloud/api/projects`
   - Browser check Project Studio and console.

---

## 11. Acceptance Criteria

Backend:
- Existing review/project APIs remain compatible.
- Existing manifests load with new model defaults.
- Project stack route returns readout and lanes for existing projects.
- Asset decision endpoint can mark an asset as final-approved.
- Refinement completion endpoint can attach result assets to queued jobs.
- Backend tests pass.

Frontend:
- Dense Project Studio layout remains visually intact.
- Counts/readouts use backend stack data when available.
- Final approval actions are visible for candidate/refined assets.
- UI degrades gracefully if stack route is unavailable.
- Frontend tests pass and production build succeeds.

Production:
- Health endpoint returns OK.
- Reviews API works.
- Projects API works.
- Project Studio opens with no console errors.
- No storage object key regression: keys remain `reviews/...` inside bucket `splitter`.

---

## 12. Risks and Mitigations

Risk: Manifest migration breaks old projects.
- Mitigation: only add Pydantic fields with defaults; avoid required fields.

Risk: Frontend and backend disagree on counts.
- Mitigation: backend stack route becomes canonical; frontend fallback is only for resilience.

Risk: Scope creep into full ComfyUI execution.
- Mitigation: first phase tracks decisions and manual results only.

Risk: Storage prefix mistakes return.
- Mitigation: keep tests asserting `reviews/{review_id}/...` object keys and bucket `splitter`.

Risk: Project Studio becomes too visually dense.
- Mitigation: preserve operator-workstation density but make hierarchy clear: left navigation, main matrix, right actions/log.

---

## 13. Open Questions

1. What should `video_ready` require: at least 1 final frame, a minimum number like 6/9, or a manually configured target per project?
2. Should asset decisions have a full history like review decisions, or is latest status enough for now?
3. Should ComfyUI result upload be manual first, or should the next phase connect directly to the Windows/SwarmUI/Comfy harness?
4. Should final video prep generate a downloadable manifest/package before any actual video generation?
5. Should stack lanes be persisted per asset or always computed from asset type/status?

Recommended defaults:
- Use `final_approved_count >= 1` for initial `video_ready` to avoid blocking tests/workflows.
- Persist latest asset status now; add asset decision history only if the UI needs audit trail.
- Keep ComfyUI manual result upload first; automate later.
- Generate video-prep manifest as the next product phase after this backend readout work.
- Persist optional `stack_lane`, but compute sensible defaults when it is absent.

---

## 14. Suggested First Implementation Slice

If we want the safest next PR, implement only:

1. Add stack-aware default fields to `ProjectAsset`.
2. Add computed stack readout models/helper.
3. Add `GET /api/projects/{project_id}/stack`.
4. Add frontend types and use readout counts in Project Studio.
5. Test and deploy.

Leave asset decision endpoints and refinement completion for the second slice.

This gives immediate alignment between backend structure and the current dense layout without risking a broad workflow rewrite.
