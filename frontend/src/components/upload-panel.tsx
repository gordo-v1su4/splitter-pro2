import { Hash, LoaderCircle, RefreshCcw, Scissors, Timer, Upload } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { assetUrl, type JobState, type VideoSplitMode, type VideoSplitOptions, type YouTubeClipRange } from '../lib/api'
import { parseClipTimestamp } from '../lib/utils'
import { Card, CardContent } from './ui/card'
import { VideoTile } from './video-tile'

export function UploadPanel({
  isUploading,
  onUpload,
  onYouTube,
  job,
  onReset,
}: {
  isUploading: boolean
  onUpload: (file: File, options: VideoSplitOptions) => Promise<void>
  onYouTube?: (url: string, options: VideoSplitOptions, useCookies: boolean, clip?: YouTubeClipRange) => Promise<void>
  job: JobState | null
  onReset: () => void
}) {
  const inputId = useId()
  const processingRef = useRef(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [splitMode, setSplitMode] = useState<VideoSplitMode>('scenes')
  const [targetCount, setTargetCount] = useState(10)
  const [intervalSeconds, setIntervalSeconds] = useState(5)
  const [sourceType, setSourceType] = useState<'file' | 'youtube'>('file')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [useCookies, setUseCookies] = useState(false)
  const [clipStartSeconds, setClipStartSeconds] = useState('')
  const [clipEndSeconds, setClipEndSeconds] = useState('')
  const [clipError, setClipError] = useState<string | null>(null)

  async function startYouTube(event: React.FormEvent) {
    event.preventDefault()
    if (isUploading || processingRef.current || !onYouTube || !youtubeUrl.trim()) return
    const start = parseClipTimestamp(clipStartSeconds)
    const length = parseClipTimestamp(clipEndSeconds)
    if (clipStartSeconds.trim() && start === null) {
      setClipError('Start uses a clock time such as 25:15.')
      return
    }
    if (clipEndSeconds.trim() && (length === null || length <= 0)) {
      setClipError('Length uses 2:00 or 2m.')
      return
    }
    const end = length == null ? null : (start ?? 0) + length
    setClipError(null)
    processingRef.current = true
    try {
      const clip: YouTubeClipRange | undefined =
        start != null || end != null ? { clipStartSeconds: start, clipEndSeconds: end } : undefined
      await onYouTube(youtubeUrl.trim(), { splitMode, targetCount, intervalSeconds }, useCookies, clip)
    } finally {
      processingRef.current = false
    }
  }

  async function startProcessing(file: File) {
    if (isUploading || processingRef.current) return
    processingRef.current = true
    setSelectedFile(file)
    try {
      await onUpload(file, { splitMode, targetCount, intervalSeconds })
    } finally {
      processingRef.current = false
    }
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) {
      void startProcessing(file)
    }
  }

  if (job) {
    return <ActiveSourceCard job={job} onReset={onReset} />
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.28em] text-[#555]">
            <span className="h-px w-6 bg-zinc-700" />
            <span>Source</span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#343434]">
            mp4 · mov · webm · mkv
          </span>
        </div>

        <SplitModeControl
          splitMode={splitMode}
          targetCount={targetCount}
          intervalSeconds={intervalSeconds}
          disabled={isUploading}
          onModeChange={setSplitMode}
          onTargetCountChange={setTargetCount}
          onIntervalSecondsChange={setIntervalSeconds}
        />

        {onYouTube ? (
          <div className="flex gap-2" aria-label="Video source">
            {(['file', 'youtube'] as const).map((source) => (
              <button key={source} type="button" aria-pressed={sourceType === source} disabled={isUploading}
                onClick={() => setSourceType(source)}
                className={`min-h-10 px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:opacity-50 ${sourceType === source ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-950 text-zinc-400 hover:text-zinc-100'}`}>
                {source === 'file' ? 'Video file' : 'YouTube link'}
              </button>
            ))}
          </div>
        ) : null}

        {sourceType === 'youtube' ? (
          <form onSubmit={(event) => { void startYouTube(event) }} className="space-y-3">
            <label htmlFor={`${inputId}-youtube`} className="block text-sm text-zinc-200">YouTube video URL</label>
            <input id={`${inputId}-youtube`} type="url" required maxLength={2048} value={youtubeUrl} disabled={isUploading}
              onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…"
              className="w-full min-w-0 border border-zinc-700 bg-zinc-950 px-3 py-3 text-base text-zinc-100 placeholder:text-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:opacity-50" />
            <p className="text-sm text-zinc-400">Download one video, then split it. Start is a clock time. Length is how long to keep, such as 25:15 and 2:00.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${inputId}-clip-start`} className="block text-sm text-zinc-200">Clip start</label>
                <input id={`${inputId}-clip-start`} type="text" inputMode="text" disabled={isUploading}
                  value={clipStartSeconds} onChange={(event) => { setClipStartSeconds(event.target.value); setClipError(null) }} placeholder="25:15"
                  className="mt-1 w-full min-w-0 border border-zinc-700 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:opacity-50" />
              </div>
              <div>
                <label htmlFor={`${inputId}-clip-end`} className="block text-sm text-zinc-200">Length</label>
                <input id={`${inputId}-clip-end`} type="text" inputMode="text" disabled={isUploading}
                  value={clipEndSeconds} onChange={(event) => { setClipEndSeconds(event.target.value); setClipError(null) }} placeholder="2:00"
                  className="mt-1 w-full min-w-0 border border-zinc-700 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:opacity-50" />
              </div>
            </div>
            {clipError ? <p className="text-sm text-red-300">{clipError}</p> : null}
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={useCookies} onChange={(event) => setUseCookies(event.target.checked)} disabled={isUploading} className="size-4 accent-zinc-400" />
              Use the server’s private YouTube cookies
            </label>
            <p className="text-sm text-zinc-400">For videos that require sign-in. Cookies must be configured by the operator; your browser session is never uploaded.</p>
            <button type="submit" disabled={isUploading || !youtubeUrl.trim()}
              className="flex min-h-10 items-center gap-2 bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:cursor-not-allowed disabled:opacity-50">
              {isUploading ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {isUploading ? 'Starting import…' : 'Download and split'}
            </button>
          </form>
        ) : <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={[
            'group relative flex cursor-pointer flex-col items-center justify-center',
            'border border-dashed border-[#181818] bg-white/[0.012]',
            'px-6 py-10 text-center transition-colors',
            'hover:border-accent-line hover:bg-accent-soft',
            isDragging ? 'border-accent-line bg-accent-soft' : '',
            isUploading ? 'pointer-events-none opacity-70' : '',
          ].join(' ')}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-white/10 bg-[#090909] text-[#aaa] transition-colors group-hover:border-accent-line group-hover:text-(--color-accent)">
            <Upload className="h-4 w-4" />
          </div>
          <div className="mt-4 max-w-md space-y-2">
            <p className="break-all text-[13px] text-[#e0e0e0]">
              {selectedFile ? selectedFile.name : 'Choose an MP4, MOV, or other local video file'}
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#555]">
              {selectedFile
                ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB · ready`
                : 'Drop a file or click to browse'}
            </p>
          </div>
          <input
            id={inputId}
            className="sr-only"
            type="file"
            accept="video/*"
            disabled={isUploading}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void startProcessing(file)
            }}
          />
        </label>}

        <div className="flex items-center justify-between gap-4 border-t border-[#181818] pt-2">
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#4f4f4f]">
            {isUploading ? <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-(--color-accent)" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#303030]" />}
            <span>
              {sourceType === 'youtube'
                ? isUploading ? 'Starting YouTube import' : 'Download begins when you select Download and split'
                : isUploading
                ? 'Uploading · processing starts automatically'
                : selectedFile
                  ? 'Choose another file to retry'
                  : 'Selection starts processing automatically'}
            </span>
          </div>
          {selectedFile ? <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-[#343434]">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}

const splitModes: Array<{
  value: VideoSplitMode
  label: string
  detail: string
  icon: typeof Scissors
}> = [
  { value: 'scenes', label: 'Scene cuts', detail: 'Content-aware', icon: Scissors },
  { value: 'count', label: 'Equal count', detail: 'Exact total', icon: Hash },
  { value: 'interval', label: 'Time step', detail: 'Fixed seconds', icon: Timer },
]

function SplitModeControl({
  splitMode,
  targetCount,
  intervalSeconds,
  disabled,
  onModeChange,
  onTargetCountChange,
  onIntervalSecondsChange,
}: {
  splitMode: VideoSplitMode
  targetCount: number
  intervalSeconds: number
  disabled: boolean
  onModeChange: (mode: VideoSplitMode) => void
  onTargetCountChange: (count: number) => void
  onIntervalSecondsChange: (seconds: number) => void
}) {
  return (
    <div className="border border-[#181818] bg-[#090909] p-1.5">
      <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Video split mode">
        {splitModes.map((mode) => {
          const Icon = mode.icon
          const selected = splitMode === mode.value
          return (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onModeChange(mode.value)}
              className={[
                'group relative flex min-h-14 items-center gap-2 border px-2.5 py-2 text-left transition-all sm:px-3',
                selected
                  ? 'border-accent-line bg-accent-soft text-[#d5decf]'
                  : 'border-transparent bg-[#0d0d0d] text-[#5d5d5d] hover:border-[#282828] hover:bg-[#111] hover:text-[#aaa]',
                disabled ? 'cursor-not-allowed opacity-60' : '',
              ].join(' ')}
            >
              <span
                className={[
                  'flex h-7 w-7 shrink-0 items-center justify-center border transition-colors',
                  selected ? 'border-accent-line text-(--color-accent)' : 'border-[#232323] text-[#555]',
                ].join(' ')}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-medium leading-tight text-current">{mode.label}</span>
                <span className="mt-1 hidden font-mono text-[8px] uppercase tracking-[0.15em] text-[#494949] sm:block">{mode.detail}</span>
              </span>
              <span className={`absolute inset-x-2 bottom-0 h-px ${selected ? 'bg-(--color-accent)' : 'bg-transparent'}`} />
            </button>
          )
        })}
      </div>

      <div
        className="mt-1 flex h-17 items-center overflow-hidden border-t border-[#171717] px-3 py-2.5"
        data-testid="split-mode-detail"
      >
        {splitMode === 'scenes' ? (
          <div className="flex w-full items-center justify-between gap-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.17em] text-[#555]">
              Adaptive detection finds visual edit points
            </p>
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[#777]">
              <span className="h-1.5 w-1.5 bg-(--color-accent)" /> Auto
            </span>
          </div>
        ) : splitMode === 'count' ? (
          <SplitRange
            label="Images"
            value={targetCount}
            min={2}
            max={60}
            step={1}
            suffix="total"
            description={`${targetCount} equal slices · one midpoint frame from each`}
            disabled={disabled}
            onChange={onTargetCountChange}
          />
        ) : (
          <SplitRange
            label="Spacing"
            value={intervalSeconds}
            min={1}
            max={60}
            step={1}
            suffix="sec"
            description={`One slice and image every ${intervalSeconds} seconds`}
            disabled={disabled}
            onChange={onIntervalSecondsChange}
          />
        )}
      </div>
    </div>
  )
}

function SplitRange({
  label,
  value,
  min,
  max,
  step,
  suffix,
  description,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  description: string
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="grid w-full grid-cols-[auto_minmax(90px,1fr)_auto] items-center gap-x-3 gap-y-1">
      <label className="font-mono text-[9px] uppercase tracking-[0.17em] text-[#666]" htmlFor={`split-range-${label}`}>
        {label}
      </label>
      <input
        id={`split-range-${label}`}
        className="splitter-range w-full accent-(--color-accent)"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="min-w-14 border border-[#252525] bg-[#0c0c0c] px-2 py-1 text-right font-mono text-[10px] text-[#bbb] tabular-nums">
        {value} <span className="text-[8px] uppercase text-[#555]">{suffix}</span>
      </output>
      <p className="col-span-3 font-mono text-[8px] uppercase tracking-[0.13em] text-[#3f3f3f] sm:col-start-2 sm:col-span-2">
        {description}
      </p>
    </div>
  )
}

function ActiveSourceCard({ job, onReset }: { job: JobState; onReset: () => void }) {
  const sourceVideoSrc = assetUrl(job.job_id, `source/${job.source_video}`)
  const modeLabel = job.split_mode === 'count'
    ? `${job.target_count} equal`
    : job.split_mode === 'interval'
      ? `${job.interval_seconds}s step`
      : 'scene cuts'

  return (
    <Card>
      <CardContent className="space-y-3 pb-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.28em] text-[#555]">
            <span className="h-px w-6 bg-zinc-700" />
            <span>Source · original</span>
          </div>
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[#555] transition-colors hover:text-[#c0c0c0]"
          >
            <RefreshCcw className="h-3 w-3" />
            New pass
          </button>
        </div>

        {job.source_ready === false ? (
          <div role="status" className="flex min-h-40 items-center justify-center gap-3 bg-zinc-950 p-5 text-sm text-zinc-300">
            {job.status !== 'failed' ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {job.status === 'failed' ? 'Video download did not finish. Start a new pass to try again.' : 'Downloading from YouTube. Preview appears when the video is ready.'}
          </div>
        ) : <VideoTile
          src={sourceVideoSrc}
          playStyle="subtle"
          ariaLabel="Play source video"
          overlay={
            <span className="pointer-events-none absolute left-3 top-3 bg-black/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-[#c0c0c0]">
              Original
            </span>
          }
        />}

        <div className="flex items-baseline justify-between gap-3 pt-1 font-mono text-[11px] text-[#555]">
          <p className="min-w-0 truncate text-[#aaa]">{job.source_video}</p>
          <p className="shrink-0 text-[10px] uppercase tracking-[0.22em] text-[#343434]">
            <span className="mr-3 text-[#666]">{modeLabel}</span>
            job <span className="ml-1 text-[#777]">{job.job_id.slice(0, 8)}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
