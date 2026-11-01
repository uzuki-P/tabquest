import { expect, test } from "bun:test"

import { MAX_ZOOM, MIN_ZOOM, clampZoom, stepZoom } from "./zoom"

test("stepZoom moves one step and stops at the ends", () => {
  expect(stepZoom(1, 1)).toBe(1.5)
  expect(stepZoom(1, -1)).toBe(0.75)
  expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
  expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
})

test("a zoom between steps snaps to the neighbour in that direction", () => {
  expect(stepZoom(1.8, 1)).toBe(2)
  expect(stepZoom(1.8, -1)).toBe(1.5)
  expect(clampZoom(20)).toBe(MAX_ZOOM)
})
