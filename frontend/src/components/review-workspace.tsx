import { useEffect, useState, type ReactNode } from 'react'

import {
  addProjectAsset,
  approveReviewImage,
  createProjectFromReview,
  createReview,
  fetchReview,
  listProjects,
  listReviews,
  projectAssetUrl,
  publishApprovedReviewImages,
  rejectReviewImage,
  reviewAssetUrl,
  type ProjectAsset,
  type ProjectManifest,
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

  async function createProject(reviewId: string) {
    setReviewActionKey('create-project')
    setError(null)
    try {
      const project = await createProjectFromReview(reviewId)
      setActiveProject(project)
      setProjects((current) => upsertProjectSummary(current, project))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create project page.')
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
      setProjects((current) => upsertProjectSummary(current, project))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add project asset.')
    } finally {
      setReviewActionKey(null)
    }
  }

  return (
    <section className="mt-6 space-y-6">
      <header className="flex flex-col gap-3 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-600">Image good / reasons</p>
          <h1 className="mt-2 font-display text-3xl italic leading-none tracking-tight text-zinc-50">Image review</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Publish generated images and why they matter, then keep the review history visible below.
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
          {reviews.length} saved review{reviews.length === 1 ? '' : 's'}
        </p>
      </header>

      <Card className="border-white/[0.08] bg-white/[0.025]">
        <CardHeader className="pb-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">Publish</p>
          <CardTitle>Publish images</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1fr_1.2fr_220px] lg:items-end">
          <label className="block space-y-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              className="w-full rounded-sm border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[color:var(--color-accent-line)]"
              placeholder="Act 1 image good, hero options…"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Reason / notes</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.currentTarget.value)}
              className="w-full rounded-sm border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[color:var(--color-accent-line)]"
              placeholder="Why these are good, what to compare, what changed…"
            />
          </label>

          <div className="space-y-2">
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Images</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))}
                className="w-full text-xs text-zinc-400 file:mr-3 file:rounded-sm file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-xs file:text-zinc-200"
              />
            </label>
            {files.length > 0 ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                {files.length} staged
              </p>
            ) : null}
          </div>

          <div className="lg:col-start-3">
            <Button type="button" onClick={publishReview} disabled={isPublishing || files.length === 0} className="w-full">
              {isPublishing ? 'Publishing…' : 'Publish images'}
            </Button>
          </div>
          {error ? <p className="text-sm text-red-300 lg:col-span-3">{error}</p> : null}
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

      {activeProject ? (
        <ProjectPage
          project={activeProject}
          isBusy={reviewActionKey === 'add-project-asset'}
          onAddAsset={addAssetToActiveProject}
        />
      ) : null}

      <ProjectStrip projects={projects} />

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
      <div className="flex flex-col justify-between gap-3 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">Current review</p>
          <h2 className="mt-2 font-display text-3xl italic text-zinc-50">{review.title || 'Untitled image review'}</h2>
          {review.notes ? <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{review.notes}</p> : null}
        </div>
        <div className="space-y-2 sm:text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
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
        <div className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-sm text-emerald-100/90">
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
                className="group overflow-hidden rounded-md border border-white/[0.08] bg-zinc-950 shadow-[0_18px_60px_rgba(0,0,0,0.24)]"
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
                      <div className="flex items-center justify-between gap-3 text-xs text-zinc-100">
                        <span className="truncate font-medium">{image.label}</span>
                        <span className="rounded-full border border-white/15 bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-200">
                          {status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-400">{image.width}×{image.height} · click to inspect</p>
                    </div>
                  </div>
                </button>
                <figcaption className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-zinc-400">
                  <span className="text-zinc-500">{status}</span>
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
          <div className="w-full max-w-7xl overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Image inspection</p>
                <h3 className="mt-1 text-lg font-medium text-zinc-50">{selectedImage.label}</h3>
              </div>
              <button
                type="button"
                onClick={closeImage}
                className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.08]"
              >
                Close
              </button>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="relative flex max-h-[82vh] min-h-[42vh] items-center justify-center overflow-auto rounded-lg bg-black/60 p-2">
                <img
                  src={selectedImageUrl}
                  alt={`${selectedImage.label} large preview`}
                  onDoubleClick={() => setZoomScale((current) => (current === 1 ? 2 : 1))}
                  style={zoomScale > 1 ? { width: `${selectedImage.width * zoomScale}px` } : undefined}
                  className={zoomScale > 1 ? 'h-auto max-w-none cursor-zoom-out object-contain' : 'max-h-[78vh] w-auto max-w-full cursor-zoom-in object-contain'}
                />
                <div className="absolute bottom-3 right-3 flex flex-wrap justify-end gap-2 rounded-full border border-white/10 bg-black/80 p-1.5 shadow-2xl backdrop-blur">
                  <button
                    type="button"
                    onClick={() => setZoomScale(1)}
                    aria-pressed={zoomScale === 1}
                    className="rounded-full px-3 py-1 text-xs font-medium text-zinc-200 transition hover:bg-white/10 aria-pressed:bg-white/15"
                  >
                    Fit
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomScale(2)}
                    aria-pressed={zoomScale === 2}
                    className="rounded-full px-3 py-1 text-xs font-medium text-zinc-200 transition hover:bg-white/10 aria-pressed:bg-white/15"
                  >
                    2×
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomScale(3)}
                    aria-pressed={zoomScale === 3}
                    className="rounded-full px-3 py-1 text-xs font-medium text-zinc-200 transition hover:bg-white/10 aria-pressed:bg-white/15"
                  >
                    3×
                  </button>
                  <a
                    href={selectedImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full px-3 py-1 text-xs font-medium text-[color:var(--color-accent)] transition hover:bg-white/10"
                  >
                    Open full size
                  </a>
                </div>
              </div>
              <aside className="space-y-4 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                <div className="space-y-1 text-sm text-zinc-400">
                  <p className="text-zinc-100">{selectedImage.width}×{selectedImage.height}</p>
                  <p>Status: {selectedImage.approval_status ?? 'pending'}</p>
                </div>
                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Optional rejection reason</span>
                  <textarea
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.currentTarget.value)}
                    rows={4}
                    className="w-full rounded-md border border-white/10 bg-black/35 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-[color:var(--color-accent-line)]"
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
  isBusy,
  onAddAsset,
}: {
  project: ProjectManifest
  isBusy: boolean
  onAddAsset: (file: File, assetType: ProjectAsset['asset_type'], label: string, notes: string, characterName: string) => void
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

  function submitAsset() {
    if (!assetFile) return
    onAddAsset(assetFile, assetType, assetLabel, assetNotes, characterName)
    setAssetFile(null)
    setAssetLabel('')
    setCharacterName('')
    setAssetNotes('')
  }

  return (
    <section className="space-y-5 rounded-lg border border-white/[0.08] bg-white/[0.025] p-4">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--color-accent)]">Working project page</p>
          <h2 className="mt-1 font-display text-3xl italic text-zinc-50">{project.title}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Approved look, character references, cinematic shot grids, selected frames, then Comfy refinement.
          </p>
          {hero ? (
            <div className="mt-4 overflow-hidden rounded-md border border-white/[0.08] bg-black">
              <img
                src={hero.public_url || projectAssetUrl(project.project_id, hero.asset_path)}
                alt={hero.label}
                className="aspect-video w-full object-contain"
              />
            </div>
          ) : null}
        </div>

        <Card className="border-white/[0.08] bg-black/20">
          <CardHeader className="pb-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">Classify upload</p>
            <CardTitle>Add project asset</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <select
              value={assetType}
              onChange={(event) => setAssetType(event.currentTarget.value as ProjectAsset['asset_type'])}
              className="w-full rounded-sm border border-white/[0.08] bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none"
            >
              <option value="character_sheet">Character sheet — keep intact</option>
              <option value="single_still">Single cinematic still — keep intact</option>
              <option value="cinematic_shot_grid">Cinematic shot grid — eligible to split</option>
              <option value="extracted_shot">Extracted shot frame</option>
              <option value="refined_shot">Comfy refined shot</option>
              <option value="other">Other / hold</option>
            </select>
            <input
              value={assetLabel}
              onChange={(event) => setAssetLabel(event.currentTarget.value)}
              placeholder="Label, e.g. Juan model sheet"
              className="w-full rounded-sm border border-white/[0.08] bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none"
            />
            {assetType === 'character_sheet' ? (
              <input
                value={characterName}
                onChange={(event) => setCharacterName(event.currentTarget.value)}
                placeholder="Character name"
                className="w-full rounded-sm border border-white/[0.08] bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none"
              />
            ) : null}
            <textarea
              value={assetNotes}
              onChange={(event) => setAssetNotes(event.currentTarget.value)}
              rows={3}
              placeholder="Continuity notes / next action"
              className="w-full rounded-sm border border-white/[0.08] bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none"
            />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setAssetFile(event.currentTarget.files?.[0] ?? null)}
              className="w-full text-xs text-zinc-400 file:mr-3 file:rounded-sm file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-xs file:text-zinc-200"
            />
            <Button type="button" onClick={submitAsset} disabled={!assetFile || isBusy} className="w-full">
              {isBusy ? 'Adding asset…' : 'Add to project'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ProjectPanel title="Characters" eyebrow="Named cards above" empty="Upload character sheets here; they stay intact.">
          {project.characters.map((character) => {
            const sheet = project.assets.find((asset) => asset.asset_id === character.sheet_asset_id)
            return sheet ? (
              <a
                key={character.character_id}
                href={projectAssetUrl(project.project_id, sheet.asset_path)}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-md border border-white/[0.08] bg-black/30 transition hover:border-[color:var(--color-accent-line)]"
              >
                <img src={projectAssetUrl(project.project_id, sheet.asset_path)} alt={character.name} className="aspect-video w-full object-cover object-top" />
                <span className="block p-3 text-sm font-medium text-zinc-100">{character.name}</span>
              </a>
            ) : null
          })}
          {sheets.length > project.characters.length ? <p className="text-xs text-zinc-500">{sheets.length - project.characters.length} sheet asset(s) waiting for names.</p> : null}
        </ProjectPanel>

        <ProjectPanel title="Cinematic shot grids" eyebrow="Sequential blocks" empty="Upload 3×3 grids here before splitting.">
          {shotGrids.map((asset, index) => (
            <div key={asset.asset_id} className="rounded-md border border-white/[0.08] bg-black/30 p-2">
              <img src={projectAssetUrl(project.project_id, asset.asset_path)} alt={asset.label} className="aspect-video w-full rounded-sm object-cover" />
              <p className="mt-2 text-xs text-zinc-300">Block {index + 1}: {asset.label}</p>
              <p className="mt-1 text-[11px] text-zinc-600">Pending split + selection</p>
            </div>
          ))}
        </ProjectPanel>

        <ProjectPanel title="Shot sequence + Comfy" eyebrow="Next pass" empty="Selected frames and 1920×1080 refined stills will land here.">
          {selectedShots.map((asset, index) => (
            <div key={asset.asset_id} className="rounded-md border border-white/[0.08] bg-black/30 p-2">
              <img src={projectAssetUrl(project.project_id, asset.asset_path)} alt={asset.label} className="aspect-video w-full rounded-sm object-cover" />
              <p className="mt-2 text-xs text-zinc-300">#{index + 1} {asset.label}</p>
            </div>
          ))}
        </ProjectPanel>
      </div>
    </section>
  )
}

