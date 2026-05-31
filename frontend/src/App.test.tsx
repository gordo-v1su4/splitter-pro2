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

  it('uploads a video and renders storyboard results', async () => {
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
      expect(screen.getByText(/storyboard ready/i)).toBeInTheDocument()
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
              },
            ],
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

    render(<App />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reviews/i }))
    expect(screen.getByRole('heading', { name: /image review/i })).toBeInTheDocument()
    expect(screen.getByText(/publish generated images and why they matter/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /history/i })).toBeInTheDocument()
    expect(await screen.findByText(/Yesterday good takes/i)).toBeInTheDocument()

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
    await user.click(screen.getAllByRole('button', { name: /^approve$/i })[0])
    expect(await screen.findByText(/^approved$/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /publish approved/i }))

    await waitFor(() => {
      expect(screen.getByRole('img', { name: /a.png/i })).toHaveAttribute(
        'src',
        'https://s3.v1su4.dev/splitter/reviews/review-1/approved/a.png',
      )
    })
    expect(screen.getByRole('img', { name: /Yesterday good takes cover/i })).toHaveAttribute(
      'src',
      'https://s3.v1su4.dev/splitter/reviews/old-review/images/cover.png',
    )
    expect(screen.getAllByText(/Pick one\./i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/2 images/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Yesterday good takes/i)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews/review-1/images/1/approve', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews/review-1/publish-approved', expect.objectContaining({ method: 'POST' }))
  })

})
