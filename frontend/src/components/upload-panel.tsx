import { LoaderCircle, RefreshCcw, Upload } from 'lucide-react'
import { useId, useState } from 'react'

import { assetUrl, type JobState } from '../lib/api'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { VideoTile } from './video-tile'

export function UploadPanel({
  isUploading,
  onUpload,
  job,
  onReset,
}: {
  isUploading: boolean
  onUpload: (file: File) => Promise<void>
  job: JobState | null
  onReset: () => void
}) {
  const inputId = useId()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  async function submit() {
    if (!selectedFile) {
      return
    }
    await onUpload(selectedFile)
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) {
      setSelectedFile(file)
    }
  }

  if (job) {
    return <ActiveSourceCard job={job} onReset={onReset} />
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
            <span className="h-px w-6 bg-zinc-700" />
            <span>Source</span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-600">
            mp4 · mov · webm · mkv
          </span>
        </div>

        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={[
            'group relative flex cursor-pointer flex-col items-center justify-center',
            'border border-dashed border-white/[0.08] bg-white/[0.012]',
            'px-6 py-10 text-center transition-colors',
            'hover:border-[color:var(--color-accent-line)] hover:bg-[color:var(--color-accent-soft)]',
            isDragging ? 'border-[color:var(--color-accent-line)] bg-[color:var(--color-accent-soft)]' : '',
          ].join(' ')}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-white/[0.1] bg-white/[0.02] text-zinc-300 transition-colors group-hover:border-[color:var(--color-accent-line)] group-hover:text-[color:var(--color-accent)]">
            <Upload className="h-4 w-4" />
          </div>
          <div className="mt-4 max-w-md space-y-2">
            <p className="break-all font-display text-lg italic text-zinc-50">
              {selectedFile ? selectedFile.name : 'Choose an MP4, MOV, or other local video file'}
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">
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
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <div className="flex items-center justify-between gap-4 border-t border-white/[0.06] pt-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">
            {selectedFile ? (
              <span>
                <span className="text-zinc-700">/</span> queued
                <span className="mx-2 text-zinc-700">·</span>
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </span>
            ) : (
              <span className="text-zinc-600">No file selected yet</span>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={!selectedFile || isUploading}
            className="w-full shrink-0 sm:w-auto"
          >
            {isUploading ? (
              <>
                <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" />
                <span>Uploading…</span>
              </>
            ) : (
              <>
                <span>Process video</span>
                <span className="font-mono text-[9px] tracking-[0.2em] opacity-90">↗</span>
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ActiveSourceCard({ job, onReset }: { job: JobState; onReset: () => void }) {
  const sourceVideoSrc = assetUrl(job.job_id, `source/${job.source_video}`)

  return (
    <Card>
      <CardContent className="space-y-3 pb-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
            <span className="h-px w-6 bg-zinc-700" />
            <span>Source · original</span>
          </div>
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500 transition-colors hover:text-zinc-200"
          >
            <RefreshCcw className="h-3 w-3" />
            New pass
          </button>
        </div>

        <VideoTile
          src={sourceVideoSrc}
          playStyle="subtle"
          ariaLabel="Play source video"
          overlay={
            <span className="pointer-events-none absolute left-3 top-3 bg-black/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-200">
              Original
            </span>
          }
        />

        <div className="flex items-baseline justify-between gap-3 pt-1 font-mono text-[11px] text-zinc-500">
          <p className="min-w-0 truncate text-zinc-300">{job.source_video}</p>
          <p className="shrink-0 text-[10px] uppercase tracking-[0.22em] text-zinc-600">
            job <span className="ml-1 text-zinc-400">{job.job_id.slice(0, 8)}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
