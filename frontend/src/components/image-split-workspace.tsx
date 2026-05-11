import { Download, ImageIcon, LayoutGrid, LoaderCircle } from 'lucide-react'
import { startTransition, useEffect, useId, useMemo, useState } from 'react'

import {
  imageSplitPanelAssetUrl,
  imageSplitZipUrl,
  recordGoogleSheetsUrl,
  splitImageBatchAuto,
  splitImageBatchFixedGrid,
  type ImageSplitBatchManifest,
} from '../lib/api'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'

type SplitModeUi = 'fixed' | 'auto'

const inputLikeProcessChrome =
  'rounded-sm border border-white/[0.08] bg-white/[0.02] text-zinc-200 outline-none focus:border-white/[0.16]'

const API_CONNECTION_HINT =
  'The browser lost the connection to the API while splitting (this is not something you fix by “deploying” the frontend—local use still needs the FastAPI process running). For dev: run uvicorn on http://127.0.0.1:8000 and `bun run dev` so Vite can proxy /api. Common causes: backend not running, wrong port, very large uploads, or the worker crashing mid-request—try a tiny test PNG and check the uvicorn terminal for errors.'

function looksLikeNetworkDisconnect(cause: unknown): boolean {
  if (!(cause instanceof Error)) {
    return false
  }
  const m = cause.message
  return (
    m === 'Failed to fetch' ||
    m === 'Load failed' ||
    m === 'NetworkError when attempting to fetch resource.' ||
    m.includes('ECONNRESET') ||
    m.includes('ERR_CONNECTION') ||
    m.includes('Network request failed')
  )
}

function formatSplitError(cause: unknown): string {
  if (looksLikeNetworkDisconnect(cause)) {
    const tech = cause instanceof Error ? cause.message : String(cause)
    return `${API_CONNECTION_HINT}\n\nDetails: ${tech}`
  }
  return cause instanceof Error ? cause.message : 'Unable to split the image(s).'
}

