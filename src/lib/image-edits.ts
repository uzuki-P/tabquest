import { isFullImage, isUsableBox } from "@/lib/redaction"
import type { RedactionBox } from "@/lib/redaction"

/**
 * Edits made to a picked image. Every box, the crop included, is in
 * fractions of the original image, so boxes stay put when the crop changes.
 */
export type ImageEdits = {
  boxes: RedactionBox[]
  /** The area kept; null keeps the whole image. */
  crop: RedactionBox | null
}

export const NO_EDITS: ImageEdits = { boxes: [], crop: null }

export function hasEdits(edits: ImageEdits): boolean {
  return edits.boxes.length > 0 || edits.crop !== null
}

/** Drops boxes shrunk to nothing and a crop that keeps the whole image. */
export function cleanEdits(edits: ImageEdits): ImageEdits {
  const boxes = edits.boxes.filter(isUsableBox)
  const crop =
    edits.crop && isUsableBox(edits.crop) && !isFullImage(edits.crop)
      ? edits.crop
      : null
  if (boxes.length === edits.boxes.length && crop === edits.crop) return edits
  return { boxes, crop }
}

/**
 * A picked image together with its edits. `file` is the flattened copy that
 * gets uploaded; `source` is the untouched original, kept so the edits can be
 * changed again and so a newly picked file can be told apart from the one
 * these edits belong to.
 */
export type EditedImage = {
  source: File
  edits: ImageEdits
  file: File
  /** True while it holds Parse suggestions the admin has not reviewed. */
  suggested: boolean
}

/** Pixel rectangle covering a fractional box, rounded outward. */
function pixelRect(box: RedactionBox, width: number, height: number) {
  const x0 = Math.floor(box.x * width)
  const y0 = Math.floor(box.y * height)
  const x1 = Math.ceil((box.x + box.width) * width)
  const y1 = Math.ceil((box.y + box.height) * height)
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * Paints solid black rectangles over the image in the browser, crops it, and
 * returns the result as a JPEG. Solid fills, not blur, so nothing underneath
 * can be recovered. The server re-encodes uploads anyway, so JPEG keeps the
 * request small without costing quality that matters.
 */
export async function flattenEdits(
  source: Blob,
  edits: ImageEdits,
  name: string
): Promise<File> {
  const bitmap = await createImageBitmap(source)
  try {
    const crop = edits.crop
      ? pixelRect(edits.crop, bitmap.width, bitmap.height)
      : { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.min(crop.width, bitmap.width - crop.x))
    canvas.height = Math.max(1, Math.min(crop.height, bitmap.height - crop.y))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Canvas 2D is not available.")
    context.drawImage(bitmap, -crop.x, -crop.y)
    context.fillStyle = "#000"
    for (const box of edits.boxes) {
      const rect = pixelRect(box, bitmap.width, bitmap.height)
      context.fillRect(
        rect.x - crop.x,
        rect.y - crop.y,
        rect.width,
        rect.height
      )
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92)
    )
    if (!blob) throw new Error("The edited image could not be encoded.")
    const base = name.replace(/\.[^.]+$/, "") || "image"
    return new File([blob], `${base}-edited.jpg`, { type: "image/jpeg" })
  } finally {
    bitmap.close()
  }
}

/** Builds the EditedImage state, or null when the edits change nothing. */
export async function editFile(
  source: File,
  edits: ImageEdits,
  suggested: boolean
): Promise<EditedImage | null> {
  const clean = cleanEdits(edits)
  if (!hasEdits(clean)) return null
  const file = await flattenEdits(source, clean, source.name)
  return { source, edits: clean, file, suggested }
}
