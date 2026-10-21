import { describe, expect, test } from "bun:test"

import { formatRupiah, isSafeRupiah } from "./money"
import {
  allocateProportional,
  computeSplit,
  SplitValidationError,
} from "./split"
import type { SplitInput } from "./split"

/**
 * The supplied example order: Rp230.000 subtotal, -Rp103.500 voucher,
 * Rp4.500 delivery and service fees, Rp131.000 final total. Cold Tonic has
 * three units split across billPlayers with two going to a single person.
 */
function exampleBill(): SplitInput {
  const items = [
    {
      id: "item-tonic",
      name: "Cold Tonic",
      quantity: 3,
      unitPrice: 28000,
      lineTotal: 84000,
    },
    {
      id: "item-croissant",
      name: "Butter Croissant",
      quantity: 2,
      unitPrice: 25000,
      lineTotal: 50000,
    },
    {
      id: "item-flatwhite",
      name: "Flat White",
      quantity: 2,
      unitPrice: 22000,
      lineTotal: 44000,
    },
    {
      id: "item-matcha",
      name: "Matcha Latte",
      quantity: 1,
      unitPrice: 26000,
      lineTotal: 26000,
    },
    {
      id: "item-nasgor",
      name: "Nasi Goreng Kampung",
      quantity: 1,
      unitPrice: 26000,
      lineTotal: 26000,
    },
  ]
  const billPlayers = [{ id: "p-raka" }, { id: "p-sinta" }, { id: "p-dewi" }]
  const allocations = [
    { itemId: "item-tonic", billPlayerId: "p-raka", quantity: 2 },
    { itemId: "item-tonic", billPlayerId: "p-sinta", quantity: 1 },
    { itemId: "item-croissant", billPlayerId: "p-sinta", quantity: 1 },
    { itemId: "item-croissant", billPlayerId: "p-dewi", quantity: 1 },
    { itemId: "item-flatwhite", billPlayerId: "p-raka", quantity: 1 },
    { itemId: "item-flatwhite", billPlayerId: "p-dewi", quantity: 1 },
    { itemId: "item-matcha", billPlayerId: "p-sinta", quantity: 1 },
    { itemId: "item-nasgor", billPlayerId: "p-dewi", quantity: 1 },
  ]
  const adjustments = [
    { id: "adj-voucher", amount: -103500 },
    { id: "adj-delivery", amount: 2000 },
    { id: "adj-service", amount: 2500 },
  ]
  return {
    items,
    billPlayers,
    allocations,
    adjustments,
    sourceSubtotal: 230000,
    finalTotal: 131000,
  }
}

describe("money", () => {
  test("accepts integers in the safe range only", () => {
    expect(isSafeRupiah(0)).toBe(true)
    expect(isSafeRupiah(131000)).toBe(true)
    expect(isSafeRupiah(0.5)).toBe(false)
    expect(isSafeRupiah(Number.MAX_SAFE_INTEGER + 1)).toBe(false)
    expect(isSafeRupiah(Number.MIN_SAFE_INTEGER - 1)).toBe(false)
  })

  test("formats rupiah", () => {
    expect(formatRupiah(230000)).toBe("Rp230.000")
    expect(formatRupiah(-103500)).toBe("-Rp103.500")
    expect(formatRupiah(0)).toBe("Rp0")
  })
})

