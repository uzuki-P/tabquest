import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, mock, test } from "bun:test"

import { NO_EDITS } from "@/lib/image-edits"
import type { ImageEdits } from "@/lib/image-edits"

import { ImageEditor } from "./image-editor"

afterEach(cleanup)

/** happy-dom has no layout: pin the surface to a 200x100 rect at the origin. */
function layoutSurface() {
  const surface = screen.getByTestId("image-editor-surface")
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect
  surface.setPointerCapture = () => {}
  return surface
}

function renderEditor(initialEdits: ImageEdits = NO_EDITS) {
  const onApply = mock((_edits: ImageEdits) => {})
  const onCancel = mock(() => {})
  render(
    <ImageEditor
      src="blob:test"
      title="Edit receipt"
      initialEdits={initialEdits}
      onApply={onApply}
      onCancel={onCancel}
    />
  )
  return { onApply, onCancel, surface: layoutSurface() }
}

function drag(
  element: HTMLElement,
  from: [number, number],
  to: [number, number]
) {
  fireEvent.pointerDown(element, {
    button: 0,
    clientX: from[0],
    clientY: from[1],
  })
  fireEvent.pointerMove(element, { clientX: to[0], clientY: to[1] })
  fireEvent.pointerUp(element, { clientX: to[0], clientY: to[1] })
}

const button = (name: string | RegExp) =>
  screen.getByRole("button", { name }) as HTMLButtonElement

/** Clicks Apply and waits for it to settle, so the next click is not lost. */
async function apply(onApply: ReturnType<typeof mock>) {
  await act(async () => {
    fireEvent.click(button(/^Apply/))
  })
  return onApply.mock.calls.at(-1)?.[0] as ImageEdits
}

test("dragging with the censor tool draws a box in image fractions", async () => {
  const { onApply, surface } = renderEditor()
  drag(surface, [20, 10], [120, 60])
  expect(screen.getAllByTestId("redaction-box")).toHaveLength(1)
  expect(await apply(onApply)).toEqual({
    boxes: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }],
    crop: null,
  })
})

test("a click without a drag adds no box", () => {
  const { surface } = renderEditor()
  drag(surface, [20, 10], [20, 10])
  expect(screen.queryAllByTestId("redaction-box")).toHaveLength(0)
})

test("undo and redo step through edits, from buttons and the keyboard", () => {
  const { surface } = renderEditor()
  expect(button("Undo").disabled).toBe(true)

  drag(surface, [20, 10], [120, 60])
  drag(surface, [140, 70], [180, 90])
  expect(screen.getAllByTestId("redaction-box")).toHaveLength(2)

  fireEvent.click(button("Undo"))
  expect(screen.getAllByTestId("redaction-box")).toHaveLength(1)
  fireEvent.keyDown(document, { key: "z", ctrlKey: true })
  expect(screen.queryAllByTestId("redaction-box")).toHaveLength(0)

  fireEvent.click(button("Redo"))
  expect(screen.getAllByTestId("redaction-box")).toHaveLength(1)
  fireEvent.keyDown(document, { key: "z", ctrlKey: true, shiftKey: true })
  expect(screen.getAllByTestId("redaction-box")).toHaveLength(2)
  expect(button("Redo").disabled).toBe(true)
})

test("moving a box is a single undo step", async () => {
  const { onApply, surface } = renderEditor()
  drag(surface, [20, 10], [60, 30])
  const box = screen.getByTestId("redaction-box")
  fireEvent.pointerDown(box, { button: 0, clientX: 30, clientY: 20 })
  fireEvent.pointerMove(surface, { clientX: 50, clientY: 30 })
  fireEvent.pointerMove(surface, { clientX: 70, clientY: 40 })
  fireEvent.pointerUp(surface, { clientX: 70, clientY: 40 })
  const moved = (await apply(onApply)).boxes[0]
  expect(moved.x).toBeCloseTo(0.3)
  expect(moved.y).toBeCloseTo(0.3)

  fireEvent.click(button("Undo"))
  expect((await apply(onApply)).boxes[0]).toMatchObject({ x: 0.1, y: 0.1 })
})

test("the crop tool sets, moves, and resets the crop", async () => {
  const { onApply, surface } = renderEditor({
    boxes: [{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }],
    crop: null,
  })
  fireEvent.click(button("Crop"))
  drag(surface, [0, 10], [200, 90])
  expect(await apply(onApply)).toEqual({
    boxes: [{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }],
    crop: { x: 0, y: 0.1, width: 1, height: 0.8 },
  })

  // Drag a corner handle to shrink it from the bottom-right.
  const handle = screen.getByTestId("crop-handle-se")
  fireEvent.pointerDown(handle, { button: 0, clientX: 200, clientY: 90 })
  fireEvent.pointerMove(surface, { clientX: 100, clientY: 60 })
  fireEvent.pointerUp(surface, { clientX: 100, clientY: 60 })
  expect((await apply(onApply)).crop).toMatchObject({ x: 0, width: 0.5 })

  fireEvent.click(button("Reset crop"))
  expect((await apply(onApply)).crop).toBeNull()
})

test("a crop covering the whole image counts as no crop", async () => {
  const { onApply, surface } = renderEditor()
  fireEvent.keyDown(document, { key: "r" })
  drag(surface, [0, 0], [200, 100])
  expect((await apply(onApply)).crop).toBeNull()
})

test("suggested boxes show their label; Delete removes the selected one", async () => {
  const { onApply } = renderEditor({
    boxes: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1, label: "order number" }],
    crop: null,
  })
  expect(screen.getByText("order number")).toBeTruthy()
  expect(button("Delete box").disabled).toBe(true)

  fireEvent.pointerDown(screen.getByTestId("redaction-box"), {
    button: 0,
    clientX: 30,
    clientY: 15,
  })
  fireEvent.pointerUp(screen.getByTestId("image-editor-surface"))
  fireEvent.keyDown(document, { key: "Delete" })
  expect(screen.queryAllByTestId("redaction-box")).toHaveLength(0)
  expect((await apply(onApply)).boxes).toEqual([])
})

test("arrow keys nudge the selected box", async () => {
  const { onApply, surface } = renderEditor()
  drag(surface, [20, 10], [60, 30])
  fireEvent.keyDown(document, { key: "ArrowRight", shiftKey: true })
  expect((await apply(onApply)).boxes[0].x).toBeCloseTo(0.11)
})

test("the pan tool and preview mode do not draw", () => {
  const { surface } = renderEditor()
  fireEvent.keyDown(document, { key: "h" })
  drag(surface, [20, 10], [120, 60])
  fireEvent.click(button("Censor"))
  fireEvent.click(button("Preview"))
  drag(surface, [20, 10], [120, 60])
  expect(screen.queryAllByTestId("redaction-box")).toHaveLength(0)
})

test("Escape cancels right away when nothing changed", () => {
  const { onCancel } = renderEditor()
  fireEvent.keyDown(document, { key: "Escape" })
  expect(onCancel).toHaveBeenCalled()
})

test("cancelling with changes asks first", () => {
  const { onCancel, surface } = renderEditor()
  drag(surface, [20, 10], [120, 60])
  const confirm = mock(() => false)
  window.confirm = confirm
  fireEvent.click(button(/Cancel/))
  expect(confirm).toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
})