function ProjectPanel({ title, eyebrow, empty, children }: { title: string; eyebrow: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : Boolean(children)
  return (
    <section className="space-y-3 rounded-md border border-white/[0.08] bg-black/20 p-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">{eyebrow}</p>
        <h3 className="mt-1 text-lg font-medium text-zinc-50">{title}</h3>
      </div>
      {hasChildren ? children : <p className="rounded-sm border border-dashed border-white/[0.08] p-3 text-sm text-zinc-500">{empty}</p>}
    </section>
  )
}

function ProjectStrip({ projects }: { projects: ProjectSummary[] }) {
  if (projects.length === 0) return null
  return (
    <section className="space-y-3 border-t border-white/[0.06] pt-5">
      <div>
        <h2 className="font-display text-2xl italic text-zinc-50">Project pages</h2>
        <p className="mt-1 text-sm text-zinc-500">Approved looks that have moved into the trailer-building pipeline.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <div key={project.project_id} className="overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.02]">
            {project.hero_asset_path ? (
              <img src={project.hero_public_url || projectAssetUrl(project.project_id, project.hero_asset_path)} alt={project.title} className="aspect-video w-full object-cover" />
            ) : null}
            <div className="p-3">
              <p className="truncate text-sm font-medium text-zinc-100">{project.title}</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                {project.asset_count} asset{project.asset_count === 1 ? '' : 's'} · {project.character_count} character{project.character_count === 1 ? '' : 's'}
              </p>
            </div>
          </div>
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
          <h2 className="mt-1 font-display text-2xl italic text-zinc-50">Pending review queue</h2>
          <p className="mt-1 text-sm text-zinc-400">Click a thumbnail once to open the full image inspector, then approve or deny.</p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">{pendingReviews.length} pending set{pendingReviews.length === 1 ? '' : 's'}</p>
      </div>

      {pendingReviews.length === 0 ? (
        <p className="rounded-sm border border-white/[0.08] bg-black/20 p-3 text-sm text-zinc-500">No pending image reviews right now.</p>
      ) : (
        <div className="grid gap-2">
          {pendingReviews.map((review) => (
            <button
              key={review.review_id}
              type="button"
              onClick={() => onOpenReview(review.review_id)}
              className="group grid w-full grid-cols-[88px_1fr] items-stretch overflow-hidden rounded-md border border-white/[0.08] bg-black/25 text-left transition hover:border-[color:var(--color-accent-line)] hover:bg-white/[0.04] sm:grid-cols-[128px_1fr_auto]"
            >
              <ReviewCover review={review} className="aspect-video h-full min-h-16 w-full object-cover" />
              <span className="flex min-w-0 flex-col justify-center p-3">
                <span className="truncate text-sm font-medium text-zinc-100">{review.title || 'Untitled image review'}</span>
                {review.notes ? <span className="mt-1 line-clamp-1 text-xs text-zinc-500">{review.notes}</span> : null}
                <span className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                  {(review.pending_count ?? review.image_count)} pending · click thumbnail to inspect
                </span>
              </span>
              <span className="hidden items-center px-4 text-xs font-medium text-[color:var(--color-accent)] sm:flex">
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
    <section className="space-y-3 border-t border-white/[0.06] pt-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl italic text-zinc-50">History log</h2>
          <p className="mt-1 text-sm text-zinc-500">Older reviews and finished/published sets live here.</p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">Newest first</p>
      </div>

      {historyReviews.length === 0 ? (
        <p className="text-sm text-zinc-500">No completed image reviews yet. Approved, rejected, or published sets will appear here after they leave the pending queue.</p>
      ) : (
        <div className="divide-y divide-white/[0.06] overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.02]">
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
                <span className="block truncate text-sm font-medium text-zinc-100">{review.title || 'Untitled image review'}</span>
                {review.notes ? <span className="mt-0.5 block truncate text-xs text-zinc-500">{review.notes}</span> : null}
                <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                  {review.image_count} image{review.image_count === 1 ? '' : 's'} · {review.pending_count ?? 0} pending · {review.published_count ?? 0} published
                </span>
              </span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-200">
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
      <span className={`${className} flex items-center justify-center bg-black/40 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-700`}>
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
