import { Check, Download, Film, Image as ImageIconLucide } from 'lucide-react'
import { useState } from 'react'

import { assetUrl, segmentKeyframeUrl, type SegmentRecord } from '../lib/api'
import { cn, formatDuration } from '../lib/utils'
import { VideoTile } from './video-tile'

type MediaTab = 'still' | 'clip'

export function SegmentCard({
  jobId,
  segment,
  selected,
  onToggleSelected,
}: {
  jobId: string
  segment: SegmentRecord
  selected: boolean
  onToggleSelected: () => void
}) {
  const clipSrc = assetUrl(jobId, segment.clip_path)
  const imageSrc = assetUrl(jobId, segment.thumbnail_path)
  const [tab, setTab] = useState<MediaTab>('still')
  const [clipTimeSeconds, setClipTimeSeconds] = useState(0)
  const keyframeDownloadUrl = tab === 'clip'
    ? segmentKeyframeUrl(jobId, segment.index, clipTimeSeconds)
    : imageSrc

  const softOverlay = (
    <>
      <span className="pointer-events-none absolute bottom-2 right-2 font-mono text-[9px] tabular-nums text-[#555]/90">
        {formatDuration(segment.duration_seconds)}
      </span>
    </>
  )

  return (
    <article
      className={cn(
        'group flex flex-col border bg-[#080808] transition-[border-color,box-shadow] duration-200',
        selected
          ? 'border-[color:var(--color-accent-line)] shadow-[inset_0_0_0_1px_rgba(115,173,104,0.12)]'
          : 'border-white/[0.04] hover:border-[#242424]',
      )}
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
            onCurrentTimeChange={setClipTimeSeconds}
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

        <span className={cn('absolute left-2 top-2 z-10 font-mono text-[8px] tracking-[0.16em] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]', selected ? 'text-[color:var(--color-accent)]' : 'text-white/45')}>
          {String(segment.index).padStart(3, '0')}
        </span>
      </div>

      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`${selected ? 'Remove' : 'Select'} clip ${segment.index} for sheet`}
          title={`${selected ? 'Remove from' : 'Add to'} selected sheet`}
          onClick={onToggleSelected}
          className="group/selection grid h-6 w-6 shrink-0 place-items-center"
        >
          <span
            className={cn(
              'grid h-3.5 w-3.5 place-items-center border transition-colors',
              selected
                ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent)]'
                : 'border-[#3a3a3a] text-transparent group-hover/selection:border-[#777]',
            )}
          >
            {selected ? <Check className="h-2.5 w-2.5" strokeWidth={2} /> : null}
          </span>
        </button>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="break-all font-mono text-[10px] leading-snug text-[#555]/95">{segment.label}</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#343434]">
            {segment.frame_count} fr · idx {segment.index}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={keyframeDownloadUrl}
            download
            title={tab === 'clip' ? `Save current frame at ${clipTimeSeconds.toFixed(2)} seconds` : 'Download keyframe'}
            aria-label={tab === 'clip' ? `Save current frame from clip ${segment.index}` : `Download keyframe for clip ${segment.index}`}
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
