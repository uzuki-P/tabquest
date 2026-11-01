/**
 * Undo/redo history for an immutable value. Live edits such as a drag call
 * `previewHistory` on every move and `commitHistory` once at the end, so the
 * whole gesture becomes a single undo step.
 */
export type History<T> = { past: T[]; present: T; future: T[] }

const LIMIT = 100

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/** Records the present as an undo step and moves to `next`. */
export function pushHistory<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history
  return {
    past: [...history.past, history.present].slice(-LIMIT),
    present: next,
    future: [],
  }
}

/** Changes the present without recording an undo step. */
export function previewHistory<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next }
}

/** Ends a live edit: records `base` as one undo step if the present moved. */
export function commitHistory<T>(history: History<T>, base: T): History<T> {
  if (history.present === base) return history
  return {
    past: [...history.past, base].slice(-LIMIT),
    present: history.present,
    future: [],
  }
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1)
  if (previous === undefined) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redoHistory<T>(history: History<T>): History<T> {
  const [next, ...future] = history.future
  if (next === undefined) return history
  return {
    past: [...history.past, history.present].slice(-LIMIT),
    present: next,
    future,
  }
}
