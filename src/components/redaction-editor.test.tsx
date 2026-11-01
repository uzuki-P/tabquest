import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, mock, test } from "bun:test"

import type { RedactionBox } from "@/lib/redaction"

import { RedactionEditor } from "./redaction-editor"

afterEach(cleanup)

/** happy-dom has no layout: pin the surface to a 200x100 rect at the origin. */
function layoutSurface() {
  const surface = screen.getByTestId("redaction-surface")
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect
  surface.setPointerCapture = () => {}
  return surface
}

function renderEditor(initialBoxes: RedactionBox[] = []) {
  const onApply = mock((_boxes: RedactionBox[]) => {})
  const onCancel = mock(() => {})
  render(
    <RedactionEditor
      src="blob:test"
      title="Censor receipt"
      initialBoxes={initialBoxes}
      onApply={onApply}
      onCancel={onCancel}
    />
  )
  return { onApply, onCancel, surface: layoutSurface() }
}

test("dragging on the image draws a box in image fractions", () => {
  const { onApply, surface } = renderEditor()

  fireEvent.pointerDown(surface, { button: 0, clientX: 20, clientY: 10 })
  fireEvent.pointerMove(surface, { clientX: 120, clientY: 60 })
  fireEvent.pointerUp(surface, { clientX: 120, clientY: 60 })
  expect(screen.getAllByTestId("redaction-box")).toHaveLength(1)

  fireEvent.click(screen.getByRole("button", { name: /Apply/ }))
  expect(onApply).toHaveBeenCalledWith([
    { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
  ])
})

test("a click without a drag adds no box", () => {
  const { surface } = renderEditor()
  fireEvent.pointerDown(surface, { button: 0, clientX: 20, clientY: 10 })
  fireEvent.pointerUp(surface, { clientX: 20, clientY: 10 })
  expect(screen.queryAllByTestId("redaction-box")).toHaveLength(0)
})

test("suggested boxes show their label and can be deleted", () => {
  const { onApply } = renderEditor([
    { x: 0.1, y: 0.1, width: 0.2, height: 0.1, label: "order number" },
  ])
  expect(screen.getByText("order number")).toBeTruthy()

  const deleteButton = screen.getByRole("button", {
    name: /Delete box/,
  }) as HTMLButtonElement
  expect(deleteButton.disabled).toBe(true)
  fireEvent.pointerDown(screen.getByTestId("redaction-box"), {
    button: 0,
    clientX: 30,
    clientY: 15,
  })
  fireEvent.click(deleteButton)
  expect(screen.queryAllByTestId("redaction-box")).toHaveLength(0)

  fireEvent.click(screen.getByRole("button", { name: /Apply/ }))
  expect(onApply).toHaveBeenCalledWith([])
})

test("Escape cancels", () => {
  const { onCancel } = renderEditor()
  fireEvent.keyDown(document, { key: "Escape" })
  expect(onCancel).toHaveBeenCalled()
})
