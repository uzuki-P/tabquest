/**
 * Framework-independent split-bill calculation.
 *
 * Money is integer rupiah everywhere. All order-wide adjustments (discounts,
 * delivery, service, tax, other fees) are allocated proportionally to each
 * billPlayer's pre-adjustment item subtotal, using a deterministic
 * largest-remainder rounding so recomputing a published bill always produces
 * the same totals.
 */

import { isSafeRupiah } from "./money"

export interface SplitItem {
  id: string
  name: string
  /** Ordered quantity as printed on the receipt, several units allowed. */
  quantity: number
  /** Unit price in integer rupiah. */
  unitPrice: number
  /** Items received per ordered unit: 2 for buy 1 get 1, 5 for a 5-pack. */
  bundleSize?: number
  /** Line total as printed on the source bill, must equal quantity * unitPrice. */
  lineTotal: number
}

/** Items players split for one receipt line: quantity x items per unit. */
export function itemUnits(quantity: number, bundleSize = 1): number {
  return quantity * bundleSize
}

/** Split the charged item cost by received quantities, with whole-rupiah rounding. */
export function allocateItemCost(
  item: SplitItem,
  allocations: ReadonlyArray<SplitAllocation>,
  billPlayers: ReadonlyArray<{ id: string }>
): Array<{ billPlayerId: string; amount: number }> {
  const quantities = new Map(
    allocations
      .filter((a) => a.itemId === item.id)
      .map((a) => [a.billPlayerId, a.quantity])
  )
  return allocateProportional(
    item.lineTotal,
    billPlayers.map((p) => ({
      billPlayerId: p.id,
      weight: quantities.get(p.id) ?? 0,
    }))
  )
}

export interface SplitAdjustment {
  id: string
  /** Signed amount: discounts negative, fees positive. */
  amount: number
}

export interface SplitAllocation {
  itemId: string
  billPlayerId: string
  /** Integer quantity of the item assigned to the billPlayer, at least 1. */
  quantity: number
}

export interface SplitInput {
  items: SplitItem[]
  billPlayers: ReadonlyArray<{ id: string }>
  allocations: SplitAllocation[]
  adjustments: SplitAdjustment[]
  /** Subtotal printed on the source bill. */
  sourceSubtotal: number
  /** Final amount charged by the merchant. */
  finalTotal: number
}

export type SplitIssue =
  | { code: "unsafe-integer"; field: string; value: number }
  | { code: "no-items" }
  | { code: "no-players" }
  | { code: "invalid-item-quantity"; itemId: string; quantity: number }
  | { code: "invalid-unit-price"; itemId: string; unitPrice: number }
  | {
      code: "line-total-mismatch"
      itemId: string
      expected: number
      actual: number
    }
  | { code: "subtotal-mismatch"; expected: number; actual: number }
  | { code: "final-total-mismatch"; expected: number; actual: number }
  | { code: "unknown-item"; itemId: string }
  | { code: "unknown-player"; billPlayerId: string }
  | { code: "duplicate-allocation"; itemId: string; billPlayerId: string }
  | {
      code: "invalid-allocation-quantity"
      itemId: string
      billPlayerId: string
      quantity: number
    }
  | {
      code: "item-quantity-mismatch"
      itemId: string
      name: string
      ordered: number
      assigned: number
    }
  | { code: "zero-item-subtotal" }

export class SplitValidationError extends Error {
  readonly issues: SplitIssue[]

  constructor(issues: SplitIssue[]) {
    super(`Split validation failed: ${issues.map((i) => i.code).join(", ")}`)
    this.name = "SplitValidationError"
    this.issues = issues
  }
}

export interface AdjustmentShare {
  adjustmentId: string
  amount: number
}

export interface BillPlayerShare {
  billPlayerId: string
  /** Pre-adjustment item subtotal for the billPlayer. */
  itemSubtotal: number
  /** The billPlayer's fraction of the bill's item subtotal, 0..1. */
  percentage: number
  adjustmentShares: AdjustmentShare[]
  /** Final amount the billPlayer owes: item subtotal plus all adjustment shares. */
  total: number
}

export interface SplitResult {
  /** Sum of charged item line totals. */
  itemSubtotal: number
  /** Sum of signed adjustment amounts. */
  adjustmentsTotal: number
  /** itemSubtotal + adjustmentsTotal, equals the merchant's final total. */
  grandTotal: number
  shares: BillPlayerShare[]
}

