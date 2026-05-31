import { useEffect, useState } from 'react'

import {
  createReview,
  listReviews,
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
      setReviews((current) => [
        {
          review_id: review.review_id,
          title: review.title,
          notes: review.notes,
          image_count: review.image_count,
          created_at: review.created_at,
          updated_at: review.updated_at,
          cover_asset_path: review.images[0]?.asset_path ?? null,
        },
        ...current.filter((item) => item.review_id !== review.review_id),
      ])
      setTitle('')
      setNotes('')
      setFiles([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to publish review.')
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <section className="mt-8 grid gap-6 lg:grid-cols-[360px_1fr]">
      <Card className="border-white/[0.08] bg-white/[0.025]">
        <CardHeader>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">Publish</p>
          <CardTitle>Review board</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Review title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              className="w-full rounded-sm border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[color:var(--color-accent-line)]"
              placeholder="Smoke pass, Act 1 options, etc."
            />
          </label>

          <label className="block space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.currentTarget.value)}
              className="min-h-20 w-full rounded-sm border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[color:var(--color-accent-line)]"
              placeholder="What should we judge? Composition, character consistency, best keyframe..."
            />
          </label>

          <label className="block space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
              Choose review images
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))}
              className="w-full text-xs text-zinc-400 file:mr-3 file:rounded-sm file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-xs file:text-zinc-200"
            />
          </label>

          {files.length > 0 ? (
            <p className="font-mono text-[11px] text-zinc-500">{files.length} image(s) staged for review.</p>
          ) : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}

          <Button type="button" onClick={publishReview} disabled={isPublishing || files.length === 0} className="w-full">
            {isPublishing ? 'Publishing…' : 'Publish review'}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {activeReview ? <ReviewGallery review={activeReview} /> : <ReviewEmptyState reviews={reviews} />}
      </div>
    </section>
  )
}

function ReviewGallery({ review }: { review: ReviewManifest }) {
  return (
    <article className="space-y-4">
      <div className="border-b border-white/[0.06] pb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">Review ready</p>
        <h2 className="mt-2 font-display text-3xl italic text-zinc-50">{review.title}</h2>
        {review.notes ? <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{review.notes}</p> : null}
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
          {review.image_count} images · /api/reviews/{review.review_id}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {review.images.map((image) => (
          <figure key={image.asset_path} className="overflow-hidden rounded-sm border border-white/[0.08] bg-white/[0.025]">
            <img
              src={reviewAssetUrl(review.review_id, image.asset_path)}
              alt={image.label}
              className="aspect-video w-full bg-black object-contain"
            />
            <figcaption className="flex items-center justify-between gap-3 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              <span className="truncate">{image.label}</span>
              <span>{image.width}×{image.height}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </article>
  )
}

function ReviewEmptyState({ reviews }: { reviews: ReviewSummary[] }) {
  return (
    <div className="space-y-4 border border-dashed border-white/[0.08] p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">Local image reviews</p>
      <h2 className="font-display text-3xl italic text-zinc-50">Post frames, compare fast.</h2>
      <p className="max-w-xl text-sm leading-6 text-zinc-400">
        Publish generated frames, contact-sheet tiles, or keyframes into a shareable local review page.
        Each review gets a stable API URL plus direct image URLs for lightweight browser review.
      </p>
      {reviews.length > 0 ? (
        <div className="grid gap-2 pt-2">
          {reviews.slice(0, 5).map((review) => (
            <div key={review.review_id} className="flex items-center justify-between border-t border-white/[0.06] py-2">
              <span className="text-sm text-zinc-300">{review.title}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                {review.image_count} images
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
