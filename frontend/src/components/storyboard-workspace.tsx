import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import { Check, Download, ImagePlus, Plus, X } from 'lucide-react'
import { exportStoryboard, placeImage, storyboardCells, storyboardDimensions, type HeroCorner, type ImageFit, type ImageFraming, type StoryboardImage, type StoryboardLayout } from '../lib/storyboard'
import { StoryboardSelect } from './storyboard-select'
import './storyboard-workspace.css'

const DRAG_TYPE = 'application/x-splitter-storyboard'
const MAX_IMAGES = 100

// Adapted from PinDeck's BoardStoryboardWorkspace: shot rail, selected shot,
// used-shot markers, and drop targets. This workspace works directly with local files.
export function StoryboardWorkspace() {
  const uploadId = useId()
  const [images, setImages] = useState<StoryboardImage[]>([])
  const [size, setSize] = useState(3)
  const [layout, setLayout] = useState<StoryboardLayout>('grid')
  const [heroSpan, setHeroSpan] = useState(2)
  const [heroCorner, setHeroCorner] = useState<HeroCorner>('top-left')
  const [sideHeroWeight, setSideHeroWeight] = useState(2)
  const [sideHeroSide, setSideHeroSide] = useState<'left' | 'right'>('left')
  const [adjusting, setAdjusting] = useState(false)
  const [activeSlot, setActiveSlot] = useState(0)
  const [framing, setFraming] = useState<Record<string, ImageFraming>>({})
  const pan = useRef<{ id: string; startX: number; startY: number; x: number; y: number; overflowX: number; overflowY: number } | null>(null)
  // Keep the larger layout's placements when switching temporarily to a smaller grid.
  const [slots, setSlots] = useState<Array<string | null>>(() => Array(25).fill(null))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [bankDragging, setBankDragging] = useState(false)
  const [fit, setFit] = useState<ImageFit>('cover')
  const [gutter, setGutter] = useState(0)
  const [width, setWidth] = useState(3840)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [backgroundGray, setBackgroundGray] = useState(255)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const backgroundLock = useRef(false)
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

  const dimensions = storyboardDimensions(width)
  const cells = storyboardCells(layout, size, dimensions.width, dimensions.height, gutter, heroSpan, heroCorner, sideHeroWeight, sideHeroSide)
  const visibleSlots = slots.slice(0, cells.length)
  const used = new Set(visibleSlots.filter(Boolean))
  const byId = new Map(images.map((image) => [image.id, image]))
  const selected = selectedId ? byId.get(selectedId) : undefined
  const hiddenCount = slots.slice(cells.length).filter(Boolean).length
  const framedImage = byId.get(visibleSlots[activeSlot] ?? '')
  const activeFraming = framedImage ? framing[framedImage.id] : undefined

  function updateFraming(id: string, patch: Partial<ImageFraming>) {
    setFraming((current) => ({ ...current, [id]: { ...(current[id] ?? { x: 50, y: 50 }), ...patch } }))
  }

  async function addFiles(files: File[]) {
    if (importLock.current || backgroundLock.current || !files.length) return
    importLock.current = true
    setImporting(true)
    setError('')
    setNotice('')
    const added: StoryboardImage[] = []
    const rejected: string[] = []
    const remaining = MAX_IMAGES - images.length
    for (const file of files.slice(0, remaining)) {
      if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 100 * 1024 * 1024) {
        rejected.push(file.name)
        continue
      }
      try {
        const bitmap = await createImageBitmap(file)
        const dimensions = { width: bitmap.width, height: bitmap.height }
        bitmap.close()
        if (!mounted.current) return
        const url = URL.createObjectURL(file)
        urls.current.add(url)
        added.push({ id: crypto.randomUUID(), name: file.name, url, file, ...dimensions })
      } catch {
        rejected.push(file.name)
      }
    }
    if (mounted.current) {
      setImages((current) => [...current, ...added])
      if (added.length) setSelectedId(added[0].id)
      setNotice(`${added.length} image${added.length === 1 ? '' : 's'} added to the bank.`)
      setError([
        rejected.length ? `Could not add ${rejected.join(', ')}. Use PNG, JPG, or WebP up to 100 MB each.` : '',
        files.length > remaining ? `The bank holds up to ${MAX_IMAGES} images.` : '',
      ].filter(Boolean).join(' '))
      setImporting(false)
    }
    importLock.current = false
  }

  function place(id: string, index: number) {
    if (!byId.has(id)) return
    setSlots((current) => placeImage(current, index, id))
    setActiveSlot(index)
    setNotice(`Placed ${byId.get(id)!.name} in position ${index + 1}.`)
  }

  async function removeBackground(image: StoryboardImage) {
    if (backgroundLock.current || images.length >= MAX_IMAGES) return
    backgroundLock.current = true
    setRemovingId(image.id)
    setError('')
    setNotice(`Removing background from ${image.name}…`)
    const gray = backgroundGray
    try {
      const form = new FormData()
      form.append('file', image.file)
      form.append('gray', String(gray))
      const response = await fetch('/api/storyboard/background-jobs', { method: 'POST', body: form })
      if (!response.ok) {
        const problem = await response.json().catch(() => null)
        throw new Error(typeof problem?.detail === 'string' ? problem.detail : 'Unable to remove background. Please try again.')
      }
      let job = await response.json()
      const jobId = job.job_id
      const labels: Record<string, string> = { queued: 'Queued', 'preparing-image': 'Preparing image', 'waiting-for-gpu': 'Waiting for GPU', 'loading-birefnet': 'Loading hair detail model', 'removing-background': 'Removing background' }
      while (job.status !== 'completed') {
        if (job.status === 'failed') throw new Error(job.error || 'Unable to remove background. Please retry.')
        if (!mounted.current) return
        setNotice(`${labels[job.stage] ?? 'Processing'}: ${image.name}…`)
        await new Promise((resolve) => window.setTimeout(resolve, 1500))
        const status = await fetch(`/api/storyboard/background-jobs/${jobId}`)
        if (!status.ok) throw new Error('Unable to check processing status. Please retry.')
        job = await status.json()
      }
      const output = await fetch(`/api/storyboard/background-jobs/${jobId}/output`)
      if (!output.ok) throw new Error('Unable to download the processed shot. Please retry.')
      const blob = await output.blob()
      const bitmap = await createImageBitmap(blob)
      const dimensions = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      if (!mounted.current) return
      const name = `${image.name.replace(/\.[^.]+$/, '')}-background-${gray}.png`
      const file = new File([blob], name, { type: 'image/png' })
      const url = URL.createObjectURL(file)
      urls.current.add(url)
      const copy = { id: crypto.randomUUID(), name, file, url, ...dimensions }
      setImages((current) => [...current, copy])
      setSelectedId(copy.id)
      setNotice('Background removed. A new shot was added; the original and board are unchanged.')
    } catch (cause) {
      if (mounted.current) {
        setNotice('')
        setError(cause instanceof Error ? cause.message : 'Unable to remove background.')
      }
    } finally {
      backgroundLock.current = false
      if (mounted.current) setRemovingId(null)
    }
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
    if (removingId === id) return
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
      for (let index = 0; index < cells.length; index++) {
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
      const blob = await exportStoryboard(images, visibleSlots, size, width, gutter, fit, { layout, framing, heroSpan, heroCorner, sideHeroWeight, sideHeroSide })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `storyboard-${layout}-${size}-${dimensions.width}x${dimensions.height}.png`
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
          className="sr-only" disabled={importing || Boolean(removingId)}
          onChange={(event) => {
            void addFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }} />
        <p className="sb-bank-help">Drag a shot into any position, or select it here and click a position.</p>
        <div className="sb-background" aria-label="Background removal settings">
          <span>New background</span>
          <div className="sb-background-row">
            <input type="range" min="0" max="255" step="1" value={backgroundGray} aria-label="Background shade"
              onChange={(event) => setBackgroundGray(Number(event.target.value))} />
            <span className="sb-background-swatch" style={{ background: `rgb(${backgroundGray}, ${backgroundGray}, ${backgroundGray})` }} aria-hidden="true" />
            <output>{Math.round(backgroundGray / 255 * 100)}%</output>
          </div>
          <div className="sb-presets" role="group" aria-label="Background presets">
            {[{ value: 0, label: 'Black' }, { value: 128, label: '50% gray' }, { value: 255, label: 'White' }].map((shade) =>
              <button type="button" key={shade.value} aria-pressed={backgroundGray === shade.value} onClick={() => setBackgroundGray(shade.value)}>{shade.label}</button>)}
          </div>
          <small>Remove a shot’s background to create an opaque copy.</small>
        </div>
        <div className="sb-shot-grid">
          {images.map((image) => (
            <div className="sb-shot" key={image.id}>
              <button type="button" draggable onDragStart={(event) => startDrag(event, image.id)}
                className={`sb-thumb ${selectedId === image.id ? 'is-selected' : ''} ${used.has(image.id) ? 'is-used' : ''}`}
                aria-pressed={selectedId === image.id} aria-label={`Select ${image.name}`}
                title={image.name} onClick={() => setSelectedId(image.id)}>
                <img src={image.url} alt={image.name} draggable={false} />
              </button>
              <button className="sb-remove" type="button" aria-label={`Delete ${image.name} from bank`}
                disabled={removingId === image.id}
                onClick={() => removeImage(image.id)}><X size={12} /></button>
              <span className="sb-shot-name" title={image.name}>{image.name}</span>
              <span className="sb-used">{used.has(image.id) ? <><Check size={12} />Placed</> : '\u00a0'}</span>
              <button type="button" className="sb-action sb-remove-background" aria-label={`Remove background from ${image.name}`}
                disabled={Boolean(removingId) || importing || images.length >= MAX_IMAGES}
                onClick={() => void removeBackground(image)}>{removingId === image.id ? 'Removing…' : 'Remove background'}</button>
            </div>
          ))}
        </div>
        {!images.length ? <p className="sb-bank-empty">Add your stills here. They stay in the bank as you arrange the board.</p> : null}
      </section>

      <section className="sb-builder" aria-label="Storyboard builder">
        <div className="sb-section-head sb-builder-head">
          <div><h1>Storyboard</h1><p>{used.size} of {cells.length} positions filled</p></div>
          <button type="button" className="sb-action sb-export" disabled={!used.size || busy || importing}
            onClick={() => void download()}><Download size={12} />{busy ? 'Exporting…' : 'Export PNG'}</button>
        </div>
        <div className="sb-toolbar">
          <div className="sb-presets" role="group" aria-label="Storyboard layout">
            {(['grid', 'hero', 'strip', 'feature', 'portrait', 'mixed'] as const).map((value) => <button key={value} type="button" aria-pressed={layout === value}
              onClick={() => setLayout(value)}>{value === 'grid' ? 'Grid' : value === 'hero' ? 'Hero' : value === 'strip' ? 'Strip' : value === 'feature' ? 'Side hero' : value === 'portrait' ? 'Portrait panels' : 'Mixed'}</button>)}
          </div>
          {layout !== 'mixed' ?
          <div className="sb-presets" role="group" aria-label="Grid size">
            {[2, 3, 4, 5].map((value) => <button key={value} type="button" aria-pressed={size === value}
              onClick={() => setSize(value)}>{layout === 'feature' ? `1 + ${value}` : layout === 'portrait' ? `${value} panels` : `${value}×${value}`}</button>)}
          </div>
          : <span className="sb-single-label">2 portrait · 4 square · 4 wide</span>}
          {layout === 'hero' ? <>
            <StoryboardSelect label="Hero span" value={String(Math.min(heroSpan, size - 1))} onChange={(value) => setHeroSpan(Number(value))}
              options={Array.from({ length: Math.max(1, size - 2) }, (_, index) => { const span = size === 2 ? 1 : index + 2; return { value: String(span), label: `${span}×${span} cells` } })} />
            <StoryboardSelect label="Hero position" value={heroCorner} onChange={(value) => setHeroCorner(value as HeroCorner)}
              options={[{ value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' }, { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' }]} />
          </> : null}
          {layout === 'feature' ? <>
            <StoryboardSelect label="Hero width" value={String(sideHeroWeight)} onChange={(value) => setSideHeroWeight(Number(value))}
              options={[{ value: '1', label: 'Equal widths' }, { value: '1.5', label: '1.5× a view' }, { value: '2', label: '2× a view' }, { value: '3', label: '3× a view' }]} />
            <StoryboardSelect label="Hero side" value={sideHeroSide} onChange={(value) => setSideHeroSide(value as 'left' | 'right')}
              options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
          </> : null}
          <button className="sb-action" type="button" disabled={!images.length || importing} onClick={autoFill}>Auto fill</button>
          <button className="sb-action" type="button" disabled={!used.size && !hiddenCount}
            onClick={() => { setSlots(Array(25).fill(null)); setNotice('Board cleared. Images remain in the bank.') }}>Clear board</button>
          <button className="sb-action" type="button" aria-pressed={adjusting} disabled={!used.size}
            onClick={() => { setAdjusting(!adjusting); setActiveSlot(Math.max(0, visibleSlots.findIndex(Boolean))) }}>Adjust framing</button>
          <div className="sb-output-controls">
          <StoryboardSelect label="Image fit" value={activeFraming?.fit ?? fit} onChange={(value) => {
            if (framedImage) updateFraming(framedImage.id, { fit: value as ImageFit })
            else setFit(value as ImageFit)
          }}
            options={[{ value: 'contain', label: 'Fit entire image' }, { value: 'cover', label: 'Fill and crop' }]} />
          <StoryboardSelect label="Grid gap" value={String(gutter)} onChange={(value) => setGutter(Number(value))}
            options={[0, 4, 8, 16, 24].map((value) => ({ value: String(value), label: `${value} px` }))} />
          <StoryboardSelect label="Export size" value={String(width)} onChange={(value) => setWidth(Number(value))}
            options={[1920, 3840].map((value) => { const output = storyboardDimensions(value); return { value: String(value), label: `${output.width} × ${output.height}` } })} />
          </div>
        </div>
        <p className="sb-instructions">{adjusting ? 'Framing mode: choose a placed image. Use Fill and crop, then drag inside its frame to reposition it.' : <>{selected ? `Selected: ${selected.name}. Click a position to place it.` : 'Drop an image from the bank into any position.'} Drag placed images to swap. Delete clears a focused position.</>}</p>
        {adjusting && framedImage ? <div className="sb-framing" aria-label="Image framing controls">
          <span title={framedImage.name}>Position {activeSlot + 1} · {framedImage.name}</span>
          <div className="sb-presets" role="group" aria-label="Horizontal alignment">
            {[{ value: 0, label: 'Left' }, { value: 50, label: 'Center' }, { value: 100, label: 'Right' }].map((alignment) =>
              <button key={alignment.value} type="button" aria-label={`Align ${alignment.label.toLowerCase()}`} aria-pressed={(activeFraming?.x ?? 50) === alignment.value}
                onClick={() => updateFraming(framedImage.id, { x: alignment.value })}>{alignment.label}</button>)}
          </div>
          <div className="sb-presets" role="group" aria-label="Vertical alignment">
            {[{ value: 0, label: 'Top' }, { value: 50, label: 'Middle' }, { value: 100, label: 'Bottom' }].map((alignment) =>
              <button key={alignment.value} type="button" aria-label={`Align ${alignment.label.toLowerCase()}`} aria-pressed={(activeFraming?.y ?? 50) === alignment.value}
                onClick={() => updateFraming(framedImage.id, { y: alignment.value })}>{alignment.label}</button>)}
          </div>
          <div className="sb-presets sb-scale" role="group" aria-label="Image scale">
            <button type="button" aria-label="Scale down 25 percent" disabled={(activeFraming?.zoom ?? 100) <= 25}
              onClick={() => updateFraming(framedImage.id, { zoom: Math.max(25, (activeFraming?.zoom ?? 100) - 25) })}>−25%</button>
            <output aria-label="Current image scale">{activeFraming?.zoom ?? 100}%</output>
            <button type="button" aria-label="Scale up 25 percent" disabled={(activeFraming?.zoom ?? 100) >= 400}
              onClick={() => updateFraming(framedImage.id, { zoom: Math.min(400, (activeFraming?.zoom ?? 100) + 25) })}>+25%</button>
            <button type="button" onClick={() => updateFraming(framedImage.id, { zoom: 100 })}>Reset scale</button>
          </div>
        </div> : null}
        <div className="sb-board-stage">
        <div className="sb-board" aria-label={`${size} ${layout} storyboard`}
          style={{ aspectRatio: '16 / 9' }}>
          {visibleSlots.map((id, index) => {
            const image = id ? byId.get(id) : undefined
            const frame = id ? framing[id] : undefined
            const cell = cells[index]
            const sourceWidth = image?.width ?? cell.width
            const sourceHeight = image?.height ?? cell.height
            const baseScale = (frame?.fit ?? fit) === 'cover' ? Math.max(cell.width / sourceWidth, cell.height / sourceHeight) : Math.min(cell.width / sourceWidth, cell.height / sourceHeight)
            const scale = baseScale * ((frame?.zoom ?? 100) / 100)
            const drawWidth = sourceWidth * scale
            const drawHeight = sourceHeight * scale
            return (
              <div key={index} className={`sb-slot ${image ? 'is-filled' : ''} ${dropTarget === index ? 'is-hot' : ''} ${adjusting && activeSlot === index ? 'is-framing' : ''}`}
                style={{ left: `${cells[index].x / dimensions.width * 100}%`, top: `${cells[index].y / dimensions.height * 100}%`, width: `${cells[index].width / dimensions.width * 100}%`, height: `${cells[index].height / dimensions.height * 100}%` }}>
                <button type="button" className={`sb-slot-target ${adjusting ? 'is-adjusting' : ''}`} draggable={Boolean(image) && !adjusting}
                  aria-label={`Position ${index + 1}${image ? `: ${image.name}` : ': empty'}`}
                  onClick={() => { if (adjusting) setActiveSlot(index); else if (selectedId) place(selectedId, index); else if (id) setSelectedId(id) }}
                  onPointerDown={(event) => {
                    if (!adjusting || !image) return
                    setActiveSlot(index)
                    if ((framing[image.id]?.fit ?? fit) !== 'cover') return
                    const img = event.currentTarget.querySelector('img')
                    if (!img?.naturalWidth) return
                    const rect = event.currentTarget.getBoundingClientRect()
                    const scale = Math.max(rect.width / img.naturalWidth, rect.height / img.naturalHeight) * ((framing[image.id]?.zoom ?? 100) / 100)
                    pan.current = { id: image.id, startX: event.clientX, startY: event.clientY, x: framing[image.id]?.x ?? 50, y: framing[image.id]?.y ?? 50,
                      overflowX: img.naturalWidth * scale - rect.width, overflowY: img.naturalHeight * scale - rect.height }
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    const drag = pan.current
                    if (!drag) return
                    updateFraming(drag.id, {
                      x: drag.overflowX > .5 ? Math.max(0, Math.min(100, drag.x - (event.clientX - drag.startX) / drag.overflowX * 100)) : drag.x,
                      y: drag.overflowY > .5 ? Math.max(0, Math.min(100, drag.y - (event.clientY - drag.startY) / drag.overflowY * 100)) : drag.y,
                    })
                  }}
                  onPointerUp={() => { pan.current = null }} onPointerCancel={() => { pan.current = null }}
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
                  {image ? <img src={image.url} alt={image.name} draggable={false}
                    onLoad={(event) => {
                      if (image.width && image.height) return
                      const { naturalWidth, naturalHeight } = event.currentTarget
                      if (naturalWidth && naturalHeight) setImages((current) => current.map((item) => item.id === image.id ? { ...item, width: naturalWidth, height: naturalHeight } : item))
                    }}
                    style={image.width && image.height ? {
                    position: 'absolute', width: `${drawWidth / cell.width * 100}%`, height: `${drawHeight / cell.height * 100}%`, maxWidth: 'none',
                    left: `${(cell.width - drawWidth) * ((frame?.x ?? 50) / 100) / cell.width * 100}%`, top: `${(cell.height - drawHeight) * ((frame?.y ?? 50) / 100) / cell.height * 100}%`,
                  } : { width: '100%', height: '100%', objectFit: frame?.fit ?? fit, objectPosition: `${frame?.x ?? 50}% ${frame?.y ?? 50}%` }} />
                    : <span className="sb-empty-mark"><Plus size={16} /><span>{layout === 'feature' ? index === 0 ? 'Hero / headshot' : `View ${index}` : layout === 'portrait' ? `Portrait ${index + 1}` : layout === 'mixed' ? index < 2 ? `Portrait ${index + 1}` : index < 6 ? `Detail ${index - 1}` : `Wide ${index - 5}` : String(index + 1).padStart(2, '0')}</span></span>}
                </button>
                {image ? <button type="button" className="sb-remove" aria-label={`Clear position ${index + 1}`}
                  onClick={() => setSlots((current) => current.map((slot, slotIndex) => slotIndex === index ? null : slot))}><X size={12} /></button> : null}
              </div>
            )
          })}
        </div>
        </div>
        <div className="sb-footer"><span>16:9 landscape sheet · {dimensions.width} × {dimensions.height} PNG{layout === 'portrait' ? ' · upright portrait panels' : ''}</span><span>Background removal processes a copy on the server. Export before closing the page.</span></div>
        {hiddenCount ? <p className="sb-instructions">{hiddenCount} placement(s) outside this layout are kept for the larger grid and excluded from export.</p> : null}
        <p role="status" className="sb-notice">{notice}</p>
        {error ? <p role="alert" className="sb-error">{error}</p> : null}
      </section>
    </div>
  )
}
