/** Zoom levels as multiples of "fit the whole image on screen". */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const
export const MIN_ZOOM = ZOOM_STEPS[0]
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * The next zoom step in a direction. A zoom between steps (after "fit
 * width") snaps to the nearest step that way instead of skipping one.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0)
    return ZOOM_STEPS.find((step) => step > current + 1e-6) ?? MAX_ZOOM
  return (
    [...ZOOM_STEPS].reverse().find((step) => step < current - 1e-6) ?? MIN_ZOOM
  )
}
