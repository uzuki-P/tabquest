import { expect, test } from "bun:test"

import {
  commitHistory,
  initHistory,
  previewHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./edit-history"

test("push, undo, and redo walk the history", () => {
  let history = initHistory("a")
  history = pushHistory(history, "b")
  history = pushHistory(history, "c")
  history = undoHistory(history)
  expect(history.present).toBe("b")
  history = undoHistory(undoHistory(history))
  expect(history.present).toBe("a")
  history = redoHistory(history)
  expect(history).toEqual({ past: ["a"], present: "b", future: ["c"] })
})

test("a new edit after undo drops the redo branch", () => {
  const history = pushHistory(undoHistory(pushHistory(initHistory(1), 2)), 3)
  expect(history).toEqual({ past: [1], present: 3, future: [] })
})

test("previews then a commit make one undo step", () => {
  const base = initHistory("start")
  let history = previewHistory(base, "drag 1")
  history = previewHistory(history, "drag 2")
  history = commitHistory(history, base.present)
  expect(history).toEqual({ past: ["start"], present: "drag 2", future: [] })
  // A gesture that ended where it began records nothing.
  expect(commitHistory(base, base.present)).toBe(base)
})

test("history keeps at most 100 undo steps", () => {
  let history = initHistory(0)
  for (let i = 1; i <= 150; i += 1) history = pushHistory(history, i)
  expect(history.past).toHaveLength(100)
  expect(history.past[0]).toBe(50)
})