describe("allocateProportional", () => {
  test("splits exactly when weights divide the amount", () => {
    const result = allocateProportional(-103500, [
      { billPlayerId: "a", weight: 78000 },
      { billPlayerId: "b", weight: 79000 },
      { billPlayerId: "c", weight: 73000 },
    ])
    expect(result).toEqual([
      { billPlayerId: "a", amount: -35100 },
      { billPlayerId: "b", amount: -35550 },
      { billPlayerId: "c", amount: -32850 },
    ])
  })

  test("distributes leftover rupiah by largest remainder", () => {
    const result = allocateProportional(2000, [
      { billPlayerId: "a", weight: 78 },
      { billPlayerId: "b", weight: 79 },
      { billPlayerId: "c", weight: 73 },
    ])
    expect(result).toEqual([
      { billPlayerId: "a", amount: 678 },
      { billPlayerId: "b", amount: 687 },
      { billPlayerId: "c", amount: 635 },
    ])
  })

  test("breaks remainder ties by billPlayer order", () => {
    const result = allocateProportional(10, [
      { billPlayerId: "a", weight: 1 },
      { billPlayerId: "b", weight: 1 },
      { billPlayerId: "c", weight: 1 },
    ])
    expect(result).toEqual([
      { billPlayerId: "a", amount: 4 },
      { billPlayerId: "b", amount: 3 },
      { billPlayerId: "c", amount: 3 },
    ])
  })

  test("zero weights receive zero", () => {
    const result = allocateProportional(300, [
      { billPlayerId: "a", weight: 10 },
      { billPlayerId: "b", weight: 0 },
    ])
    expect(result).toEqual([
      { billPlayerId: "a", amount: 300 },
      { billPlayerId: "b", amount: 0 },
    ])
  })

  test("rejects non-zero amounts with an all-zero total weight", () => {
    expect(() =>
      allocateProportional(1, [{ billPlayerId: "a", weight: 0 }])
    ).toThrow()
  })
})

