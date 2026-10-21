// Component test for the split board: receipt rows can share a name while
// their variants differ, so the board must surface the variant notes.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test } from "bun:test"

import { AllocationBoard } from "./allocation-board"
import { formatAmountInput, formatRupiah } from "@/domain/money"
import type { BillFormValue } from "@/lib/bill-form"

afterEach(cleanup)

function boardValue(items: BillFormValue["items"]): BillFormValue {
  return {
    merchant: "Kopi Sudirman",
    title: "",
    orderDate: "2026-08-30",
    sourceSubtotal: "",
    finalTotal: "",
    items,
    adjustments: [],
    billPlayers: [
      { key: "p-raka", alias: "Raka", playerId: "player-raka" },
      { key: "p-sinta", alias: "Sinta", playerId: "player-sinta" },
    ],
  }
}

describe("AllocationBoard", () => {
  test("keeps same-name items apart through their variant notes", () => {
    render(
      <AllocationBoard
        value={boardValue([
          {
            key: "item-kopi-1",
            name: "Es Kopi Susu",
            variantNotes: "Regular, less sugar",
            quantity: "1",
            unitPrice: formatAmountInput("18000"),
          },
          {
            key: "item-kopi-2",
            name: "Es Kopi Susu",
            variantNotes: "Large, extra shot",
            quantity: "2",
            unitPrice: formatAmountInput("25000"),
          },
        ])}
        matrix={{}}
        setMatrix={() => {}}
      />
    )

    expect(screen.getByText("Regular, less sugar")).toBeTruthy()
    expect(screen.getByText("Large, extra shot")).toBeTruthy()
    // Variant text sits under the name and wraps to at most two lines.
    for (const variant of ["Regular, less sugar", "Large, extra shot"]) {
      const span = screen.getByText(variant)
      expect(span.className).toContain("line-clamp-2")
      // Each clamped variant is wired as a tooltip trigger for the full text.
      expect(span.getAttribute("data-slot")).toBe("tooltip-trigger")
    }
    // The accessible names of the counter cards differ too.
    expect(
      screen.getByLabelText(
        /Es Kopi Susu \(Regular, less sugar\), 1 unassigned/
      )
    ).toBeTruthy()
    expect(
      screen.getByLabelText(/Es Kopi Susu \(Large, extra shot\), 2 unassigned/)
    ).toBeTruthy()
  })

  test("shows no variant span when an item has none", () => {
    render(
      <AllocationBoard
        value={boardValue([
          {
            key: "item-nasgor",
            name: "Nasi Goreng Kampung",
            variantNotes: "",
            quantity: "1",
            unitPrice: formatAmountInput("26000"),
          },
        ])}
        matrix={{}}
        setMatrix={() => {}}
      />
    )

    expect(screen.getByText("Nasi Goreng Kampung")).toBeTruthy()
    // Plain name in the accessible name: no empty parentheses appended.
    expect(
      screen.getByLabelText(/Nasi Goreng Kampung, 1 unassigned/)
    ).toBeTruthy()
  })
})

test("shows bundle costs for allocated and unassigned units", () => {
  const value = boardValue([
    {
      key: "coffee",
      name: "Coffee",
      variantNotes: "",
      quantity: "1",
      unitPrice: "25,001",
      bundleSize: "2",
    },
  ])
  const { rerender } = render(
    <AllocationBoard
      value={value}
      matrix={{ "coffee::p-raka": "1" }}
      setMatrix={() => {}}
    />
  )
  expect(screen.getAllByText(formatRupiah(12501)).length).toBeGreaterThan(0)
  expect(screen.queryByText(formatRupiah(25001))).toBeNull()
  expect(screen.getByLabelText(/^Coffee, 1 unassigned\./)).toBeTruthy()
  rerender(
    <AllocationBoard
      value={value}
      matrix={{ "coffee::p-raka": "1", "coffee::p-sinta": "1" }}
      setMatrix={() => {}}
    />
  )
  expect(screen.getAllByText(formatRupiah(12500)).length).toBeGreaterThan(0)
})
