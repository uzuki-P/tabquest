import { describe, expect, test } from "bun:test"

import { buildStructure, previewSplit, remainingByItem } from "./bill-form"
import type { BillFormValue } from "./bill-form"

function formValue(overrides: Partial<BillFormValue> = {}): BillFormValue {
  return {
    merchant: "Kopi Sudirman",
    title: "",
    orderDate: "2026-08-27",
    sourceSubtotal: "50,000",
    finalTotal: "50,000",
    items: [
      {
        key: "item-1",
        name: "Cold Tonic",
        variantNotes: "",
        quantity: "2",
        unitPrice: "25,000",
      },
    ],
    adjustments: [],
    billPlayers: [{ key: "p-1", alias: "Raka", playerId: "player-1" }],
    ...overrides,
  }
}

describe("buildStructure", () => {
  test("rejects a bill player without a directory player", () => {
    const value = formValue({
      billPlayers: [{ key: "p-1", alias: "Raka", playerId: null }],
    })
    const built = buildStructure(value, {})
    expect(built.ok).toBe(false)
    expect(built.issues).toEqual(["Pick a player for Raka"])
  })

  test("derives line total from quantity x unit price", () => {
    const built = buildStructure(formValue(), {})
    expect(built.ok).toBe(true)
    expect(built.structure!.items[0].lineTotal).toBe(50_000)
    expect(built.structure!.items[0].quantity).toBe(2)
    expect(built.structure!.items[0].unitPrice).toBe(25_000)
  })

  test("derives line total from formatted money text", () => {
    const value = formValue({
      items: [
        {
          key: "item-1",
          name: "Flat White",
          variantNotes: "",
          quantity: "3",
          unitPrice: "22,500",
        },
      ],
    })
    const built = buildStructure(value, {})
    expect(built.ok).toBe(true)
    expect(built.structure!.items[0].lineTotal).toBe(67_500)
  })

  test("does not ask for a line total when qty or price are invalid", () => {
    const noPrice = buildStructure(
      formValue({
        items: [
          {
            key: "item-1",
            name: "Cold Tonic",
            variantNotes: "",
            quantity: "2",
            unitPrice: "",
          },
        ],
      }),
      {}
    )
    expect(noPrice.ok).toBe(false)
    expect(noPrice.issues.some((i) => i.includes("line total"))).toBe(false)

    const zeroQty = buildStructure(
      formValue({
        items: [
          {
            key: "item-1",
            name: "Cold Tonic",
            variantNotes: "",
            quantity: "0",
            unitPrice: "25,000",
          },
        ],
      }),
      {}
    )
    expect(zeroQty.ok).toBe(false)
    expect(zeroQty.issues.some((i) => i.includes("quantity"))).toBe(true)
  })

  test("keeps a printed amount only when it differs from the net", () => {
    const value = formValue({
      adjustments: [
        {
          key: "adj-1",
          type: "delivery",
          label: "Biaya Pengiriman",
          amount: "0",
          originalAmount: "3,500",
        },
        {
          key: "adj-2",
          type: "service",
          label: "Biaya Layanan",
          amount: "3,500",
          originalAmount: "3,500",
        },
      ],
    })
    const built = buildStructure(value, {})
    expect(built.ok).toBe(true)
    expect(built.structure!.adjustments[0].originalAmount).toBe(3_500)
    // Printed amount equal to the net carries no information.
    expect(built.structure!.adjustments[1].originalAmount).toBeNull()
  })

  test("rejects a non-positive printed amount", () => {
    const value = formValue({
      adjustments: [
        {
          key: "adj-1",
          type: "delivery",
          label: "Biaya Pengiriman",
          amount: "0",
          originalAmount: "-3,500",
        },
      ],
    })
    const built = buildStructure(value, {})
    expect(built.ok).toBe(false)
    expect(
      built.issues.some(
        (i) => i.includes("printed amount") && i.includes("positive")
      )
    ).toBe(true)
  })
})

test("items per qty multiplies the items to split, not the charge", () => {
  const value = formValue({
    sourceSubtotal: "25,001",
    finalTotal: "25,001",
    billPlayers: [
      { key: "p-1", alias: "Raka", playerId: "player-1" },
      { key: "p-2", alias: "Sinta", playerId: "player-2" },
    ],
  })
  value.items[0].quantity = "1"
  value.items[0].bundleSize = "2"
  value.items[0].unitPrice = "25,001"
  const matrix = { "item-1::p-1": "1", "item-1::p-2": "1" }
  const built = buildStructure(value, matrix)
  expect(built.structure!.items[0]).toMatchObject({
    quantity: 1,
    unitPrice: 25001,
    lineTotal: 25001,
    bundleSize: 2,
  })
  expect(previewSplit(value, matrix).split!.shares.map((p) => p.total)).toEqual(
    [12501, 12500]
  )
  expect(remainingByItem(value, matrix).get("item-1")).toBe(0)
  value.items[0].bundleSize = "1"
  expect(remainingByItem(value, matrix).get("item-1")).toBe(-1)
})