describe("computeSplit", () => {
  test("reconciles the supplied example order exactly", () => {
    const result = computeSplit(exampleBill())

    expect(result.itemSubtotal).toBe(230000)
    expect(result.adjustmentsTotal).toBe(-99000)
    expect(result.grandTotal).toBe(131000)

    const byId = Object.fromEntries(
      result.shares.map((s) => [s.billPlayerId, s])
    )
    expect(byId["p-raka"].itemSubtotal).toBe(78000)
    expect(byId["p-sinta"].itemSubtotal).toBe(79000)
    expect(byId["p-dewi"].itemSubtotal).toBe(73000)

    // Every adjustment follows the billPlayer's percentage of the item subtotal.
    expect(byId["p-raka"].percentage).toBeCloseTo(78 / 230, 12)
    expect(byId["p-sinta"].percentage).toBeCloseTo(79 / 230, 12)
    expect(byId["p-dewi"].percentage).toBeCloseTo(73 / 230, 12)

    const voucher = (p: string) =>
      byId[p].adjustmentShares.find((s) => s.adjustmentId === "adj-voucher")!
        .amount
    expect(voucher("p-raka")).toBe(-35100)
    expect(voucher("p-sinta")).toBe(-35550)
    expect(voucher("p-dewi")).toBe(-32850)

    const delivery = (p: string) =>
      byId[p].adjustmentShares.find((s) => s.adjustmentId === "adj-delivery")!
        .amount
    expect(delivery("p-raka")).toBe(678)
    expect(delivery("p-sinta")).toBe(687)
    expect(delivery("p-dewi")).toBe(635)

    const service = (p: string) =>
      byId[p].adjustmentShares.find((s) => s.adjustmentId === "adj-service")!
        .amount
    expect(service("p-raka")).toBe(848)
    expect(service("p-sinta")).toBe(859)
    expect(service("p-dewi")).toBe(793)

    // BillPlayer totals remain exact after rounding and sum to the final total.
    expect(byId["p-raka"].total).toBe(44426)
    expect(byId["p-sinta"].total).toBe(44996)
    expect(byId["p-dewi"].total).toBe(41578)
    expect(result.shares.reduce((sum, s) => sum + s.total, 0)).toBe(131000)
  })

  test("is deterministic across repeated computation", () => {
    const first = computeSplit(exampleBill())
    for (let i = 0; i < 10; i++) {
      expect(computeSplit(exampleBill())).toEqual(first)
    }
  })

  test("rejects unassigned or over-assigned item quantities", () => {
    const input = exampleBill()
    input.allocations = input.allocations.filter(
      (a) => a.itemId !== "item-matcha"
    )
    expect(() => computeSplit(input)).toThrow(SplitValidationError)

    const over = exampleBill()
    over.allocations.push({
      itemId: "item-tonic",
      billPlayerId: "p-dewi",
      quantity: 1,
    })
    try {
      computeSplit(over)
      throw new Error("expected SplitValidationError")
    } catch (error) {
      expect(error).toBeInstanceOf(SplitValidationError)
      const issues = (error as SplitValidationError).issues
      expect(issues).toContainEqual({
        code: "item-quantity-mismatch",
        itemId: "item-tonic",
        name: "Cold Tonic",
        ordered: 3,
        assigned: 4,
      })
    }
  })

  test("rejects a line total that disagrees with quantity times unit price", () => {
    const input = exampleBill()
    input.items[0].lineTotal = 84001
    expect(() => computeSplit(input)).toThrow(SplitValidationError)
  })

  test("rejects a source subtotal that disagrees with the item lines", () => {
    const input = exampleBill()
    input.sourceSubtotal = 230001
    expect(() => computeSplit(input)).toThrow(SplitValidationError)
  })

  test("rejects a final total that disagrees with subtotal plus adjustments", () => {
    const input = exampleBill()
    input.finalTotal = 131001
    expect(() => computeSplit(input)).toThrow(SplitValidationError)
  })

  test("collects every issue at once", () => {
    const input = exampleBill()
    input.items = []
    input.billPlayers = []
    input.allocations = []
    input.adjustments = [{ id: "adj-x", amount: -500 }]
    input.sourceSubtotal = 0
    input.finalTotal = -500
    try {
      computeSplit(input)
      throw new Error("expected SplitValidationError")
    } catch (error) {
      expect(error).toBeInstanceOf(SplitValidationError)
      const codes = (error as SplitValidationError).issues.map((i) => i.code)
      expect(codes).toContain("no-items")
      expect(codes).toContain("no-players")
      expect(codes).toContain("zero-item-subtotal")
    }
  })

  test("rejects duplicate allocations for the same item and billPlayer", () => {
    const input = exampleBill()
    input.allocations.push({
      itemId: "item-nasgor",
      billPlayerId: "p-dewi",
      quantity: 1,
    })
    expect(() => computeSplit(input)).toThrow(SplitValidationError)
  })

  test("rejects non-positive allocation quantities", () => {
    const input = exampleBill()
    input.allocations[0] = {
      itemId: "item-tonic",
      billPlayerId: "p-raka",
      quantity: 0,
    }
    expect(() => computeSplit(input)).toThrow(SplitValidationError)
  })

  test("rejects values outside the safe integer range", () => {
    const input = exampleBill()
    input.items[0].unitPrice = Number.MAX_SAFE_INTEGER + 1
    try {
      computeSplit(input)
      throw new Error("expected SplitValidationError")
    } catch (error) {
      expect(error).toBeInstanceOf(SplitValidationError)
      expect((error as SplitValidationError).issues[0].code).toBe(
        "unsafe-integer"
      )
    }
  })

  test("rejects adjustments when the item subtotal is zero", () => {
    const input: SplitInput = {
      items: [
        {
          id: "i",
          name: "Free water",
          quantity: 1,
          unitPrice: 0,
          lineTotal: 0,
        },
      ],
      billPlayers: [{ id: "p" }],
      allocations: [{ itemId: "i", billPlayerId: "p", quantity: 1 }],
      adjustments: [{ id: "adj-delivery", amount: 4500 }],
      sourceSubtotal: 0,
      finalTotal: 4500,
    }
    expect(() => computeSplit(input)).toThrow(SplitValidationError)
  })

  test("handles a single billPlayer taking everything", () => {
    const input: SplitInput = {
      items: [
        {
          id: "i1",
          name: "Cold Tonic",
          quantity: 3,
          unitPrice: 28000,
          lineTotal: 84000,
        },
      ],
      billPlayers: [{ id: "solo" }],
      allocations: [{ itemId: "i1", billPlayerId: "solo", quantity: 3 }],
      adjustments: [
        { id: "adj-voucher", amount: -10000 },
        { id: "adj-fee", amount: 4500 },
      ],
      sourceSubtotal: 84000,
      finalTotal: 78500,
    }
    const result = computeSplit(input)
    expect(result.shares).toEqual([
      {
        billPlayerId: "solo",
        itemSubtotal: 84000,
        percentage: 1,
        adjustmentShares: [
          { adjustmentId: "adj-voucher", amount: -10000 },
          { adjustmentId: "adj-fee", amount: 4500 },
        ],
        total: 78500,
      },
    ])
  })

  test("handles large amounts whose proportional products exceed the safe integer range", () => {
    const unitPrice = 90_000_000_000
    const input: SplitInput = {
      items: [
        {
          id: "i1",
          name: "Big",
          quantity: 2,
          unitPrice,
          lineTotal: unitPrice * 2,
        },
        {
          id: "i2",
          name: "Small",
          quantity: 1,
          unitPrice: 1_000_000_000,
          lineTotal: 1_000_000_000,
        },
      ],
      billPlayers: [{ id: "a" }, { id: "b" }],
      allocations: [
        { itemId: "i1", billPlayerId: "a", quantity: 2 },
        { itemId: "i2", billPlayerId: "b", quantity: 1 },
      ],
      adjustments: [{ id: "adj", amount: -7 }],
      sourceSubtotal: unitPrice * 2 + 1_000_000_000,
      finalTotal: unitPrice * 2 + 1_000_000_000 - 7,
    }
    const result = computeSplit(input)
    expect(result.shares.reduce((sum, s) => sum + s.total, 0)).toBe(
      input.finalTotal
    )
    const adj = result.shares.map((s) => s.adjustmentShares[0].amount)
    expect(adj.reduce((sum, a) => sum + a, 0)).toBe(-7)
  })
})

