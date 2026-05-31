import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Film } from 'lucide-react'

import { ImageSplitWorkspace } from './components/image-split-workspace'
import { JobStatusPanel } from './components/job-status-panel'
import { ReviewWorkspace } from './components/review-workspace'
import { SegmentCard } from './components/segment-card'
import { UploadPanel } from './components/upload-panel'
import { assetUrl, fetchJob, fetchJobResult, type JobManifest, type JobState, submitVideo } from './lib/api'
import { formatDuration } from './lib/utils'

type WorkspaceTab = 'video' | 'image' | 'review'

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceTab>('video')
  const [job, setJob] = useState<JobState | null>(null)
  const [manifest, setManifest] = useState<JobManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const pollFailureCountRef = useRef(0)

  async function loadManifest(jobId: string, attempt = 0) {
    try {
      const nextManifest = await fetchJobResult(jobId)
      startTransition(() => {
        setManifest(nextManifest)
      })
      pollFailureCountRef.current = 0
      setError(null)
    } catch (cause) {
      if (attempt < 2) {
        window.setTimeout(() => {
          void loadManifest(jobId, attempt + 1)
        }, 350)
        return
      }
      setError(cause instanceof Error ? cause.message : 'Unable to load storyboard results.')
    }
  }

  const pollJob = useEffectEvent(async (jobId: string) => {
    try {
      const nextJob = await fetchJob(jobId)
      pollFailureCountRef.current = 0
      startTransition(() => {
        setJob(nextJob)
      })
      if (nextJob.status === 'completed') {
        setError(null)
        await loadManifest(jobId)
      }
      if (nextJob.status === 'failed' && nextJob.error) {
        setError(nextJob.error)
      }
    } catch (cause) {
      pollFailureCountRef.current += 1
      if (pollFailureCountRef.current >= 3) {
        setError(cause instanceof Error ? cause.message : 'Unable to refresh job state.')
      }
    }
  })

  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') {
      return undefined
    }

    void pollJob(job.job_id)
    const intervalId = window.setInterval(() => {
      void pollJob(job.job_id)
    }, 1500)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [job])

  async function handleUpload(file: File) {
    setIsUploading(true)
    setError(null)
    setManifest(null)
    pollFailureCountRef.current = 0
    try {
      const createdJob = await submitVideo(file)
      startTransition(() => {
        setJob(createdJob)
      })
      if (createdJob.status === 'completed') {
        await loadManifest(createdJob.job_id)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  function resetJob() {
    setJob(null)
    setManifest(null)
    setError(null)
    setIsUploading(false)
    pollFailureCountRef.current = 0
  }

  const hasActiveWork = job !== null

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0a0b] text-zinc-100">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[360px] opacity-60"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(100, 115, 90, 0.06), transparent 60%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '120px 120px',
        }}
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-6 lg:px-10">
        <TopNav activeTab={workspace} onSelectTab={setWorkspace} />

        {workspace === 'image' ? (
          <ImageSplitWorkspace />
        ) : workspace === 'review' ? (
          <ReviewWorkspace />
        ) : (
          <>
            {hasActiveWork ? <HeroCompact /> : <HeroFull />}

            <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <UploadPanel
                isUploading={isUploading}
                onUpload={handleUpload}
                job={job}
                onReset={resetJob}
              />
              <JobStatusPanel job={job} error={error} manifest={manifest} />
            </section>

            {manifest ? (
              <section className="mt-8 space-y-5">
                <StoryboardHeader manifest={manifest} onReset={resetJob} />

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {manifest.segments.map((segment) => (
                    <SegmentCard key={segment.index} jobId={manifest.job_id} segment={segment} />
                  ))}
                </div>
              </section>
            ) : !hasActiveWork ? (
              <EmptyStoryboard />
            ) : null}
          </>
        )}

        <Footer />
      </div>
    </main>
  )
}

