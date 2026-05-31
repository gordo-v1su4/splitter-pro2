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

  async function openReview(reviewId: string) {
    setLoadingReviewId(reviewId)
    setError(null)
    try {
      setActiveReview(await fetchReview(reviewId))
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

  function rejectImage(reviewId: string, imageIndex: number) {
    void runReviewAction(
      `reject-${imageIndex}`,
      () => rejectReviewImage(reviewId, imageIndex),
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

      {activeReview ? (
        <ReviewGallery
          review={activeReview}
          actionKey={reviewActionKey}
          onApprove={approveImage}
          onReject={rejectImage}
          onPublishApproved={publishApproved}
        />
      ) : (
        <ReviewPrimer />
      )}

      <ReviewHistory reviews={reviews} loadingReviewId={loadingReviewId} onOpenReview={openReview} />
    </section>
  )
}

function upsertReviewSummary(current: ReviewSummary[], review: ReviewManifest): ReviewSummary[] {
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
    },
    ...current.filter((item) => item.review_id !== review.review_id),
  ]
}

function ReviewGallery({
  review,
  actionKey,
  onApprove,
  onReject,
  onPublishApproved,
}: {
  review: ReviewManifest
  actionKey: string | null
  onApprove: (reviewId: string, imageIndex: number) => void
  onReject: (reviewId: string, imageIndex: number) => void
  onPublishApproved: (reviewId: string) => void
}) {
  const approvedCount = review.images.filter((image) => image.approval_status === 'approved').length

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
            {review.image_count} review frames · /api/reviews/{review.review_id}
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {review.images.map((image) => {
          const status = image.approval_status ?? 'pending'
          return (
            <figure key={image.asset_path} className="overflow-hidden rounded-sm border border-white/[0.08] bg-white/[0.025]">
              <img
                src={image.public_url || reviewAssetUrl(review.review_id, image.asset_path)}
                alt={image.label}
                className="aspect-video w-full bg-black object-contain"
              />
              <figcaption className="space-y-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate">{image.label}</span>
                  <span>{image.width}×{image.height}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={status === 'published' ? 'text-emerald-300' : status === 'rejected' ? 'text-red-300' : status === 'approved' ? 'text-[color:var(--color-accent)]' : 'text-zinc-500'}>
                    {status}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onApprove(review.review_id, image.index)}
                      disabled={status === 'published' || actionKey === `approve-${image.index}`}
                      className="text-[color:var(--color-accent)] disabled:text-zinc-700"
                    >
                      {actionKey === `approve-${image.index}` ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onReject(review.review_id, image.index)}
                      disabled={status === 'published' || actionKey === `reject-${image.index}`}
                      className="text-red-300 disabled:text-zinc-700"
                    >
                      {actionKey === `reject-${image.index}` ? 'Rejecting…' : 'Reject'}
                    </button>
                  </div>
                </div>
              </figcaption>
            </figure>
          )
        })}
      </div>
    </article>
  )
}

function ReviewPrimer() {
  return (
    <div className="border border-dashed border-white/[0.08] p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">Review mode</p>
      <h2 className="mt-2 font-display text-2xl italic text-zinc-50">Publish frames. Record the reason.</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
        Use this as the quick image-good board for generated frames, contact sheets, keyframes, and visual-storyline candidates.
      </p>
    </div>
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
        <h2 className="font-display text-2xl italic text-zinc-50">History</h2>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">Newest first</p>
      </div>

      {reviews.length === 0 ? (
        <p className="text-sm text-zinc-500">No image reviews published yet.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {reviews.map((review) => (
            <article key={review.review_id} className="grid grid-cols-[96px_1fr] overflow-hidden rounded-sm border border-white/[0.08] bg-white/[0.025]">
              <div className="bg-black/40">
                {review.cover_asset_path ? (
                  <img
                    src={review.cover_public_url || reviewAssetUrl(review.review_id, review.cover_asset_path)}
                    alt={`${review.title} cover`}
                    className="h-full min-h-24 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full min-h-24 items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-700">
                    No image
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-col justify-between gap-3 p-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium text-zinc-100">{review.title || 'Untitled image review'}</h3>
                  {review.notes ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{review.notes}</p> : null}
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">{review.image_count} images</p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenReview(review.review_id)}
                  className="self-start font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-accent)] hover:text-zinc-100"
                >
                  {loadingReviewId === review.review_id ? 'Loading…' : 'Open'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
