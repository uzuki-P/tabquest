import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"
import { ItemsSection, useBillForm } from "./bill-form-sections"
import { formatRupiah } from "@/domain/money"

afterEach(cleanup)

function ItemForm() {
  const form = useBillForm({
    merchant: "Cafe",
    title: "",
    orderDate: "2026-10-05",
    sourceSubtotal: "",
    finalTotal: "",
    items: [
      {
        key: "coffee",
        name: "Coffee",
        variantNotes: "",
        quantity: "4",
        unitPrice: "25,000",
        bundleSize: "1",
      },
    ],
    adjustments: [],
    billPlayers: [],
  })
  return <ItemsSection form={form} />
}

test("item total follows qty x unit price and shows the items to split", () => {
  render(<ItemForm />)
  expect(
    screen.getByText(`4 x ${formatRupiah(25000)} = ${formatRupiah(100000)}`)
  ).toBeTruthy()
  expect(screen.queryByText(/items to split/)).toBeNull()
  const perQty = screen.getByLabelText("Items per qty")
  fireEvent.change(perQty, { target: { value: "2" } })
  expect(
    screen.getByText(`4 x ${formatRupiah(25000)} = ${formatRupiah(100000)}`)
  ).toBeTruthy()
  expect(
    screen.getByText(`8 items to split, ${formatRupiah(12500)} per item`)
  ).toBeTruthy()
  fireEvent.change(screen.getByLabelText("Qty"), { target: { value: "1" } })
  fireEvent.change(perQty, { target: { value: "3" } })
  expect(
    screen.getByText(`3 items to split, ≈${formatRupiah(8333)} per item`)
  ).toBeTruthy()
  fireEvent.change(perQty, { target: { value: "5" } })
  fireEvent.change(screen.getByLabelText("Unit price"), {
    target: { value: "50,000" },
  })
  expect(
    screen.getByText(`1 x ${formatRupiah(50000)} = ${formatRupiah(50000)}`)
  ).toBeTruthy()
  expect(
    screen.getByText(`5 items to split, ${formatRupiah(10000)} per item`)
  ).toBeTruthy()
})
