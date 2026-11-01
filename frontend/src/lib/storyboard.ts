export type StoryboardImage = { id: string; name: string; url: string; file: File }
export type ImageFit = 'contain' | 'cover'

// Moving between board cells swaps their contents; placing from the bank replaces a cell.
// Replaced images remain in the bank, and an image occupies at most one cell.
export function placeImage(slots: Array<string | null>, target: number, imageId: string) {
  const next = [...slots]
  const source = next.indexOf(imageId)
  if (source !== -1) next[source] = next[target]
  next[target] = imageId
  return next
}

export async function exportStoryboard(
  images: StoryboardImage[], slots: Array<string | null>, size: number,
  width: number, gutter: number, fit: ImageFit,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = width * 9 / 16
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image export is unavailable in this browser.')
  context.fillStyle = '#080808'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const cellWidth = (canvas.width - gutter * (size - 1)) / size
  const cellHeight = (canvas.height - gutter * (size - 1)) / size
  const byId = new Map(images.map((image) => [image.id, image]))
  for (let index = 0; index < size * size; index++) {
    const image = byId.get(slots[index] ?? '')
    if (!image) continue
    const bitmap = await createImageBitmap(image.file)
    try {
      const x = (index % size) * (cellWidth + gutter)
      const y = Math.floor(index / size) * (cellHeight + gutter)
      const scale = fit === 'cover'
        ? Math.max(cellWidth / bitmap.width, cellHeight / bitmap.height)
        : Math.min(cellWidth / bitmap.width, cellHeight / bitmap.height)
      const drawnWidth = bitmap.width * scale
      const drawnHeight = bitmap.height * scale
      context.save()
      context.beginPath()
      context.rect(x, y, cellWidth, cellHeight)
      context.clip()
      context.drawImage(bitmap, x + (cellWidth - drawnWidth) / 2, y + (cellHeight - drawnHeight) / 2, drawnWidth, drawnHeight)
      context.restore()
    } finally {
      bitmap.close()
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('Unable to export this grid. Try a smaller output size.')),
    'image/png',
  ))
}
