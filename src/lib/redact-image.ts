import type { RedactionBox } from "@/lib/redaction"

/**
 * A picked image together with the boxes blacked out on it. `file` is the
 * flattened copy that gets uploaded; `source` is the untouched original, kept
 * so the boxes can be edited again and so a newly picked file can be told
 * apart from the one these boxes belong to.
 */
export type RedactedImage = {
  source: File
  boxes: RedactionBox[]
  file: File
  /** True while the boxes are Parse's suggestions the admin has not reviewed. */
  suggested: boolean
}

/**
 * Paints solid black rectangles over the image in the browser and returns
 * the result as a JPEG. Solid fills, not blur, so nothing underneath can be
 * recovered. The server re-encodes uploads anyway, so JPEG keeps the request
 * small without costing quality that matters.
 */
export async function flattenRedactions(
  source: Blob,
  boxes: readonly RedactionBox[],
  name: string
): Promise<File> {
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Canvas 2D is not available.")
    context.drawImage(bitmap, 0, 0)
    context.fillStyle = "#000"
    for (const box of boxes) {
      // Round outward so anti-aliased edges never leave a sliver of text.
      const x0 = Math.floor(box.x * canvas.width)
      const y0 = Math.floor(box.y * canvas.height)
      const x1 = Math.ceil((box.x + box.width) * canvas.width)
      const y1 = Math.ceil((box.y + box.height) * canvas.height)
      context.fillRect(x0, y0, x1 - x0, y1 - y0)
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92)
    )
    if (!blob) throw new Error("The censored image could not be encoded.")
    const base = name.replace(/\.[^.]+$/, "") || "image"
    return new File([blob], `${base}-censored.jpg`, { type: "image/jpeg" })
  } finally {
    bitmap.close()
  }
}

/** Builds the RedactedImage state, or null when there is nothing to hide. */
export async function redactFile(
  source: File,
  boxes: RedactionBox[],
  suggested: boolean
): Promise<RedactedImage | null> {
  if (boxes.length === 0) return null
  const file = await flattenRedactions(source, boxes, source.name)
  return { source, boxes, file, suggested }
}
