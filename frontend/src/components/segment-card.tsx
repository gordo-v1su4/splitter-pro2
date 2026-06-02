import { Download, Film, Image as ImageIconLucide } from 'lucide-react'
import { useState } from 'react'

import { assetUrl, type SegmentRecord } from '../lib/api'
import { cn, formatDuration } from '../lib/utils'
import { VideoTile } from './video-tile'

type MediaTab = 'still' | 'clip'

export function SegmentCard({ jobId, segment }: { jobId: string; segment: SegmentRecord }) {
  const clipSrc = assetUrl(jobId, segment.clip_path)
  const imageSrc = assetUrl(jobId, segment.thumbnail_path)
  const [tab, setTab] = useState<MediaTab>('still')

  const softOverlay = (
    <>
      <span className="pointer-events-none absolute left-2 top-2 bg-black/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-[#555]/95">
        #{segment.index}
      </span>
      <span className="pointer-events-none absolute bottom-2 right-2 font-mono text-[9px] tabular-nums text-[#555]/90">
        {formatDuration(segment.duration_seconds)}
      </span>
    </>
  )

  return (
    <article
      className="group flex flex-col border border-white/[0.04] bg-[#080808] transition-colors
        duration-200 hover:border-[#181818]"
    >
      <div className="relative">
        {tab === 'still' ? (
          <div className="relative aspect-video w-full overflow-hidden bg-zinc-950/80">
            <img
              src={imageSrc}
              alt={`Segment ${segment.index} keyframe`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/15 to-transparent" />
            {softOverlay}
          </div>
        ) : (
          <VideoTile
            src={clipSrc}
            poster={imageSrc}
            playStyle="subtle"
            ariaLabel={`Play segment ${segment.index} clip`}
            overlay={softOverlay}
          />
        )}

        <div
          className="absolute right-1.5 top-1.5 z-10 flex rounded border border-[#181818] bg-black/45 p-px backdrop-blur-sm"
          role="group"
          aria-label="View keyframe or clip"
        >
          <button
            type="button"
            aria-pressed={tab === 'still'}
            title="Keyframe"
            onClick={() => setTab('still')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-[1px] transition-colors',
              tab === 'still' ? 'bg-white/[0.09] text-[#c0c0c0]/90' : 'text-[#555]/80 hover:text-[#777]/90',
            )}
          >
            <ImageIconLucide className="h-3 w-3" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-pressed={tab === 'clip'}
            title="Clip"
            onClick={() => setTab('clip')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-[1px] transition-colors',
              tab === 'clip' ? 'bg-white/[0.09] text-[#c0c0c0]/90' : 'text-[#555]/80 hover:text-[#777]/90',
            )}
          >
            <Film className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2 px-2.5 py-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="break-all font-mono text-[10px] leading-snug text-[#555]/95">{segment.label}</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#343434]">
            {segment.frame_count} fr · idx {segment.index}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={imageSrc}
            download
            title="Download keyframe"
            className="flex h-6 w-6 items-center justify-center text-[#555]/80 transition-colors hover:text-[#aaa]/90"
          >
            <ImageIconLucide className="h-3.5 w-3.5" strokeWidth={1.5} />
          </a>
          <a
            href={clipSrc}
            download
            title="Download clip"
            className="flex h-6 w-6 items-center justify-center text-[#555]/80 transition-colors hover:text-[#aaa]/90"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
          </a>
        </div>
      </div>
    </article>
  )
}
