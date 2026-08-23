import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Film } from 'lucide-react'

import { ImageSplitWorkspace } from './components/image-split-workspace'
import { JobStatusPanel } from './components/job-status-panel'
import { ReviewWorkspace } from './components/review-workspace'
import { SegmentCard } from './components/segment-card'
import { UploadPanel } from './components/upload-panel'
import {
  assetUrl,
  customContactSheetUrl,
  fetchJob,
  fetchJobResult,
  type JobManifest,
  type JobState,
  type VideoSplitOptions,
  submitVideo,
} from './lib/api'
import { formatDuration } from './lib/utils'

type WorkspaceTab = 'projects' | 'reviews' | 'video' | 'image'

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceTab>('projects')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    if (window.innerWidth < 768) return true
    try {
      const saved = window.localStorage?.getItem('splitter.studio.sidebarCollapsed')
      return saved == null ? false : saved === '1'
    } catch {
      return false
    }
  })
  const [job, setJob] = useState<JobState | null>(null)
  const [manifest, setManifest] = useState<JobManifest | null>(null)
  const [selectedSegmentIndices, setSelectedSegmentIndices] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const pollFailureCountRef = useRef(0)

  useEffect(() => {
    try {
      window.localStorage?.setItem('splitter.studio.sidebarCollapsed', isSidebarCollapsed ? '1' : '0')
    } catch {
      // Storage can be disabled; the sidebar still works for the current session.
    }
  }, [isSidebarCollapsed])

  async function loadManifest(jobId: string, attempt = 0) {
    try {
      const nextManifest = await fetchJobResult(jobId)
      startTransition(() => {
        setManifest(nextManifest)
        setSelectedSegmentIndices([])
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

  async function handleUpload(file: File, options: VideoSplitOptions) {
    setIsUploading(true)
    setError(null)
    setManifest(null)
    setSelectedSegmentIndices([])
    pollFailureCountRef.current = 0
    try {
      const createdJob = await submitVideo(file, options)
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
    setSelectedSegmentIndices([])
    setError(null)
    setIsUploading(false)
    pollFailureCountRef.current = 0
  }

  const hasActiveWork = job !== null

  function selectWorkspace(nextWorkspace: WorkspaceTab) {
    setWorkspace(nextWorkspace)
    if (window.innerWidth < 768) {
      setIsSidebarCollapsed(true)
    }
  }

  function toggleSegmentSelection(segmentIndex: number) {
    setSelectedSegmentIndices((current) =>
      current.includes(segmentIndex)
        ? current.filter((index) => index !== segmentIndex)
        : [...current, segmentIndex].sort((a, b) => a - b),
    )
  }

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
        <StudioSidebar
          activeTab={workspace}
          collapsed={isSidebarCollapsed}
          onToggleCollapsed={() => setIsSidebarCollapsed((current) => !current)}
          onSelectTab={selectWorkspace}
        />
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspaceHeader activeTab={workspace} job={job} manifest={manifest} reviewsHref="/docs" />
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#080808] p-2 sm:p-4">
            {workspace === 'image' ? (
              <ImageSplitWorkspace />
            ) : workspace === 'projects' || workspace === 'reviews' ? (
              <ReviewWorkspace
                view={workspace}
                onOpenProjects={() => selectWorkspace('projects')}
                onOpenReviews={() => selectWorkspace('reviews')}
              />
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
                    <ShotSequenceHeader
                      manifest={manifest}
                      selectedSegmentIndices={selectedSegmentIndices}
                      onClearSelection={() => setSelectedSegmentIndices([])}
                      onSelectAll={() => setSelectedSegmentIndices(manifest.segments.map((segment) => segment.index))}
                      onReset={resetJob}
                    />

                    <div className="grid gap-3 min-[540px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                      {manifest.segments.map((segment) => (
                        <SegmentCard
                          key={`${manifest.job_id}-${segment.index}`}
                          jobId={manifest.job_id}
                          segment={segment}
                          selected={selectedSegmentIndices.includes(segment.index)}
                          onToggleSelected={() => toggleSegmentSelection(segment.index)}
                        />
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
  collapsed,
  onToggleCollapsed,
  onSelectTab,
}: {
  activeTab: WorkspaceTab
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelectTab: (tab: WorkspaceTab) => void
}) {
  const modules: Array<{ tab: WorkspaceTab; label: string; sub: string }> = [
    { tab: 'projects', label: 'Projects', sub: 'overview · workspace' },
    { tab: 'reviews', label: 'Reviews', sub: 'approve · publish' },
    { tab: 'video', label: 'Video process', sub: 'detect · frames · sheet' },
    { tab: 'image', label: 'Split grids', sub: 'image grids · crops' },
  ]

  if (collapsed) {
    return (
      <aside className="relative z-20 flex w-9 shrink-0 flex-col items-center overflow-visible border-r border-[#181818] bg-[#0c0c0c]">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand module panel"
          aria-label="Expand module panel"
          className="flex h-9 w-full items-center justify-center border-b border-[#181818] text-[12px] text-[#777] transition-colors hover:bg-[#131313] hover:text-[color:var(--color-accent)]"
        >
          »
        </button>
        <div className="mt-3 grid grid-cols-2 gap-[2px]">
          <div className="h-[5px] w-[5px] bg-[#3a8a3a]" />
          <div className="h-[5px] w-[5px] bg-[#2a2a2a]" />
          <div className="h-[5px] w-[5px] bg-[#2a2a2a]" />
          <div className="h-[5px] w-[5px] bg-[#3a8a3a]" />
        </div>
        <div className="mt-4 flex flex-1 flex-col items-center gap-2 overflow-y-auto py-1">
          {modules.map((module) => (
            <button
              key={module.tab}
              type="button"
              onClick={() => onSelectTab(module.tab)}
              title={`${module.label} · ${module.sub}`}
              aria-label={`${module.label} · ${module.sub}`}
              className={`flex h-6 w-6 items-center justify-center rounded-[2px] border transition-colors ${activeTab === module.tab ? 'border-[color:var(--color-accent)]' : 'border-transparent hover:border-[#333]'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${activeTab === module.tab ? 'bg-[color:var(--color-accent)]' : 'bg-[#2a2a2a]'}`} />
            </button>
          ))}
        </div>
        <a className="mb-3 font-mono text-[9px] uppercase tracking-[0.12em] text-[#444] [writing-mode:vertical-rl] hover:text-[#777]" href="/docs">
          Docs
        </a>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Open navigation drawer"
          aria-label="Open navigation drawer"
          className="group absolute left-full top-1/2 z-30 flex h-[72px] w-5 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-r-[3px] border-y border-r border-[#242424] bg-[#0c0c0c] text-[#555] shadow-[4px_0_14px_rgba(0,0,0,0.45)] transition-[width,border-color,color,background-color] hover:w-6 hover:border-[#3a8a3a]/70 hover:bg-[#111] hover:text-[#6aae6a] focus-visible:w-6 focus-visible:border-[#3a8a3a] focus-visible:text-[#75b875] focus-visible:outline-none"
        >
          <span className="font-mono text-[7px] uppercase tracking-[0.14em] [writing-mode:vertical-rl]">Open</span>
          <span className="text-[13px] leading-none transition-transform group-hover:translate-x-px">›</span>
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex w-[min(13rem,calc(100vw-3rem))] shrink-0 flex-col border-r border-[#181818] bg-[#0c0c0c] sm:w-52">
      <div className="flex items-center gap-2 border-b border-[#181818] px-3 py-[10px]">
        <div className="grid shrink-0 grid-cols-2 gap-[2px]">
          <div className="h-[7px] w-[7px] bg-[#3a8a3a]" />
          <div className="h-[7px] w-[7px] bg-[#2a2a2a]" />
          <div className="h-[7px] w-[7px] bg-[#2a2a2a]" />
          <div className="h-[7px] w-[7px] bg-[#3a8a3a]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold tracking-wide text-[#e0e0e0]">Splitter Studio</div>
          <div className="text-[9px] uppercase tracking-[0.22em] text-[#3a3a3a]">Pro 02</div>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse module panel"
          aria-label="Collapse module panel"
          className="shrink-0 rounded-[2px] border border-transparent px-1.5 py-1 text-[12px] text-[#555] transition-colors hover:border-[#333] hover:text-[color:var(--color-accent)]"
        >
          «
        </button>
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
          <div><span className="text-[#3a8a3a99]">[PROJECT]</span> <span className="text-[#444]">open from left nav</span></div>
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
  const title = activeTab === 'video' ? 'Video frame extraction' : activeTab === 'image' ? 'Image grid splitter' : activeTab === 'projects' ? 'Projects workspace' : 'Reviews queue'
  const status = activeTab === 'video'
    ? manifest
      ? `${manifest.segment_count} frames · contact sheet ready`
      : job
        ? job.status
        : 'ready for source video'
    : activeTab === 'image'
      ? 'split uploaded grids into reviewable stills'
      : activeTab === 'projects'
        ? 'overview, working pages, project stack'
        : 'image approval, publishing, project creation'

  return (
    <header className="flex min-h-9 shrink-0 items-center justify-between gap-3 border-b border-[#181818] bg-[#0c0c0c] px-3 py-[8px] sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d0d0d0] sm:text-[12px] sm:tracking-[0.18em]">{title}</span>
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
          <span>Choose · Sample · Split</span>
        </div>
        <h1 className="text-[26px] font-semibold leading-none tracking-[-0.02em] text-[#e0e0e0]">
          Every frame,
          <br />
          <span className="text-[#aaa]">on your terms</span>
          <span className="text-[color:var(--color-accent)]">.</span>
        </h1>
        <p className="max-w-xl text-[14px] leading-relaxed text-[#777]">
          Choose scene cuts, an exact number of evenly spaced frames, or a fixed time step.
          ffmpeg slices the whole video frame-accurately and gives every slice a stable
          midpoint image you can review. Local-first. Disk-backed. Zero cloud.
        </p>
      </div>

      <aside className="flex flex-col justify-end gap-1 self-end font-mono text-[11px] uppercase tracking-[0.22em] text-[#555]">
        <Spec label="Sampling" value="Scene · Count · Time" />
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
          Every frame, <span className="text-[#777]">on your terms</span>
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

function splitModeLabel(manifest: JobManifest) {
  if (manifest.split_mode === 'count') return `${manifest.target_count} equal`
  if (manifest.split_mode === 'interval') return `${manifest.interval_seconds}s step`
  return 'scene cuts'
}

function ShotSequenceHeader({
  manifest,
  selectedSegmentIndices,
  onClearSelection,
  onSelectAll,
  onReset,
}: {
  manifest: JobManifest
  selectedSegmentIndices: number[]
  onClearSelection: () => void
  onSelectAll: () => void
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
  const sheetLayouts = [
    { label: '2×2', rows: 2, columns: 2 },
    { label: '3×3', rows: 3, columns: 3 },
    { label: '4×4', rows: 4, columns: 4 },
    { label: '4×5', rows: 4, columns: 5 },
    { label: '5×5', rows: 5, columns: 5 },
  ]
  const [selectedSheetLayoutLabel, setSelectedSheetLayoutLabel] = useState('3×3')
  const selectedSheetLayout = sheetLayouts.find((layout) => layout.label === selectedSheetLayoutLabel) ?? sheetLayouts[1]

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
            {manifest.segment_count} seg · {splitModeLabel(manifest)} · {formatDuration(manifest.duration_seconds)} · {manifest.frame_count} fr
          </p>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-x-1 gap-y-2 font-mono text-[11px] text-[#555]/90 min-[1024px]:justify-end min-[1024px]:pt-0.5 min-[1024px]:text-right">
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
          {manifest.contact_sheet_path ? (
            <details className="group relative max-sm:order-last max-sm:basis-full max-sm:w-full">
              <summary className="cursor-pointer list-none text-[#555]/90 underline decoration-white/10 decoration-dotted underline-offset-4 transition-colors hover:text-[#aaa] [&::-webkit-details-marker]:hidden">
                sheet <span className="text-[#333] transition-transform group-open:inline-block group-open:rotate-180">⌄</span>
              </summary>
              <div className="z-40 mt-2 w-full border border-[#242424] bg-[#0c0c0c] p-3 text-left shadow-2xl sm:absolute sm:right-0 sm:w-[19rem]">
                <p className="text-[9px] uppercase tracking-[0.22em] text-[#3a3a3a]">Sheet export</p>
                <a
                  href={assetUrl(manifest.job_id, manifest.contact_sheet_path)}
                  download
                  className="mt-2 flex items-center justify-between border border-[#202020] px-2.5 py-2 text-[#888] transition-colors hover:border-[#3a3a3a] hover:text-[#c0c0c0]"
                >
                  <span>All main keyframes</span>
                  <span className="text-[9px] text-[#444]">5×4 default</span>
                </a>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] text-[#888]">Selected clips</p>
                    <p className="mt-0.5 text-[9px] text-[#444]">Evenly sampled as one timeline</p>
                  </div>
                  <span className="shrink-0 text-[9px] text-[color:var(--color-accent)]">{selectedSegmentIndices.length} selected</span>
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1" role="radiogroup" aria-label="Selected sheet grid size">
                  {sheetLayouts.map((layout) => {
                    const isSelected = selectedSheetLayout.label === layout.label
                    return (
                      <button
                        key={layout.label}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={`${layout.label} grid`}
                        onClick={() => setSelectedSheetLayoutLabel(layout.label)}
                        className={`flex h-8 items-center justify-center border text-[9px] transition-colors ${isSelected ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent)]' : 'border-[#242424] text-[#555] hover:border-[#444] hover:text-[#999]'}`}
                      >
                        {layout.label}
                      </button>
                    )
                  })}
                </div>
                <div className="mt-2">
                  {selectedSegmentIndices.length > 0 ? (
                    <a
                      href={customContactSheetUrl(
                        manifest.job_id,
                        selectedSegmentIndices,
                        selectedSheetLayout.rows,
                        selectedSheetLayout.columns,
                      )}
                      download
                      title={`Export ${selectedSheetLayout.label} sheet from selected clips`}
                      className="flex h-8 items-center justify-between border border-[color:var(--color-accent-line)] bg-[color:var(--color-accent-soft)] px-2.5 text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-accent)] transition-colors hover:border-[color:var(--color-accent)]"
                    >
                      <span>Export selected sheet</span>
                      <span className="text-[8px] opacity-70">{selectedSheetLayout.rows * selectedSheetLayout.columns} frames</span>
                    </a>
                  ) : (
                    <div className="flex h-8 items-center border border-[#1e1e1e] px-2.5 text-[9px] text-[#333]">Select clips below to export</div>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-3 border-t border-[#1c1c1c] pt-2 text-[9px]">
                  <button type="button" onClick={onSelectAll} className="text-[#666] hover:text-[#aaa]">select all</button>
                  <span className="text-[#222]">·</span>
                  <button type="button" onClick={onClearSelection} disabled={selectedSegmentIndices.length === 0} className="text-[#666] hover:text-[#aaa] disabled:text-[#2f2f2f]">clear</button>
                </div>
              </div>
            </details>
          ) : null}
          {manifest.contact_sheet_path ? <span className="px-1 text-[#222]/80">·</span> : null}
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
          <Step index="02" title="Sample" body="Choose scene cuts, an exact frame count, or a fixed time step." />
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