interface WeightedBillPlayer {
  billPlayerId: string
  weight: number
}

/**
 * Deterministic largest-remainder allocation of a signed amount across
 * weighted billPlayers. Exact rational arithmetic uses BigInt internally so
 * products of two safe integers never lose precision.
 *
 * Ties in the fractional remainder are broken by billPlayer order, so the
 * same input always produces the same rupiah assignment.
 */
export function allocateProportional(
  amount: number,
  billPlayers: ReadonlyArray<WeightedBillPlayer>
): Array<{ billPlayerId: string; amount: number }> {
  if (amount === 0) {
    return billPlayers.map((p) => ({
      billPlayerId: p.billPlayerId,
      amount: 0,
    }))
  }

  const totalWeight = billPlayers.reduce((sum, p) => sum + p.weight, 0)
  if (totalWeight <= 0) {
    throw new Error(
      "allocateProportional requires a positive total weight for non-zero amounts"
    )
  }

  const denom = BigInt(totalWeight)
  const bigAmount = BigInt(amount)

  const rows = billPlayers.map((p, index) => {
    const scaled = bigAmount * BigInt(p.weight)
    const base = floorDiv(scaled, denom)
    const remainder = scaled - base * denom
    return { billPlayerId: p.billPlayerId, index, base, remainder }
  })

  const assignedTotal = rows.reduce((sum, row) => sum + row.base, 0n)
  let leftover = bigAmount - assignedTotal
  if (leftover !== 0n) {
    const step = leftover > 0n ? 1n : -1n
    const order = [...rows].sort((a, b) => {
      if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1
      return a.index - b.index
    })
    let i = 0
    while (leftover !== 0n) {
      order[i % order.length].base += step
      leftover -= step
      i++
    }
  }

  return rows.map((row) => ({
    billPlayerId: row.billPlayerId,
    amount: Number(row.base),
  }))
}

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b
  const r = a % b
  if (r !== 0n && r < 0n !== b < 0n) return q - 1n
  return q
}

/**
 * Validates the entered bill data and computes billPlayer shares. Throws
 * {@link SplitValidationError} listing every reconciliation problem when the
 * data does not balance, so callers can show all allocation errors at once.
 */