describe("items per qty", () => {
  function promoBill(
    quantity = 1,
    unitPrice = 25001,
    bundleSize = 2
  ): SplitInput {
    const lineTotal = quantity * unitPrice
    const items = quantity * bundleSize
    return {
      items: [
        {
          id: "promo",
          name: "Coffee",
          quantity,
          unitPrice,
          lineTotal,
          bundleSize,
        },
      ],
      billPlayers: [{ id: "a" }, { id: "b" }],
      allocations: [
        { itemId: "promo", billPlayerId: "a", quantity: 1 },
        { itemId: "promo", billPlayerId: "b", quantity: items - 1 },
      ],
      adjustments: [],
      sourceSubtotal: lineTotal,
      finalTotal: lineTotal,
    }
  }

  test("splits an odd rupiah price deterministically and keeps the exact charge", () => {
    const bill = promoBill()
    expect(computeSplit(bill).shares.map((p) => p.total)).toEqual([
      12501, 12500,
    ])
    bill.allocations.reverse()
    expect(computeSplit(bill).shares.map((p) => p.total)).toEqual([
      12501, 12500,
    ])
  })

  test("keeps regular item costs and applies order fees after the bundle", () => {
    const bill = promoBill(2, 25000)
    bill.items.push({
      id: "regular",
      name: "Food",
      quantity: 1,
      unitPrice: 30000,
      lineTotal: 30000,
    })
    bill.allocations.push({ itemId: "regular", billPlayerId: "a", quantity: 1 })
    bill.sourceSubtotal = 80000
    bill.adjustments = [{ id: "delivery", amount: 8000 }]
    bill.finalTotal = 88000
    const split = computeSplit(bill)
    expect(split.shares.map((p) => p.itemSubtotal)).toEqual([42500, 37500])
    expect(split.shares.map((p) => p.total)).toEqual([46750, 41250])
  })

  test("requires allocations to match qty x items per qty and the line total to match qty x unit price", () => {
    const bill = promoBill()
    bill.items[0].bundleSize = 1
    expect(() => computeSplit(bill)).toThrow(SplitValidationError)
    bill.items[0].bundleSize = 2
    bill.items[0].lineTotal *= 2
    expect(() => computeSplit(bill)).toThrow(SplitValidationError)
  })

  test("charges a 5-item package once and splits it by item", () => {
    const split = computeSplit(promoBill(1, 100000, 5))
    expect(split.itemSubtotal).toBe(100000)
    expect(split.shares.map((p) => p.total)).toEqual([20000, 80000])
  })

  test("still requires allocations for the free units", () => {
    const bill = promoBill()
    bill.allocations.pop()
    expect(() => computeSplit(bill)).toThrow(SplitValidationError)
  })
})
