import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoryboardWorkspace } from './storyboard-workspace'
import { exportStoryboard, placeImage } from '../lib/storyboard'

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
})

describe('storyboard export', () => {
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
