import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoryboardWorkspace } from './storyboard-workspace'
import { exportStoryboard, placeImage, storyboardCells, storyboardDimensions, type HeroCorner, type StoryboardLayout } from '../lib/storyboard'

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 640, height: 360, close: vi.fn() }))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function upload(names = ['first.png', 'second.png']) {
  fireEvent.drop(screen.getByRole('region', { name: 'Image bank' }), {
    dataTransfer: { files: names.map((name) => new File(['image'], name, { type: 'image/png' })) },
  })
  await screen.findByRole('button', { name: `Select ${names[0]}` })
}

describe('storyboard workspace', () => {
  it('adds an opaque background-removal copy without replacing the original or its placement', async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ job_id: 'test-job', status: 'completed' }) })
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['png'], { type: 'image/png' }) })
    vi.stubGlobal('fetch', request)
    render(<StoryboardWorkspace />)
    await upload(['original.png'])
    fireEvent.click(screen.getByRole('button', { name: 'Auto fill' }))
    fireEvent.click(screen.getByRole('button', { name: '50% gray' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove background from original.png' }))
    await screen.findByRole('button', { name: 'Select original-background-128.png' })
    expect(screen.getByRole('button', { name: 'Select original.png' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Position 1: original.png' })).toBeVisible()
    const form = request.mock.calls[0][1].body as FormData
    expect(form.get('gray')).toBe('128')
    expect((form.get('file') as File).name).toBe('original.png')
  })

  it('keeps the original on background failure and lets the user retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: 'Model unavailable' }) }))
    render(<StoryboardWorkspace />)
    await upload(['original.png'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove background from original.png' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Model unavailable'))
    expect(screen.getByRole('button', { name: 'Remove background from original.png' })).toBeEnabled()
    expect(screen.getAllByRole('button', { name: /^Select / })).toHaveLength(1)
  })

  it('places a batch, swaps dragged shots, keeps images in the bank, and preserves larger layouts', async () => {
    render(<StoryboardWorkspace />)
    await upload()
    fireEvent.click(screen.getByRole('button', { name: 'Auto fill' }))
    expect(screen.getByRole('button', { name: 'Position 1: first.png' })).toBeVisible()
    const target = screen.getByRole('button', { name: 'Position 2: second.png' })
    // Exercise the actual drag payload produced by the bank, then the slot drop path.
    let draggedId = ''
    fireEvent.dragStart(screen.getByRole('button', { name: 'Select first.png' }), {
      dataTransfer: { setData: (_type: string, id: string) => { draggedId = id } },
    })
    fireEvent.drop(target, { dataTransfer: { getData: () => draggedId } })
    expect(screen.getByRole('button', { name: 'Position 1: second.png' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Position 2: first.png' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Position 9: empty' }))
    expect(screen.getByRole('button', { name: 'Position 9: first.png' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '2×2' }))
    expect(screen.getByText(/outside this layout/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '3×3' }))
    expect(screen.getByRole('button', { name: 'Position 9: first.png' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Clear board' }))
    expect(screen.getByRole('button', { name: 'Export PNG' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: /^Select / })).toHaveLength(2)
  })

  it('allows click placement and keyboard removal, rejects bad files, and releases removed previews', async () => {
    render(<StoryboardWorkspace />)
    await upload(['good.png', 'notes.txt'])
    expect(screen.getByRole('alert')).toHaveTextContent('notes.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Position 5: empty' }))
    const placed = screen.getByRole('button', { name: 'Position 5: good.png' })
    fireEvent.keyDown(placed, { key: 'Delete' })
    expect(screen.getByRole('button', { name: 'Position 5: empty' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Delete good.png from bank' }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image')
    expect(screen.queryByRole('button', { name: 'Select good.png' })).not.toBeInTheDocument()
  })

  it('reports unreadable image files without discarding existing images', async () => {
    render(<StoryboardWorkspace />)
    await upload(['good.png'])
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode failed'))
    fireEvent.change(screen.getByLabelText('Add storyboard images'), {
      target: { files: [new File(['broken'], 'broken.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('broken.png'))
    expect(screen.getByRole('button', { name: 'Select good.png' })).toBeVisible()
  })

  it('switches PinDeck layouts without losing shots and uses dark keyboard-operable format controls', async () => {
    render(<StoryboardWorkspace />)
    await upload()
    fireEvent.click(screen.getByRole('button', { name: 'Auto fill' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hero' }))
    expect(screen.getAllByRole('button', { name: /^Position / })).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Position 1: first.png' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Strip' }))
    expect(screen.getAllByRole('button', { name: /^Position / })).toHaveLength(4)
    const format = screen.getByRole('combobox', { name: 'Export size' })
    fireEvent.click(format)
    fireEvent.click(screen.getByRole('option', { name: '1920 × 1080' }))
    expect(format).toHaveTextContent('1920 × 1080')
    fireEvent.keyDown(format, { key: 'End' })
    fireEvent.keyDown(format, { key: 'Enter' })
    expect(format).toHaveTextContent('3840 × 2160')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Board format' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Portrait panels' }))
    expect(screen.getAllByRole('button', { name: /^Position / })).toHaveLength(3)
    expect(screen.getByText(/upright portrait panels/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }))
    expect(screen.getAllByRole('button', { name: /^Position / })).toHaveLength(9)
    expect(screen.getByRole('button', { name: 'Position 2: second.png' })).toBeVisible()
  })
})

describe('storyboard export', () => {
  it.each([25, 100, 125, 200, 400])('keeps the source aspect ratio unchanged at %s percent scale', async (zoom) => {
    const ctx = { fillStyle: '', fillRect: vi.fn(), save: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn(), restore: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })))
    const file = new File(['image'], 'shot.png', { type: 'image/png' })
    await exportStoryboard([{ id: 'a', name: 'shot', url: 'blob:a', file }], ['a'], 3, 1920, 0, 'cover', {
      layout: 'feature', framing: { a: { x: 100, y: 0, zoom } },
    })
    const [, , , drawnWidth, drawnHeight] = ctx.drawImage.mock.calls[0]
    expect(drawnWidth / drawnHeight).toBeCloseTo(640 / 360)
    expect(drawnHeight).toBeCloseTo(1080 * zoom / 100)
  })
  it('lays out every style within a landscape board, without overlapping positions', () => {
    const dimensions = storyboardDimensions(1920)
    for (const layout of ['grid', 'hero', 'strip', 'feature', 'portrait', 'mixed'] as StoryboardLayout[]) {
      for (const size of [2, 3, 4, 5]) {
        const cells = storyboardCells(layout, size, dimensions.width, dimensions.height, 16)
        expect(cells).toHaveLength(layout === 'grid' ? size * size : layout === 'hero' ? size * size - Math.min(2, size - 1) ** 2 + 1 : layout === 'portrait' ? size : layout === 'mixed' ? 10 : size + 1)
        if (layout === 'mixed') {
          cells.slice(0, 2).forEach((cell) => expect(cell.width / cell.height).toBeCloseTo(9 / 16))
          cells.slice(2, 6).forEach((cell) => expect(cell.width).toBeCloseTo(cell.height))
          cells.slice(6).forEach((cell) => expect(cell.width).toBeGreaterThan(cell.height))
        }
        if (layout === 'portrait') {
          expect(cells[0].x).toBe(0)
          expect(cells.at(-1)!.x + cells.at(-1)!.width).toBeCloseTo(dimensions.width)
          cells.forEach((cell) => expect(cell.height).toBe(dimensions.height))
        }
        if (layout === 'feature') expect(cells[0].width * cells[0].height).toBeCloseTo(2 * cells[1].width * cells[1].height)
        for (const cell of cells) {
          expect(cell.x).toBeGreaterThanOrEqual(0)
          expect(cell.y).toBeGreaterThanOrEqual(0)
          expect(cell.x + cell.width).toBeLessThanOrEqual(dimensions.width + .001)
          expect(cell.y + cell.height).toBeLessThanOrEqual(dimensions.height + .001)
          for (const other of cells.filter((item) => item !== cell)) {
            const overlaps = cell.x < other.x + other.width - .001 && cell.x + cell.width > other.x + .001
              && cell.y < other.y + other.height - .001 && cell.y + cell.height > other.y + .001
            expect(overlaps).toBe(false)
          }
        }
      }
    }
  })

  it('exports per-image crop positioning inside the tall left feature without moving its board position', async () => {
    const ctx = { fillStyle: '', fillRect: vi.fn(), save: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn(), restore: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })))
    const file = new File(['image'], 'shot.png', { type: 'image/png' })
    const images = [{ id: 'a', name: 'shot', url: 'blob:a', file }]
    const options = { layout: 'feature' as const, framing: { a: { fit: 'cover' as const, x: 100, y: 50 } } }
    await exportStoryboard(images, ['a'], 3, 1920, 0, 'contain', options)
    expect(ctx.rect).toHaveBeenCalledExactlyOnceWith(0, 0, 768, 1080)
    expect(ctx.drawImage.mock.calls[0].slice(1)).toEqual([-1152, 0, 1920, 1080])
    expect(storyboardCells('feature', 3, 1920, 1080, 0)).toEqual([
      { x: 0, y: 0, width: 768, height: 1080 },
      { x: 768, y: 0, width: 384, height: 1080 },
      { x: 1152, y: 0, width: 384, height: 1080 },
      { x: 1536, y: 0, width: 384, height: 1080 },
    ])
  })

  it.each([
    ['hero', 1280, 720],
    ['strip', 1920, 1080 * 2.1 / 3.1],
  ] as const)('exports %s in landscape with the same large first frame as the preview', async (layout, heroWidth, heroHeight) => {
    const ctx = { fillStyle: '', fillRect: vi.fn(), save: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn(), restore: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
      expect([this.width, this.height]).toEqual([1920, 1080])
      callback(new Blob(['png'], { type: 'image/png' }))
    })
    const file = new File(['image'], 'shot.png', { type: 'image/png' })
    await exportStoryboard([{ id: 'a', name: 'shot', url: 'blob:a', file }], ['a'], 3, 1920, 0, 'cover', { layout })
    expect(ctx.rect).toHaveBeenCalledExactlyOnceWith(0, 0, heroWidth, heroHeight)
  })
  it('supports a four-cell hero or larger hero in any corner of a 4x4 grid', () => {
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as HeroCorner[]) {
      const cells = storyboardCells('hero', 4, 1920, 1080, 0, 2, corner)
      expect(cells).toHaveLength(13)
      expect(cells[0].width).toBe(960)
      expect(cells[0].height).toBe(540)
      expect(cells[0].x).toBe(corner.endsWith('right') ? 960 : 0)
      expect(cells[0].y).toBe(corner.startsWith('bottom') ? 540 : 0)
      expect(storyboardCells('hero', 4, 1920, 1080, 0, 3, corner)).toHaveLength(8)
    }
  })
  it('replaces a bank image without duplicating its source or losing the previous image', () => {
    expect(placeImage(['a', 'b', null], 1, 'a')).toEqual(['b', 'a', null])
    expect(placeImage(['a', 'b', null], 1, 'c')).toEqual(['a', 'c', null])
  })

  it('renders positions in order at the selected size and gap, leaving empty cells blank', async () => {
    const ctx = { fillStyle: '', fillRect: vi.fn(), save: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn(), restore: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
      expect([this.width, this.height]).toEqual([1920, 1080])
      callback(new Blob(['png'], { type: 'image/png' }))
    })
    const file = new File(['image'], 'shot.png', { type: 'image/png' })
    const blob = await exportStoryboard([{ id: 'a', name: 'shot', url: 'blob:a', file }], [null, null, null, 'a'], 2, 1920, 8, 'contain')
    expect(blob.type).toBe('image/png')
    expect(ctx.rect).toHaveBeenCalledExactlyOnceWith(964, 544, 956, 536)
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    expect(ctx.drawImage.mock.calls[0][1]).toBeCloseTo(965.5556)
    expect(ctx.drawImage.mock.calls[0][2]).toBe(544)
    expect(vi.mocked(createImageBitmap).mock.results).toHaveLength(1)
  })
})
