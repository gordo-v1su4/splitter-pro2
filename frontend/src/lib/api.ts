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
    const raw = await response.json().catch(() => null) as
      | { detail?: string | Array<{ msg?: string }> }
      | null
    let message = `Request failed with status ${response.status}`
    if (raw?.detail != null) {
      if (typeof raw.detail === 'string') {
        message = raw.detail
      } else if (Array.isArray(raw.detail)) {
        message = 'Invalid request (check form fields).'
      }
    }
    throw new Error(message)
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

export type ImageSplitMode = 'fixed' | 'auto'

export interface ImageSplitPanelMeta {
  index: number
  label: string
  asset_path: string
}

export interface ImageSplitManifest {
  split_id: string
  source_filename: string
  width: number
  height: number
  mode: ImageSplitMode
  rows: number
  cols: number
  gutter_px: number
  panels: ImageSplitPanelMeta[]
}

export interface ImageSplitBatchPanelMeta extends ImageSplitPanelMeta {
  source_index: number
  source_filename: string
}

export interface ImageSplitBatchManifest {
  batch_id: string
  mode: ImageSplitMode
  rows: number | null
  cols: number | null
  gutter_px: number
  sensitivity: number | null
  source_filenames: string[]
  total_sources: number
  panels: ImageSplitBatchPanelMeta[]
}

export async function splitImageFixedGrid(
  file: File,
  rows: number,
  cols: number,
  gutterPx: number,
): Promise<ImageSplitManifest> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('rows', String(rows))
  formData.append('cols', String(cols))
  formData.append('gutter_px', String(gutterPx))

  const response = await fetch('/api/image-split/fixed-grid', {
    method: 'POST',
    body: formData,
  })

  const payload = await parseResponse<{ manifest: ImageSplitManifest }>(response)
  return payload.manifest
}

export async function splitImageAuto(file: File, gutterPx: number, sensitivity: number): Promise<ImageSplitManifest> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('gutter_px', String(gutterPx))
  formData.append('sensitivity', String(sensitivity))

  const response = await fetch('/api/image-split/auto', {
    method: 'POST',
    body: formData,
  })

  const payload = await parseResponse<{ manifest: ImageSplitManifest }>(response)
  return payload.manifest
}

export async function splitImageBatchFixedGrid(
  files: File[],
  rows: number,
  cols: number,
  gutterPx: number,
): Promise<ImageSplitBatchManifest> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  formData.append('rows', String(rows))
  formData.append('cols', String(cols))
  formData.append('gutter_px', String(gutterPx))

  const response = await fetch('/api/image-split/batch/fixed-grid', {
    method: 'POST',
    body: formData,
  })

  const payload = await parseResponse<{ manifest: ImageSplitBatchManifest }>(response)
  return payload.manifest
}

export async function splitImageBatchAuto(
  files: File[],
  gutterPx: number,
  sensitivity: number,
): Promise<ImageSplitBatchManifest> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  formData.append('gutter_px', String(gutterPx))
  formData.append('sensitivity', String(sensitivity))

  const response = await fetch('/api/image-split/batch/auto', {
    method: 'POST',
    body: formData,
  })

  const payload = await parseResponse<{ manifest: ImageSplitBatchManifest }>(response)
  return payload.manifest
}

export function imageSplitPanelAssetUrl(splitId: string, assetPath: string): string {
  const safe = assetPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `/api/image-split/${splitId}/panels/${safe}`
}

export function imageSplitZipUrl(splitId: string): string {
  return `/api/image-split/${splitId}/export.zip`
}

export interface ReviewImageMeta {
  index: number
  label: string
  asset_path: string
  width: number
  height: number
  approval_status?: 'pending' | 'approved' | 'rejected' | 'published'
  rejection_reason?: string | null
  storage_bucket?: string | null
  object_key?: string | null
  public_url?: string | null
  media_url?: string | null
}

export interface ReviewManifest {
  review_id: string
  title: string
  notes: string
  image_count: number
  images: ReviewImageMeta[]
  created_at: string
  updated_at: string
}

export interface ReviewSummary {
  review_id: string
  title: string
  notes: string
  image_count: number
  created_at: string
  updated_at: string
  cover_asset_path: string | null
  cover_public_url?: string | null
  pending_count?: number
  approved_count?: number
  rejected_count?: number
  published_count?: number
}

export interface ProjectAsset {
  asset_id: string
  source_kind: string
  asset_type: 'character_sheet' | 'single_still' | 'cinematic_shot_grid' | 'extracted_shot' | 'refined_shot' | 'other'
  label: string
  filename: string
  width: number
  height: number
  asset_path: string
  storage_bucket?: string | null
  object_key?: string | null
  public_url?: string | null
  notes: string
  approval_status?: 'candidate' | 'needs_fix' | 'final_approved' | 'rejected' | string
  source_asset_id?: string | null
  source_job_id?: string | null
  stack_lane?: string | null
  created_at: string
}

export interface ProjectCharacter {
  character_id: string
  name: string
  sheet_asset_id: string
  crop_asset_id?: string | null
  look_label?: string | null
  notes: string
  created_at: string
}

export interface ProjectRefinementJob {
  job_id: string
  input_asset_ids: string[]
  reference_asset_ids: string[]
  workflow_name: 'keep_as_is' | 'comfyui_upscale' | 'comfyui_face_fix' | string
  status: string
  result_asset_ids: string[]
  settings_json: Record<string, unknown>
  error?: string | null
  created_at: string
  updated_at: string
}

