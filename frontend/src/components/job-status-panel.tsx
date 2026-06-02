import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react'

import type { JobManifest, JobState } from '../lib/api'
import { formatDuration } from '../lib/utils'
import { Card, CardContent } from './ui/card'
import { Progress } from './ui/progress'

function toPercentage(job: JobState | null) {
  if (!job || !job.progress_total) {
    return job?.status === 'completed' ? 100 : 8
  }
  return Math.round((job.progress_completed / job.progress_total) * 100)
}

type Tone = 'idle' | 'working' | 'completed' | 'failed'

function resolveTone(job: JobState | null): Tone {
  if (!job) return 'idle'
  if (job.status === 'failed') return 'failed'
  if (job.status === 'completed') return 'completed'
  return 'working'
}

const toneStyles: Record<Tone, { dot: string; text: string; headline: string; sub: string }> = {
  idle: {
    dot: 'bg-zinc-600',
    text: 'text-[#555]',
    headline: 'Awaiting',
    sub: 'Drop a video to start the pipeline.',
  },
  working: {
    dot: 'bg-zinc-500/80 dot-pulse',
    text: 'text-[#777]/90',
    headline: 'Working',
    sub: 'Polling every 1.5 seconds.',
  },
  completed: {
    dot: 'bg-zinc-500/70',
    text: 'text-[#777]/90',
    headline: 'Done',
    sub: 'Shot sequence rendered below.',
  },
  failed: {
    dot: 'bg-red-400',
    text: 'text-red-300',
    headline: 'Failed',
    sub: 'See the error below.',
  },
}

export function JobStatusPanel({
  job,
  error,
  manifest,
}: {
  job: JobState | null
  error: string | null
  manifest: JobManifest | null
}) {
  const percentage = toPercentage(job)
  const tone = resolveTone(job)
  const visibleError = job?.status === 'failed' ? job.error ?? error : error
  const styles = toneStyles[tone]

  const progressTotal = job?.progress_total ?? 0
  const progressDone = job?.progress_completed ?? 0
  const dotCount = Math.min(Math.max(progressTotal || 0, 12), 48)
  const dots = Array.from({ length: dotCount })

  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-4 pb-5 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.28em] text-[#555]">
            <span className="h-px w-6 bg-zinc-700" />
            <span>Pipeline</span>
          </div>
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em]">
            <span className={`h-1.5 w-1.5 rounded-[2px] ${styles.dot}`} />
            <span className={styles.text}>{job?.status ?? 'idle'}</span>
          </span>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="font-mono text-[12px] font-medium leading-none tracking-tight text-[#777]">
              {styles.headline}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#555]">
              {styles.sub}
            </p>
          </div>
          <div className="text-right leading-none">
            <p className="font-mono text-[16px] font-semibold font-medium tracking-tight text-[#555]/90 tabular-nums">
              {percentage}
              <span className="ml-0.5 text-[12px] text-[#343434]">%</span>
            </p>
          </div>
        </div>

        <Progress value={percentage} />

        {job ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[#555]">
            <span>
              <span className="text-[#aaa]">{progressDone}</span>
              <span className="mx-1 text-[#222]">/</span>
              <span>{progressTotal || '—'}</span>
              <span className="ml-2 text-[#343434]">extracted</span>
            </span>
            <span>
              stage <span className="ml-2 text-[#aaa]">{job.stage}</span>
            </span>
            {job.duration_seconds ? (
              <span>
                source <span className="ml-2 text-[#aaa]">{formatDuration(job.duration_seconds)}</span>
              </span>
            ) : null}
            {job.segment_count ? (
              <span>
                cuts <span className="ml-2 text-[#aaa]">{job.segment_count}</span>
              </span>
            ) : null}
          </div>
        ) : null}

        {job ? (
          <div className="grid grid-cols-12 gap-1 sm:grid-cols-16 lg:grid-cols-12 xl:grid-cols-16">
            {dots.map((_, idx) => {
              const filled =
                progressTotal > 0
                  ? idx < Math.round((progressDone / progressTotal) * dotCount)
                  : tone === 'working' && idx < (Date.now() / 200) % dotCount
              const dimmed = !filled && tone !== 'completed'
              return (
                <span
                  key={idx}
                  className={[
                    'h-1.5 transition-colors duration-300',
                    filled || tone === 'completed'
                      ? 'bg-zinc-500/50'
                      : dimmed
                        ? 'bg-white/[0.06]'
                        : 'bg-white/[0.06]',
                  ].join(' ')}
                />
              )
            })}
          </div>
        ) : null}

        <div className="mt-auto flex items-start gap-3 border-t border-[#181818] pt-4">
          <div className="mt-0.5 shrink-0">
            {!job ? (
              <span className="block h-3.5 w-3.5 border border-white/[0.12]" />
            ) : job.status === 'failed' ? (
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
            ) : job.status === 'completed' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-[#555]/90" />
            ) : (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#555]/80" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="break-all font-mono text-[11px] text-[#aaa]">
              {job?.source_video ?? 'No active job yet.'}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#343434]">
              {manifest
                ? `${manifest.frame_rate.toFixed(2)} fps · ${manifest.frame_count} frames`
                : job
                  ? job.duration_seconds
                    ? `${formatDuration(job.duration_seconds)} · scanning`
                    : 'inspecting source'
                  : 'idle'}
            </p>
          </div>
        </div>

        {visibleError && job?.status !== 'completed' ? (
          <div className="border border-red-500/20 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-300">
            {visibleError}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
