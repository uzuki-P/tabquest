import { itemUnits, computeSplit, SplitValidationError } from "@/domain/split"
import type { SplitInput, SplitIssue, SplitResult } from "@/domain/split"
import { billStructureSchema, parseRupiahField } from "./bill-schema"
import type { AdjustmentType, BillStructureInput } from "./bill-schema"

/**
 * Shared form-value shapes for the admin editor. Money and quantity inputs
 * stay strings in the form and parse to integers at the boundary, through
 * the same Zod schema the server uses.
 */

export interface ItemFormValue {
  key: string
  name: string
  variantNotes: string
  quantity: string
  /** Items received per ordered unit, blank means 1. */
  bundleSize?: string
  unitPrice: string
}

export interface AdjustmentFormValue {
  key: string
  type: AdjustmentType
  label: string
  amount: string
  /** Printed amount when the receipt shows one that differs from the net. */
  originalAmount: string
}

export interface PlayerFormValue {
  key: string
  alias: string
  /** Directory player on the bill; null until one is picked or created. */
  playerId: string | null
}

export interface BillFormValue {
  merchant: string
  title: string
  orderDate: string
  sourceSubtotal: string
  finalTotal: string
  items: ItemFormValue[]
  adjustments: AdjustmentFormValue[]
  billPlayers: PlayerFormValue[]
}

/** Allocation matrix keyed by `${itemKey}::${billPlayerKey}`. */
export type AllocationMatrix = Record<string, string>

export interface BuildOutcome {
  ok: boolean
  issues: string[]
  structure: BillStructureInput | null
}

function parseIntField(
  value: string,
  label: string,
  issues: string[]
): number | null {
  const parsed = parseRupiahField(value)
  if (parsed === null) {
    issues.push(`${label}: enter a whole number of rupiah`)
    return null
  }
  return parsed
}

function parseQuantity(
  value: string,
  label: string,
  issues: string[]
): number | null {
  if (!/^\d+$/.test(value.trim())) {
    issues.push(`${label}: enter a whole number of at least 1`)
    return null
  }
  const parsed = Number(value.trim())
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    issues.push(`${label}: enter a whole number of at least 1`)
    return null
  }
  return parsed
}

export function buildStructure(
  value: BillFormValue,
  matrix: AllocationMatrix
): BuildOutcome {
  const issues: string[] = []

  const sourceSubtotal = parseIntField(
    value.sourceSubtotal,
    "Source subtotal",
    issues
  )
  const finalTotal = parseIntField(
    value.finalTotal,
    "Final charged total",
    issues
  )

  const items: BillStructureInput["items"] = []
  value.items.forEach((item, index) => {
    const quantity = parseQuantity(
      item.quantity,
      `Item ${index + 1} quantity`,
      issues
    )
    const unitPrice = parseIntField(
      item.unitPrice,
      `Item ${index + 1} unit price`,
      issues
    )
    const bundleSize = item.bundleSize?.trim()
      ? parseQuantity(
          item.bundleSize,
          `Item ${index + 1} items per price`,
          issues
        )
      : 1
    // Line total is derived, never entered: quantity x unit price.
    if (quantity === null || unitPrice === null || bundleSize === null) return
    items.push({
      id: item.key,
      name: item.name,
      variantNotes: item.variantNotes,
      quantity,
      unitPrice,
      bundleSize,
      lineTotal: quantity * unitPrice,
      sortOrder: index,
    })
  })

  const adjustments: BillStructureInput["adjustments"] = []
  value.adjustments.forEach((adjustment, index) => {
    const amount = parseIntField(
      adjustment.amount,
      `Adjustment ${index + 1} amount`,
      issues
    )
    if (amount === null) return
    // Optional printed amount; only kept when it differs from the net.
    let originalAmount: number | null = null
    if (adjustment.originalAmount.trim() !== "") {
      const parsed = parseRupiahField(adjustment.originalAmount)
      if (parsed === null || parsed <= 0) {
        issues.push(
          `Adjustment ${index + 1} printed amount: enter a positive whole number of rupiah`
        )
      } else if (parsed !== amount) {
        originalAmount = parsed
      }
    }
    adjustments.push({
      id: adjustment.key,
      type: adjustment.type,
      label: adjustment.label,
      amount,
      originalAmount,
      sortOrder: index,
    })
  })

  const billPlayers: BillStructureInput["billPlayers"] = []
  value.billPlayers.forEach((billPlayer, index) => {
    if (billPlayer.playerId === null) {
      issues.push(
        `Pick a player for ${billPlayer.alias || `person ${index + 1}`}`
      )
      return
    }
    billPlayers.push({
      id: billPlayer.key,
      alias: billPlayer.alias,
      playerId: billPlayer.playerId,
      sortOrder: index,
    })
  })

  const allocations: BillStructureInput["allocations"] = []
  if (items.length > 0 && billPlayers.length > 0) {
    for (const item of value.items) {
      for (const billPlayer of value.billPlayers) {
        const raw = matrix[`${item.key}::${billPlayer.key}`] ?? ""
        if (raw.trim() === "" || raw.trim() === "0") continue
        const quantity = parseQuantity(
          raw,
          `${item.name} for ${billPlayer.alias || "player"}`,
          issues
        )
        if (quantity === null) continue
        allocations.push({
          itemId: item.key,
          billPlayerId: billPlayer.key,
          quantity,
        })
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues, structure: null }
  if (sourceSubtotal === null || finalTotal === null)
    return {
      ok: false,
      issues: ["Header amounts are missing"],
      structure: null,
    }

  const structure: BillStructureInput = {
    header: {
      merchant: value.merchant,
      title: value.title,
      orderDate: value.orderDate,
      currency: "IDR",
      sourceSubtotal,
      finalTotal,
    },
    items,
    adjustments,
    billPlayers,
    allocations,
  }

  const parsed = billStructureSchema.safeParse(structure)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) =>
          `${issue.path.map(String).join(".") || "value"}: ${issue.message}`
      ),
      structure: null,
    }
  }

  return { ok: true, issues: [], structure: parsed.data }
}

