import { Film, ImageIcon } from 'lucide-react'

import { assetUrl, type SegmentRecord } from '../lib/api'
import { formatDuration } from '../lib/utils'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'

export function SegmentCard({ jobId, segment }: { jobId: string; segment: SegmentRecord }) {
  const clipSrc = assetUrl(jobId, segment.clip_path)
  const imageSrc = assetUrl(jobId, segment.thumbnail_path)

  return (
    <Card className="overflow-hidden border-zinc-800 bg-zinc-950/94">
      <div className="relative">
        <img
          className="aspect-video w-full object-cover"
          src={imageSrc}
          alt={`Segment ${segment.index} thumbnail`}
          loading="lazy"
        />
        <div className="absolute left-3 top-3 rounded-md bg-black/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-100">
          Segment {segment.index}
        </div>
      </div>
      <CardContent className="space-y-3 px-4 pb-4 pt-4">
        <div className="space-y-1">
          <p className="font-display text-lg leading-tight tracking-[-0.05em] text-zinc-50">{segment.label}</p>
          <p className="text-xs text-zinc-400">
            {formatDuration(segment.duration_seconds)} · {segment.frame_count} frames
          </p>
        </div>

        <div className="overflow-hidden rounded-md border border-zinc-800 bg-black">
          <video className="aspect-video w-full" src={clipSrc} controls preload="metadata" />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button asChild variant="secondary" className="px-3 py-2 text-sm">
            <a href={clipSrc} download>
              <Film className="h-3.5 w-3.5" />
              Download clip
            </a>
          </Button>
          <Button asChild variant="ghost" className="px-3 py-2 text-sm">
            <a href={imageSrc} download>
              <ImageIcon className="h-3.5 w-3.5" />
              Download still
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
