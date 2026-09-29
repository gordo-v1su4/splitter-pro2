import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UploadPanel } from './upload-panel'
import { JobStatusPanel } from './job-status-panel'
import { submitYouTube, type JobState } from '../lib/api'
import { parseClipTimestamp } from '../lib/utils'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const downloading: JobState = {
  job_id: 'a'.repeat(32), status: 'processing', stage: 'downloading-video',
  source_video: 'youtube-i380DwcJxxM.mp4', source_ready: false, source_url: 'https://youtu.be/i380DwcJxxM',
  created_at: '', updated_at: '', split_mode: 'count', target_count: 10, interval_seconds: 5,
  error: null, duration_seconds: null, segment_count: 0, progress_completed: 0, progress_total: 0,
  downloaded_bytes: 25 * 1024 * 1024, download_total_bytes: 100 * 1024 * 1024,
}

describe('YouTube import', () => {
  it('submits one URL with selected split mode and explicit cookie choice', async () => {
    let finish!: () => void
    const submit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<UploadPanel isUploading={false} onUpload={vi.fn()} onYouTube={submit} job={null} onReset={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'YouTube link' }))
    expect(screen.getByRole('button', { name: 'Download and split' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('YouTube video URL'), { target: { value: 'https://youtu.be/i380DwcJxxM' } })
    fireEvent.click(screen.getByRole('radio', { name: /Equal Count/i }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Download and split' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download and split' }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith(
      'https://youtu.be/i380DwcJxxM',
      { splitMode: 'count', targetCount: 10, intervalSeconds: 5 },
      true,
      undefined,
    )
    finish()
  })

  it('accepts a colon time as minutes and seconds', () => {
    expect(parseClipTimestamp('25:15')).toBe(25 * 60 + 15)
    expect(parseClipTimestamp('1:02:03')).toBe(3600 + 120 + 3)
    expect(parseClipTimestamp('2m')).toBe(120)
    expect(parseClipTimestamp('90')).toBe(90)
    const submit = vi.fn(() => Promise.resolve())
    render(<UploadPanel isUploading={false} onUpload={vi.fn()} onYouTube={submit} job={null} onReset={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'YouTube link' }))
    fireEvent.change(screen.getByLabelText('YouTube video URL'), { target: { value: 'https://youtu.be/i380DwcJxxM' } })
    fireEvent.change(screen.getByLabelText('Clip start'), { target: { value: '25:15' } })
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '2:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download and split' }))
    expect(submit).toHaveBeenCalledWith(
      'https://youtu.be/i380DwcJxxM',
      { splitMode: 'scenes', targetCount: 10, intervalSeconds: 5 },
      false,
      { clipStartSeconds: 25 * 60 + 15, clipEndSeconds: 25 * 60 + 15 + 120 },
    )
  })

  it('shows real download progress without requesting an incomplete preview', () => {
    const { container } = render(<>
      <UploadPanel isUploading={false} onUpload={vi.fn()} job={downloading} onReset={vi.fn()} />
      <JobStatusPanel job={downloading} error={null} manifest={null} />
    </>)
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByText('25%')).toBeVisible()
    expect(screen.getByText('25.0 MB downloaded')).toBeVisible()
    expect(screen.getByText('Downloading from YouTube')).toBeVisible()
  })

  it('shows the authentication failure and allows a new pass', () => {
    const reset = vi.fn()
    const job: JobState = { ...downloading, status: 'failed', stage: 'download-failed', error: 'YouTube requires sign-in. Refresh the private cookies.' }
    render(<><UploadPanel isUploading={false} onUpload={vi.fn()} job={job} onReset={reset} /><JobStatusPanel job={job} error={null} manifest={null} /></>)
    expect(screen.getByText(job.error!)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'New pass' }))
    expect(reset).toHaveBeenCalledOnce()
  })

  it('posts JSON to the URL endpoint rather than the multipart upload endpoint', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ job: downloading }), { status: 202 }))
    vi.stubGlobal('fetch', request)
    await submitYouTube('https://youtu.be/i380DwcJxxM', { splitMode: 'interval', targetCount: 10, intervalSeconds: 8 }, false)
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    expect(request.mock.calls[0][0]).toBe('/api/jobs/youtube')
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ url: 'https://youtu.be/i380DwcJxxM', split_mode: 'interval', target_count: 10, interval_seconds: 8, use_cookies: false })
  })
})
