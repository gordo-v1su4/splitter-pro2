# Splitter processing deployment

The web app and durable job files live on Hostinger. Existing Trigger.dev on
VM100 coordinates work in the dedicated **Splitter Pro** project
`proj_slopwoltlvvujwgohfta` (`splitter-pro-Ax8q`). The existing Trigger platform,
registry, and workers remain in place.

## Acceptance checklist

- [x] Create dedicated project in the existing v1su4 organization.
- [x] Verify VM100 GPU: RTX 4070 Ti, 12,282 MiB, idle baseline 203 MiB.
- [x] Locate existing SAM 3 checkpoint on the desktop; no model access workaround.
- [ ] Deploy video-processing task with its own CPU queue.
- [ ] Deploy background-removal task with its own serialized queue.
- [ ] Run SAM 3 on VM100 under the existing shared GPU lock.
- [ ] Exit inference process after each job to release VRAM.
- [ ] Preserve original shots and add opaque grayscale-background copies.
- [ ] Confirm queued, running, failed, and completed states in the browser.
- [ ] Correlate real browser requests with production Trigger runs and outputs.
- [ ] Test occupied GPU lock, idempotent retries, and failure recovery.
- [ ] Verify actual hair detail on the same supplied reference image.
- [ ] Verify live drag placement, retained arrangement, and exported PNG in Photos.

Image-grid splitting remains CPU-only and does not acquire the GPU lock.
Trigger project queues isolate video and background tasks; the shared host lock
also protects against cooperating GPU services in other projects. A Trigger
queue alone does not coordinate separate applications.

The previous CPU background-removal release is not accepted in production:
Hostinger's kernel killed its inference process after about 5.7 GiB resident
memory on the 8 GiB VPS. Do not repeat that test as a fallback on Hostinger.
