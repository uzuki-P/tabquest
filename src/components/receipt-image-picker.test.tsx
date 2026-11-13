import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"
import { useRef } from "react"

import type { EditedImage } from "@/lib/image-edits"

import { ReceiptImagePicker } from "./receipt-image-picker"

afterEach(cleanup)

// happy-dom has no blob URL store; the preview only needs a usable src.
URL.createObjectURL = () => "blob:test"
URL.revokeObjectURL = () => {}

function PickerHarness({
  separateBillImage = false,
  receiptEdit = null,
}: {
  separateBillImage?: boolean
  receiptEdit?: EditedImage | null
}) {
  const ocrInputRef = useRef<HTMLInputElement>(null)
  const billInputRef = useRef<HTMLInputElement>(null)
  return (
    <ReceiptImagePicker
      ocrInputRef={ocrInputRef}
      billInputRef={billInputRef}
      separateBillImage={separateBillImage}
      setSeparateBillImage={() => {}}
      ocrBusy={false}
      ocrError={null}
      ocrMessage={null}
      onOcrParse={() => {}}
      receiptEdit={receiptEdit}
      billEdit={null}
      onEdit={async () => {}}
    />
  )
}

function pickReceiptImage() {
  const input = screen.getByLabelText("Receipt image")
  const file = new File(["fake-png-bytes"], "receipt.png", {
    type: "image/png",
  })
  Object.defineProperty(input, "files", { value: [file] })
  fireEvent.change(input)
  return file
}

test("picked receipt shows preview, status chip, and file metadata", () => {
  render(<PickerHarness />)
  const file = pickReceiptImage()

  expect(screen.getByAltText("Receipt image preview")).toBeTruthy()
  expect(screen.getByText("Ready to parse")).toBeTruthy()
  // Metadata list: name, size, and the modified row for freshness checks.
  expect(screen.getByText(file.name)).toBeTruthy()
  expect(screen.getByText("Size")).toBeTruthy()
  expect(screen.getByText("Modified")).toBeTruthy()
})

test("preview opens the fullscreen lightbox and Escape closes it", () => {
  render(<PickerHarness />)
  pickReceiptImage()

  fireEvent.click(screen.getByTitle("View fullscreen"))
  expect(
    document.querySelector(
      '[role="dialog"][aria-label="Receipt image preview"]'
    )
  ).toBeTruthy()

  fireEvent.keyDown(document, { key: "Escape" })
  expect(
    document.querySelector(
      '[role="dialog"][aria-label="Receipt image preview"]'
    )
  ).toBeNull()
})

test("separate bill image toggle reveals the bill image slot", () => {
  render(<PickerHarness separateBillImage />)

  expect(screen.getByLabelText("Bill image")).toBeTruthy()
  expect(screen.getByText("No bill image yet")).toBeTruthy()
})

test("a parse suggestion asks for review and the preview shows the censored copy", () => {
  // The edits must belong to the picked file, so pick first, then render
  // again with edits whose source is that file.
  const { rerender } = render(<PickerHarness />)
  const source = pickReceiptImage()
  rerender(
    <PickerHarness
      receiptEdit={{
        source,
        file: new File(["censored"], "receipt-censored.jpg", {
          type: "image/jpeg",
        }),
        edits: {
          crop: null,
          boxes: [
            { x: 0.1, y: 0.8, width: 0.4, height: 0.02, label: "order number" },
          ],
        },
        suggested: true,
      }}
    />
  )

  expect(
    screen.getByText(/Parse blacked out 1 area that looks personal/)
  ).toBeTruthy()
  expect(screen.getByText(/order number/)).toBeTruthy()
  expect(screen.getByRole("button", { name: "Review" })).toBeTruthy()
  expect(screen.getByRole("button", { name: /Crop & censor/ })).toHaveProperty(
    "disabled",
    false
  )
})

test("a hand edit with a crop summarises both edits", () => {
  const { rerender } = render(<PickerHarness />)
  const source = pickReceiptImage()
  rerender(
    <PickerHarness
      receiptEdit={{
        source,
        file: new File(["edited"], "receipt-edited.jpg", {
          type: "image/jpeg",
        }),
        edits: {
          crop: { x: 0, y: 0.1, width: 1, height: 0.8 },
          boxes: [{ x: 0.1, y: 0.8, width: 0.4, height: 0.02 }],
        },
        suggested: false,
      }}
    />
  )
  expect(
    screen.getByText(
      "Cropped, 1 area censored. The saved image keeps these edits."
    )
  ).toBeTruthy()
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy()
})

// happy-dom's DataTransfer only takes its own File class, but the preload
// restores Bun's. A tiny stand-in keeps the drop path under test.
globalThis.DataTransfer = class {
  private list: File[] = []
  items = { add: (file: File) => void this.list.push(file) }
  get files() {
    return this.list as unknown as FileList
  }
} as unknown as typeof DataTransfer

function dropOn(zone: HTMLElement, file: File) {
  const dataTransfer = { types: ["Files"], files: [file], dropEffect: "none" }
  fireEvent.dragEnter(zone, { dataTransfer })
  fireEvent.drop(zone, { dataTransfer })
}

test("dropping an image on the preview fills the receipt input", () => {
  render(<PickerHarness />)
  const file = new File(["fake-png-bytes"], "dropped.png", {
    type: "image/png",
  })
  dropOn(screen.getByTestId("receipt-drop-zone"), file)

  const input = screen.getByLabelText("Receipt image") as HTMLInputElement
  expect(input.files?.[0]).toBe(file)
  expect(screen.getByAltText("Receipt image preview")).toBeTruthy()
  expect(screen.getByText("dropped.png")).toBeTruthy()
})

test("dropping a non-image on the preview is rejected", () => {
  render(<PickerHarness />)
  const file = new File(["%PDF"], "receipt.pdf", { type: "application/pdf" })
  dropOn(screen.getByTestId("receipt-drop-zone"), file)

  const input = screen.getByLabelText("Receipt image") as HTMLInputElement
  expect(input.files?.length ?? 0).toBe(0)
  expect(screen.getByRole("alert").textContent).toContain("receipt.pdf")
  expect(screen.getByText("No photo")).toBeTruthy()
})

test("dropping an image on the bill row fills the bill input", () => {
  render(<PickerHarness separateBillImage />)
  const file = new File(["fake-png-bytes"], "bill.webp", {
    type: "image/webp",
  })
  dropOn(screen.getByTestId("bill-drop-zone"), file)

  const input = screen.getByLabelText("Bill image") as HTMLInputElement
  expect(input.files?.[0]).toBe(file)
  expect(screen.getByAltText("Bill image preview")).toBeTruthy()
})
