# Splitter processing deployment

The web app and durable job files live on Hostinger. Existing Trigger.dev on
VM100 coordinates work in the dedicated **Splitter Pro** project
`proj_slopwoltlvvujwgohfta` (`splitter-pro-Ax8q`). The existing Trigger platform,
registry, and workers remain in place.

## Acceptance checklist

- [x] Create dedicated project in the existing v1su4 organization.
- [x] Verify VM100 GPU: RTX 4070 Ti, 12,282 MiB, idle baseline 203 MiB.
- [x] Locate existing SAM 3 checkpoint on the desktop; no model access workaround.
- [x] Deploy video-processing task with its own CPU queue.
- [x] Deploy background-removal task with its own serialized queue.
- [x] Run SAM 3 on VM100 under the existing shared GPU lock.
- [x] Exit inference process after each job to release VRAM.
- [x] Preserve original shots and add opaque grayscale-background copies.
- [x] Confirm queued, running, failed, and completed states in the browser.
- [x] Correlate real browser requests with production Trigger runs and outputs.
- [x] Test occupied GPU lock, idempotent retries, and failure recovery.
- [x] Inspect actual hair detail on the same supplied reference image; limitations below.
- [x] Verify live drag placement, retained arrangement, and exported PNG in Photos.

## Verified production evidence (2026-11-01 UTC)

**SAM 3 was rejected after user inspection of hair quality.** The queue and
export evidence below remains valid, but the accepted replacement candidate is
BiRefNet HR-matting. On the same 1672x941 Explorer input, the pinned HR-matting
checkpoint preserved visibly more flyaway hair than SAM 3 and sharper detail
than the local RMBG 2.0 comparison. Measured inference including load: HR-matting
4.07s / 5,373,649,920 bytes peak VRAM; RMBG 2.0 3.59s / 3,364,545,536 bytes.
Both exited to the 203 MiB idle GPU baseline. No blur or mask threshold was added.
Production replacement verification is recorded after deployment below.

HR-matting source/weights revision:
`ZhengPeng7/BiRefNet_HR-matting@fecd89c4fca69964f82f9c40bc4428e78e06f448`.
Worker image `splitter-background-worker:birefnet-hr-v1`, model directory
`/opt/splitter-background-worker/models/birefnet-hr-matting` (read-only in worker).

Web release `19b8767` deployed through GitHub Actions run `41268024330`.
The dedicated project's production tasks are `splitter-process-video` on
`splitter-video-cpu` and `splitter-remove-background` on `splitter-background-gpu`.
Each queue has concurrency one. Image-grid splitting remains direct CPU work.

- White SAM 3 copy: job `e5d1a7c4ba144d938cb13694a3cf09a7`,
  run `run_cmvx8ig6t002h3foe42shdjhg`, completed after the deliberately occupied
  host GPU lock released. Native browser displayed **Waiting for GPU**.
- Gray copy: job `c76691f1cf13473cade5b69f524a8c30`,
  run `run_cmvx8p63b002p3foewo53ou6c`, completed in about 17 seconds.
- Video: job `236f3443cf6f4dae883e430584234209`,
  run `run_cmvx8ne9d002l3foesy6x0tb7`, completed. The real three-second,
  30-fps upload produced three ordered 30-frame shots. Downloaded keyframes.zip
  contained segment-001 red, segment-002 blue, segment-003 green.
- Original Explorer image remained in the bank. White/gray operations added
  separate copies. Bank drag, filled-position swap, reverse swap, and tab
  switching retained placement. All six layout exports were 3840x2160 with
  fully opaque alpha. The production comparison PNG opened in Windows Photos
  through File Explorer and displayed the correct dimensions and arrangement.
- GPU returned to its 203 MiB baseline, 0% utilization after inference.
- Backend: 76 tests; frontend: 32 tests plus production build/lint.
  Essentia's shared-lock layer passed 27 Linux tests, including lock contention,
  nesting, exception release, and existing Studio compatibility checks.

SAM 3 checkpoint SHA256:
`9999e2341ceef5e136daa386eecb55cb414446a00ac2b55eb2dfd2f7c3cf8c9e`.
It runs in `splitter-background-worker:sam3-v1` on app-vm, private Tailnet
listener `100.118.78.13:18097`, managed as a Dockhand Internal stack.
Essentia Studio/AllInOne now cooperate through the same host lock, using
`essentia-api:shared-gpu-v1` (source-only layer over `studio-59550eb`).
Other legacy Essentia endpoints are outside this shared-lock change.

### Quality boundary

The rejected SAM 3 path applied its mask without added blur, feather, dilation, or image stretching.
The supplied composite image is challenging: the prompt **person wearing clothes
and a backpack** preserved straps that plain **person** omitted. The result still
has a small background remnant and imperfect fine hair edges. Model execution is
verified; exact strand-for-strand fidelity is not claimed. This result was rejected,
not accepted as final background-removal quality.

The deliberate no-subject SAM job failed visibly without adding a shot or
changing the board. A subsequent valid Explorer job completed and added its
copy. The error path now clears the stale processing notice as well as enabling
retry controls.

### Automatic deployment

The app retains its existing main-push GitHub Actions deployment. On app-vm,
`splitter-trigger-deploy.timer` checks public main every two minutes and deploys
only when the Git tree for `orchestration/` changes. It uses the existing private
`/home/gordo/.config/splitter/trigger-deploy.env`; no new SSH access was added.
The service builds with pinned Bun/Trigger CLI, pushes the exact project's image
to the existing local registry, and writes its successful tree stamp only after
the push completes. Failed attempts retry on the next timer tick. Unchanged
trees skip installation/build/deployment. Definitions are in `infra/trigger-deploy/`.
The initial automatic service deployment produced version `20261101.5`, image
digest `sha256:3280ea14a4fed16184c85aeab5b36f05c99d86b262aec5f621e1a0a935738c69`.

Image-grid splitting remains CPU-only and does not acquire the GPU lock.
Trigger project queues isolate video and background tasks; the shared host lock
also protects against cooperating GPU services in other projects. A Trigger
queue alone does not coordinate separate applications.

The previous CPU background-removal release is not accepted in production:
Hostinger's kernel killed its inference process after about 5.7 GiB resident
memory on the 8 GiB VPS. Do not repeat that test as a fallback on Hostinger.
