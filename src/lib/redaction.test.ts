import { describe, expect, test } from "bun:test"

import {
  boxFromModelPixels,
  boxFromPoints,
  isFullImage,
  isUsableBox,
  mergeBoxes,
  moveBox,
  overlapRatio,
  resizeFromCorner,
} from "./redaction"

describe("redaction boxes", () => {
  test("boxFromPoints accepts corners in any order and clamps to the image", () => {
    expect(boxFromPoints(0.8, 0.6, 0.2, 0.1)).toEqual({
      x: 0.2,
      y: 0.1,
      width: 0.6000000000000001,
      height: 0.5,
    })
    expect(boxFromPoints(-0.5, -0.5, 2, 2)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  test("moveBox keeps the whole box inside the image", () => {
    const box = { x: 0.5, y: 0.5, width: 0.3, height: 0.2, label: "phone" }
    expect(moveBox(box, 1, 1)).toEqual({
      x: 0.7,
      y: 0.8,
      width: 0.3,
      height: 0.2,
      label: "phone",
    })
    expect(moveBox(box, -1, -1)).toMatchObject({ x: 0, y: 0 })
  })

  test("tiny boxes are misclicks", () => {
    expect(isUsableBox({ x: 0, y: 0, width: 0.001, height: 0.3 })).toBe(false)
    expect(isUsableBox({ x: 0, y: 0, width: 0.1, height: 0.02 })).toBe(true)
  })

  test("boxFromModelPixels rejects boxes outside or covering the image", () => {
    expect(boxFromModelPixels([10, 10, 20, 20], 0, 100)).toBeNull()
    expect(boxFromModelPixels([500, 500, 600, 600], 100, 100)).toBeNull()
    expect(boxFromModelPixels([0, 0, 100, 90], 100, 100)).toBeNull()
    expect(boxFromModelPixels([10, 40, 50, 50], 100, 100)).not.toBeNull()
  })
})

describe("box editing helpers", () => {
  const box = { x: 0.2, y: 0.2, width: 0.4, height: 0.4, label: "phone" }

  test("resizeFromCorner keeps the opposite corner fixed", () => {
    expect(resizeFromCorner(box, "se", 0.8, 0.9)).toMatchObject({
      x: 0.2,
      y: 0.2,
      label: "phone",
    })
    const nw = resizeFromCorner(box, "nw", 0.1, 0.1)
    expect(nw.x + nw.width).toBeCloseTo(0.6)
    expect(nw.y + nw.height).toBeCloseTo(0.6)
    // Dragging past the anchor flips the box instead of inverting it.
    expect(resizeFromCorner(box, "se", 0.1, 0.1)).toMatchObject({ x: 0.1 })
  })

  test("mergeBoxes skips incoming boxes that repeat an existing one", () => {
    const repeat = { ...box, x: 0.21 }
    const elsewhere = { x: 0.7, y: 0.7, width: 0.1, height: 0.1 }
    expect(mergeBoxes([box], [repeat, elsewhere])).toEqual([box, elsewhere])
    expect(overlapRatio(box, elsewhere)).toBe(0)
  })

  test("isFullImage spots a crop that keeps everything", () => {
    expect(isFullImage({ x: 0, y: 0, width: 1, height: 1 })).toBe(true)
    expect(isFullImage({ x: 0, y: 0.1, width: 1, height: 0.9 })).toBe(false)
  })
})
