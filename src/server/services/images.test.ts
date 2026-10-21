import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import {
  exceedsEdgeLimit,
  exceedsPixelLimit,
  ImageTooLarge,
  InvalidImage,
  MAX_UPLOAD_BYTES,
  storeBillImage,
} from "./images"
import { makeHarness } from "../../../test/helpers"

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

function pngFile(bytes = PNG_1X1): File {
  const buffer = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))
  return new File([buffer], "receipt-from-phone.png", { type: "image/png" })
}

async function run<T, TError>(effect: Effect.Effect<T, TError>): Promise<T> {
  return Effect.runPromise(effect)
}

describe("image service", () => {
  test("stores a re-encoded webp copy under an opaque key", async () => {
    const harness = await makeHarness()
    const stored = await run(
      storeBillImage({ uploadDir: harness.uploadDir }, pngFile())
    )

    expect(stored.mediaType).toBe("image/webp")
    expect(stored.objectKey).toMatch(/^[0-9a-f-]{36}\.webp$/)
    expect(stored.objectKey).not.toContain("receipt")
    expect(stored.byteSize).toBeGreaterThan(0)
    expect(existsSync(path.join(harness.uploadDir, stored.objectKey))).toBe(
      true
    )

    const decoded = new Bun.Image(
      new Uint8Array(
        await Bun.file(
          path.join(harness.uploadDir, stored.objectKey)
        ).arrayBuffer()
      )
    )
    expect(await decoded.metadata()).toMatchObject({
      width: 1,
      height: 1,
      format: "webp",
    })

    harness.cleanup()
  })

  test("rejects files that are not images", async () => {
    const harness = await makeHarness()
    const text = new File(
      [new TextEncoder().encode("definitely not an image")],
      "notes.txt",
      { type: "text/plain" }
    )
    await expect(
      Effect.runPromise(storeBillImage({ uploadDir: harness.uploadDir }, text))
    ).rejects.toBeInstanceOf(InvalidImage)
    harness.cleanup()
  })

  test("rejects unsupported image formats", async () => {
    const harness = await makeHarness()
    const gif = new File([new TextEncoder().encode("GIF89a1")], "anim.gif", {
      type: "image/gif",
    })
    await expect(
      Effect.runPromise(storeBillImage({ uploadDir: harness.uploadDir }, gif))
    ).rejects.toBeInstanceOf(InvalidImage)
    harness.cleanup()
  })

  test("rejects oversized uploads before decoding", async () => {
    const harness = await makeHarness()
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "huge.png", {
      type: "image/png",
    })
    await expect(
      Effect.runPromise(storeBillImage({ uploadDir: harness.uploadDir }, big))
    ).rejects.toBeInstanceOf(ImageTooLarge)
    harness.cleanup()
  })

  test("pixel and edge limits", () => {
    expect(exceedsPixelLimit(7000, 6000)).toBe(true) // 42MP
    expect(exceedsPixelLimit(6000, 6000)).toBe(false) // 36MP
    expect(exceedsEdgeLimit(3001, 100)).toBe(true)
    expect(exceedsEdgeLimit(3000, 3000)).toBe(false)
  })
})
