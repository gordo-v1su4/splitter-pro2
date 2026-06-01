import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

const fetchMock = vi.fn()

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it('uploads a video and renders shot-sequence results', async () => {
    fetchMock
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
              segment_count: 1,
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
              ],
            },
          }),
        ),
      )

    render(<App />)

    const fileInput = screen.getByLabelText(/choose an mp4/i)
    const user = userEvent.setup()
    await user.upload(fileInput, new File(['video'], 'sample.mp4', { type: 'video/mp4' }))
    await user.click(screen.getByRole('button', { name: /process video/i }))

    await waitFor(() => {
      expect(screen.getByText(/shot sequence ready/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('img', { name: /segment 1 keyframe/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /keyframes\.zip/i })).toBeInTheDocument()
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

    render(<App />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reviews/i }))
    expect(screen.getByRole('heading', { name: /image review/i })).toBeInTheDocument()
    expect(screen.getByText(/publish generated images and why they matter/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /history/i })).toBeInTheDocument()
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

    render(<App />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reviews/i }))
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
