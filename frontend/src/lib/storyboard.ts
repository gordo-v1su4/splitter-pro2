export type StoryboardImage = { id: string; name: string; url: string; file: File; width?: number; height?: number }
export type ImageFit = 'contain' | 'cover'
export type StoryboardLayout = 'grid' | 'hero' | 'strip' | 'feature' | 'portrait' | 'mixed'
export type HeroCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type ImageFraming = { fit?: ImageFit; x: number; y: number; zoom?: number }

export function storyboardDimensions(width: number) {
  return { width, height: width * 9 / 16 }
}

// Shared by the visible board and the PNG renderer so every layout exports as shown.
export function storyboardCells(layout: StoryboardLayout, size: number, width: number, height: number, gap: number, heroSpan = 2, heroCorner: HeroCorner = 'top-left', sideHeroWeight = 2, sideHeroSide: 'left' | 'right' = 'left') {
  if (layout === 'mixed') {
    const topHeight = (width - 2 * gap) / (2 * 9 / 16 + 1)
    const portraitWidth = topHeight * 9 / 16
    const squareSize = (topHeight - gap) / 2
    const detailsX = 2 * (portraitWidth + gap)
    const wideWidth = (width - 3 * gap) / 4
    return [
      ...Array.from({ length: 2 }, (_, col) => ({ x: col * (portraitWidth + gap), y: 0, width: portraitWidth, height: topHeight })),
      ...Array.from({ length: 4 }, (_, index) => ({ x: detailsX + (index % 2) * (squareSize + gap), y: Math.floor(index / 2) * (squareSize + gap), width: squareSize, height: squareSize })),
      ...Array.from({ length: 4 }, (_, col) => ({ x: col * (wideWidth + gap), y: topHeight + gap, width: wideWidth, height: height - topHeight - gap })),
    ]
  }
  const cellWidth = (width - gap * (size - 1)) / size
  const cellHeight = (height - gap * (size - 1)) / size
  const cell = (col: number, row: number) => ({ x: col * (cellWidth + gap), y: row * (cellHeight + gap), width: cellWidth, height: cellHeight })
  if (layout === 'feature') {
    // One wide frame plus upright frames ACROSS the sheet, matching the reference.
    const smallWidth = (width - gap * size) / (size + sideHeroWeight)
    const heroWidth = smallWidth * sideHeroWeight
    return [
      { x: sideHeroSide === 'left' ? 0 : width - heroWidth, y: 0, width: heroWidth, height },
      ...Array.from({ length: size }, (_, col) => ({ x: (sideHeroSide === 'left' ? heroWidth + gap : 0) + col * (smallWidth + gap), y: 0, width: smallWidth, height })),
    ]
  }
  if (layout === 'portrait') {
    const frameWidth = (width - gap * (size - 1)) / size
    return Array.from({ length: size }, (_, col) => ({ x: col * (frameWidth + gap), y: 0, width: frameWidth, height }))
  }
  if (layout === 'strip') {
    const heroHeight = (height - gap) * 2.1 / 3.1
    return [
      { x: 0, y: 0, width, height: heroHeight },
      ...Array.from({ length: size }, (_, col) => ({ x: col * (cellWidth + gap), y: heroHeight + gap, width: cellWidth, height: height - heroHeight - gap })),
    ]
  }
  if (layout === 'hero') {
    const span = Math.max(1, Math.min(heroSpan, size - 1))
    const heroCol = heroCorner.endsWith('right') ? size - span : 0
    const heroRow = heroCorner.startsWith('bottom') ? size - span : 0
    const cells = [{ x: heroCol * (cellWidth + gap), y: heroRow * (cellHeight + gap), width: span * cellWidth + (span - 1) * gap, height: span * cellHeight + (span - 1) * gap }]
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (col >= heroCol && col < heroCol + span && row >= heroRow && row < heroRow + span) continue
        cells.push(cell(col, row))
      }
    }
    return cells
  }
  return Array.from({ length: size * size }, (_, index) => cell(index % size, Math.floor(index / size)))
}

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
  options: { layout?: StoryboardLayout; framing?: Record<string, ImageFraming>; heroSpan?: number; heroCorner?: HeroCorner; sideHeroWeight?: number; sideHeroSide?: 'left' | 'right' } = {},
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const dimensions = storyboardDimensions(width)
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image export is unavailable in this browser.')
  context.fillStyle = '#080808'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const cells = storyboardCells(options.layout ?? 'grid', size, canvas.width, canvas.height, gutter, options.heroSpan, options.heroCorner, options.sideHeroWeight, options.sideHeroSide)
  const byId = new Map(images.map((image) => [image.id, image]))
  for (let index = 0; index < cells.length; index++) {
    const image = byId.get(slots[index] ?? '')
    if (!image) continue
    const bitmap = await createImageBitmap(image.file)
    try {
      const { x, y, width: cellWidth, height: cellHeight } = cells[index]
      const framing = options.framing?.[image.id]
      const baseScale = (framing?.fit ?? fit) === 'cover'
        ? Math.max(cellWidth / bitmap.width, cellHeight / bitmap.height)
        : Math.min(cellWidth / bitmap.width, cellHeight / bitmap.height)
      const scale = baseScale * ((framing?.zoom ?? 100) / 100)
      const drawnWidth = bitmap.width * scale
      const drawnHeight = bitmap.height * scale
      context.save()
      context.beginPath()
      context.rect(x, y, cellWidth, cellHeight)
      context.clip()
      context.drawImage(bitmap, x + (cellWidth - drawnWidth) * ((framing?.x ?? 50) / 100), y + (cellHeight - drawnHeight) * ((framing?.y ?? 50) / 100), drawnWidth, drawnHeight)
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
