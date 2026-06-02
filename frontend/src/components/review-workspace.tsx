import { useEffect, useState, type ReactNode } from 'react'

import {
  addProjectAsset,
  approveReviewImage,
  createProjectFromReview,
  createReview,
  fetchProject,
  fetchProjectStack,
  fetchReview,
  listProjects,
  listReviews,
  projectAssetUrl,
  publishApprovedReviewImages,
  queueProjectRefinement,
  rejectReviewImage,
  reviewAssetUrl,
  type ProjectAsset,
  type ProjectManifest,
  type ProjectStackResponse,
  type ProjectSummary,
  type ReviewManifest,
  type ReviewSummary,
} from '../lib/api'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

export function ReviewWorkspace() {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [reviews, setReviews] = useState<ReviewSummary[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [activeReview, setActiveReview] = useState<ReviewManifest | null>(null)
  const [activeProject, setActiveProject] = useState<ProjectManifest | null>(null)
  const [activeProjectStack, setActiveProjectStack] = useState<ProjectStackResponse | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [reviewActionKey, setReviewActionKey] = useState<string | null>(null)
  const [loadingReviewId, setLoadingReviewId] = useState<string | null>(null)
  const [autoInspectToken, setAutoInspectToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    listReviews()
      .then((nextReviews) => {
        if (isMounted) {
          setReviews(sortReviewsNewest(nextReviews))
        }
      })
      .catch(() => {
        if (isMounted) {
          setReviews([])
        }
      })
    listProjects()
      .then((nextProjects) => {
        if (isMounted) {
          setProjects(nextProjects)
        }
      })
      .catch(() => {
        if (isMounted) {
          setProjects([])
        }
      })
    return () => {
      isMounted = false
    }
  }, [])

  async function publishReview() {
    setIsPublishing(true)
    setError(null)
    try {
      const review = await createReview(files, title, notes)
      setActiveReview(review)
      setReviews((current) => sortReviewsNewest(upsertReviewSummary(current, review)))
      setTitle('')
      setNotes('')
      setFiles([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to publish images.')
    } finally {
      setIsPublishing(false)
    }
  }

  async function openReview(reviewId: string, inspectFirstPending = false) {
    setLoadingReviewId(reviewId)
    setError(null)
    try {
      const review = await fetchReview(reviewId)
      setActiveReview(review)
      if (inspectFirstPending) {
        setAutoInspectToken(`${reviewId}-${Date.now()}`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load review.')
    } finally {
      setLoadingReviewId(null)
    }
  }


  async function runReviewAction(actionKey: string, action: () => Promise<ReviewManifest>, fallbackMessage: string) {
    setReviewActionKey(actionKey)
    setError(null)
    try {
      const review = await action()
      setActiveReview(review)
      setReviews((current) => sortReviewsNewest(upsertReviewSummary(current, review)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallbackMessage)
    } finally {
      setReviewActionKey(null)
    }
  }

  function approveImage(reviewId: string, imageIndex: number) {
    void runReviewAction(
      `approve-${imageIndex}`,
      () => approveReviewImage(reviewId, imageIndex),
      'Unable to approve image.',
    )
  }

  function rejectImage(reviewId: string, imageIndex: number, reason = '') {
    void runReviewAction(
      `reject-${imageIndex}`,
      () => rejectReviewImage(reviewId, imageIndex, reason),
      'Unable to reject image.',
    )
  }

  function publishApproved(reviewId: string) {
    void runReviewAction('publish-approved', () => publishApprovedReviewImages(reviewId), 'Unable to publish approved images.')
  }

  async function refreshProjectStack(projectId: string) {
    try {
      const stack = await fetchProjectStack(projectId)
      setActiveProject(stack.project)
      setActiveProjectStack(stack)
      setProjects((current) => upsertProjectSummary(current, stack.project))
    } catch {
      setActiveProjectStack(null)
    }
  }

  async function createProject(reviewId: string) {
    setReviewActionKey('create-project')
    setError(null)
    try {
      const project = await createProjectFromReview(reviewId)
      setActiveProject(project)
      setActiveProjectStack(null)
      setProjects((current) => upsertProjectSummary(current, project))
      void refreshProjectStack(project.project_id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create project page.')
    } finally {
      setReviewActionKey(null)
    }
  }

  async function openProject(projectId: string) {
    setReviewActionKey(`open-project-${projectId}`)
    setError(null)
    try {
      const project = await fetchProject(projectId)
      setActiveProject(project)
      setActiveProjectStack(null)
      setProjects((current) => upsertProjectSummary(current, project))
      void refreshProjectStack(project.project_id)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load project page.')
    } finally {
      setReviewActionKey(null)
    }
  }

  async function addAssetToActiveProject(
    file: File,
    assetType: ProjectAsset['asset_type'],
    label: string,
    notes: string,
    characterName: string,
  ) {
    if (!activeProject) return
    setReviewActionKey('add-project-asset')
    setError(null)
    try {
      const project = await addProjectAsset(activeProject.project_id, file, assetType, label, notes, characterName)
      setActiveProject(project)
      setActiveProjectStack(null)
      setProjects((current) => upsertProjectSummary(current, project))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add project asset.')
    } finally {
      setReviewActionKey(null)
    }
  }

  async function queueRefinement(
    workflowName: 'keep_as_is' | 'comfyui_upscale' | 'comfyui_face_fix',
    assetIds: string[],
    settingsJson: Record<string, unknown> = {},
  ) {
    if (!activeProject || assetIds.length === 0) return
    setReviewActionKey(`refine-${workflowName}`)
    setError(null)
    try {
      const project = await queueProjectRefinement(activeProject.project_id, workflowName, assetIds, settingsJson)
      setActiveProject(project)
      setActiveProjectStack(null)
      setProjects((current) => upsertProjectSummary(current, project))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to queue refinement.')
    } finally {
      setReviewActionKey(null)
    }
  }

  if (activeProject) {
    return (
      <ProjectPage
        project={activeProject}
        stack={activeProjectStack?.project.project_id === activeProject.project_id ? activeProjectStack : null}
        isBusy={reviewActionKey === 'add-project-asset' || Boolean(reviewActionKey?.startsWith('refine-'))}
        onAddAsset={addAssetToActiveProject}
        onQueueRefinement={(workflowName, assetIds, settingsJson) => void queueRefinement(workflowName, assetIds, settingsJson)}
        onBack={() => setActiveProject(null)}
      />
    )
  }

  return (
    <section className="mt-0 space-y-6">
      <header className="flex flex-col gap-3 border-b border-[#181818] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#343434]">Project overview</p>
          <h1 className="mt-2 text-[16px] font-semibold leading-tight text-[#e0e0e0]">Projects</h1>
          <p className="mt-2 max-w-2xl text-[12px] leading-6 text-[#777]">
            Open project pages first, then use the Reviews navigation on the left for image approval and routing.
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#343434]">
          {projects.length} project{projects.length === 1 ? '' : 's'} · {reviews.length} saved review{reviews.length === 1 ? '' : 's'}
        </p>
      </header>

      <ProjectStrip
        projects={projects}
        loadingProjectId={reviewActionKey?.startsWith('open-project-') ? reviewActionKey.replace('open-project-', '') : null}
        onOpenProject={(projectId) => void openProject(projectId)}
      />

      <Card className="border-[#181818] bg-[#090909]">
        <CardHeader className="pb-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#343434]">Publish</p>
          <CardTitle>Publish images</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1fr_1.2fr_220px] lg:items-end">
          <label className="block space-y-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#555]">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              className="w-full rounded-sm border border-[#181818] bg-[#080808] px-3 py-2 text-[12px] text-[#d4d4d4] outline-none focus:border-[color:var(--color-accent-line)]"
              placeholder="Act 1 image good, hero options…"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#555]">Reason / notes</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.currentTarget.value)}
              className="w-full rounded-sm border border-[#181818] bg-[#080808] px-3 py-2 text-[12px] text-[#d4d4d4] outline-none focus:border-[color:var(--color-accent-line)]"
              placeholder="Why these are good, what to compare, what changed…"
            />
          </label>

          <div className="space-y-2">
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#555]">Images</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))}
                className="w-full text-[10px] text-[#777] file:mr-3 file:rounded-sm file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-[10px] file:text-[#c0c0c0]"
              />
            </label>
            {files.length > 0 ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#343434]">
                {files.length} staged
              </p>
            ) : null}
          </div>

          <div className="lg:col-start-3">
            <Button type="button" onClick={publishReview} disabled={isPublishing || files.length === 0} className="w-full">
              {isPublishing ? 'Publishing…' : 'Publish images'}
            </Button>
          </div>
          {error ? <p className="text-[12px] text-red-300 lg:col-span-3">{error}</p> : null}
        </CardContent>
      </Card>

      <PendingReviewQueue
        reviews={reviews}
        loadingReviewId={loadingReviewId}
        onOpenReview={(reviewId) => void openReview(reviewId, true)}
      />

      {activeReview ? (
        <ReviewGallery
          review={activeReview}
          actionKey={reviewActionKey}
          autoInspectToken={autoInspectToken}
          onApprove={approveImage}
          onReject={rejectImage}
          onPublishApproved={publishApproved}
          onCreateProject={(reviewId) => void createProject(reviewId)}
        />
      ) : null}

      <ReviewHistory reviews={reviews} loadingReviewId={loadingReviewId} onOpenReview={(reviewId) => void openReview(reviewId)} />
    </section>
  )
}

function upsertReviewSummary(current: ReviewSummary[], review: ReviewManifest): ReviewSummary[] {
  const statusCounts = summarizeReviewStatuses(review)
  return [
    {
      review_id: review.review_id,
      title: review.title,
      notes: review.notes,
      image_count: review.image_count,
      created_at: review.created_at,
      updated_at: review.updated_at,
      cover_asset_path: review.images[0]?.asset_path ?? null,
      cover_public_url: review.images[0]?.public_url ?? null,
      ...statusCounts,
    },
    ...current.filter((item) => item.review_id !== review.review_id),
  ]
}

function sortReviewsNewest(reviews: ReviewSummary[]): ReviewSummary[] {
  return [...reviews].sort((left, right) => {
    const rightTime = Date.parse(right.updated_at || right.created_at)
    const leftTime = Date.parse(left.updated_at || left.created_at)
    return rightTime - leftTime
  })
}

function hasPendingImages(review: ReviewSummary): boolean {
  return (review.pending_count ?? review.image_count) > 0
}

function upsertProjectSummary(current: ProjectSummary[], project: ProjectManifest): ProjectSummary[] {
  const hero = project.assets.find((asset) => asset.asset_id === project.hero_asset_id) ?? project.assets[0]
  return [
    {
      project_id: project.project_id,
      title: project.title,
      status: project.status,
      source_review_id: project.source_review_id,
      hero_asset_path: hero?.asset_path ?? null,
      hero_public_url: hero?.public_url ?? null,
      asset_count: project.assets.length,
      character_count: project.characters.length,
      shot_grid_count: project.shot_grids.length,
      shot_frame_count: project.shot_frames.length,
      created_at: project.created_at,
      updated_at: project.updated_at,
    },
    ...current.filter((item) => item.project_id !== project.project_id),
  ]
}

function summarizeReviewStatuses(review: ReviewManifest) {
  return review.images.reduce(
    (counts, image) => {
      const status = image.approval_status ?? 'pending'
      if (status === 'pending') counts.pending_count += 1
      if (status === 'approved') counts.approved_count += 1
      if (status === 'rejected') counts.rejected_count += 1
      if (status === 'published') counts.published_count += 1
      return counts
    },
    { pending_count: 0, approved_count: 0, rejected_count: 0, published_count: 0 },
  )
}

function ReviewGallery({
  review,
  actionKey,
  onApprove,
  onReject,
  onPublishApproved,
  onCreateProject,
  autoInspectToken,
}: {
  review: ReviewManifest
  actionKey: string | null
  autoInspectToken: string | null
  onApprove: (reviewId: string, imageIndex: number) => void
  onReject: (reviewId: string, imageIndex: number, reason?: string) => void
  onPublishApproved: (reviewId: string) => void
  onCreateProject: (reviewId: string) => void
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [zoomScale, setZoomScale] = useState(1)
  const pendingImages = review.images.filter((image) => (image.approval_status ?? 'pending') === 'pending')
  const approvedCount = review.images.filter((image) => image.approval_status === 'approved').length
  const publishedCount = review.images.filter((image) => image.approval_status === 'published').length
  const selectedImage = review.images.find((image) => image.index === selectedIndex) ?? null
  const selectedImageUrl = selectedImage ? selectedImage.public_url || reviewAssetUrl(review.review_id, selectedImage.asset_path) : ''

  useEffect(() => {
    if (!autoInspectToken) return
    const firstPending = review.images.find((image) => (image.approval_status ?? 'pending') === 'pending') ?? review.images[0]
    if (firstPending) {
      openImage(firstPending.index)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInspectToken])

  function openImage(imageIndex: number) {
    setSelectedIndex(imageIndex)
    setZoomScale(1)
    const image = review.images.find((candidate) => candidate.index === imageIndex)
    setRejectReason(image?.rejection_reason ?? '')
  }

  function closeImage() {
    setSelectedIndex(null)
    setRejectReason('')
    setZoomScale(1)
  }

  return (
    <article className="space-y-4">
      <div className="flex flex-col justify-between gap-3 border-b border-[#181818] pb-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#343434]">Current review</p>
          <h2 className="mt-2 text-[16px] font-semibold text-[#e0e0e0]">{review.title || 'Untitled image review'}</h2>
          {review.notes ? <p className="mt-2 max-w-2xl text-[12px] leading-6 text-[#777]">{review.notes}</p> : null}
        </div>
        <div className="space-y-2 sm:text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#343434]">
            {review.image_count} review frame{review.image_count === 1 ? '' : 's'} · approve before storage
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              onClick={() => onPublishApproved(review.review_id)}
              disabled={approvedCount === 0 || actionKey === 'publish-approved'}
              className="w-full sm:w-auto"
            >
              {actionKey === 'publish-approved' ? 'Publishing approved…' : `Publish approved (${approvedCount})`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onCreateProject(review.review_id)}
              disabled={publishedCount === 0 || actionKey === 'create-project'}
              className="w-full sm:w-auto"
            >
              {actionKey === 'create-project' ? 'Creating project…' : 'Create project page'}
            </Button>
          </div>
        </div>
      </div>

      {pendingImages.length === 0 ? (
        <div className="rounded-[2px] border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-[12px] text-emerald-100/90">
          This review has no pending images left. It has moved down into the compact history log.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {pendingImages.map((image) => {
            const status = image.approval_status ?? 'pending'
            const imageUrl = image.public_url || reviewAssetUrl(review.review_id, image.asset_path)
            return (
              <figure
                key={image.asset_path}
                className="group overflow-hidden rounded-[2px] border border-[#181818] bg-zinc-950 shadow-[0_18px_60px_rgba(0,0,0,0.24)]"
              >
                <button
                  type="button"
                  onClick={() => openImage(image.index)}
                  aria-label={`View ${image.label}`}
                  className="relative block w-full overflow-hidden bg-black text-left"
                >
                  <img
                    src={imageUrl}
                    alt={image.label}
                    className="aspect-video w-full bg-black object-contain transition duration-300 group-hover:scale-[1.02]"
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/85 via-black/10 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <div className="w-full p-3">
                      <div className="flex items-center justify-between gap-3 text-[10px] text-[#d4d4d4]">
                        <span className="truncate font-medium">{image.label}</span>
                        <span className="rounded-[2px] border border-white/15 bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[#c0c0c0]">
                          {status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-[#777]">{image.width}×{image.height} · click to inspect</p>
                    </div>
                  </div>
                </button>
                <figcaption className="flex items-center justify-between gap-3 px-3 py-2 text-[10px] text-[#777]">
                  <span className="text-[#555]">{status}</span>
                  <Button type="button" variant="secondary" size="sm" onClick={() => openImage(image.index)}>
                    Inspect
                  </Button>
                </figcaption>
              </figure>
            )
          })}
        </div>
      )}

      {selectedImage ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={selectedImage.label}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeImage()
            }
          }}
        >
          <div className="w-full max-w-7xl overflow-hidden rounded-[2px] border border-[#181818] bg-zinc-950/95 shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-[#181818] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[#555]">Image inspection</p>
                <h3 className="mt-1 text-[13px] font-medium text-[#e0e0e0]">{selectedImage.label}</h3>
              </div>
              <button
                type="button"
                onClick={closeImage}
                className="rounded-[2px] border border-[#181818] bg-white/[0.04] px-4 py-2 text-[12px] text-[#c0c0c0] transition hover:bg-white/[0.08]"
              >
                Close
              </button>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="relative flex max-h-[82vh] min-h-[42vh] items-center justify-center overflow-auto rounded-[2px] bg-black/60 p-2">
                <img
                  src={selectedImageUrl}
                  alt={`${selectedImage.label} large preview`}
                  onDoubleClick={() => setZoomScale((current) => (current === 1 ? 2 : 1))}
                  style={zoomScale > 1 ? { width: `${selectedImage.width * zoomScale}px` } : undefined}
                  className={zoomScale > 1 ? 'h-auto max-w-none cursor-zoom-out object-contain' : 'max-h-[78vh] w-auto max-w-full cursor-zoom-in object-contain'}
                />
                <div className="absolute bottom-3 right-3 flex flex-wrap justify-end gap-2 rounded-[2px] border border-[#181818] bg-black/80 p-1.5 shadow-2xl backdrop-blur">
                  <button
                    type="button"
                    onClick={() => setZoomScale(1)}
                    aria-pressed={zoomScale === 1}
                    className="rounded-[2px] px-3 py-1 text-[10px] font-medium text-[#c0c0c0] transition hover:bg-white/10 aria-pressed:bg-white/15"
                  >
                    Fit
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomScale(2)}
                    aria-pressed={zoomScale === 2}
                    className="rounded-[2px] px-3 py-1 text-[10px] font-medium text-[#c0c0c0] transition hover:bg-white/10 aria-pressed:bg-white/15"
                  >
                    2×
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomScale(3)}
                    aria-pressed={zoomScale === 3}
                    className="rounded-[2px] px-3 py-1 text-[10px] font-medium text-[#c0c0c0] transition hover:bg-white/10 aria-pressed:bg-white/15"
                  >
                    3×
                  </button>
                  <a
                    href={selectedImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-[2px] px-3 py-1 text-[10px] font-medium text-[color:var(--color-accent)] transition hover:bg-white/10"
                  >
                    Open full size
                  </a>
                </div>
              </div>
              <aside className="space-y-4 rounded-[2px] border border-[#181818] bg-[#090909] p-4">
                <div className="space-y-1 text-[12px] text-[#777]">
                  <p className="text-[#d4d4d4]">{selectedImage.width}×{selectedImage.height}</p>
                  <p>Status: {selectedImage.approval_status ?? 'pending'}</p>
                </div>
                <label className="block space-y-2">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-[#555]">Optional rejection reason</span>
                  <textarea
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.currentTarget.value)}
                    rows={4}
                    className="w-full rounded-[2px] border border-[#181818] bg-[#080808] px-3 py-2 text-[12px] text-[#d4d4d4] outline-none placeholder:text-[#222] focus:border-[color:var(--color-accent-line)]"
                    placeholder="Too vertical, wrong character, unreadable layout…"
                  />
                </label>
                <div className="grid gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      closeImage()
                      onApprove(review.review_id, selectedImage.index)
                    }}
                    disabled={selectedImage.approval_status === 'published' || actionKey === `approve-${selectedImage.index}`}
                    className="w-full"
                  >
                    {actionKey === `approve-${selectedImage.index}` ? 'Approving…' : 'Approve image'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      closeImage()
                      onReject(review.review_id, selectedImage.index, rejectReason)
                    }}
                    disabled={selectedImage.approval_status === 'published' || actionKey === `reject-${selectedImage.index}`}
                    className="w-full border-red-400/25 text-red-200 hover:bg-red-400/10"
                  >
                    {actionKey === `reject-${selectedImage.index}` ? 'Denying…' : 'Deny image'}
                  </Button>
                </div>
              </aside>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function ProjectPage({
  project,
  stack,
  isBusy,
  onAddAsset,
  onQueueRefinement,
  onBack,
}: {
  project: ProjectManifest
  stack: ProjectStackResponse | null
  isBusy: boolean
  onAddAsset: (file: File, assetType: ProjectAsset['asset_type'], label: string, notes: string, characterName: string) => void
  onQueueRefinement: (
    workflowName: 'keep_as_is' | 'comfyui_upscale' | 'comfyui_face_fix',
    assetIds: string[],
    settingsJson?: Record<string, unknown>,
  ) => void
  onBack: () => void
}) {
  const [assetType, setAssetType] = useState<ProjectAsset['asset_type']>('character_sheet')
  const [assetFile, setAssetFile] = useState<File | null>(null)
  const [assetLabel, setAssetLabel] = useState('')
  const [characterName, setCharacterName] = useState('')
  const [assetNotes, setAssetNotes] = useState('')
  const hero = project.assets.find((asset) => asset.asset_id === project.hero_asset_id) ?? project.assets[0]
  const sheets = project.assets.filter((asset) => asset.asset_type === 'character_sheet')
  const shotGrids = project.assets.filter((asset) => asset.asset_type === 'cinematic_shot_grid')
  const selectedShots = project.assets.filter((asset) => asset.asset_type === 'extracted_shot' || asset.asset_type === 'refined_shot')
  const refinementCandidates = project.assets.filter((asset) => asset.asset_type === 'single_still' || asset.asset_type === 'extracted_shot' || asset.asset_type === 'refined_shot')
  const readout = stack?.readout
  const stackSelectedCount = readout?.selected_count ?? selectedShots.length
  const stackQueuedCount = readout?.queued_refinement_count ?? project.refinement_jobs.filter((job) => job.status === 'queued' || job.status === 'processing').length
  const nextAction = readout?.next_action || 'Approved look, character references, cinematic shot grids, selected frames, then Comfy refinement. Far-away shots should route through crop / face replace / stitch before final video generation approval.'
  const latestRefinement = project.refinement_jobs.at(-1)
  const allAssetIds = refinementCandidates.map((asset) => asset.asset_id)

  function submitAsset() {
    if (!assetFile) return
    onAddAsset(assetFile, assetType, assetLabel, assetNotes, characterName)
    setAssetFile(null)
    setAssetLabel('')
    setCharacterName('')
    setAssetNotes('')
  }

  return (
    <section className="space-y-4 text-[#d8d8d8]">
      <header className="flex flex-col gap-3 border-b border-[#181818] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="mb-3 text-[10px] uppercase tracking-[0.22em] text-[#666] transition hover:text-[#3a8a3a]">
            ← Project overview
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#343434]">Project page</p>
          <h1 className="mt-2 truncate text-[16px] font-semibold leading-tight text-[#e0e0e0]">{project.title || 'Untitled project'}</h1>
          <p className="mt-2 max-w-2xl text-[12px] leading-6 text-[#777]">Overview, continuity, routing, and approvals for this project. Reviews stay in the main left navigation instead of opening a second app shell.</p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right font-mono text-[10px]">
          <Readout label="Assets" value={project.assets.length} />
          <Readout label="Chars" value={project.characters.length} />
          <Readout label="Jobs" value={project.refinement_jobs.length} />
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_224px]">
        <main className="min-w-0 space-y-4">
              <div className="grid gap-4 2xl:grid-cols-[minmax(520px,1.05fr)_minmax(380px,0.95fr)]">
                <section className="overflow-hidden rounded-[3px] border border-[#181818] bg-[#0b0b0b]">
                  <div className="flex items-center justify-between border-b border-[#181818] px-3 py-2">
                    <div>
                      <div className="text-[9px] uppercase tracking-[0.22em] text-[#343434]">Approved look</div>
                      <h1 className="mt-1 truncate text-[26px] font-semibold leading-none tracking-[-0.02em] text-[#f0f0f0]">{project.title || 'Untitled project'}</h1>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-right font-mono text-[10px]">
                      <Readout label="Assets" value={project.assets.length} />
                      <Readout label="Chars" value={project.characters.length} />
                      <Readout label="Jobs" value={project.refinement_jobs.length} />
                    </div>
                  </div>
                  <div className="bg-black">
                    {hero ? (
                      <img
                        src={hero.public_url || projectAssetUrl(project.project_id, hero.asset_path)}
                        alt={hero.label}
                        className="aspect-video w-full object-contain"
                      />
                    ) : (
                      <div className="flex aspect-video items-center justify-center text-[10px] uppercase tracking-[0.22em] text-[#333]">No hero selected</div>
                    )}
                  </div>
                  <div className="grid border-t border-[#181818] sm:grid-cols-3">
                    <InfoCell label="Source review" value={project.source_review_id?.slice(0, 8) ?? 'manual'} />
                    <InfoCell label="Hero asset" value={hero?.label ?? 'none'} />
                    <InfoCell label="Updated" value={new Date(project.updated_at).toLocaleTimeString()} />
                  </div>
                </section>

                <section className="rounded-[3px] border border-[#181818] bg-[#0b0b0b] p-3">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[9px] uppercase tracking-[0.22em] text-[#343434]">Working project page</div>
                      <h2 className="mt-1 text-[16px] font-semibold text-[#dcdcdc]">Continuity + next operator action</h2>
                    </div>
                    <span className="rounded-[2px] border border-[#1f2f1f] bg-[#081008] px-2 py-1 font-mono text-[10px] text-[#3a8a3a]">WORKING</span>
                  </div>
                  <p className="min-h-20 rounded-[2px] border border-[#181818] bg-[#070707] p-3 text-[12px] leading-6 text-[#9a9a9a]">
                    {nextAction}
                  </p>
                  {project.notes ? <p className="mt-2 rounded-[2px] border border-[#181818] bg-[#080808] p-2 text-[10px] text-[#666]">{project.notes}</p> : null}
                  {latestRefinement ? (
                    <div className="mt-3 rounded-[2px] border border-[#1f2f1f] bg-[#081008] px-3 py-2 text-[10px] text-[#9ed29e]">
                      Latest: {formatRefinementWorkflow(latestRefinement.workflow_name)} {latestRefinement.status} · {latestRefinement.input_asset_ids.length} input{latestRefinement.input_asset_ids.length === 1 ? '' : 's'}
                    </div>
                  ) : null}
                </section>
              </div>

              <section className="mt-4 rounded-[3px] border border-[#181818] bg-[#0b0b0b]">
                <div className="flex flex-col gap-3 border-b border-[#181818] px-3 py-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[9px] uppercase tracking-[0.22em] text-[#343434]">Refinement routing</div>
                    <h2 className="mt-1 text-[16px] font-semibold text-[#dcdcdc]">Keep / upscale / face-fix decision matrix</h2>
                    <p className="mt-1 text-[11px] text-[#555]">Use Fix for far-away faces: crop, replace face, stitch back, then approve for video generation.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" disabled={isBusy || allAssetIds.length === 0} onClick={() => onQueueRefinement('keep_as_is', allAssetIds)}>
                      Keep all
                    </Button>
                    <Button type="button" size="sm" disabled={isBusy || allAssetIds.length === 0} onClick={() => onQueueRefinement('comfyui_upscale', allAssetIds, { scale: 2 })}>
                      Upscale all
                    </Button>
                  </div>
                </div>
                {refinementCandidates.length === 0 ? (
                  <p className="m-3 rounded-[2px] border border-dashed border-[#181818] bg-[#080808] p-3 text-[12px] text-[#555]">No stills are ready for refinement routing yet.</p>
                ) : (
                  <div className="grid gap-px bg-[#181818] sm:grid-cols-2 2xl:grid-cols-3 min-[1800px]:grid-cols-4">
                    {refinementCandidates.map((asset, index) => (
                      <AssetDecisionCard
                        key={asset.asset_id}
                        asset={asset}
                        projectId={project.project_id}
                        index={index}
                        isBusy={isBusy}
                        onQueueRefinement={onQueueRefinement}
                      />
                    ))}
                  </div>
                )}
              </section>

              <div className="mt-4 grid gap-4 2xl:grid-cols-3">
                <ProjectPanel title="Characters" eyebrow="Named cards" empty="Upload character sheets here; they stay intact.">
                  {project.characters.map((character) => {
                    const sheet = project.assets.find((asset) => asset.asset_id === character.sheet_asset_id)
                    return sheet ? <AssetMiniCard key={character.character_id} projectId={project.project_id} asset={sheet} title={character.name} subtitle="Character sheet" /> : null
                  })}
                  {sheets.length > project.characters.length ? <p className="text-[10px] text-[#555]">{sheets.length - project.characters.length} sheet asset(s) waiting for names.</p> : null}
                </ProjectPanel>

                <ProjectPanel title="Cinematic shot grids" eyebrow="Sequential blocks" empty="Upload 3×3 grids here before splitting.">
                  {shotGrids.map((asset, index) => (
                    <AssetMiniCard key={asset.asset_id} projectId={project.project_id} asset={asset} title={`Block ${index + 1}`} subtitle={asset.label} />
                  ))}
                </ProjectPanel>

                <ProjectPanel title="Shot sequence + Comfy" eyebrow="Final approvals" empty="Selected frames and 1920×1080 refined stills will land here.">
                  {selectedShots.map((asset, index) => (
                    <AssetMiniCard key={asset.asset_id} projectId={project.project_id} asset={asset} title={`#${index + 1} ${asset.label}`} subtitle={asset.asset_type === 'refined_shot' ? 'Refined' : 'Selected'} />
                  ))}
                </ProjectPanel>
              </div>
            </main>

            <aside className="hidden overflow-y-auto border-l border-[#181818] bg-[#0c0c0c] xl:block">
              <div className="border-b border-[#181818] p-3">
                <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Live readout</div>
                <div className="space-y-[5px]">
                  <ReadoutRow label="Manifest" value={project.project_id.slice(0, 8)} />
                  <ReadoutRow label="Assets" value={readout?.asset_count ?? project.assets.length} />
                  <ReadoutRow label="Sheets" value={sheets.length} />
                  <ReadoutRow label="Grids" value={readout?.shot_grid_count ?? shotGrids.length} />
                  <ReadoutRow label="Selected" value={stackSelectedCount} />
                  <ReadoutRow label="Queued" value={stackQueuedCount} />
                </div>
              </div>

              <div className="border-b border-[#181818] p-3">
                <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Add project asset</div>
                <div className="space-y-2">
                  <select value={assetType} onChange={(event) => setAssetType(event.currentTarget.value as ProjectAsset['asset_type'])} className="w-full rounded-[2px] border border-[#181818] bg-[#080808] px-2 py-2 text-[10px] text-[#aaa] outline-none">
                    <option value="character_sheet">Character sheet — intact</option>
                    <option value="single_still">Single still — route</option>
                    <option value="cinematic_shot_grid">Shot grid — split later</option>
                    <option value="extracted_shot">Extracted shot frame</option>
                    <option value="refined_shot">Comfy refined shot</option>
                    <option value="other">Other / hold</option>
                  </select>
                  <input value={assetLabel} onChange={(event) => setAssetLabel(event.currentTarget.value)} placeholder="Asset label" className="w-full rounded-[2px] border border-[#181818] bg-[#080808] px-2 py-2 text-[10px] text-[#ddd] outline-none" />
                  {assetType === 'character_sheet' ? (
                    <input value={characterName} onChange={(event) => setCharacterName(event.currentTarget.value)} placeholder="Character name" className="w-full rounded-[2px] border border-[#181818] bg-[#080808] px-2 py-2 text-[10px] text-[#ddd] outline-none" />
                  ) : null}
                  <textarea value={assetNotes} onChange={(event) => setAssetNotes(event.currentTarget.value)} rows={3} placeholder="Continuity notes / next action" className="w-full rounded-[2px] border border-[#181818] bg-[#080808] px-2 py-2 text-[10px] text-[#ddd] outline-none" />
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setAssetFile(event.currentTarget.files?.[0] ?? null)} className="w-full text-[10px] text-[#555] file:mr-2 file:rounded-[2px] file:border-0 file:bg-[#181818] file:px-2 file:py-1.5 file:text-[10px] file:text-[#aaa]" />
                  <Button type="button" onClick={submitAsset} disabled={!assetFile || isBusy} className="w-full">
                    {isBusy ? 'Adding…' : 'Add asset'}
                  </Button>
                </div>
              </div>

              <div className="border-b border-[#181818] p-3">
                <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Refinement log</div>
                <div className="space-y-[6px]">
                  {project.refinement_jobs.length ? project.refinement_jobs.slice(-8).reverse().map((job) => (
                    <div key={job.job_id} className="rounded-[2px] border border-[#181818] bg-[#080808] p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[10px] text-[#777]">{formatRefinementWorkflow(job.workflow_name)}</span>
                        <span className="font-mono text-[9px] text-[#3a8a3a]">{job.status}</span>
                      </div>
                      <div className="mt-1 font-mono text-[9px] text-[#333]">{job.input_asset_ids.length} in · {job.result_asset_ids.length} out</div>
                    </div>
                  )) : <p className="rounded-[2px] border border-dashed border-[#181818] bg-[#080808] p-3 text-[10px] text-[#444]">No ComfyUI routing decisions yet.</p>}
                </div>
              </div>

              <div className="p-3">
                <div className="mb-2 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Terminal</div>
                <div className="space-y-[4px] font-mono text-[9px] leading-tight">
                  <div><span className="text-[#3a8a3a99]">[ROUTE]</span> <span className="text-[#555]">awaiting operator image decisions</span></div>
                  <div><span className="text-[#3a8a3a99]">[FACE]</span> <span className="text-[#444]">far shots → crop / replace / stitch</span></div>
                  <div><span className="text-[#3a8a3a99]">[VIDEO]</span> <span className="text-[#444]">final approvals gate generation</span></div>
                  <div className="mt-1 animate-pulse text-[#2e2e2e]">&gt; WAITING_FOR_PROJECT_INPUT_</div>
                </div>
              </div>
            </aside>
          </div>
    </section>
  )
}

function AssetDecisionCard({
  asset,
  projectId,
  index,
  isBusy,
  onQueueRefinement,
}: {
  asset: ProjectAsset
  projectId: string
  index: number
  isBusy: boolean
  onQueueRefinement: (
    workflowName: 'keep_as_is' | 'comfyui_upscale' | 'comfyui_face_fix',
    assetIds: string[],
    settingsJson?: Record<string, unknown>,
  ) => void
}) {
  return (
    <div className="bg-[#0b0b0b] p-2">
      <a href={asset.public_url || projectAssetUrl(projectId, asset.asset_path)} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-[2px] border border-[#181818] bg-black">
        <img src={asset.public_url || projectAssetUrl(projectId, asset.asset_path)} alt={asset.label} className="aspect-video w-full object-contain transition duration-300 group-hover:scale-[1.015]" />
      </a>
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-medium text-[#d8d8d8]">{asset.label}</p>
          <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[#444]">#{index + 1} · {asset.width}×{asset.height}</p>
        </div>
        <span className="rounded-[2px] border border-[#181818] bg-[#080808] px-1.5 py-1 font-mono text-[9px] text-[#555]">{asset.asset_type}</span>
      </div>
      {asset.notes ? <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-[#666]">{asset.notes}</p> : null}
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <Button type="button" variant="secondary" size="sm" disabled={isBusy} onClick={() => onQueueRefinement('keep_as_is', [asset.asset_id])}>Keep</Button>
        <Button type="button" variant="secondary" size="sm" disabled={isBusy} onClick={() => onQueueRefinement('comfyui_upscale', [asset.asset_id], { scale: 2 })}>Upscale</Button>
        <Button type="button" variant="secondary" size="sm" disabled={isBusy} onClick={() => onQueueRefinement('comfyui_face_fix', [asset.asset_id], { crop_face: true, stitch_back: true })}>Fix</Button>
      </div>
    </div>
  )
}

function AssetMiniCard({ projectId, asset, title, subtitle }: { projectId: string; asset: ProjectAsset; title: string; subtitle: string }) {
  return (
    <a href={asset.public_url || projectAssetUrl(projectId, asset.asset_path)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[2px] border border-[#181818] bg-[#080808] transition hover:border-[#3a8a3a]/50">
      <img src={asset.public_url || projectAssetUrl(projectId, asset.asset_path)} alt={asset.label} className="aspect-video w-full bg-black object-cover object-top" />
      <span className="block p-2">
        <span className="block truncate text-[10px] font-medium text-[#d8d8d8]">{title}</span>
        <span className="mt-0.5 block truncate font-mono text-[9px] uppercase tracking-[0.16em] text-[#444]">{subtitle}</span>
      </span>
    </a>
  )
}

function Readout({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.18em] text-[#303030]">{label}</div>
      <div className="text-[12px] text-[#3a8a3a]">{value}</div>
    </div>
  )
}

function ReadoutRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-[#434343]">{label}</span>
      <span className="font-mono text-[11px] text-[#3a8a3a]">{value}</span>
    </div>
  )
}

function InfoCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-t border-[#181818] p-3 sm:border-l sm:border-t-0 first:sm:border-l-0">
      <div className="text-[9px] uppercase tracking-[0.18em] text-[#303030]">{label}</div>
      <div className="mt-1 truncate text-[10px] text-[#888]">{value}</div>
    </div>
  )
}

function ProjectPanel({ title, eyebrow, empty, children }: { title: string; eyebrow: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : Boolean(children)
  return (
    <section className="space-y-3 rounded-[2px] border border-[#181818] bg-[#080808] p-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#343434]">{eyebrow}</p>
        <h3 className="mt-1 text-[13px] font-medium text-[#e0e0e0]">{title}</h3>
      </div>
      {hasChildren ? children : <p className="rounded-sm border border-dashed border-[#181818] p-3 text-[12px] text-[#555]">{empty}</p>}
    </section>
  )
}

function formatRefinementWorkflow(workflowName: string): string {
  if (workflowName === 'keep_as_is') return 'Keep as-is'
  if (workflowName === 'comfyui_upscale') return 'ComfyUI upscale'
  if (workflowName === 'comfyui_face_fix') return 'ComfyUI face fix'
  return workflowName
}

function ProjectStrip({
  projects,
  loadingProjectId,
  onOpenProject,
}: {
  projects: ProjectSummary[]
  loadingProjectId: string | null
  onOpenProject: (projectId: string) => void
}) {
  if (projects.length === 0) return null
  return (
    <section className="space-y-3 border-t border-[#181818] pt-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[#e0e0e0]">Project pages</h2>
        <p className="mt-1 text-[12px] text-[#555]">Approved looks that have moved into the trailer-building pipeline.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <button
            key={project.project_id}
            type="button"
            onClick={() => onOpenProject(project.project_id)}
            className="group overflow-hidden rounded-[2px] border border-[#181818] bg-[#090909] text-left transition hover:border-[#3a8a3a]/60 hover:bg-white/[0.04]"
          >
            {project.hero_asset_path ? (
              <img src={project.hero_public_url || projectAssetUrl(project.project_id, project.hero_asset_path)} alt={project.title} className="aspect-video w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
            ) : null}
            <span className="block p-3">
              <span className="block truncate text-[12px] font-medium text-[#d4d4d4]">{project.title}</span>
              <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[#343434]">
                {project.asset_count} asset{project.asset_count === 1 ? '' : 's'} · {project.character_count} character{project.character_count === 1 ? '' : 's'}
              </span>
              <span className="mt-2 block text-[10px] font-medium text-[color:var(--color-accent)]">
                {loadingProjectId === project.project_id ? 'Opening project…' : 'Open project page'}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function PendingReviewQueue({
  reviews,
  loadingReviewId,
  onOpenReview,
}: {
  reviews: ReviewSummary[]
  loadingReviewId: string | null
  onOpenReview: (reviewId: string) => void
}) {
  const pendingReviews = sortReviewsNewest(reviews.filter(hasPendingImages))

  return (
    <section className="space-y-3 border border-[color:var(--color-accent-line)]/60 bg-[color:var(--color-accent-soft)]/20 p-4">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--color-accent)]">Needs review</p>
          <h2 className="mt-1 text-[16px] font-semibold text-[#e0e0e0]">Pending review queue</h2>
          <p className="mt-1 text-[12px] text-[#777]">Click a thumbnail once to open the full image inspector, then approve or deny.</p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#343434]">{pendingReviews.length} pending set{pendingReviews.length === 1 ? '' : 's'}</p>
      </div>

      {pendingReviews.length === 0 ? (
        <p className="rounded-sm border border-[#181818] bg-[#080808] p-3 text-[12px] text-[#555]">No pending image reviews right now.</p>
      ) : (
        <div className="grid gap-2">
          {pendingReviews.map((review) => (
            <button
              key={review.review_id}
              type="button"
              onClick={() => onOpenReview(review.review_id)}
              className="group grid w-full grid-cols-[88px_1fr] items-stretch overflow-hidden rounded-[2px] border border-[#181818] bg-[#080808] text-left transition hover:border-[color:var(--color-accent-line)] hover:bg-white/[0.04] sm:grid-cols-[128px_1fr_auto]"
            >
              <ReviewCover review={review} className="aspect-video h-full min-h-16 w-full object-cover" />
              <span className="flex min-w-0 flex-col justify-center p-3">
                <span className="truncate text-[12px] font-medium text-[#d4d4d4]">{review.title || 'Untitled image review'}</span>
                {review.notes ? <span className="mt-1 line-clamp-1 text-[10px] text-[#555]">{review.notes}</span> : null}
                <span className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#343434]">
                  {(review.pending_count ?? review.image_count)} pending · click thumbnail to inspect
                </span>
              </span>
              <span className="hidden items-center px-4 text-[10px] font-medium text-[color:var(--color-accent)] sm:flex">
                {loadingReviewId === review.review_id ? 'Loading…' : 'Review now'}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function ReviewHistory({
  reviews,
  loadingReviewId,
  onOpenReview,
}: {
  reviews: ReviewSummary[]
  loadingReviewId: string | null
  onOpenReview: (reviewId: string) => void
}) {
  const historyReviews = sortReviewsNewest(reviews.filter((review) => !hasPendingImages(review)))

  return (
    <section className="space-y-3 border-t border-[#181818] pt-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[#e0e0e0]">History log</h2>
          <p className="mt-1 text-[12px] text-[#555]">Older reviews and finished/published sets live here.</p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#343434]">Newest first</p>
      </div>

      {historyReviews.length === 0 ? (
        <p className="text-[12px] text-[#555]">No completed image reviews yet. Approved, rejected, or published sets will appear here after they leave the pending queue.</p>
      ) : (
        <div className="divide-y divide-white/[0.06] overflow-hidden rounded-[2px] border border-[#181818] bg-[#090909]">
          {historyReviews.map((review) => (
            <button
              key={review.review_id}
              type="button"
              onClick={() => onOpenReview(review.review_id)}
              aria-label={`View ${review.title || 'Untitled image review'}`}
              className="grid w-full grid-cols-[56px_1fr_auto] items-center gap-2 px-2 py-1.5 text-left transition hover:bg-white/[0.04]"
            >
              <ReviewCover review={review} className="aspect-video w-full rounded-sm object-contain" />
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium text-[#d4d4d4]">{review.title || 'Untitled image review'}</span>
                {review.notes ? <span className="mt-0.5 block truncate text-[10px] text-[#555]">{review.notes}</span> : null}
                <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[#343434]">
                  {review.image_count} image{review.image_count === 1 ? '' : 's'} · {review.pending_count ?? 0} pending · {review.published_count ?? 0} published
                </span>
              </span>
              <span className="rounded-[2px] border border-[#181818] bg-white/[0.04] px-3 py-1.5 text-[10px] font-medium text-[#c0c0c0]">
                {loadingReviewId === review.review_id ? 'Loading…' : 'View'}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function ReviewCover({ review, className }: { review: ReviewSummary; className: string }) {
  if (!review.cover_asset_path) {
    return (
      <span className={`${className} flex items-center justify-center bg-black/40 font-mono text-[9px] uppercase tracking-[0.2em] text-[#222]`}>
        No image
      </span>
    )
  }

  return (
    <img
      src={review.cover_public_url || reviewAssetUrl(review.review_id, review.cover_asset_path)}
      alt={`${review.title} thumbnail`}
      className={className}
    />
  )
}
