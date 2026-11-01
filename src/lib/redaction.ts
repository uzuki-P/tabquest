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

export type Corner = "nw" | "ne" | "sw" | "se"
export const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"]

/** Resizes a box by dragging one corner; the opposite corner stays put. */
export function resizeFromCorner(
  box: RedactionBox,
  corner: Corner,
  x: number,
  y: number
): RedactionBox {
  const anchorX = corner.endsWith("w") ? box.x + box.width : box.x
  const anchorY = corner.startsWith("n") ? box.y + box.height : box.y
  return { ...box, ...boxFromPoints(anchorX, anchorY, x, y) }
}

/** Area shared by two boxes, as a share of the smaller box. */
export function overlapRatio(a: RedactionBox, b: RedactionBox): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (width <= 0 || height <= 0) return 0
  const smaller = Math.min(a.width * a.height, b.width * b.height)
  return smaller > 0 ? (width * height) / smaller : 0
}

/**
 * Adds incoming boxes that do not mostly cover an existing one, so running
 * Parse twice does not stack duplicate suggestions.
 */
export function mergeBoxes(
  existing: readonly RedactionBox[],
  incoming: readonly RedactionBox[]
): RedactionBox[] {
  const merged = [...existing]
  for (const box of incoming) {
    if (!merged.some((other) => overlapRatio(box, other) > 0.6))
      merged.push(box)
  }
  return merged
}

/** A crop this close to the full image is no crop at all. */
export function isFullImage(box: RedactionBox): boolean {
  return (
    box.x <= 0.001 &&
    box.y <= 0.001 &&
    box.width >= 0.998 &&
    box.height >= 0.998
  )
}
