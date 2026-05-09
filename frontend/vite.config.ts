/// <reference types="vitest/config" />

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const configDir = path.dirname(fileURLToPath(import.meta.url))

/** Read SPLITTER_PROXY_TARGET from optional env files (e.g. `.env.development.local`; gitignored via `*.local`). */
function splitterProxyFromEnvFiles(): string | undefined {
  for (const name of ['.env.development.local', '.env.local', '.env']) {
    const filePath = path.join(configDir, name)
    if (!existsSync(filePath)) {
      continue
    }
    const text = readFileSync(filePath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }
      const match = trimmed.match(/^SPLITTER_PROXY_TARGET\s*=\s*(.*)$/)
      if (!match) {
        continue
      }
      return match[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  return undefined
}

/** When Docker holds 8000, point dev proxy at a local uvicorn (e.g. 8001). */
const apiProxyTarget =
  process.env.SPLITTER_PROXY_TARGET ?? splitterProxyFromEnvFiles() ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        timeout: 180000,
        proxyTimeout: 180000,
      },
      '/docs': { target: apiProxyTarget, changeOrigin: true },
      '/redoc': { target: apiProxyTarget, changeOrigin: true },
      '/openapi.json': { target: apiProxyTarget, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
})
