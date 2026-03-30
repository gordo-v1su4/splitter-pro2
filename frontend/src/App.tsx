import { startTransition, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { Clapperboard, Download, Film, ImageIcon, LayoutGrid, RefreshCcw, ScissorsLineDashed } from 'lucide-react'

import { assetUrl, fetchJob, fetchJobResult, type JobManifest, type JobState, submitVideo } from './lib/api'
import { formatDuration } from './lib/utils'
import { Button } from './components/ui/button'
import { Badge } from './components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { UploadPanel } from './components/upload-panel'
import { JobStatusPanel } from './components/job-status-panel'
import { SegmentCard } from './components/segment-card'

function App() {
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

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_28%),linear-gradient(180deg,_#09090b_0%,_#111113_45%,_#151518_100%)] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(circle_at_center,black,transparent_80%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-7 px-4 py-5 sm:px-6 lg:px-10">
        <header className="rounded-xl border border-zinc-800 bg-zinc-950/84 px-5 py-5 shadow-[0_28px_90px_rgba(0,0,0,0.4)] backdrop-blur-xl">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(500px,0.95fr)] xl:items-end">
            <div className="max-w-2xl space-y-3">
              <Badge className="bg-zinc-900 text-zinc-200 ring-zinc-700">Shot split storyboard</Badge>
              <div className="space-y-2">
                <h1 className="font-display text-4xl leading-[0.92] tracking-[-0.08em] text-zinc-50 lg:text-5xl">
                  Drop in a video.
                  <span className="block text-zinc-300">Get every hard cut back as a storyboard.</span>
                </h1>
                <p className="max-w-xl text-sm leading-6 text-zinc-400 sm:text-base">
                  Splitter Pro 2 detects scene boundaries with PySceneDetect, cuts clips with ffmpeg,
                  and pulls the first frame of each segment into a clean review surface.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:self-end">
              <MetricCard icon={<Film className="h-4 w-4" />} label="Input" value="1 video" />
              <MetricCard icon={<ScissorsLineDashed className="h-4 w-4" />} label="Cuts" value="Auto" />
              <MetricCard icon={<ImageIcon className="h-4 w-4" />} label="Thumbs" value="1st frame" />
              <MetricCard icon={<Clapperboard className="h-4 w-4" />} label="Output" value="Storyboard" />
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <UploadPanel isUploading={isUploading} onUpload={handleUpload} job={job} />
          <div className="space-y-6">
            <JobStatusPanel job={job} error={error} />
            <Card className="border-zinc-800 bg-zinc-950/92">
              <CardHeader>
                <CardTitle>What this first version does</CardTitle>
                <CardDescription>
                  Single-video workflow with disk-backed jobs so each run can be reopened later.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-zinc-300 sm:grid-cols-2 xl:grid-cols-4">
                <InfoPill label="Detection" value="Adaptive scene detector" />
                <InfoPill label="Splitting" value="Frame-accurate ffmpeg clips" />
                <InfoPill label="Review" value="Image + video cards" />
                <InfoPill label="Exports" value="ZIPs + contact sheet" />
              </CardContent>
            </Card>
          </div>
        </section>

        {manifest ? (
          <section className="space-y-6">
            <div className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-950/92 px-5 py-4 shadow-[0_25px_70px_rgba(0,0,0,0.36)] backdrop-blur-xl xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl space-y-1.5">
                <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Storyboard ready</p>
                <h2 className="font-display text-2xl leading-tight tracking-[-0.06em] text-zinc-50 sm:text-3xl">
                  {manifest.source_video}
                </h2>
                <p className="text-sm text-zinc-400">
                  {manifest.segment_count} segments across {formatDuration(manifest.duration_seconds)} · {manifest.frame_count} frames.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[490px]">
                {manifest.keyframes_zip_path ? (
                  <Button asChild variant="secondary" className="justify-start px-3 py-2 text-sm">
                    <a href={assetUrl(manifest.job_id, manifest.keyframes_zip_path)} download>
                      <ImageIcon className="h-4 w-4" />
                      Export keyframes ZIP
                    </a>
                  </Button>
                ) : null}
                {manifest.segments_zip_path ? (
                  <Button asChild variant="secondary" className="justify-start px-3 py-2 text-sm">
                    <a href={assetUrl(manifest.job_id, manifest.segments_zip_path)} download>
                      <Download className="h-4 w-4" />
                      Export segments ZIP
                    </a>
                  </Button>
                ) : null}
                {manifest.contact_sheet_path ? (
                  <Button asChild variant="secondary" className="justify-start px-3 py-2 text-sm">
                    <a href={assetUrl(manifest.job_id, manifest.contact_sheet_path)} download>
                      <LayoutGrid className="h-4 w-4" />
                      Export contact sheet
                    </a>
                  </Button>
                ) : null}
                <Button variant="ghost" className="justify-start px-3 py-2 text-sm" onClick={resetJob}>
                  <RefreshCcw className="h-4 w-4" />
                  Start another pass
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {manifest.segments.map((segment) => (
                <SegmentCard key={segment.index} jobId={manifest.job_id} segment={segment} />
              ))}
            </div>
          </section>
        ) : (
          <EmptyStoryboard onReset={resetJob} />
        )}
      </div>
    </main>
  )
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex min-h-0 items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/90 px-3 py-3 shadow-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-zinc-100 text-zinc-950">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">{label}</p>
        <p className="mt-1 break-words text-sm leading-tight font-semibold text-zinc-100">{value}</p>
      </div>
    </div>
  )
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{label}</p>
      <p className="mt-2 font-medium text-zinc-100">{value}</p>
    </div>
  )
}

function EmptyStoryboard({ onReset }: { onReset: () => void }) {
  return (
    <Card className="border-dashed border-zinc-800 bg-zinc-950/72">
      <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950">
          <Film className="h-7 w-7" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-3xl tracking-[-0.06em] text-zinc-50">Storyboard waiting room</h2>
          <p className="max-w-xl text-zinc-400">
            Upload a video to generate scene clips, thumbnails, and a review grid you can scrub through.
          </p>
        </div>
        <Button variant="ghost" onClick={onReset}>
          Reset state
        </Button>
      </CardContent>
    </Card>
  )
}

export default App
