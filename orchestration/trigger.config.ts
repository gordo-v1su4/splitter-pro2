import { defineConfig } from '@trigger.dev/sdk'

export default defineConfig({
  project: 'proj_slopwoltlvvujwgohfta',
  runtime: 'bun',
  machine: 'medium-1x',
  maxDuration: 7200,
  retries: { default: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 30000, factor: 2, randomize: true } },
  dirs: ['./src/trigger'],
})
