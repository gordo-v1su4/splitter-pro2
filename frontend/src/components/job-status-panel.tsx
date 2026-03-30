import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react'

import type { JobState } from '../lib/api'
import { Badge } from './ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Progress } from './ui/progress'

function toPercentage(job: JobState | null) {
  if (!job || !job.progress_total) {
    return job?.status === 'completed' ? 100 : 12
  }
  return Math.round((job.progress_completed / job.progress_total) * 100)
}

export function JobStatusPanel({ job, error }: { job: JobState | null; error: string | null }) {
  const percentage = toPercentage(job)
  const visibleError = job?.status === 'failed' ? job.error ?? error : error
  const summaryTone =
    job?.status === 'failed'
      ? 'border-red-950/80 bg-[linear-gradient(135deg,rgba(127,29,29,0.32),rgba(24,24,27,0.96)_42%,rgba(24,24,27,0.96)_100%)]'
      : job?.status === 'completed'
        ? 'border-emerald-950/80 bg-[linear-gradient(135deg,rgba(6,95,70,0.26),rgba(24,24,27,0.96)_42%,rgba(24,24,27,0.96)_100%)]'
        : 'border-amber-950/80 bg-[linear-gradient(135deg,rgba(146,64,14,0.22),rgba(24,24,27,0.96)_42%,rgba(24,24,27,0.96)_100%)]'
  const statusTone =
    job?.status === 'failed'
      ? 'bg-[linear-gradient(135deg,rgba(127,29,29,0.72),rgba(69,10,10,0.56))] text-red-100 ring-red-800'
      : job?.status === 'completed'
        ? 'bg-[linear-gradient(135deg,rgba(6,95,70,0.72),rgba(4,47,46,0.56))] text-emerald-100 ring-emerald-800'
        : 'bg-[linear-gradient(135deg,rgba(146,64,14,0.52),rgba(39,39,42,0.72))] text-zinc-100 ring-zinc-700'

  return (
    <Card className="border-zinc-800 bg-zinc-950/92">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Processing status</CardTitle>
            <CardDescription>Polling every 1.5 seconds until the storyboard is ready.</CardDescription>
          </div>
          <Badge className={statusTone}>{job?.status ?? 'idle'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {job ? (
          <>
            <div className={`flex items-start gap-3 rounded-md border px-4 py-3 ${summaryTone}`}>
              <div className="mt-0.5">
                {job.status === 'failed' ? (
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                ) : job.status === 'completed' ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <LoaderCircle className="h-5 w-5 animate-spin text-amber-600" />
                )}
              </div>
              <div className="space-y-1">
                <p className="break-all font-medium text-zinc-50">{job.source_video}</p>
                <p className="text-sm text-zinc-400">
                  Stage: <span className="font-medium text-zinc-200">{job.stage}</span>
                </p>
                {job.status === 'failed' && job.error ? <p className="text-sm text-red-300">{job.error}</p> : null}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-zinc-400">
                <span>
                  {job.progress_completed}/{job.progress_total || '...'} extracted
                </span>
                <span>{percentage}%</span>
              </div>
              <Progress
                value={percentage}
                className={
                  job?.status === 'failed'
                    ? '[&>div]:bg-gradient-to-r [&>div]:from-red-300 [&>div]:via-red-500 [&>div]:to-red-700'
                    : job?.status === 'completed'
                      ? '[&>div]:bg-gradient-to-r [&>div]:from-emerald-200 [&>div]:via-emerald-400 [&>div]:to-teal-500'
                      : '[&>div]:bg-gradient-to-r [&>div]:from-amber-200 [&>div]:via-amber-400 [&>div]:to-zinc-100'
                }
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-400">No active job yet. Upload a video to start the first pass.</p>
        )}
        {visibleError && job?.status !== 'completed' ? (
          <p className="rounded-md bg-red-950/60 px-4 py-3 text-sm text-red-200">{visibleError}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
