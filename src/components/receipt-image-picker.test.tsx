import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"
import { useRef } from "react"

import { ReceiptImagePicker } from "./receipt-image-picker"

afterEach(cleanup)

// happy-dom has no blob URL store; the preview only needs a usable src.
URL.createObjectURL = () => "blob:test"
URL.revokeObjectURL = () => {}

function PickerHarness({
  separateBillImage = false,
}: {
  separateBillImage?: boolean
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
