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
    expect(screen.getByText(/segment 1/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /export keyframes zip/i })).toBeInTheDocument()
  })
})