function TopNav({
  activeTab,
  onSelectTab,
}: {
  activeTab: WorkspaceTab
  onSelectTab: (tab: WorkspaceTab) => void
}) {
  const tabClassName = (tab: WorkspaceTab) =>
    [
      'rounded-sm px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] transition',
      activeTab === tab
        ? 'border border-[color:var(--color-accent-line)] bg-[color:var(--color-accent-soft)] text-zinc-50'
        : 'border border-transparent text-zinc-500 hover:text-zinc-200',
    ].join(' ')

  return (
    <nav className="flex flex-col gap-4 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="relative flex h-7 w-7 items-center justify-center">
          <div className="absolute inset-0 rounded-sm border border-white/[0.12]" />
          <div className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[1px] bg-[color:var(--color-accent)]" />
        </div>
        <div className="flex items-baseline gap-2 leading-none">
          <span className="font-display text-xl italic tracking-tight text-zinc-50">Splitter</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-zinc-500">Pro&nbsp;02</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.24em]">
        <button type="button" className={tabClassName('video')} onClick={() => onSelectTab('video')}>
          Video
        </button>
        <button type="button" className={tabClassName('image')} onClick={() => onSelectTab('image')}>
          Image grids
        </button>
        <button type="button" className={tabClassName('review')} onClick={() => onSelectTab('review')}>
          Reviews
        </button>
        <span className="hidden text-zinc-700 sm:inline">/</span>
        <a className="text-zinc-500 transition-colors hover:text-zinc-200" href="/docs" rel="noreferrer">
          Swagger docs
        </a>
      </div>
    </nav>
  )
}

function HeroFull() {
  return (
    <header className="mt-10 grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-end lg:gap-14">
      <div className="space-y-5">
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">
          <span className="h-px w-8 bg-zinc-700" />
          <span>Scene · Detect · Split</span>
        </div>
        <h1 className="font-display text-5xl leading-[0.95] tracking-[-0.02em] text-zinc-50 sm:text-6xl lg:text-[72px]">
          Every cut,
          <br />
          <em className="italic text-zinc-300">on its own</em>
          <span className="text-[color:var(--color-accent)]">.</span>
        </h1>
        <p className="max-w-xl text-[14px] leading-relaxed text-zinc-400">
          Drop a video. PySceneDetect finds the hard cuts, ffmpeg slices each scene
          frame-accurately, and the first frame of every shot becomes a thumbnail you can
          scrub through. Local-first. Disk-backed. Zero cloud.
        </p>
      </div>

      <aside className="flex flex-col justify-end gap-1 self-end font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">
        <Spec label="Detector" value="PySceneDetect · Adaptive" />
        <Spec label="Splitter" value="ffmpeg · frame accurate" />
        <Spec label="Output" value="Clips · Stills · Sheet" />
        <Spec label="Storage" value="Per-job folder" />
      </aside>
    </header>
  )
}

function HeroCompact() {
  return (
    <header className="mt-5 flex flex-wrap items-baseline justify-between gap-4 border-b border-white/[0.06] pb-4">
      <div className="flex items-baseline gap-4">
        <h1 className="font-display text-2xl italic leading-none tracking-tight text-zinc-50 sm:text-3xl">
          Every cut, <em className="text-zinc-400">on its own</em>
          <span className="text-[color:var(--color-accent)]">.</span>
        </h1>
      </div>
      <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
        <span><span className="text-zinc-700">/</span> PySceneDetect</span>
        <span><span className="text-zinc-700">/</span> ffmpeg</span>
        <span><span className="text-zinc-700">/</span> per-job folder</span>
      </div>
    </header>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-baseline gap-4 border-t border-white/[0.06] py-2">
      <span className="text-zinc-600">{label}</span>
      <span className="text-zinc-300">{value}</span>
    </div>
  )
}

