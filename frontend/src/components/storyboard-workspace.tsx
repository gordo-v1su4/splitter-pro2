import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import { Check, Download, ImagePlus, Plus, X } from 'lucide-react'
import { exportStoryboard, placeImage, type ImageFit, type StoryboardImage } from '../lib/storyboard'
import './storyboard-workspace.css'

const DRAG_TYPE = 'application/x-splitter-storyboard'
const MAX_IMAGES = 100

// Adapted from PinDeck's BoardStoryboardWorkspace: shot rail, selected shot,
// used-shot markers, and drop targets. This workspace works directly with local files.
export function StoryboardWorkspace() {
  const uploadId = useId()
  const [images, setImages] = useState<StoryboardImage[]>([])
  const [size, setSize] = useState(3)
  // Keep the larger layout's placements when switching temporarily to a smaller grid.
  const [slots, setSlots] = useState<Array<string | null>>(() => Array(25).fill(null))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [bankDragging, setBankDragging] = useState(false)
  const [fit, setFit] = useState<ImageFit>('contain')
  const [gutter, setGutter] = useState(0)
  const [width, setWidth] = useState(3840)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const urls = useRef(new Set<string>())
  const importLock = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const ownedUrls = urls.current
    return () => {
      mounted.current = false
      ownedUrls.forEach((url) => URL.revokeObjectURL(url))
      ownedUrls.clear()
    }
  }, [])

  const visibleSlots = slots.slice(0, size * size)
  const used = new Set(visibleSlots.filter(Boolean))
  const byId = new Map(images.map((image) => [image.id, image]))
  const selected = selectedId ? byId.get(selectedId) : undefined
  const hiddenCount = slots.slice(size * size).filter(Boolean).length

  async function addFiles(files: File[]) {
    if (importLock.current || !files.length) return
    importLock.current = true
    setImporting(true)
    setError('')
    setNotice('')
    const added: StoryboardImage[] = []
    const rejected: string[] = []
    const remaining = MAX_IMAGES - images.length
    for (const file of files.slice(0, remaining)) {
      if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 25 * 1024 * 1024) {
        rejected.push(file.name)
        continue
      }
      try {
        const bitmap = await createImageBitmap(file)
        bitmap.close()
        if (!mounted.current) return
        const url = URL.createObjectURL(file)
        urls.current.add(url)
        added.push({ id: crypto.randomUUID(), name: file.name, url, file })
      } catch {
        rejected.push(file.name)
      }
    }
    if (mounted.current) {
      setImages((current) => [...current, ...added])
      if (added.length) setSelectedId(added[0].id)
      setNotice(`${added.length} image${added.length === 1 ? '' : 's'} added to the bank.`)
      setError([
        rejected.length ? `Could not add ${rejected.join(', ')}. Use PNG, JPG, or WebP up to 25 MB each.` : '',
        files.length > remaining ? `The bank holds up to ${MAX_IMAGES} images.` : '',
      ].filter(Boolean).join(' '))
      setImporting(false)
    }
    importLock.current = false
  }

  function place(id: string, index: number) {
    if (!byId.has(id)) return
    setSlots((current) => placeImage(current, index, id))
    setNotice(`Placed ${byId.get(id)!.name} in position ${index + 1}.`)
  }

  function startDrag(event: DragEvent, id: string) {
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData(DRAG_TYPE, id)
    setSelectedId(id)
  }

  function drop(event: DragEvent, index: number) {
    event.preventDefault()
    setDropTarget(null)
    const id = event.dataTransfer.getData(DRAG_TYPE)
    if (id) place(id, index)
  }

  function removeImage(id: string) {
    const image = byId.get(id)
    if (image) {
      URL.revokeObjectURL(image.url)
      urls.current.delete(image.url)
    }
    setImages((current) => current.filter((item) => item.id !== id))
    setSlots((current) => current.map((slot) => slot === id ? null : slot))
    if (selectedId === id) setSelectedId(null)
  }

  function autoFill() {
    setSlots((current) => {
      const next = [...current]
      const assigned = new Set(current.filter(Boolean))
      const available = images.filter((image) => !assigned.has(image.id))
      for (let index = 0; index < size * size; index++) {
        if (!next[index]) next[index] = available.shift()?.id ?? null
      }
      return next
    })
    setNotice('Filled empty positions in image-bank order.')
  }

  async function download() {
    setBusy(true)
    setError('')
    try {
      const blob = await exportStoryboard(images, visibleSlots, size, width, gutter, fit)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `storyboard-${size}x${size}-${width}.png`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('Storyboard exported as PNG.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to export this grid.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sb-workspace">
      <section className={`sb-bank ${bankDragging ? 'is-hot' : ''}`} aria-label="Image bank"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
            setBankDragging(true)
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setBankDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setBankDragging(false)
          void addFiles(Array.from(event.dataTransfer.files))
        }}>
        <div className="sb-section-head">
          <h2>Image bank</h2><span>{images.length} / {MAX_IMAGES}</span>
        </div>
        <label className="sb-upload" htmlFor={uploadId}>
          <ImagePlus size={20} aria-hidden="true" />
          <span>{importing ? 'Adding images…' : bankDragging ? 'Drop images here' : 'Drop images or browse'}</span>
          <small>PNG · JPG · WebP</small>
        </label>
        <input id={uploadId} aria-label="Add storyboard images" type="file" accept="image/png,image/jpeg,image/webp" multiple
          className="sr-only" disabled={importing}
          onChange={(event) => {
            void addFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }} />
        <p className="sb-bank-help">Drag a shot into any position, or select it here and click a position.</p>
        <div className="sb-shot-grid">
          {images.map((image) => (
            <div className="sb-shot" key={image.id}>
              <button type="button" draggable onDragStart={(event) => startDrag(event, image.id)}
                className={`sb-thumb ${selectedId === image.id ? 'is-selected' : ''} ${used.has(image.id) ? 'is-used' : ''}`}
                aria-pressed={selectedId === image.id} aria-label={`Select ${image.name}`}
                title={image.name} onClick={() => setSelectedId(image.id)}>
                <img src={image.url} alt={image.name} draggable={false} />
                {used.has(image.id) ? <span className="sb-used"><Check size={13} />Placed</span> : null}
              </button>
              <button className="sb-remove" type="button" aria-label={`Delete ${image.name} from bank`}
                onClick={() => removeImage(image.id)}><X size={12} /></button>
              <span className="sb-shot-name" title={image.name}>{image.name}</span>
            </div>
          ))}
        </div>
        {!images.length ? <p className="sb-bank-empty">Add your stills here. They stay in the bank as you arrange the board.</p> : null}
      </section>

      <section className="sb-builder" aria-label="Storyboard builder">
        <div className="sb-section-head sb-builder-head">
          <div><h1>Storyboard</h1><p>{used.size} of {size * size} positions filled</p></div>
          <button type="button" className="sb-action sb-export" disabled={!used.size || busy || importing}
            onClick={() => void download()}><Download size={12} />{busy ? 'Exporting…' : 'Export PNG'}</button>
        </div>
        <div className="sb-toolbar">
          <div className="sb-presets" role="group" aria-label="Grid size">
            {[2, 3, 4, 5].map((value) => <button key={value} type="button" aria-pressed={size === value}
              onClick={() => setSize(value)}>{value}×{value}</button>)}
          </div>
          <button className="sb-action" type="button" disabled={!images.length || importing} onClick={autoFill}>Auto fill</button>
          <button className="sb-action" type="button" disabled={!used.size && !hiddenCount}
            onClick={() => { setSlots(Array(25).fill(null)); setNotice('Board cleared. Images remain in the bank.') }}>Clear board</button>
          <label>Image fit<select aria-label="Image fit" value={fit} onChange={(event) => setFit(event.target.value as ImageFit)}>
            <option value="contain">Fit entire image</option><option value="cover">Fill and crop</option>
          </select></label>
          <label>Gap<select aria-label="Grid gap" value={gutter} onChange={(event) => setGutter(Number(event.target.value))}>
            {[0, 4, 8, 16, 24].map((value) => <option key={value} value={value}>{value} px</option>)}
          </select></label>
          <label>Export size<select aria-label="Export size" value={width} onChange={(event) => setWidth(Number(event.target.value))}>
            <option value={1920}>1920 × 1080</option><option value={3840}>3840 × 2160</option>
          </select></label>
        </div>
        <p className="sb-instructions">{selected ? `Selected: ${selected.name}. Click a position to place it.` : 'Drop an image from the bank into any position.'} Drag placed images to swap. Delete clears a focused position.</p>
        <div className="sb-board" aria-label={`${size} by ${size} storyboard`}
          style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`, columnGap: `${gutter / width * 100}%`, rowGap: `${gutter / (width * 9 / 16) * 100}%` }}>
          {visibleSlots.map((id, index) => {
            const image = id ? byId.get(id) : undefined
            return (
              <div key={index} className={`sb-slot ${image ? 'is-filled' : ''} ${dropTarget === index ? 'is-hot' : ''}`}>
                <button type="button" className="sb-slot-target" draggable={Boolean(image)}
                  aria-label={`Position ${index + 1}${image ? `: ${image.name}` : ': empty'}`}
                  onClick={() => { if (selectedId) place(selectedId, index); else if (id) setSelectedId(id) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Delete' || event.key === 'Backspace') {
                      event.preventDefault()
                      setSlots((current) => current.map((slot, slotIndex) => slotIndex === index ? null : slot))
                    }
                  }}
                  onDragStart={(event) => { if (id) startDrag(event, id) }}
                  onDragEnd={() => setDropTarget(null)}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); setDropTarget(index) }
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(event) => drop(event, index)}>
                  {image ? <img src={image.url} alt={image.name} draggable={false} style={{ objectFit: fit }} />
                    : <span className="sb-empty-mark"><Plus size={16} /><span>{String(index + 1).padStart(2, '0')}</span></span>}
                </button>
                {image ? <button type="button" className="sb-remove" aria-label={`Clear position ${index + 1}`}
                  onClick={() => setSlots((current) => current.map((slot, slotIndex) => slotIndex === index ? null : slot))}><X size={12} /></button> : null}
              </div>
            )
          })}
        </div>
        <div className="sb-footer"><span>16:9 board · {width} × {width * 9 / 16} PNG</span><span>Images stay on this device. Export before closing the page.</span></div>
        {hiddenCount ? <p className="sb-instructions">{hiddenCount} placement(s) outside this layout are kept for the larger grid and excluded from export.</p> : null}
        <p role="status" className="sb-notice">{notice}</p>
        {error ? <p role="alert" className="sb-error">{error}</p> : null}
      </section>
    </div>
  )
}
