import { Check, Download, ImageIcon, Images, LayoutGrid, LoaderCircle, X } from 'lucide-react'
import { startTransition, useEffect, useId, useState } from 'react'

import {
  downloadImageSplitSelection,
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
  'rounded-sm border border-[#181818] bg-[#090909] text-[#c0c0c0] outline-none focus:border-white/[0.16]'

const API_CONNECTION_HINT =
  'The browser lost the connection to the API while splitting (this is not something you fix by “deploying” the frontend—local use still needs the FastAPI process running). For dev: run uvicorn on http://127.0.0.1:8000 and `bun run dev` so Vite can proxy /api. Common causes: backend not running, wrong port, very large uploads, or the worker crashing mid-request—try a tiny test PNG and check the uvicorn terminal for errors.'

/** Square row/column count so each tile keeps the plate’s aspect (e.g. 16:9 → 2×2 panels stay 16:9). */
function suggestSquareGridFromImageSize(width: number, height: number): { rows: number; cols: number } {
  const ratio = width / height
  const tol = 0.04
  const r169 = 16 / 9
  const r916 = 9 / 16
  if (Math.abs(ratio - 1) < tol) {
    return { rows: 3, cols: 3 }
  }
  if (Math.abs(ratio - r169) < tol || Math.abs(ratio - r916) < tol) {
    return { rows: 2, cols: 2 }
  }
  return { rows: 2, cols: 2 }
}

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
  const [sourcePreviews, setSourcePreviews] = useState<Array<{ file: File; url: string }>>([])

  const [splitMode, setSplitMode] = useState<SplitModeUi>('fixed')
  const [rows, setRows] = useState(2)
  const [cols, setCols] = useState(2)
  const [gutterPx, setGutterPx] = useState(0)
  const [sensitivity, setSensitivity] = useState(0.55)
  const [sheetsUrl, setSheetsUrl] = useState('')

  const [manifest, setManifest] = useState<ImageSplitBatchManifest | null>(null)
  const [selectedAssetPaths, setSelectedAssetPaths] = useState<Set<string>>(new Set())
  const [isBusy, setIsBusy] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const previews = imageFiles.map((file) => ({ file, url: URL.createObjectURL(file) }))
    setSourcePreviews(previews)
    return () => previews.forEach(({ url }) => URL.revokeObjectURL(url))
  }, [imageFiles])

  useEffect(() => {
    const first = imageFiles[0]
    if (!first) {
      return undefined
    }
    let cancelled = false
    void (async () => {
      try {
        const bitmap = await createImageBitmap(first)
        if (cancelled) {
          bitmap.close()
          return
        }
        const { rows: nextRows, cols: nextCols } = suggestSquareGridFromImageSize(bitmap.width, bitmap.height)
        bitmap.close()
        setRows(nextRows)
        setCols(nextCols)
      } catch {
        /* decode failed — keep current grid */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [imageFiles])

  const panelCountLabel = manifest
    ? `${manifest.total_sources} source(s) · ${manifest.panels.length} panels`.toUpperCase()
    : '0 PANELS'

  const selectedCount = selectedAssetPaths.size
  const allPanelsSelected = Boolean(manifest?.panels.length) && selectedCount === manifest?.panels.length

  function replaceImageFiles(files: File[]) {
    setImageFiles(files.slice(0, 32))
    setManifest(null)
    setSelectedAssetPaths(new Set())
    setError(files.length > 32 ? 'Only the first 32 images were added.' : null)
  }

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

      startTransition(() => {
        setManifest(nextManifest)
        setSelectedAssetPaths(new Set(nextManifest.panels.map((panel) => panel.asset_path)))
      })
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
      replaceImageFiles(images)
    }
  }

  function togglePanel(assetPath: string) {
    setSelectedAssetPaths((current) => {
      const next = new Set(current)
      if (next.has(assetPath)) {
        next.delete(assetPath)
      } else {
        next.add(assetPath)
      }
      return next
    })
  }

  async function handleExportSelected() {
    if (!manifest || !selectedCount || isExporting) {
      return
    }
    setIsExporting(true)
    setError(null)
    try {
      const orderedSelection = manifest.panels
        .filter((panel) => selectedAssetPaths.has(panel.asset_path))
        .map((panel) => panel.asset_path)
      const blob = await downloadImageSplitSelection(manifest.batch_id, orderedSelection)
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `splitter-pro-selected-panels-${manifest.batch_id}.zip`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    } catch (cause) {
      setError(formatSplitError(cause))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.28em] text-[#555]">
              <span>Source batch</span>
              <span className={imageFiles.length ? 'text-[color:var(--color-accent)]' : 'text-[#343434]'}>
                {imageFiles.length ? `${imageFiles.length} queued` : 'up to 32'}
              </span>
            </div>

            {sourcePreviews.length ? (
              <div className="max-h-56 overflow-y-auto rounded-sm border border-[#181818] bg-black/40 p-px" aria-label="Selected source images">
                <div className="grid grid-cols-2 gap-px bg-[#181818]">
                  {sourcePreviews.map(({ file, url }, index) => (
                    <figure key={`${index}-${file.name}-${file.size}-${file.lastModified}`} className="min-w-0 bg-[#090909]">
                      <img
                        alt={`Source ${index + 1}: ${file.name}`}
                        className="aspect-video w-full bg-black object-cover"
                        draggable={false}
                        src={url}
                      />
                      <figcaption className="truncate px-2 py-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[#666]">
                        {String(index + 1).padStart(2, '0')} · {file.name}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center rounded-sm border border-dashed border-[#181818] bg-[#090909] px-4 text-center text-[11px] text-[#555]">
                <LayoutGrid className="mb-2 h-8 w-8 text-[#343434]" />
                <span>No source batch yet.</span>
                <span className="mt-1 font-mono text-[8px] uppercase tracking-[0.18em] text-[#353535]">Select several images at once</span>
              </div>
            )}

            <Button
              asChild
              size="sm"
              variant="secondary"
              className="min-h-6 w-full cursor-pointer justify-start gap-2 border-dashed px-2 py-1 font-normal"
            >
              <label
                htmlFor={uploadId}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                className="flex cursor-pointer items-center gap-2"
              >
                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[#777]" />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#aaa]">
                  {imageFiles.length ? 'Replace source batch' : 'Choose multiple images'}
                </span>
                <input
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Cinematic shot grid upload"
                  className="sr-only"
                  id={uploadId}
                  multiple
                  type="file"
                  onChange={(event) => {
                    const list = event.target.files
                    if (!list?.length) {
                      return
                    }
                    replaceImageFiles(Array.from(list).filter((f) => f.type.startsWith('image/')))
                    event.target.value = ''
                  }}
                />
              </label>
            </Button>

            <div className="flex items-center justify-between gap-3 font-mono text-[8px] uppercase tracking-[0.16em] text-[#414141]">
              <span>PNG · JPG · WebP · multi-select</span>
              {imageFiles.length ? (
                <button
                  type="button"
                  onClick={() => replaceImageFiles([])}
                  className="flex items-center gap-1 text-[#555] transition hover:text-[#aaa]"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              ) : null}
            </div>

            <div className="space-y-3 border-t border-white/[0.05] pt-4">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.26em] text-[#343434]">
                <span>Split mode</span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={splitMode === 'fixed' ? undefined : 'secondary'}
                  className="min-w-0 flex-1 font-sans text-[7px] tracking-[0.08em] sm:text-[8px]"
                  onClick={() => setSplitMode('fixed')}
                >
                  Fixed grid
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={splitMode === 'auto' ? undefined : 'secondary'}
                  className="min-w-0 flex-1 font-sans text-[7px] tracking-[0.08em] sm:text-[8px]"
                  onClick={() => setSplitMode('auto')}
                >
                  Auto detect
                </Button>
              </div>
            </div>

            <div className="space-y-3 border-t border-white/[0.05] pt-4">
              {splitMode === 'fixed' ? (
                <div className="grid grid-cols-2 gap-4">
                  <p className="col-span-2 text-[11px] leading-relaxed text-[#555]">
                    Same rows and cols keep each panel matching the plate aspect (16×9 plates default to 2×2).
                  </p>
                  <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#555]">
                    Rows
                    <input
                      className={cn('mt-2 w-full px-2 py-1 text-[12px] tabular-nums', inputLikeProcessChrome)}
                      inputMode="numeric"
                      max={24}
                      min={1}
                      type="number"
                      value={rows}
                      onChange={(event) => setRows(Number.parseInt(event.target.value, 10) || 1)}
                    />
                  </label>
                  <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#555]">
                    Cols
                    <input
                      className={cn('mt-2 w-full px-2 py-1 text-[12px] tabular-nums', inputLikeProcessChrome)}
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
                <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#555]">
                  Sensitivity
                  <span className="ml-3 text-[11px] text-[#aaa]">{Math.round(sensitivity * 100)}%</span>
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

              <label className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[#555]">
                Gutter
                <span className="ml-3 text-[11px] text-[#aaa]">{gutterPx}px</span>
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
              <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-[#343434]">Integrations</p>
              <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#555]">
                Google Sheets URL
                <input
                  className={cn('mt-2 w-full px-2 py-2 text-[10px]', inputLikeProcessChrome)}
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
              disabled={isBusy || !imageFiles.length}
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

            {error ? <p className="whitespace-pre-line text-center text-[10px] text-red-300">{error}</p> : null}
          </CardContent>
        </Card>
      </aside>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#181818] pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#555]">Results</p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <h2 className="text-[16px] font-semibold text-[#e0e0e0]">Panels</h2>
              <Badge>{panelCountLabel}</Badge>
            </div>
          </div>
          {manifest ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--color-accent)]">
                {selectedCount} selected
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectedAssetPaths(
                    allPanelsSelected ? new Set() : new Set(manifest.panels.map((panel) => panel.asset_path)),
                  )
                }}
              >
                {allPanelsSelected ? 'Clear' : 'Select all'}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!selectedCount || isExporting}
                onClick={() => void handleExportSelected()}
              >
                {isExporting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Images className="h-3.5 w-3.5" />}
                Download selected
              </Button>
              <Button asChild size="sm" variant="secondary">
                <a
                  aria-label="Download every panel inside a ZIP"
                  download
                  href={imageSplitZipUrl(manifest.batch_id)}
                  rel="noreferrer"
                  className="inline-flex items-center gap-2"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download all
                </a>
              </Button>
            </div>
          ) : null}
        </div>

        {!manifest ? (
          <div className="rounded-[2px] border border-dashed border-[#181818] bg-white/[0.01] px-6 py-20 text-center text-[12px] text-[#555]">
            Processed panels will appear here once you upload one or more plates and tap &ldquo;Run splitter.&rdquo;
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {manifest.panels.map((panel) => {
              const selected = selectedAssetPaths.has(panel.asset_path)
              return (
                <figure
                  key={`${panel.index}-${panel.asset_path}`}
                  className={cn(
                    'space-y-2 rounded-[2px] border bg-white/[0.01] p-3 transition-colors [contain-intrinsic-size:320px] [content-visibility:auto]',
                    selected
                      ? 'border-[color:var(--color-accent-line)] bg-[color:var(--color-accent-soft)]'
                      : 'border-white/[0.05]',
                  )}
                >
                  <div className="relative overflow-hidden rounded-sm border border-white/[0.04] bg-black">
                    <img
                      alt={panel.label}
                      className="h-auto w-full max-w-full"
                      loading="lazy"
                      src={imageSplitPanelAssetUrl(manifest.batch_id, panel.asset_path)}
                    />
                    <button
                      type="button"
                      aria-label={`${selected ? 'Remove' : 'Select'} ${panel.label} for download`}
                      aria-pressed={selected}
                      onClick={() => togglePanel(panel.asset_path)}
                      className={cn(
                        'absolute left-3 top-3 grid h-8 w-8 place-items-center border backdrop-blur-sm transition-colors',
                        selected
                          ? 'border-[color:var(--color-accent)] bg-[rgba(16,28,15,0.9)] text-[color:var(--color-accent)]'
                          : 'border-white/15 bg-black/70 text-[#777] hover:border-white/30 hover:text-white',
                      )}
                    >
                      {selected ? <Check className="h-4 w-4" strokeWidth={2} /> : <span className="h-3 w-3 border border-current" />}
                    </button>
                    <Button
                      asChild
                      size="sm"
                      variant="secondary"
                      className="absolute bottom-3 right-3 h-8 min-h-0 w-8 min-w-0 bg-black/75 p-0 backdrop-blur-sm"
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
                  <figcaption className="flex items-center justify-between gap-3 font-mono uppercase tracking-[0.18em] text-[#777]">
                    <span className="min-w-0 truncate text-[9px]">{panel.label}</span>
                    <span className="shrink-0 text-[8px] text-[#414141]">#{String(panel.index).padStart(3, '0')}</span>
                  </figcaption>
                </figure>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