export interface ProjectManifest {
  project_id: string
  title: string
  notes: string
  status: string
  source_review_id?: string | null
  hero_asset_id?: string | null
  assets: ProjectAsset[]
  characters: ProjectCharacter[]
  shot_grids: unknown[]
  shot_frames: unknown[]
  refinement_jobs: ProjectRefinementJob[]
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  project_id: string
  title: string
  status: string
  source_review_id?: string | null
  hero_asset_path?: string | null
  hero_public_url?: string | null
  asset_count: number
  character_count: number
  shot_grid_count: number
  shot_frame_count: number
  created_at: string
  updated_at: string
}

export interface ProjectStackReadout {
  asset_count: number
  character_count: number
  shot_grid_count: number
  selected_count: number
  refined_count: number
  queued_refinement_count: number
  completed_refinement_count: number
  final_approved_count: number
  video_ready: boolean
  next_action: string
}

export interface ProjectLane {
  lane_id: string
  label: string
  description: string
  asset_ids: string[]
  count: number
}

export interface ProjectStackResponse {
  project: ProjectManifest
  readout: ProjectStackReadout
  lanes: ProjectLane[]
}

export async function createProjectFromReview(reviewId: string, title = ''): Promise<ProjectManifest> {
  const formData = new FormData()
  if (title.trim()) {
    formData.append('title', title.trim())
  }
  const response = await fetch(`/api/reviews/${reviewId}/project`, { method: 'POST', body: formData })
  const payload = await parseResponse<{ project: ProjectManifest }>(response)
  return payload.project
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await fetch('/api/projects')
  const payload = await parseResponse<{ projects: ProjectSummary[] }>(response)
  return payload.projects
}

export async function fetchProject(projectId: string): Promise<ProjectManifest> {
  const response = await fetch(`/api/projects/${projectId}`)
  const payload = await parseResponse<{ project: ProjectManifest }>(response)
  return payload.project
}

export async function fetchProjectStack(projectId: string): Promise<ProjectStackResponse> {
  const response = await fetch(`/api/projects/${projectId}/stack`)
  return parseResponse<ProjectStackResponse>(response)
}

export async function addProjectAsset(
  projectId: string,
  file: File,
  assetType: ProjectAsset['asset_type'],
  label: string,
  notes: string,
  characterName = '',
): Promise<ProjectManifest> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('asset_type', assetType)
  formData.append('label', label)
  formData.append('notes', notes)
  formData.append('character_name', characterName)
  const response = await fetch(`/api/projects/${projectId}/assets`, { method: 'POST', body: formData })
  const payload = await parseResponse<{ project: ProjectManifest }>(response)
  return payload.project
}

export async function queueProjectRefinement(
  projectId: string,
  workflowName: 'keep_as_is' | 'comfyui_upscale' | 'comfyui_face_fix',
  inputAssetIds: string[],
  settingsJson: Record<string, unknown> = {},
): Promise<ProjectManifest> {
  const response = await fetch(`/api/projects/${projectId}/refinements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_name: workflowName,
      input_asset_ids: inputAssetIds,
      settings_json: settingsJson,
    }),
  })
  const payload = await parseResponse<{ project: ProjectManifest }>(response)
  return payload.project
}

export function projectAssetUrl(projectId: string, assetPath: string): string {
  const safe = assetPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `/api/projects/${projectId}/assets/${safe}`
}

export async function listReviews(): Promise<ReviewSummary[]> {
  const response = await fetch('/api/reviews')
  const payload = await parseResponse<{ reviews: ReviewSummary[] }>(response)
  return payload.reviews
}

export async function fetchReview(reviewId: string): Promise<ReviewManifest> {
  const response = await fetch(`/api/reviews/${reviewId}`)
  const payload = await parseResponse<{ review: ReviewManifest }>(response)
  return payload.review
}

export async function createReview(files: File[], title: string, notes: string): Promise<ReviewManifest> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  formData.append('title', title)
  formData.append('notes', notes)

  const response = await fetch('/api/reviews', {
    method: 'POST',
    body: formData,
  })

  const payload = await parseResponse<{ review: ReviewManifest }>(response)
  return payload.review
}

export async function approveReviewImage(reviewId: string, imageIndex: number): Promise<ReviewManifest> {
  const response = await fetch(`/api/reviews/${reviewId}/images/${imageIndex}/approve`, { method: 'POST' })
  const payload = await parseResponse<{ review: ReviewManifest }>(response)
  return payload.review
}

export async function rejectReviewImage(reviewId: string, imageIndex: number, reason = ''): Promise<ReviewManifest> {
  const trimmed = reason.trim()
  const response = await fetch(`/api/reviews/${reviewId}/images/${imageIndex}/reject`, {
    method: 'POST',
    headers: trimmed ? { 'Content-Type': 'application/json' } : undefined,
    body: trimmed ? JSON.stringify({ reason: trimmed }) : undefined,
  })
  const payload = await parseResponse<{ review: ReviewManifest }>(response)
  return payload.review
}

export async function publishApprovedReviewImages(reviewId: string): Promise<ReviewManifest> {
  const response = await fetch(`/api/reviews/${reviewId}/publish-approved`, { method: 'POST' })
  const payload = await parseResponse<{ review: ReviewManifest }>(response)
  return payload.review
}

export function reviewAssetUrl(reviewId: string, assetPath: string): string {
  const safe = assetPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `/api/reviews/${reviewId}/assets/${safe}`
}

export async function recordGoogleSheetsUrl(url: string): Promise<boolean> {
  const trimmed = url.trim()
  if (!trimmed) {
    return false
  }

  const body = new FormData()
  body.append('sheets_url', trimmed)
  const response = await fetch('/api/integrations/google-sheets', { method: 'POST', body })

  if (!response.ok) {
    return false
  }

  const payload = (await response.json()) as { recorded?: boolean }
  return payload.recorded === true
}
