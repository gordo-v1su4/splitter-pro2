import { LoaderCircle, Upload } from 'lucide-react'
import { useId, useState } from 'react'

import { assetUrl, type JobState } from '../lib/api'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

export function UploadPanel({
  isUploading,
  onUpload,
  job,
}: {
  isUploading: boolean
  onUpload: (file: File) => Promise<void>
  job: JobState | null
}) {
  const inputId = useId()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  async function submit() {
    if (!selectedFile) {
      return
    }
    await onUpload(selectedFile)
  }

  const sourceVideoSrc = job ? assetUrl(job.job_id, `source/${job.source_video}`) : null

  return (
    <Card className="border-zinc-800 bg-zinc-950/92">
      <CardHeader>
        <CardTitle>Upload a source video</CardTitle>
        <CardDescription>
          Splitter Pro 2 stores each run in its own job folder, so clips and thumbnails stay reusable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <label
          htmlFor={inputId}
          className="group flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-900 px-6 py-12 text-center transition-colors hover:border-zinc-600 hover:bg-zinc-900/80"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 transition-transform group-hover:scale-105">
            <Upload className="h-6 w-6" />
          </div>
          <div className="mt-5 space-y-2">
            <p className="break-all font-medium text-zinc-50">
              {selectedFile ? selectedFile.name : 'Choose an MP4, MOV, or other local video file'}
            </p>
            <p className="text-sm text-zinc-400">
              Hard cuts become clips. The first frame of every segment becomes a thumbnail.
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-zinc-400">
            {selectedFile ? `Selected size: ${(selectedFile.size / 1024 / 1024).toFixed(2)} MB` : 'No file selected yet.'}
          </div>
          <Button onClick={submit} disabled={!selectedFile || isUploading}>
            {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isUploading ? 'Uploading…' : 'Process video'}
          </Button>
        </div>

        {sourceVideoSrc ? (
          <div className="space-y-3 rounded-lg border border-zinc-800 bg-black/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Source video</p>
                <p className="break-all text-sm font-medium text-zinc-100">{job?.source_video}</p>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-zinc-800 bg-black">
              <video className="aspect-video w-full" src={sourceVideoSrc} controls preload="metadata" />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
