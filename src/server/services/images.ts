import { rmSync } from "node:fs"

import { Data, Effect } from "effect"

export class InvalidImage extends Data.TaggedError("InvalidImage")<{
  reason: string
}> {}
export class ImageTooLarge extends Data.TaggedError("ImageTooLarge")<{
  reason: string
}> {}
export class ImageStorageError extends Data.TaggedError("ImageStorageError")<{
  cause: unknown
}> {}

export interface ImageDeps {
  uploadDir: string
}

export interface StoredImage {
  objectKey: string
  mediaType: string
  byteSize: number
}

/** Requests larger than 15 MiB are rejected before decoding. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/** Decoded images above 40 megapixels are rejected. */
export const MAX_PIXELS = 40_000_000

/** Re-encoded public copies never exceed this longest edge. */
export const MAX_LONGEST_EDGE = 3000

const ACCEPTED_SOURCE_FORMATS = new Set(["png", "jpeg", "webp", "avif"])

export function exceedsPixelLimit(width: number, height: number): boolean {
  return width * height > MAX_PIXELS
}

export function exceedsEdgeLimit(width: number, height: number): boolean {
  return Math.max(width, height) > MAX_LONGEST_EDGE
}

/**
 * Validates the uploaded bill image, then stores a re-encoded WebP copy
 * under an opaque object key. Re-encoding drops any embedded metadata and
 * the original filename is never used or retained.
 */
export function storeBillImage(
  deps: ImageDeps,
  file: File
): Effect.Effect<
  StoredImage,
  InvalidImage | ImageTooLarge | ImageStorageError
> {
  return Effect.gen(function* () {
    if (file.size === 0)
      return yield* new InvalidImage({ reason: "The uploaded file is empty." })
    if (file.size > MAX_UPLOAD_BYTES) {
      return yield* new ImageTooLarge({
        reason: `The uploaded file exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MiB limit.`,
      })
    }

    const source = new Uint8Array(
      yield* Effect.promise(() => file.arrayBuffer())
    )

    const metadata = yield* Effect.tryPromise({
      try: () => new Bun.Image(source).metadata(),
      catch: () =>
        new InvalidImage({
          reason: "The uploaded file is not a supported image.",
        }),
    })
    const { width, height, format } = metadata

    if (!ACCEPTED_SOURCE_FORMATS.has(format)) {
      return yield* new InvalidImage({
        reason: `Unsupported image format "${format}". Upload PNG, JPEG, WebP, or AVIF.`,
      })
    }
    if (width <= 0 || height <= 0) {
      return yield* new InvalidImage({
        reason: "The image has no decodable dimensions.",
      })
    }
    if (exceedsPixelLimit(width, height)) {
      return yield* new ImageTooLarge({
        reason: `The image is ${width}x${height}, above the 40 megapixel limit.`,
      })
    }

    let image = new Bun.Image(source)
    if (exceedsEdgeLimit(width, height)) {
      const scale = MAX_LONGEST_EDGE / Math.max(width, height)
      image = image.resize(
        Math.round(width * scale),
        Math.round(height * scale)
      )
    }

    const encoded = yield* Effect.tryPromise({
      try: () => image.webp({ quality: 90 }).bytes(),
      catch: (cause) => new ImageStorageError({ cause }),
    })

    const objectKey = `${crypto.randomUUID()}.webp`
    const destination = `${deps.uploadDir.replace(/\/+$/, "")}/${objectKey}`
    yield* Effect.tryPromise({
      try: () => Bun.write(destination, encoded),
      catch: (cause) => new ImageStorageError({ cause }),
    })

    return {
      objectKey,
      mediaType: "image/webp",
      byteSize: encoded.byteLength,
    }
  })
}

/**
 * Removes a stored upload. Missing files are tolerated so deleting a bill
 * whose image was already removed from disk still succeeds.
 */
export function deleteImage(deps: ImageDeps, objectKey: string): void {
  const target = `${deps.uploadDir.replace(/\/+$/, "")}/${objectKey}`
  rmSync(target, { force: true })
}
