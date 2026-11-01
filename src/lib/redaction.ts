/**
 * A rectangle blacked out on a receipt image. Coordinates are fractions of
 * the image's width and height (0..1), so the same box applies to the
 * original upload and to any resized copy of it.
 */
export type RedactionBox = {
  x: number
  y: number
  width: number
  height: number
  /** What the box hides, when it came from a suggestion ("order number"). */
  label?: string
}

/** Boxes smaller than this fraction on either side are treated as misclicks. */
export const MIN_BOX_SIDE = 0.005

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Builds a box from two corner points in any order, clamped to the image. */
export function boxFromPoints(
  ax: number,
  ay: number,
  bx: number,
  by: number
): RedactionBox {
  const x0 = clamp01(Math.min(ax, bx))
  const y0 = clamp01(Math.min(ay, by))
  const x1 = clamp01(Math.max(ax, bx))
  const y1 = clamp01(Math.max(ay, by))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** Shifts a box by a delta while keeping it fully inside the image. */
export function moveBox(
  box: RedactionBox,
  dx: number,
  dy: number
): RedactionBox {
  return {
    ...box,
    x: Math.min(1 - box.width, Math.max(0, box.x + dx)),
    y: Math.min(1 - box.height, Math.max(0, box.y + dy)),
  }
}

export function isUsableBox(box: RedactionBox): boolean {
  return box.width >= MIN_BOX_SIDE && box.height >= MIN_BOX_SIDE
}

/**
 * Converts a vision-model box given as [x0, y0, x1, y1] in pixels of the
 * image it saw into a fractional box. The box is padded a little because
 * models tend to clip the first and last glyph of a value. Returns null for
 * anything that is not a usable rectangle inside the image.
 */
export function boxFromModelPixels(
  coords: readonly number[],
  imageWidth: number,
  imageHeight: number,
  label?: string
): RedactionBox | null {
  if (coords.length !== 4 || imageWidth <= 0 || imageHeight <= 0) return null
  if (!coords.every((value) => Number.isFinite(value))) return null
  const [ax, ay, bx, by] = coords
  const height = Math.abs(by - ay)
  const padX = imageWidth * 0.01
  const padY = Math.max(height * 0.25, imageHeight * 0.002)
  const box = boxFromPoints(
    (Math.min(ax, bx) - padX) / imageWidth,
    (Math.min(ay, by) - padY) / imageHeight,
    (Math.max(ax, bx) + padX) / imageWidth,
    (Math.max(ay, by) + padY) / imageHeight
  )
  if (!isUsableBox(box)) return null
  // A box covering most of the image is a model failure, not a redaction.
  if (box.width * box.height > 0.5) return null
  return label ? { ...box, label } : box
}
