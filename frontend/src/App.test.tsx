import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

import App from './App'
import { AccessGate } from './components/access-gate'
import { ImageSplitWorkspace } from './components/image-split-workspace'
import { ReviewWorkspace } from './components/review-workspace'
import { UploadPanel } from './components/upload-panel'

const fetchMock = vi.fn()
const storage = new Map<string, string>()

function ReviewWorkspaceHarness() {
  const [view, setView] = useState<'projects' | 'reviews'>('reviews')
  return (
    <ReviewWorkspace
      view={view}
      onOpenProjects={() => setView('projects')}
      onOpenReviews={() => setView('reviews')}
    />
  )
}

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    storage.clear()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it('uploads a video and renders shot-sequence results', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ required: false, unlocked: true })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            job: {
              job_id: 'job-1',
              status: 'queued',
              stage: 'upload-complete',
              source_video: 'sample.mp4',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              error: null,
              duration_seconds: null,
              segment_count: 0,
              progress_completed: 0,
              progress_total: 0,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            job_id: 'job-1',
            status: 'completed',
            stage: 'completed',
            source_video: 'sample.mp4',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            error: null,
            duration_seconds: 3,
            segment_count: 1,
            progress_completed: 1,
            progress_total: 1,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            manifest: {
              job_id: 'job-1',
              source_video: 'sample.mp4',
              duration_seconds: 3,
              frame_rate: 30,
              frame_count: 90,
              segment_count: 4,
              created_at: new Date().toISOString(),
              reassembled_path: 'clips/reassembled.mp4',
              keyframes_zip_path: 'exports/keyframes.zip',
              segments_zip_path: 'exports/segments.zip',
              contact_sheet_path: 'exports/contact-sheet.jpg',
              reconstruction_audit: {
                original_frame_count: 90,
                reconstructed_frame_count: 90,
                expected_segment_frames: 90,
                frame_delta: 0,
                original_duration_seconds: 3,
                reconstructed_duration_seconds: 3,
                duration_delta_seconds: 0,
              },
              segments: [
                {
                  index: 1,
                  start_frame: 0,
                  end_frame: 90,
                  frame_count: 90,
                  start_seconds: 0,
                  end_seconds: 3,
                  duration_seconds: 3,
                  clip_path: 'clips/segment-001.mp4',
                  thumbnail_path: 'thumbnails/segment-001.jpg',
                  label: '00:00:00.000 - 00:00:03.000',
                },
                {
                  index: 2,
                  start_frame: 90,
                  end_frame: 180,
                  frame_count: 90,
                  start_seconds: 3,
                  end_seconds: 6,
                  duration_seconds: 3,
                  clip_path: 'clips/segment-002.mp4',
                  thumbnail_path: 'thumbnails/segment-002.jpg',
                  label: '00:00:03.000 - 00:00:06.000',
                },
                {
                  index: 3,
                  start_frame: 180,
                  end_frame: 270,
                  frame_count: 90,
                  start_seconds: 6,
                  end_seconds: 9,
                  duration_seconds: 3,
                  clip_path: 'clips/segment-003.mp4',
                  thumbnail_path: 'thumbnails/segment-003.jpg',
                  label: '00:00:06.000 - 00:00:09.000',
                },
                {
                  index: 4,
                  start_frame: 270,
                  end_frame: 360,
                  frame_count: 90,
                  start_seconds: 9,
                  end_seconds: 12,
                  duration_seconds: 3,
                  clip_path: 'clips/segment-004.mp4',
                  thumbnail_path: 'thumbnails/segment-004.jpg',
                  label: '00:00:09.000 - 00:00:12.000',
                },
              ],
            },
          }),
        ),
      )

    render(<App />)

    const user = userEvent.setup()
    expect(screen.getByRole('button', { name: /projects temporarily offline/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /reviews temporarily offline/i })).toBeDisabled()
    expect(screen.getByText(/video frame extraction/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /collapse module panel/i }))
    expect(screen.getByRole('button', { name: /expand module panel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open navigation drawer/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open navigation drawer/i }))
    await user.click(screen.getByRole('button', { name: /video process/i }))
    const fileInput = screen.getByLabelText(/choose an mp4/i)
    await user.upload(fileInput, new File(['video'], 'sample.mp4', { type: 'video/mp4' }))
    expect(screen.queryByRole('button', { name: /process video/i })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/shot sequence ready/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('img', { name: /segment 1 keyframe/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /keyframes\.zip/i })).toBeInTheDocument()

    await user.click(screen.getByText(/^sheet/i, { selector: 'summary' }))
    await user.click(screen.getByRole('button', { name: /select all/i }))
    expect(screen.getByText(/4 selected/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /remove clip 2 for sheet/i }))
    await user.click(screen.getByRole('button', { name: /remove clip 4 for sheet/i }))
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /all main keyframes/i })).toHaveAttribute(
      'href',
      '/api/jobs/job-1/assets/exports/contact-sheet.jpg',
    )
    await user.click(screen.getByRole('radio', { name: /3×3 grid/i }))
    expect(screen.getByRole('radio', { name: /3×3 grid/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('link', { name: /export selected sheet/i })).toHaveAttribute(
      'href',
      '/api/jobs/job-1/contact-sheet?segment_indices=1&segment_indices=3&rows=3&columns=3',
    )
  })

  it('starts processing immediately when a video is dropped', async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined)
    render(<UploadPanel isUploading={false} onUpload={onUpload} job={null} onReset={vi.fn()} />)
    const dropTarget = screen.getByText(/drop a file or click to browse/i).closest('label')
    const file = new File(['video'], 'dropped.mp4', { type: 'video/mp4' })

    fireEvent.drop(dropTarget as HTMLLabelElement, { dataTransfer: { files: [file] } })

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file, {
      splitMode: 'scenes',
      targetCount: 10,
      intervalSeconds: 5,
    }))
    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /process video/i })).not.toBeInTheDocument()
  })

  it('passes an exact evenly distributed image count with the upload', async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined)
    render(<UploadPanel isUploading={false} onUpload={onUpload} job={null} onReset={vi.fn()} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: /equal count/i }))
    fireEvent.change(screen.getByLabelText(/^images$/i), { target: { value: '12' } })
    await user.upload(
      screen.getByLabelText(/choose an mp4/i),
      new File(['video'], 'twelve-frames.mp4', { type: 'video/mp4' }),
    )

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(expect.any(File), {
      splitMode: 'count',
      targetCount: 12,
      intervalSeconds: 5,
    }))
    expect(screen.getByText(/12 equal slices/i)).toBeInTheDocument()
  })

  it('keeps the video split-mode detail rail at one fixed height', async () => {
    const user = userEvent.setup()
    render(<UploadPanel isUploading={false} onUpload={vi.fn()} job={null} onReset={vi.fn()} />)

    const detailRail = screen.getByTestId('split-mode-detail')
    expect(detailRail).toHaveClass('h-[68px]')
    await user.click(screen.getByRole('radio', { name: /equal count/i }))
    expect(screen.getByTestId('split-mode-detail')).toBe(detailRail)
    await user.click(screen.getByRole('radio', { name: /time step/i }))
    expect(screen.getByTestId('split-mode-detail')).toBe(detailRail)
    await user.click(screen.getByRole('radio', { name: /scene cuts/i }))
    expect(screen.getByTestId('split-mode-detail')).toBe(detailRail)
  })

  it('splits multiple source images and downloads only selected panels', async () => {
    const RealURL = URL
    class TestURL extends RealURL {
      static createObjectURL = vi.fn(() => `blob:test-${TestURL.createObjectURL.mock.calls.length}`)
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', TestURL)
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        manifest: {
          batch_id: 'batch-1',
          mode: 'fixed',
          rows: 2,
          cols: 2,
          gutter_px: 0,
          sensitivity: null,
          source_filenames: ['alpha.png', 'beta.png'],
          total_sources: 2,
          panels: [
            { index: 1, label: 'alpha.png · Panel 1', asset_path: '000/panel-001.png', source_index: 0, source_filename: 'alpha.png' },
            { index: 2, label: 'alpha.png · Panel 2', asset_path: '000/panel-002.png', source_index: 0, source_filename: 'alpha.png' },
            { index: 3, label: 'beta.png · Panel 1', asset_path: '001/panel-001.png', source_index: 1, source_filename: 'beta.png' },
            { index: 4, label: 'beta.png · Panel 2', asset_path: '001/panel-002.png', source_index: 1, source_filename: 'beta.png' },
          ],
        },
      })))
      .mockResolvedValueOnce(new Response(new Blob(['zip']), { status: 200, headers: { 'Content-Type': 'application/zip' } }))

    render(<ImageSplitWorkspace />)
    const user = userEvent.setup()
    await user.upload(screen.getByLabelText(/cinematic shot grid upload/i), [
      new File(['alpha'], 'alpha.png', { type: 'image/png' }),
      new File(['beta'], 'beta.png', { type: 'image/png' }),
    ])

    expect(screen.getByRole('img', { name: /source 1: alpha\.png/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /source 2: beta\.png/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /run splitter/i }))
    await screen.findByText(/2 source\(s\) · 4 panels/i)
    expect(screen.getByText('4 selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /remove alpha\.png · panel 1 for download/i }))
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /download selected/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/image-split/batch-1/export-selected.zip',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          asset_paths: ['000/panel-002.png', '001/panel-001.png', '001/panel-002.png'],
        }),
      }),
    ))
    expect(anchorClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: /download every panel/i })).toHaveAttribute(
      'href',
      '/api/image-split/batch-1/export.zip',
    )
  })

  it('unlocks the private workspace through the server gate', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ required: true, unlocked: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ required: true, unlocked: true })))

    render(<AccessGate />)
    const user = userEvent.setup()
    const input = await screen.findByLabelText(/access code/i)
    await user.type(input, '4821')
    await user.click(screen.getByRole('button', { name: /unlock workspace/i }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /private access/i })).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenLastCalledWith('/api/access-gate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ pin: '4821' }),
    }))
  })

  it('publishes images into a condensed image review board with history below', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reviews: [
              {
                review_id: 'old-review',
                title: 'Yesterday good takes',
                notes: 'hero frame candidates',
                image_count: 4,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                cover_asset_path: 'images/cover.png',
                cover_public_url: 'https://s3.v1su4.dev/splitter/reviews/old-review/images/cover.png',
                pending_count: 0,
                approved_count: 0,
                rejected_count: 0,
                published_count: 4,
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ projects: [] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            review: {
              review_id: 'review-1',
              title: 'Smoke pass',
              notes: 'Pick one.',
              image_count: 2,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              images: [
                {
                  index: 1,
                  label: 'a.png',
                  asset_path: 'images/a.png',
                  width: 1280,
                  height: 720,
                  approval_status: 'pending',
                },
                { index: 2, label: 'b.png', asset_path: 'images/b.png', width: 1280, height: 720, approval_status: 'pending' },
              ],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            review: {
              review_id: 'review-1',
              title: 'Smoke pass',
              notes: 'Pick one.',
              image_count: 2,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              images: [
                { index: 1, label: 'a.png', asset_path: 'images/a.png', width: 1280, height: 720, approval_status: 'approved' },
                { index: 2, label: 'b.png', asset_path: 'images/b.png', width: 1280, height: 720, approval_status: 'pending' },
              ],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            review: {
              review_id: 'review-1',
              title: 'Smoke pass',
              notes: 'Pick one.',
              image_count: 2,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              images: [
                {
                  index: 1,
                  label: 'a.png',
                  asset_path: 'images/a.png',
                  width: 1280,
                  height: 720,
                  approval_status: 'published',
                  storage_bucket: 'splitter',
                  object_key: 'reviews/review-1/approved/a.png',
                  public_url: 'https://s3.v1su4.dev/splitter/reviews/review-1/approved/a.png',
                  media_url: 'https://media.v1su4.dev/files/splitter/reviews/review-1/approved/a.png',
                },
                { index: 2, label: 'b.png', asset_path: 'images/b.png', width: 1280, height: 720, approval_status: 'pending' },
              ],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            project: {
              project_id: 'project-1',
              title: 'Smoke pass',
              notes: 'Project note visible on page.',
              status: 'active',
              source_review_id: 'review-1',
              hero_asset_id: 'asset-1',
              assets: [
                {
                  asset_id: 'asset-1',
                  source_kind: 'review_approved',
                  asset_type: 'single_still',
                  label: 'Approved project look',
                  filename: 'a.png',
                  width: 1280,
                  height: 720,
                  asset_path: 'assets/a.png',
                  public_url: 'https://s3.v1su4.dev/splitter/reviews/review-1/approved/a.png',
                  notes: 'Hero/look image created from the approved review publish step.',
                  approval_status: 'candidate',
                  stack_lane: null,
                  created_at: new Date().toISOString(),
                },
              ],
              characters: [],
              shot_grids: [],
              shot_frames: [],
              refinement_jobs: [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            project: {
              project_id: 'project-1',
              title: 'Smoke pass',
              notes: 'Project note visible on page.',
              status: 'active',
              source_review_id: 'review-1',
              hero_asset_id: 'asset-1',
              assets: [
                {
                  asset_id: 'asset-1',
                  source_kind: 'review_approved',
                  asset_type: 'single_still',
                  label: 'Approved project look',
                  filename: 'a.png',
                  width: 1280,
                  height: 720,
                  asset_path: 'assets/a.png',
                  public_url: 'https://s3.v1su4.dev/splitter/reviews/review-1/approved/a.png',
                  notes: 'Hero/look image created from the approved review publish step.',
                  approval_status: 'candidate',
                  stack_lane: null,
                  created_at: new Date().toISOString(),
                },
              ],
              characters: [],
              shot_grids: [],
              shot_frames: [],
              refinement_jobs: [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            readout: {
              asset_count: 1,
              character_count: 0,
              shot_grid_count: 0,
              selected_count: 0,
              refined_count: 0,
              queued_refinement_count: 0,
              completed_refinement_count: 0,
              final_approved_count: 0,
              video_ready: false,
              next_action: 'Approve final frames for video prep.',
            },
            lanes: [
              {
                lane_id: 'look',
                label: 'Approved look',
                description: 'Published review images and single still references.',
                asset_ids: ['asset-1'],
                count: 1,
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            project: {
              project_id: 'project-1',
              title: 'Smoke pass',
              notes: 'Project note visible on page.',
              status: 'active',
              source_review_id: 'review-1',
              hero_asset_id: 'asset-1',
              assets: [
                {
                  asset_id: 'asset-1',
                  source_kind: 'review_approved',
                  asset_type: 'single_still',
                  label: 'Approved project look',
                  filename: 'a.png',
                  width: 1280,
                  height: 720,
                  asset_path: 'assets/a.png',
                  public_url: 'https://s3.v1su4.dev/splitter/reviews/review-1/approved/a.png',
                  notes: 'Hero/look image created from the approved review publish step.',
                  created_at: new Date().toISOString(),
                },
              ],
              characters: [],
              shot_grids: [],
              shot_frames: [],
              refinement_jobs: [
                {
                  job_id: 'refine-1',
                  input_asset_ids: ['asset-1'],
                  reference_asset_ids: [],
                  workflow_name: 'comfyui_upscale',
                  status: 'queued',
                  result_asset_ids: [],
                  settings_json: { scale: 2 },
                  error: null,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
        ),
      )

    render(<ReviewWorkspaceHarness />)

    const user = userEvent.setup()
    expect(screen.getByRole('heading', { name: /^reviews$/i })).toBeInTheDocument()
    expect(screen.getByText(/upload images for approval/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /history log/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByText(/Yesterday good takes/i).length).toBeGreaterThan(0)
    })

    await user.type(screen.getByLabelText(/title/i), 'Smoke pass')
    await user.upload(screen.getByLabelText(/images/i), [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ])
    await user.click(screen.getByRole('button', { name: /publish images/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/Smoke pass/i).length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /view a\.png/i }))
    await user.click(screen.getByRole('button', { name: /approve image/i }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /a\.png/i })).not.toBeInTheDocument()
    })
    expect(screen.getAllByText(/1 pending/i).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /publish approved/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/reviews/review-1/publish-approved', expect.objectContaining({ method: 'POST' }))
    })
    expect(screen.getByRole('img', { name: /Yesterday good takes thumbnail/i })).toHaveAttribute(
      'src',
      'https://s3.v1su4.dev/splitter/reviews/old-review/images/cover.png',
    )
    expect(screen.getAllByText(/Pick one\./i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/4 images/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Yesterday good takes/i).length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews/review-1/images/1/approve', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews/review-1/publish-approved', expect.objectContaining({ method: 'POST' }))

    await user.click(screen.getByRole('button', { name: /create project page/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/reviews/review-1/project', expect.objectContaining({ method: 'POST' }))
    })
    expect(screen.getByText(/Working project page/i)).toBeInTheDocument()
    expect(screen.getByText(/Project note visible on page\./i)).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-1/stack')
    })
    expect(screen.getByText(/Approve final frames for video prep\./i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /upscale all/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/refinements',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const refineRequest = fetchMock.mock.calls.find(([url]) => url === '/api/projects/project-1/refinements')
    expect(JSON.parse(refineRequest?.[1]?.body as string)).toEqual({
      workflow_name: 'comfyui_upscale',
      input_asset_ids: ['asset-1'],
      settings_json: { scale: 2 },
    })
    expect(screen.getByText(/ComfyUI upscale queued/i)).toBeInTheDocument()
  })


  it('opens review images in a large modal with approve and optional reject reason', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            reviews: [
              {
                review_id: 'review-visual',
                title: 'Gen-X Vampire 3x3 Grids',
                notes: 'Approve one.',
                image_count: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                cover_asset_path: 'images/grid.png',
                pending_count: 1,
                approved_count: 0,
                rejected_count: 0,
                published_count: 0,
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ projects: [] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            review: {
              review_id: 'review-visual',
              title: 'Gen-X Vampire 3x3 Grids',
              notes: 'Approve one.',
              image_count: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              images: [
                {
                  index: 1,
                  label: 'grid.png',
                  asset_path: 'images/grid.png',
                  width: 2752,
                  height: 1536,
                  approval_status: 'pending',
                },
              ],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            review: {
              review_id: 'review-visual',
              title: 'Gen-X Vampire 3x3 Grids',
              notes: 'Approve one.',
              image_count: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              images: [
                {
                  index: 1,
                  label: 'grid.png',
                  asset_path: 'images/grid.png',
                  width: 2752,
                  height: 1536,
                  approval_status: 'rejected',
                  rejection_reason: 'too vertical and hard to read',
                },
              ],
            },
          }),
        ),
      )

    render(<ReviewWorkspaceHarness />)

    const user = userEvent.setup()
    const pendingButtons = await screen.findAllByRole('button', { name: /gen-x vampire 3x3 grids/i })
    await user.click(pendingButtons[0])

    expect(await screen.findByRole('dialog', { name: /grid\.png/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /grid\.png large preview/i })).toHaveClass('max-h-[78vh]')

    await user.type(screen.getByLabelText(/optional rejection reason/i), 'too vertical and hard to read')
    await user.click(screen.getByRole('button', { name: /deny image/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/reviews/review-visual/images/1/reject',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const rejectRequest = fetchMock.mock.calls.find(([url]) => url === '/api/reviews/review-visual/images/1/reject')
    expect(JSON.parse(rejectRequest?.[1]?.body as string)).toEqual({ reason: 'too vertical and hard to read' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /grid\.png/i })).not.toBeInTheDocument()
    })
    expect(screen.getAllByText(/Gen-X Vampire 3x3 Grids/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/0 pending/i).length).toBeGreaterThan(0)
  })

})