export function computeSplit(input: SplitInput): SplitResult {
  const issues: SplitIssue[] = []

  const moneyFields: Array<[string, number]> = [
    ["sourceSubtotal", input.sourceSubtotal],
    ["finalTotal", input.finalTotal],
    ...input.adjustments.map((a): [string, number] => [
      `adjustment:${a.id}`,
      a.amount,
    ]),
    ...input.items.flatMap((i): Array<[string, number]> => [
      [`item:${i.id}:quantity`, i.quantity],
      [`item:${i.id}:unitPrice`, i.unitPrice],
      [`item:${i.id}:lineTotal`, i.lineTotal],
    ]),
    ...input.allocations.map((a): [string, number] => [
      `allocation:${a.itemId}:${a.billPlayerId}`,
      a.quantity,
    ]),
  ]
  for (const [field, value] of moneyFields) {
    if (!isSafeRupiah(value)) {
      issues.push({ code: "unsafe-integer", field, value })
    }
  }

  if (issues.length > 0) {
    throw new SplitValidationError(issues)
  }

  if (input.items.length === 0) issues.push({ code: "no-items" })
  if (input.billPlayers.length === 0) issues.push({ code: "no-players" })

  const itemIds = new Set<string>()
  for (const item of input.items) {
    if (itemIds.has(item.id)) {
      issues.push({ code: "unknown-item", itemId: item.id })
    }
    itemIds.add(item.id)
    if (item.quantity < 1) {
      issues.push({
        code: "invalid-item-quantity",
        itemId: item.id,
        quantity: item.quantity,
      })
    }
    if (item.unitPrice < 0) {
      issues.push({
        code: "invalid-unit-price",
        itemId: item.id,
        unitPrice: item.unitPrice,
      })
    }
    const expected = item.quantity * item.unitPrice
    if (item.lineTotal !== expected) {
      issues.push({
        code: "line-total-mismatch",
        itemId: item.id,
        expected,
        actual: item.lineTotal,
      })
    }
  }

  const billPlayerIds = new Set<string>()
  for (const billPlayer of input.billPlayers) {
    billPlayerIds.add(billPlayer.id)
  }

  const assignedByItem = new Map<string, number>()
  const seenAllocations = new Set<string>()
  for (const allocation of input.allocations) {
    if (!itemIds.has(allocation.itemId)) {
      issues.push({ code: "unknown-item", itemId: allocation.itemId })
      continue
    }
    if (!billPlayerIds.has(allocation.billPlayerId)) {
      issues.push({
        code: "unknown-player",
        billPlayerId: allocation.billPlayerId,
      })
      continue
    }
    const key = `${allocation.itemId}::${allocation.billPlayerId}`
    if (seenAllocations.has(key)) {
      issues.push({
        code: "duplicate-allocation",
        itemId: allocation.itemId,
        billPlayerId: allocation.billPlayerId,
      })
      continue
    }
    seenAllocations.add(key)
    if (allocation.quantity < 1) {
      issues.push({
        code: "invalid-allocation-quantity",
        itemId: allocation.itemId,
        billPlayerId: allocation.billPlayerId,
        quantity: allocation.quantity,
      })
      continue
    }
    assignedByItem.set(
      allocation.itemId,
      (assignedByItem.get(allocation.itemId) ?? 0) + allocation.quantity
    )
  }

  for (const item of input.items) {
    if (item.quantity < 1) continue
    const assigned = assignedByItem.get(item.id) ?? 0
    const ordered = itemUnits(item.quantity, item.bundleSize)
    if (assigned !== ordered) {
      issues.push({
        code: "item-quantity-mismatch",
        itemId: item.id,
        name: item.name,
        ordered,
        assigned,
      })
    }
  }

  const itemSubtotal = input.items.reduce(
    (sum, item) => sum + item.lineTotal,
    0
  )
  if (itemSubtotal !== input.sourceSubtotal) {
    issues.push({
      code: "subtotal-mismatch",
      expected: input.sourceSubtotal,
      actual: itemSubtotal,
    })
  }

  const adjustmentsTotal = input.adjustments.reduce(
    (sum, a) => sum + a.amount,
    0
  )
  const grandTotal = itemSubtotal + adjustmentsTotal
  if (grandTotal !== input.finalTotal) {
    issues.push({
      code: "final-total-mismatch",
      expected: input.finalTotal,
      actual: grandTotal,
    })
  }

  const hasNonZeroAdjustment = input.adjustments.some((a) => a.amount !== 0)
  if (hasNonZeroAdjustment && itemSubtotal === 0) {
    issues.push({ code: "zero-item-subtotal" })
  }

  if (issues.length > 0) {
    throw new SplitValidationError(issues)
  }

  const itemSubtotalByBillPlayer = new Map<string, number>(
    input.billPlayers.map((p) => [p.id, 0])
  )
  for (const item of input.items) {
    for (const { billPlayerId, amount } of allocateItemCost(
      item,
      input.allocations,
      input.billPlayers
    )) {
      itemSubtotalByBillPlayer.set(
        billPlayerId,
        (itemSubtotalByBillPlayer.get(billPlayerId) ?? 0) + amount
      )
    }
  }

  const weights: WeightedBillPlayer[] = input.billPlayers.map((p) => ({
    billPlayerId: p.id,
    weight: itemSubtotalByBillPlayer.get(p.id) ?? 0,
  }))

  const shares: BillPlayerShare[] = input.billPlayers.map((p) => {
    const itemSubtotalForP = itemSubtotalByBillPlayer.get(p.id) ?? 0
    return {
      billPlayerId: p.id,
      itemSubtotal: itemSubtotalForP,
      percentage: itemSubtotal === 0 ? 0 : itemSubtotalForP / itemSubtotal,
      adjustmentShares: [],
      total: itemSubtotalForP,
    }
  })
  const shareByBillPlayer = new Map(shares.map((s) => [s.billPlayerId, s]))

  for (const adjustment of input.adjustments) {
    const allocation = allocateProportional(adjustment.amount, weights)
    for (const { billPlayerId, amount } of allocation) {
      shareByBillPlayer
        .get(billPlayerId)!
        .adjustmentShares.push({ adjustmentId: adjustment.id, amount })
      shareByBillPlayer.get(billPlayerId)!.total += amount
    }
  }

  const shareTotal = shares.reduce((sum, s) => sum + s.total, 0)
  if (shareTotal !== grandTotal || shareTotal !== input.finalTotal) {
    throw new SplitValidationError([
      {
        code: "final-total-mismatch",
        expected: input.finalTotal,
        actual: shareTotal,
      },
    ])
  }

  return {
    itemSubtotal,
    adjustmentsTotal,
    grandTotal,
    shares,
  }
}