function StoryboardHeader({
  manifest,
  onReset,
}: {
  manifest: JobManifest
  onReset: () => void
}) {
  const exports: Array<{ label: string; href: string }> = []
  if (manifest.keyframes_zip_path) {
    exports.push({
      label: 'Export keyframes ZIP',
      href: assetUrl(manifest.job_id, manifest.keyframes_zip_path),
    })
  }
  if (manifest.segments_zip_path) {
    exports.push({
      label: 'Export segments ZIP',
      href: assetUrl(manifest.job_id, manifest.segments_zip_path),
    })
  }
  if (manifest.contact_sheet_path) {
    exports.push({
      label: 'Contact sheet',
      href: assetUrl(manifest.job_id, manifest.contact_sheet_path),
    })
  }

  return (
    <div className="space-y-3 border-t border-white/[0.04] pt-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">
        <span className="text-zinc-500/90">Storyboard ready</span>
      </p>
      <div className="flex flex-col gap-2 min-[1024px]:flex-row min-[1024px]:items-start min-[1024px]:justify-between min-[1024px]:gap-6">
        <div className="min-w-0 flex-1">
          <h2
            className="block max-w-full truncate whitespace-nowrap font-mono text-sm font-normal text-zinc-400/95 sm:text-[15px]"
            title={manifest.source_video}
          >
            {manifest.source_video}
          </h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
            {manifest.segment_count} seg · {formatDuration(manifest.duration_seconds)} · {manifest.frame_count} fr
          </p>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-x-1 font-mono text-[11px] text-zinc-500/90 min-[1024px]:pt-0.5 min-[1024px]:text-right">
          {exports.map((item, i) => {
            const short =
              item.label === 'Export keyframes ZIP'
                ? 'keyframes.zip'
                : item.label === 'Export segments ZIP'
                  ? 'segments.zip'
                  : 'sheet'
            return (
              <span key={item.label} className="inline-flex items-center">
                {i > 0 ? <span className="px-1 text-zinc-700/80">·</span> : null}
                <a
                  href={item.href}
                  download
                  className="text-zinc-500/90 underline decoration-white/10 decoration-dotted underline-offset-4 transition-colors hover:text-zinc-300 hover:decoration-zinc-500"
                >
                  {short}
                </a>
              </span>
            )
          })}
          {exports.length > 0 ? <span className="px-1 text-zinc-700/80">·</span> : null}
          <button
            type="button"
            onClick={onReset}
            className="text-zinc-500/90 transition-colors hover:text-zinc-300"
          >
            new pass
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyStoryboard() {
  return (
    <section className="mt-8 border-t border-white/[0.06] pt-8">
      <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-2">
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
            <span className="h-px w-6 bg-zinc-700" />
            <span>Workflow</span>
          </div>
          <h2 className="font-display text-2xl italic tracking-tight text-zinc-50 sm:text-3xl">
            Three steps. <em className="text-zinc-500">No more.</em>
          </h2>
        </div>
        <ol className="grid gap-px bg-white/[0.06] sm:grid-cols-3">
          <Step index="01" title="Drop" body="Upload a local video file. Stored in its own job folder." />
          <Step index="02" title="Detect" body="Adaptive scene detection finds every hard cut." />
          <Step index="03" title="Review" body="Scrub clips, grab thumbnails, export ZIPs." />
        </ol>
      </div>
    </section>
  )
}

function Step({ index, title, body }: { index: string; title: string; body: string }) {
  return (
    <li className="space-y-2 bg-[#0a0a0b] p-5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] tracking-[0.2em] text-zinc-600">{index}</span>
        <Film className="h-3.5 w-3.5 text-zinc-700" />
      </div>
      <p className="font-display text-xl italic text-zinc-50">{title}</p>
      <p className="text-[12px] leading-5 text-zinc-500">{body}</p>
    </li>
  )
}

function Footer() {
  return (
    <footer className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/[0.06] py-5 font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-600 sm:flex-row sm:items-center">
      <span>FastAPI · React 19 · ffmpeg · PySceneDetect</span>
      <span className="flex items-center gap-2">
        <span className="h-1 w-1 rounded-full bg-[color:var(--color-accent)]" />
        Local-first · No telemetry
      </span>
    </footer>
  )
}

export default App