export function ImageSplitWorkspace() {
  const uploadId = useId()
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const [splitMode, setSplitMode] = useState<SplitModeUi>('fixed')
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const [gutterPx, setGutterPx] = useState(0)
  const [sensitivity, setSensitivity] = useState(0.55)
  const [sheetsUrl, setSheetsUrl] = useState('')

  const [manifest, setManifest] = useState<ImageSplitBatchManifest | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const first = imageFiles[0]
    if (!first) {
      setPreviewUrl(null)
      return undefined
    }
    const objectUrl = URL.createObjectURL(first)
    setPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [imageFiles])

  const panelCountLabel = useMemo(() => {
    if (!manifest) {
      return '0 PANELS'
    }
    return `${manifest.total_sources} source(s) · ${manifest.panels.length} panels`.toUpperCase()
  }, [manifest])

  async function handleRun() {
    if (!imageFiles.length) {
      setError('Upload at least one image to continue.')
      return
    }

    setIsBusy(true)
    setError(null)
    setManifest(null)

    try {
      if (sheetsUrl.trim()) {
        void recordGoogleSheetsUrl(sheetsUrl)
      }

      const nextManifest =
        splitMode === 'fixed'
          ? await splitImageBatchFixedGrid(imageFiles, rows, cols, gutterPx)
          : await splitImageBatchAuto(imageFiles, gutterPx, sensitivity)

      startTransition(() => setManifest(nextManifest))
    } catch (cause) {
      setError(formatSplitError(cause))
    } finally {
      setIsBusy(false)
    }
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    const incoming = event.dataTransfer.files
    if (!incoming?.length) {
      return
    }
    const images = Array.from(incoming).filter((f) => f.type.startsWith('image/'))
    if (images.length) {
      setImageFiles(images)
    }
  }

  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              <span>Source</span>
              <span className="text-zinc-600">PNG · JPG · WebP</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {previewUrl ? (
                <figure className="col-span-2 overflow-hidden rounded-sm border border-white/[0.06] bg-black/40">
                  <img
                    alt="Selected source thumbnail"
                    className="aspect-video w-full object-contain bg-black"
                    draggable={false}
                    src={previewUrl}
                  />
                  {imageFiles.length > 1 ? (
                    <figcaption className="border-t border-white/[0.06] bg-black/50 px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                      +{imageFiles.length - 1} more
                    </figcaption>
                  ) : null}
                </figure>
              ) : (
                <div className="col-span-2 flex aspect-video flex-col items-center justify-center rounded-sm border border-dashed border-white/[0.08] bg-white/[0.015] px-4 text-center text-[11px] text-zinc-500">
                  <LayoutGrid className="mb-2 h-8 w-8 text-zinc-600" />
                  <span>No images yet.</span>
                </div>
              )}
            </div>

            <Button
              asChild
              size="sm"
              variant="secondary"
              className="h-auto min-h-8 w-full cursor-pointer justify-start gap-3 border-dashed px-4 py-2.5 font-normal"
            >
              <label
                htmlFor={uploadId}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                className="flex cursor-pointer items-center gap-3"
              >
                <ImageIcon className="h-4 w-4 shrink-0 text-zinc-400" />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                  {imageFiles.length ? 'Replace images' : 'Upload images'}
                </span>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Storyboard upload"
                  className="sr-only"
                  id={uploadId}
                  multiple
                  type="file"
                  onChange={(event) => {
                    const list = event.target.files
                    if (!list?.length) {
                      setImageFiles([])
                      return
                    }
                    setImageFiles(Array.from(list).filter((f) => f.type.startsWith('image/')))
                  }}
                />
              </label>
            </Button>

            <div className="space-y-3 border-t border-white/[0.05] pt-4">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.26em] text-zinc-600">
                <span>Split mode</span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={splitMode === 'fixed' ? undefined : 'secondary'}
                  className="min-w-0 flex-1"
                  onClick={() => setSplitMode('fixed')}
                >
                  Fixed grid
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={splitMode === 'auto' ? undefined : 'secondary'}
                  className="min-w-0 flex-1"
                  onClick={() => setSplitMode('auto')}
                >
                  Auto detect
                </Button>
              </div>
            </div>

            <div className="space-y-3 border-t border-white/[0.05] pt-4">
              {splitMode === 'fixed' ? (
                <div className="grid grid-cols-2 gap-4">
                  <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                    Rows
                    <input
                      className={cn('mt-2 w-full px-2 py-1 text-base tabular-nums', inputLikeProcessChrome)}
                      inputMode="numeric"
                      max={24}
                      min={1}
                      type="number"
                      value={rows}
                      onChange={(event) => setRows(Number.parseInt(event.target.value, 10) || 1)}
                    />
                  </label>
                  <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                    Cols
                    <input
                      className={cn('mt-2 w-full px-2 py-1 text-base tabular-nums', inputLikeProcessChrome)}
                      inputMode="numeric"
                      max={24}
                      min={1}
                      type="number"
                      value={cols}
                      onChange={(event) => setCols(Number.parseInt(event.target.value, 10) || 1)}
                    />
                  </label>
                </div>
              ) : (
                <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                  Sensitivity
                  <span className="ml-3 text-[11px] text-zinc-300">{Math.round(sensitivity * 100)}%</span>
                  <input
                    className="splitter-range mt-2 block w-full"
                    max={100}
                    min={0}
                    type="range"
                    value={sensitivity * 100}
                    onChange={(event) => setSensitivity(Number.parseInt(event.target.value, 10) / 100)}
                  />
                </label>
              )}

              <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                Gutter
                <span className="ml-3 text-[11px] text-zinc-300">{gutterPx}px</span>
                <input
                  className="splitter-range mt-2 block w-full"
                  max={96}
                  min={0}
                  type="range"
                  value={gutterPx}
                  onChange={(event) => setGutterPx(Number.parseInt(event.target.value, 10))}
                />
              </label>
            </div>

            <div className="space-y-2 border-t border-white/[0.05] pt-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-zinc-600">Integrations</p>
              <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Google Sheets URL
                <input
                  className={cn('mt-2 w-full px-2 py-2 text-xs', inputLikeProcessChrome)}
                  placeholder="https://docs.google.com/spreadsheets/..."
                  type="url"
                  value={sheetsUrl}
                  onChange={(event) => setSheetsUrl(event.target.value)}
                />
              </label>
            </div>

            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={isBusy}
              onClick={() => void handleRun()}
            >
              {isBusy ? (
                <>
                  <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" />
                  <span>Running…</span>
                </>
              ) : (
                <>
                  <span>Run splitter</span>
                  <span className="font-mono text-[9px] tracking-[0.2em] opacity-90">↗</span>
                </>
              )}
            </Button>

            {error ? <p className="whitespace-pre-line text-center text-xs text-red-300">{error}</p> : null}
          </CardContent>
        </Card>
      </aside>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">Results</p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <h2 className="font-display text-3xl italic text-zinc-50">Panels</h2>
              <Badge>{panelCountLabel}</Badge>
            </div>
          </div>
          {manifest ? (
            <Button asChild size="sm" variant="secondary">
              <a
                aria-label="Download every panel inside a ZIP"
                download
                href={imageSplitZipUrl(manifest.batch_id)}
                rel="noreferrer"
                className="inline-flex items-center gap-2"
              >
                <Download className="h-3.5 w-3.5" />
                Export all
              </a>
            </Button>
          ) : null}
        </div>

        {!manifest ? (
          <div className="rounded-md border border-dashed border-white/[0.06] bg-white/[0.01] px-6 py-20 text-center text-sm text-zinc-500">
            Processed panels will appear here once you upload one or more plates and tap &ldquo;Run splitter.&rdquo;
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {manifest.panels.map((panel) => (
              <figure
                key={`${panel.index}-${panel.asset_path}`}
                className="space-y-2 rounded-md border border-white/[0.05] bg-white/[0.01] p-3"
              >
                <div className="relative overflow-hidden rounded-sm border border-white/[0.04] bg-black">
                  <img
                    alt={panel.label}
                    className="h-auto w-full max-w-full"
                    src={imageSplitPanelAssetUrl(manifest.batch_id, panel.asset_path)}
                  />
                  <Button
                    asChild
                    size="sm"
                    variant="secondary"
                    className="absolute bottom-3 right-3 h-8 min-h-0 w-8 min-w-0 p-0"
                  >
                    <a
                      aria-label={`Download ${panel.label}`}
                      download={`${manifest.batch_id}-${panel.asset_path.replace(/\//g, '-')}`}
                      href={imageSplitPanelAssetUrl(manifest.batch_id, panel.asset_path)}
                      className="rounded-sm"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
                <figcaption className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                  <span>{panel.label}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
