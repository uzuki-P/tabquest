import { describe, expect, test } from "bun:test"

import {
  boxFromModelPixels,
  boxFromPoints,
  isUsableBox,
  moveBox,
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
