import { z } from "zod"

import { isValidDateString } from "./time"

/**
 * Single Zod validation system for the bill structure, shared by the admin
 * form and the server request handlers.
 */

export const ADJUSTMENT_TYPES = [
  "discount",
  "delivery",
  "service",
  "tax",
  "other",
] as const
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number]

const safeInt = z
  .number()
  .int()
  .refine((n) => Number.isSafeInteger(n), "outside the safe integer range")

const rowId = z.string().trim().min(1).max(100)
const sortOrder = z.number().int().min(0)

export const billHeaderSchema = z.object({
  merchant: z.string().trim().min(1, "Merchant is required").max(200),
  title: z.string().trim().max(200),
  orderDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Order date must be YYYY-MM-DD")
    .refine(isValidDateString, "Order date is not a real calendar date"),
  currency: z.literal("IDR").default("IDR"),
  sourceSubtotal: safeInt.min(0),
  finalTotal: safeInt,
})
export type BillHeaderInput = z.infer<typeof billHeaderSchema>

export const billItemSchema = z.object({
  id: rowId,
  name: z.string().trim().min(1, "Item name is required").max(200),
  variantNotes: z.string().trim().max(300),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
  unitPrice: safeInt.min(0),
  lineTotal: safeInt.min(0),
  bundleSize: z
    .number()
    .int()
    .min(1, "Items per price must be at least 1")
    .optional(),
  sortOrder,
})
export type BillItemInput = z.infer<typeof billItemSchema>

export const billAdjustmentSchema = z.object({
  id: rowId,
  type: z.enum(ADJUSTMENT_TYPES),
  label: z.string().trim().min(1, "Label is required").max(200),
  amount: safeInt,
  /** Amount as printed on the receipt when the net differs; display-only. */
  originalAmount: safeInt.positive().nullable().optional(),
  sortOrder,
})
export type BillAdjustmentInput = z.infer<typeof billAdjustmentSchema>

export const billPlayerSchema = z.object({
  id: rowId,
  alias: z.string().trim().min(1, "Alias is required").max(100),
  /** The directory player this bill player represents. */
  playerId: z.string().trim().min(1).max(100),
  sortOrder,
})
export type BillPlayerInput = z.infer<typeof billPlayerSchema>

export const billAllocationSchema = z.object({
  itemId: rowId,
  billPlayerId: rowId,
  quantity: z.number().int().min(1, "Allocated quantity must be at least 1"),
})
export type BillAllocationInput = z.infer<typeof billAllocationSchema>

export const billStructureSchema = z.object({
  header: billHeaderSchema,
  items: z.array(billItemSchema),
  adjustments: z.array(billAdjustmentSchema),
  billPlayers: z.array(billPlayerSchema),
  allocations: z.array(billAllocationSchema),
})
export type BillStructureInput = z.infer<typeof billStructureSchema>

/** The non-header rows, as posted alongside the header when creating a bill. */
export const billStructureRowsSchema = billStructureSchema.omit({
  header: true,
})
export type BillStructureRowsInput = z.infer<typeof billStructureRowsSchema>

export const paymentStateSchema = z.enum(["unpaid", "paid"])
export type PaymentState = z.infer<typeof paymentStateSchema>

export const publicBillQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .refine(isValidDateString, "Date is not a real calendar date")
    .optional(),
  p: z.string().trim().max(100).optional(),
})

/** Parses a form string into an integer rupiah value, empty string as null. */
export function parseRupiahField(
  value: string | null | undefined
): number | null {
  if (value === null || value === undefined || value.trim() === "") return null
  const cleaned = value.trim().replace(/[,\s]/g, "")
  if (!/^-?\d+$/.test(cleaned)) return null
  const parsed = Number(cleaned)
  return Number.isSafeInteger(parsed) ? parsed : null
}