export function toSplitInput(structure: BillStructureInput): SplitInput {
  return {
    items: structure.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      bundleSize: item.bundleSize,
    })),
    billPlayers: structure.billPlayers.map((p) => ({ id: p.id })),
    allocations: structure.allocations,
    adjustments: structure.adjustments.map((a) => ({
      id: a.id,
      amount: a.amount,
    })),
    sourceSubtotal: structure.header.sourceSubtotal,
    finalTotal: structure.header.finalTotal,
  }
}

export interface PreviewOutcome {
  split: SplitResult | null
  issues: SplitIssue[]
  formIssues: string[]
}

/** Live client-side reconciliation preview using the domain module. */
export function previewSplit(
  value: BillFormValue,
  matrix: AllocationMatrix
): PreviewOutcome {
  const built = buildStructure(value, matrix)
  if (!built.ok || !built.structure) {
    return { split: null, issues: [], formIssues: built.issues }
  }
  try {
    return {
      split: computeSplit(toSplitInput(built.structure)),
      issues: [],
      formIssues: [],
    }
  } catch (error) {
    if (error instanceof SplitValidationError)
      return { split: null, issues: error.issues, formIssues: [] }
    throw error
  }
}

/** Items to hand out for a form row: qty x items per unit, 0 while invalid. */
export function formItemUnits(item: ItemFormValue): number {
  const quantity = item.quantity.trim()
  const perUnit = item.bundleSize?.trim() ?? ""
  const units = itemUnits(
    /^\d+$/.test(quantity) ? Number(quantity) : 0,
    /^\d+$/.test(perUnit) && Number(perUnit) >= 1 ? Number(perUnit) : 1
  )
  return Number.isSafeInteger(units) ? units : 0
}

/** Remaining unassigned items per item row, keyed by item key. */
export function remainingByItem(
  value: BillFormValue,
  matrix: AllocationMatrix
): Map<string, number> {
  const remaining = new Map<string, number>()
  for (const item of value.items) {
    let assigned = 0
    for (const billPlayer of value.billPlayers) {
      const raw = matrix[`${item.key}::${billPlayer.key}`] ?? ""
      const parsed = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : 0
      assigned += Number.isSafeInteger(parsed) ? parsed : 0
    }
    remaining.set(item.key, formItemUnits(item) - assigned)
  }
  return remaining
}

export function describeSplitIssue(issue: SplitIssue): string {
  switch (issue.code) {
    case "unsafe-integer":
      return `${issue.field} is outside the safe integer range`
    case "no-items":
      return "Add at least one menu item"
    case "no-players":
      return "Add at least one player"
    case "invalid-item-quantity":
      return `An item has quantity ${issue.quantity}, which must be at least 1`
    case "invalid-unit-price":
      return `An item has unit price ${issue.unitPrice}, which cannot be negative`
    case "line-total-mismatch":
      return `A line total is ${issue.actual} but the expected item charge is ${issue.expected}`
    case "subtotal-mismatch":
      return `Items add up to ${issue.actual} but the source subtotal is ${issue.expected}`
    case "final-total-mismatch":
      return `The computed total is ${issue.actual} but the merchant charged ${issue.expected}`
    case "unknown-item":
      return `An allocation references a missing item (${issue.itemId})`
    case "unknown-player":
      return `An allocation references a missing player (${issue.billPlayerId})`
    case "duplicate-allocation":
      return `Duplicate allocation for item ${issue.itemId} and player ${issue.billPlayerId}`
    case "invalid-allocation-quantity":
      return `An allocated quantity is ${issue.quantity}, which must be at least 1`
    case "item-quantity-mismatch":
      return `${issue.name}: ${issue.assigned} of ${issue.ordered} units assigned`
    case "zero-item-subtotal":
      return "Order-wide adjustments need a non-zero item subtotal to split proportionally"
  }
}
