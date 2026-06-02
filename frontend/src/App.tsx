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
      setError(cause instanceof Error ? cause.message : 'Unable to load shot-sequence results.')
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
    <main className="relative h-screen overflow-hidden bg-[#070707] text-[#c0c0c0]" style={{ fontFamily: "'Inter','SF Pro Display',system-ui,sans-serif" }}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[360px] opacity-50"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(100, 115, 90, 0.06), transparent 60%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '120px 120px',
        }}
      />

      <div className="relative flex h-screen w-full overflow-hidden">
        <StudioSidebar activeTab={workspace} onSelectTab={setWorkspace} />
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspaceHeader activeTab={workspace} job={job} manifest={manifest} reviewsHref="/docs" />
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#080808] p-4">
            {workspace === 'image' ? (
              <ImageSplitWorkspace />
            ) : workspace === 'review' ? (
              <ReviewWorkspace />
            ) : (
              <div className="mx-auto w-full max-w-[1680px]">
                {hasActiveWork ? <HeroCompact /> : <HeroFull />}

                <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
                  <UploadPanel
                    isUploading={isUploading}
                    onUpload={handleUpload}
                    job={job}
                    onReset={resetJob}
                  />
                  <JobStatusPanel job={job} error={error} manifest={manifest} />
                </section>

                {manifest ? (
                  <section className="mt-5 space-y-4">
                    <ShotSequenceHeader manifest={manifest} onReset={resetJob} />

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                      {manifest.segments.map((segment) => (
                        <SegmentCard key={segment.index} jobId={manifest.job_id} segment={segment} />
                      ))}
                    </div>
                  </section>
                ) : !hasActiveWork ? (
                  <EmptyShotSequence />
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function StudioSidebar({
  activeTab,
  onSelectTab,
}: {
  activeTab: WorkspaceTab
  onSelectTab: (tab: WorkspaceTab) => void
}) {
  const modules: Array<{ tab: WorkspaceTab; label: string; sub: string }> = [
    { tab: 'video', label: 'Video process', sub: 'detect · frames · sheet' },
    { tab: 'image', label: 'Split grids', sub: 'image grids · crops' },
    { tab: 'review', label: 'Reviews', sub: 'approve · route · project' },
  ]

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-[#181818] bg-[#0c0c0c]">
      <div className="flex items-center gap-2 border-b border-[#181818] px-3 py-[10px]">
        <div className="grid shrink-0 grid-cols-2 gap-[2px]">
          <div className="h-[7px] w-[7px] bg-[#3a8a3a]" />
          <div className="h-[7px] w-[7px] bg-[#2a2a2a]" />
          <div className="h-[7px] w-[7px] bg-[#2a2a2a]" />
          <div className="h-[7px] w-[7px] bg-[#3a8a3a]" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold tracking-wide text-[#e0e0e0]">Splitter Studio</div>
          <div className="text-[9px] uppercase tracking-[0.22em] text-[#3a3a3a]">Pro 02</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <div className="mb-1 px-3 pt-1 text-[9px] uppercase tracking-[0.22em] text-[#343434]">Module Selection</div>
        {modules.map((module) => {
          const isActive = activeTab === module.tab
          return (
            <button
              key={module.tab}
              type="button"
              onClick={() => onSelectTab(module.tab)}
              className={`flex w-full items-center text-left transition-colors ${isActive ? 'bg-[#131313] text-[#e0e0e0]' : 'text-[#585858] hover:bg-[#101010] hover:text-[#9a9a9a]'}`}
            >
              <div className="mr-3 w-[2px] self-stretch" style={{ background: isActive ? '#3a8a3a' : 'transparent', minHeight: 38 }} />
              <div className="py-[7px]">
                <div className="text-[12px] font-medium leading-tight">{module.label}</div>
                <div className="text-[10px] text-[#3a3a3a]">{module.sub}</div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="border-t border-[#181818] p-3">
        <a className="block rounded-[2px] border border-[#181818] bg-[#080808] px-2 py-2 text-[10px] uppercase tracking-[0.18em] text-[#555] transition hover:border-[#3a8a3a]/50 hover:text-[#3a8a3a]" href="/docs" rel="noreferrer">
          Swagger docs
        </a>
        <div className="mt-3 space-y-[4px] font-mono text-[9px] leading-tight">
          <div><span className="text-[#3a8a3a99]">[FLOW]</span> <span className="text-[#555]">upload → detect → sheet</span></div>
          <div><span className="text-[#3a8a3a99]">[GRID]</span> <span className="text-[#444]">split before review</span></div>
          <div><span className="text-[#3a8a3a99]">[REVIEW]</span> <span className="text-[#444]">approve → project</span></div>
        </div>
      </div>
    </aside>
  )
}

function WorkspaceHeader({
  activeTab,
  job,
  manifest,
  reviewsHref,
}: {
  activeTab: WorkspaceTab
  job: JobState | null
  manifest: JobManifest | null
  reviewsHref: string
}) {
  const title = activeTab === 'video' ? 'Scene frame detection' : activeTab === 'image' ? 'Image grid splitter' : 'Review + project studio'
  const status = activeTab === 'video'
    ? manifest
      ? `${manifest.segment_count} frames · contact sheet ready`
      : job
        ? job.status
        : 'ready for source video'
    : activeTab === 'image'
      ? 'split uploaded grids into reviewable stills'
      : 'image review, project stack, Comfy routing'

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-[#181818] bg-[#0c0c0c] px-5 py-[8px]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-[12px] font-semibold uppercase tracking-[0.18em] text-[#d0d0d0]">{title}</span>
        <span className="hidden border-l border-[#222] pl-3 text-[10px] uppercase tracking-[0.18em] text-[#3a8a3a] sm:inline">{status}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[#3a8a3a] sm:flex">
          <span className="h-[5px] w-[5px] rounded-[2px] bg-[#3a8a3a] dot-pulse" />
          Main screen
        </span>
        <a className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#555] transition hover:text-[#3a8a3a]" href={reviewsHref} rel="noreferrer">
          Docs
        </a>
      </div>
    </header>
  )
}

function HeroFull() {
  return (
    <header className="mt-10 grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-end lg:gap-14">
      <div className="space-y-5">
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.28em] text-[#555]">
          <span className="h-px w-8 bg-zinc-700" />
          <span>Scene · Detect · Split</span>
        </div>
        <h1 className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-[#e0e0e0]">
          Every cut,
          <br />
          <span className="text-[#aaa]">on its own</span>
          <span className="text-[color:var(--color-accent)]">.</span>
        </h1>
        <p className="max-w-xl text-[14px] leading-relaxed text-[#777]">
          Drop a video. PySceneDetect finds the hard cuts, ffmpeg slices each scene
          frame-accurately, and the first frame of every shot becomes a thumbnail you can
          scrub through. Local-first. Disk-backed. Zero cloud.
        </p>
      </div>

      <aside className="flex flex-col justify-end gap-1 self-end font-mono text-[11px] uppercase tracking-[0.22em] text-[#555]">
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
    <header className="mt-5 flex flex-wrap items-baseline justify-between gap-4 border-b border-[#181818] pb-4">
      <div className="flex items-baseline gap-4">
        <h1 className="text-[16px] font-semibold leading-none tracking-tight text-[#e0e0e0] sm:text-[16px] font-semibold">
          Every cut, <span className="text-[#777]">on its own</span>
          <span className="text-[color:var(--color-accent)]">.</span>
        </h1>
      </div>
      <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.24em] text-[#555]">
        <span><span className="text-[#222]">/</span> PySceneDetect</span>
        <span><span className="text-[#222]">/</span> ffmpeg</span>
        <span><span className="text-[#222]">/</span> per-job folder</span>
      </div>
    </header>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-baseline gap-4 border-t border-[#181818] py-2">
      <span className="text-[#343434]">{label}</span>
      <span className="text-[#aaa]">{value}</span>
    </div>
  )
}

function ShotSequenceHeader({
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
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#343434]">
        <span className="text-[#555]/90">Shot sequence ready</span>
      </p>
      <div className="flex flex-col gap-2 min-[1024px]:flex-row min-[1024px]:items-start min-[1024px]:justify-between min-[1024px]:gap-6">
        <div className="min-w-0 flex-1">
          <h2
            className="block max-w-full truncate whitespace-nowrap font-mono text-[12px] font-normal text-[#777] sm:text-[12px]"
            title={manifest.source_video}
          >
            {manifest.source_video}
          </h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#343434]">
            {manifest.segment_count} seg · {formatDuration(manifest.duration_seconds)} · {manifest.frame_count} fr
          </p>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-x-1 font-mono text-[11px] text-[#555]/90 min-[1024px]:pt-0.5 min-[1024px]:text-right">
          {exports.map((item, i) => {
            const short =
              item.label === 'Export keyframes ZIP'
                ? 'keyframes.zip'
                : item.label === 'Export segments ZIP'
                  ? 'segments.zip'
                  : 'sheet'
            return (
              <span key={item.label} className="inline-flex items-center">
                {i > 0 ? <span className="px-1 text-[#222]/80">·</span> : null}
                <a
                  href={item.href}
                  download
                  className="text-[#555]/90 underline decoration-white/10 decoration-dotted underline-offset-4 transition-colors hover:text-[#aaa] hover:decoration-zinc-500"
                >
                  {short}
                </a>
              </span>
            )
          })}
          {exports.length > 0 ? <span className="px-1 text-[#222]/80">·</span> : null}
          <button
            type="button"
            onClick={onReset}
            className="text-[#555]/90 transition-colors hover:text-[#aaa]"
          >
            new pass
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyShotSequence() {
  return (
    <section className="mt-8 border-t border-[#181818] pt-8">
      <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-2">
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.28em] text-[#555]">
            <span className="h-px w-6 bg-zinc-700" />
            <span>Workflow</span>
          </div>
          <h2 className="text-[16px] font-semibold tracking-tight text-[#e0e0e0] sm:text-[16px] font-semibold">
            Three steps. <span className="text-[#555]">No more.</span>
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
        <span className="font-mono text-[11px] tracking-[0.2em] text-[#343434]">{index}</span>
        <Film className="h-3.5 w-3.5 text-[#222]" />
      </div>
      <p className="text-[13px] text-[#e0e0e0]">{title}</p>
      <p className="text-[12px] leading-5 text-[#555]">{body}</p>
    </li>
  )
}

export default App
