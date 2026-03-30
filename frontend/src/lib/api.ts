export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface SegmentRecord {
  index: number
  start_frame: number
  end_frame: number
  frame_count: number
  start_seconds: number
  end_seconds: number
  duration_seconds: number
  clip_path: string
  thumbnail_path: string
  label: string
}

export interface ReconstructionAudit {
  original_frame_count: number
  reconstructed_frame_count: number
  expected_segment_frames: number
  frame_delta: number
  original_duration_seconds: number
  reconstructed_duration_seconds: number
  duration_delta_seconds: number
}

export interface JobManifest {
  job_id: string
  source_video: string
  duration_seconds: number
  frame_rate: number
  frame_count: number
  segment_count: number
  created_at: string
  reassembled_path: string | null
  keyframes_zip_path: string | null
  segments_zip_path: string | null
  contact_sheet_path: string | null
  reconstruction_audit: ReconstructionAudit | null
  segments: SegmentRecord[]
}

export interface JobState {
  job_id: string
  status: JobStatus
  stage: string
  source_video: string
  created_at: string
  updated_at: string
  error: string | null
  duration_seconds: number | null
  segment_count: number
  progress_completed: number
  progress_total: number
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(payload?.detail ?? `Request failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

export async function submitVideo(file: File): Promise<JobState> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch('/api/jobs', {
    method: 'POST',
    body: formData,
  })
  const payload = await parseResponse<{ job: JobState }>(response)
  return payload.job
}

export async function fetchJob(jobId: string): Promise<JobState> {
  const response = await fetch(`/api/jobs/${jobId}`)
  return parseResponse<JobState>(response)
}

export async function fetchJobResult(jobId: string): Promise<JobManifest> {
  const response = await fetch(`/api/jobs/${jobId}/result`)
  const payload = await parseResponse<{ manifest: JobManifest }>(response)
  return payload.manifest
}

export function assetUrl(jobId: string, assetPath: string): string {
  return `/api/jobs/${jobId}/assets/${assetPath}`
}
