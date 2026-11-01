import { metadata, task, wait } from '@trigger.dev/sdk'

type Payload = { jobId: string; dispatchId: string }

function settings() {
  const app = process.env.SPLITTER_APP_URL
  const token = process.env.SPLITTER_ORCHESTRATION_TOKEN
  const worker = process.env.SPLITTER_GPU_WORKER_URL
  if (!app || !token) throw new Error('Splitter orchestration configuration is incomplete')
  return { app, token, worker }
}

async function request(url: string, token: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300_000) })
  if (!response.ok) throw new Error(`Processing service returned ${response.status}`)
  return response
}

function validate(payload: Payload) {
  if (!/^[a-f0-9]{32}$/.test(payload.jobId) || !/^[a-f0-9]{32}$/.test(payload.dispatchId)) throw new Error('Invalid job identifier')
}

async function update(payload: Payload, runId: string, patch: object) {
  const { app, token } = settings()
  return request(`${app}/internal/orchestration/backgrounds/${payload.jobId}`, token, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dispatch_id: payload.dispatchId, run_id: runId, ...patch }),
  }).then(r => r.json())
}

export const processVideo = task({
  id: 'splitter-process-video',
  queue: { name: 'splitter-video-cpu', concurrencyLimit: 1 },
  maxDuration: 7200,
  run: async (payload: Payload, { ctx }) => {
    validate(payload)
    metadata.set('stage', 'processing-video').set('progressMode', 'indeterminate').set('jobId', payload.jobId)
    const { app, token } = settings()
    // Start once; short polls avoid holding a long HTTP request to Hostinger.
    await request(`${app}/internal/orchestration/videos/${payload.jobId}/start`, token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispatch_id: payload.dispatchId, run_id: ctx.run.id }),
    })
    for (let attempt = 0; attempt < 2400; attempt++) {
      const state = await request(`${app}/internal/orchestration/videos/${payload.jobId}`, token).then(r => r.json())
      metadata.set('stage', state.stage).set('completedItems', state.progress_completed).set('totalItems', state.progress_total)
      if (state.status === 'completed') return { jobId: payload.jobId, status: 'completed' }
      if (state.status === 'failed') throw new Error('Video processing failed; see the job status')
      await wait.for({ seconds: 3 })
    }
    throw new Error('Video processing exceeded its time limit')
  },
})

export const removeBackground = task({
  id: 'splitter-remove-background',
  queue: { name: 'splitter-background-gpu', concurrencyLimit: 1 },
  maxDuration: 7200,
  onFailure: async ({ payload, ctx }: { payload: Payload; ctx: { run: { id: string } } }) => {
    await update(payload, ctx.run.id, { status: 'failed', stage: 'failed', error: 'Background removal failed. The original is unchanged; please retry.' })
  },
  run: async (payload: Payload, { ctx }) => {
    validate(payload)
    const { app, token, worker } = settings()
    if (!worker) throw new Error('Splitter GPU worker is not configured')
    const state = await update(payload, ctx.run.id, { status: 'processing', stage: 'preparing-image', error: null })
    if (state.status === 'completed') return { jobId: payload.jobId, status: 'completed', cached: true }
    const response = await request(`${app}/internal/orchestration/backgrounds/${payload.jobId}/source`, token, {
      headers: { 'X-Splitter-Dispatch': payload.dispatchId },
    })
    const form = new FormData()
    form.set('file', await response.blob(), 'source.png')
    form.set('gray', response.headers.get('X-Splitter-Gray')!)
    form.set('prompt', decodeURIComponent(response.headers.get('X-Splitter-Prompt')!))
    await request(`${worker}/jobs/${payload.jobId}`, token, { method: 'POST', body: form })
    for (let attempt = 0; attempt < 2400; attempt++) {
      const result = await request(`${worker}/jobs/${payload.jobId}`, token).then(r => r.json())
      metadata.set('stage', result.stage).set('progressMode', 'indeterminate').set('jobId', payload.jobId).set('model', 'sam3')
      await update(payload, ctx.run.id, { status: 'processing', stage: result.stage })
      if (result.status === 'failed') throw new Error('SAM 3 processing failed')
      if (result.status === 'completed') {
        const output = await request(`${worker}/jobs/${payload.jobId}/output`, token).then(r => r.blob())
        const completed = new FormData()
        completed.set('file', output, 'output.png')
        completed.set('dispatch_id', payload.dispatchId)
        completed.set('run_id', ctx.run.id)
        await request(`${app}/internal/orchestration/backgrounds/${payload.jobId}/complete`, token, { method: 'POST', body: completed })
        metadata.set('stage', 'completed')
        return { jobId: payload.jobId, status: 'completed', model: 'sam3' }
      }
      await wait.for({ seconds: 3 })
    }
    throw new Error('Background removal exceeded its time limit')
  },
})
