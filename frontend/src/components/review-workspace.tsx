import { useEffect, useState } from 'react'

import {
  approveReviewImage,
  createReview,
  fetchReview,
  listReviews,
  publishApprovedReviewImages,
  rejectReviewImage,
  reviewAssetUrl,
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
  const [activeReview, setActiveReview] = useState<ReviewManifest | null>(null)
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
          setReviews(nextReviews)
        }
      })
      .catch(() => {
        if (isMounted) {
          setReviews([])
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
      setReviews((current) => upsertReviewSummary(current, review))
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
      setReviews((current) => upsertReviewSummary(current, review))
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
  autoInspectToken,
}: {
  review: ReviewManifest
  actionKey: string | null
  autoInspectToken: string | null
  onApprove: (reviewId: string, imageIndex: number) => void
  onReject: (reviewId: string, imageIndex: number, reason?: string) => void
  onPublishApproved: (reviewId: string) => void
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const approvedCount = review.images.filter((image) => image.approval_status === 'approved').length
  const selectedImage = review.images.find((image) => image.index === selectedIndex) ?? null

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
    const image = review.images.find((candidate) => candidate.index === imageIndex)
    setRejectReason(image?.rejection_reason ?? '')
  }

  function closeImage() {
    setSelectedIndex(null)
    setRejectReason('')
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
          <Button
            type="button"
            onClick={() => onPublishApproved(review.review_id)}
            disabled={approvedCount === 0 || actionKey === 'publish-approved'}
            className="w-full sm:w-auto"
          >
            {actionKey === 'publish-approved' ? 'Publishing approved…' : `Publish approved (${approvedCount})`}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {review.images.map((image) => {
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
                <span className={status === 'published' ? 'text-emerald-300' : status === 'rejected' ? 'text-red-300' : status === 'approved' ? 'text-[color:var(--color-accent)]' : 'text-zinc-500'}>
                  {status}
                </span>
                <Button type="button" variant="secondary" size="sm" onClick={() => openImage(image.index)}>
                  Inspect
                </Button>
              </figcaption>
              {image.rejection_reason ? <p className="px-3 pb-3 text-xs leading-5 text-red-200/80">{image.rejection_reason}</p> : null}
            </figure>
          )
        })}
      </div>

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
            <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
              <div className="flex min-h-[42vh] items-center justify-center rounded-lg bg-black/60 p-2">
                <img
                  src={selectedImage.public_url || reviewAssetUrl(review.review_id, selectedImage.asset_path)}
                  alt={`${selectedImage.label} large preview`}
                  className="max-h-[78vh] w-auto max-w-full object-contain"
                />
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
                    onClick={() => onApprove(review.review_id, selectedImage.index)}
                    disabled={selectedImage.approval_status === 'published' || actionKey === `approve-${selectedImage.index}`}
                    className="w-full"
                  >
                    {actionKey === `approve-${selectedImage.index}` ? 'Approving…' : 'Approve image'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => onReject(review.review_id, selectedImage.index, rejectReason)}
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

function PendingReviewQueue({
  reviews,
  loadingReviewId,
  onOpenReview,
}: {
  reviews: ReviewSummary[]
  loadingReviewId: string | null
  onOpenReview: (reviewId: string) => void
}) {
  const pendingReviews = reviews.filter((review) => (review.pending_count ?? review.image_count) > 0)

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
  return (
    <section className="space-y-3 border-t border-white/[0.06] pt-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl italic text-zinc-50">History log</h2>
          <p className="mt-1 text-sm text-zinc-500">Older reviews and finished/published sets live here.</p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">Newest first</p>
      </div>

      {reviews.length === 0 ? (
        <p className="text-sm text-zinc-500">No image reviews published yet.</p>
      ) : (
        <div className="divide-y divide-white/[0.06] overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.02]">
          {reviews.map((review) => (
            <button
              key={review.review_id}
              type="button"
              onClick={() => onOpenReview(review.review_id)}
              aria-label={`View ${review.title || 'Untitled image review'}`}
              className="grid w-full grid-cols-[72px_1fr_auto] items-center gap-3 p-2 text-left transition hover:bg-white/[0.04]"
            >
              <ReviewCover review={review} className="aspect-video w-full rounded-sm object-cover" />
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
