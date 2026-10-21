// Component test for the public billing breakdown under bun:test with
// happy-dom and Testing Library.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test } from "bun:test"

import { BillSummary } from "./bill-summary"
import type { BillSummaryAdjustment } from "./bill-summary"

afterEach(cleanup)

// The canonical example order: Rp230.000 subtotal, -Rp103.500 voucher, a
// delivery fee the voucher waived, service and other fees, Rp131.000 total.
function sampleAdjustments(): BillSummaryAdjustment[] {
  return [
    {
      id: "adj-voucher",
      label: "Voucher Diskon",
      amount: -103_500,
      originalAmount: null,
    },
    {
      id: "adj-delivery",
      label: "Biaya Pengiriman",
      amount: 0,
      originalAmount: 3_500,
    },
    {
      id: "adj-service",
      label: "Biaya Layanan",
      amount: 3_500,
      originalAmount: null,
    },
    {
      id: "adj-other",
      label: "Biaya Lain-lain",
      amount: 1_000,
      originalAmount: null,
    },
  ]
}

describe("BillSummary", () => {
  test("renders subtotal, discount, fees, and final total", () => {
    render(
      <BillSummary
        sourceSubtotal={230_000}
        finalTotal={131_000}
        adjustments={sampleAdjustments()}
      />
    )

    expect(screen.getByText("Subtotal")).toBeTruthy()
    expect(screen.getByText("Rp230.000")).toBeTruthy()
    expect(screen.getByText("Voucher Diskon")).toBeTruthy()
    expect(screen.getByText("-Rp103.500")).toBeTruthy()
    expect(screen.getByText("Biaya Layanan")).toBeTruthy()
    expect(screen.getByText("Biaya Lain-lain")).toBeTruthy()
    expect(screen.getByText("Final total")).toBeTruthy()
    expect(screen.getByText("Rp131.000")).toBeTruthy()
  })

  test("shows the printed price struck through when a voucher waived a fee", () => {
    render(
      <BillSummary
        sourceSubtotal={230_000}
        finalTotal={131_000}
        adjustments={sampleAdjustments()}
      />
    )

    const printed = screen.getByTestId("printed-amount")
    expect(printed.textContent).toBe("Rp3.500")
    expect(printed.className).toContain("line-through")
    expect(screen.getByText("Rp0")).toBeTruthy()
  })

  test("does not strike through when the printed amount equals the net", () => {
    render(
      <BillSummary
        sourceSubtotal={230_000}
        finalTotal={131_000}
        adjustments={[
          {
            id: "adj-service",
            label: "Biaya Layanan",
            amount: 3_500,
            originalAmount: 3_500,
          },
        ]}
      />
    )

    expect(screen.getByText("Rp3.500")).toBeTruthy()
    expect(screen.queryByTestId("printed-amount")).toBeNull()
  })
})
