import { and, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm"
import { Data, Effect } from "effect"

import type { Db, Tx } from "@/db/client"
import {
  adjustmentAllocations,
  adjustments,
  bills,
  players,
  itemAllocations,
  items,
  billPlayers,
  paymentStatuses,
} from "@/db/schema"
import type {
  AdjustmentAllocationRow,
  AdjustmentRow,
  BillRow,
  ItemAllocationRow,
  ItemRow,
  BillPlayerRow,
  PaymentStatusRow,
} from "@/db/schema"
import {
  allocateItemCost,
  computeSplit,
  SplitValidationError,
} from "@/domain/split"
import type { SplitInput, SplitIssue, SplitResult } from "@/domain/split"
import type { BillHeaderInput, BillStructureInput } from "@/lib/bill-schema"
import { nowUtcIso } from "@/lib/time"
import { deleteImage } from "./images"
import { refreshPlayerHoverSummaries } from "./insights"

export class BillNotFound extends Data.TaggedError("BillNotFound")<{
  billId: string
}> {}
export class PublicBillNotFound extends Data.TaggedError("PublicBillNotFound")<{
  publicId: string
}> {}
export class BillAlreadyPublished extends Data.TaggedError(
  "BillAlreadyPublished"
)<{ billId: string }> {}
export class BillNotPublished extends Data.TaggedError("BillNotPublished")<{
  billId: string
}> {}
export class BillStillPublished extends Data.TaggedError("BillStillPublished")<{
  billId: string
}> {}
export class UnknownPlayer extends Data.TaggedError("UnknownPlayer")<{
  playerId: string
}> {}
export class MissingBillImage extends Data.TaggedError("MissingBillImage")<{
  billId: string
}> {}
export class SplitReconciliationFailed extends Data.TaggedError(
  "SplitReconciliationFailed"
)<{
  issues: SplitIssue[]
}> {}
export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  cause: unknown
}> {}

export interface BillDeps {
  db: Db
  /** Upload directory, needed only by deleteBill to remove the image. */
  uploadDir?: string
}

export interface StoredImage {
  objectKey: string
  mediaType: string
  byteSize: number
}

export interface BillDetail {
  bill: BillRow
  items: ItemRow[]
  adjustments: AdjustmentRow[]
  billPlayers: BillPlayerRow[]
  allocations: ItemAllocationRow[]
  adjustmentAllocations: AdjustmentAllocationRow[]
  paymentStatuses: PaymentStatusRow[]
  split: SplitResult | null
  splitIssues: SplitIssue[]
}

export interface PublicBillPlayerView {
  billPlayerId: string
  alias: string
  /** Directory link for ad-hoc people is null; their names never link. */
  playerId: string | null
  itemSubtotal: number
  percentage: number
  total: number
  paid: boolean
  itemLines: Array<{
    name: string
    variantNotes: string | null
    quantity: number
    unitPrice: number
    amount: number
  }>
  adjustmentLines: Array<{ label: string; amount: number }>
}

export interface PublicBillView {
  publicId: string
  merchant: string
  title: string | null
  orderDate: string
  currency: string
  sourceSubtotal: number
  finalTotal: number
  adjustmentsTotal: number
  imageAvailable: boolean
  archived: boolean
  billPlayers: PublicBillPlayerView[]
  adjustments: Array<{
    id: string
    type: string
    label: string
    amount: number
    originalAmount: number | null
  }>
}

export function newBillId(): string {
  return Bun.randomUUIDv7()
}

export function newPublicId(): string {
  return crypto.randomUUID()
}

export function tryDb<T>(
  op: () => T | Promise<T>
): Effect.Effect<T, RepositoryError> {
  return Effect.tryPromise({
    try: async () => op(),
    catch: (cause) => new RepositoryError({ cause }),
  })
}

export function toSplitInput(
  detail: Omit<BillDetail, "split" | "splitIssues">
): SplitInput {
  return {
    items: detail.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      bundleSize: item.bundleSize,
    })),
    billPlayers: detail.billPlayers.map((p) => ({ id: p.id })),
    allocations: detail.allocations.map((a) => ({
      itemId: a.itemId,
      billPlayerId: a.billPlayerId,
      quantity: a.quantity,
    })),
    adjustments: detail.adjustments.map((a) => ({
      id: a.id,
      amount: a.signedAmount,
    })),
    sourceSubtotal: detail.bill.sourceSubtotal,
    finalTotal: detail.bill.finalTotal,
  }
}

export function previewSplit(
  detail: Omit<BillDetail, "split" | "splitIssues">
): Pick<BillDetail, "split" | "splitIssues"> {
  try {
    return { split: computeSplit(toSplitInput(detail)), splitIssues: [] }
  } catch (error) {
    if (error instanceof SplitValidationError)
      return { split: null, splitIssues: error.issues }
    throw error
  }
}

export function createBill(
  deps: BillDeps,
  header: BillHeaderInput,
  image: StoredImage | null,
  billPlayerCount = 1
): Effect.Effect<BillRow, RepositoryError> {
  return tryDb(async () => {
    const now = nowUtcIso()
    const row: typeof bills.$inferInsert = {
      id: newBillId(),
      publicId: newPublicId(),
      merchant: header.merchant,
      title: header.title === "" ? null : header.title,
      orderDate: header.orderDate,
      timezone: "Asia/Jakarta",
      currency: header.currency,
      sourceSubtotal: header.sourceSubtotal,
      finalTotal: header.finalTotal,
      status: "draft",
      imageObjectKey: image?.objectKey ?? null,
      imageMediaType: image?.mediaType ?? null,
      imageByteSize: image?.byteSize ?? null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    }
    await deps.db.transaction(async (tx: Tx) => {
      await tx.insert(bills).values(row).run()
      await tx
        .insert(billPlayers)
        .values(
          Array.from({ length: billPlayerCount }, (_, index) => ({
            id: newBillId(),
            billId: row.id,
            alias: `Person ${index + 1}`,
            sortOrder: index,
          }))
        )
        .run()
    })
    return (await deps.db
      .select()
      .from(bills)
      .where(eq(bills.id, row.id))
      .get())!
  })
}

export function createFullBill(
  deps: BillDeps,
  header: BillHeaderInput,
  rows: Omit<BillStructureInput, "header">,
  image: StoredImage | null
): Effect.Effect<BillRow, UnknownPlayer | RepositoryError> {
  return Effect.gen(function* () {
    yield* validatePlayerLinks(deps, rows.billPlayers)
    return yield* tryDb(async () => {
      const now = nowUtcIso()
      const row: typeof bills.$inferInsert = {
        id: newBillId(),
        publicId: newPublicId(),
        merchant: header.merchant,
        title: header.title === "" ? null : header.title,
        orderDate: header.orderDate,
        timezone: "Asia/Jakarta",
        currency: header.currency,
        sourceSubtotal: header.sourceSubtotal,
        finalTotal: header.finalTotal,
        status: "draft",
        imageObjectKey: image?.objectKey ?? null,
        imageMediaType: image?.mediaType ?? null,
        imageByteSize: image?.byteSize ?? null,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      }
      await deps.db.transaction(async (tx: Tx) => {
        await tx.insert(bills).values(row).run()
        await insertStructureRows(tx, row.id, rows)
      })
      return (await deps.db
        .select()
        .from(bills)
        .where(eq(bills.id, row.id))
        .get())!
    })
  })
}

/**
 * BillPlayer rows may link to directory players; every linked id must
 * exist so a stale client cannot persist a dangling reference.
 */
function validatePlayerLinks(
  deps: BillDeps,
  rows: BillStructureInput["billPlayers"]
): Effect.Effect<void, UnknownPlayer | RepositoryError> {
  return Effect.gen(function* () {
    const linkedPlayerIds = [
      ...new Set(
        rows
          .map((p) => p.playerId)
          .filter((id): id is string => typeof id === "string" && id !== "")
      ),
    ]
    if (linkedPlayerIds.length === 0) return
    const found = yield* tryDb(() =>
      deps.db
        .select({ id: players.id })
        .from(players)
        .where(inArray(players.id, linkedPlayerIds))
        .all()
    )
    const foundIds = new Set(found.map((row) => row.id))
    const missing = linkedPlayerIds.find((id) => !foundIds.has(id))
    if (missing !== undefined) {
      return yield* new UnknownPlayer({ playerId: missing })
    }
  })
}

async function insertStructureRows(
  tx: Tx,
  billId: string,
  rows: Omit<BillStructureInput, "header">
): Promise<void> {
  if (rows.items.length > 0) {
    await tx
      .insert(items)
      .values(
        rows.items.map((item) => ({
          id: item.id,
          billId,
          name: item.name,
          variantNotes: item.variantNotes === "" ? null : item.variantNotes,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          bundleSize: item.bundleSize ?? 1,
          sortOrder: item.sortOrder,
        }))
      )
      .run()
  }
  if (rows.adjustments.length > 0) {
    await tx
      .insert(adjustments)
      .values(
        rows.adjustments.map((adj) => ({
          id: adj.id,
          billId,
          type: adj.type,
          label: adj.label,
          signedAmount: adj.amount,
          originalAmount: adj.originalAmount ?? null,
          sortOrder: adj.sortOrder,
        }))
      )
      .run()
  }
  if (rows.billPlayers.length > 0) {
    await tx
      .insert(billPlayers)
      .values(
        rows.billPlayers.map((p) => ({
          id: p.id,
          billId,
          alias: p.alias,
          sortOrder: p.sortOrder,
          playerId: p.playerId,
        }))
      )
      .run()
  }
  if (rows.allocations.length > 0) {
    await tx
      .insert(itemAllocations)
      .values(
        rows.allocations.map((a) => ({
          id: newBillId(),
          itemId: a.itemId,
          billPlayerId: a.billPlayerId,
          quantity: a.quantity,
        }))
      )
      .run()
  }
}

export function replaceImage(
  deps: BillDeps,
  billId: string,
  image: StoredImage
): Effect.Effect<BillRow, BillNotFound | RepositoryError> {
  return Effect.gen(function* () {
    const existing = yield* tryDb(() =>
      deps.db.select().from(bills).where(eq(bills.id, billId)).get()
    )
    if (!existing) return yield* new BillNotFound({ billId })
    return yield* tryDb(async () => {
      await deps.db
        .update(bills)
        .set({
          imageObjectKey: image.objectKey,
          imageMediaType: image.mediaType,
          imageByteSize: image.byteSize,
          updatedAt: nowUtcIso(),
        })
        .where(and(eq(bills.id, billId), eq(bills.status, "draft")))
        .run()
      return (await deps.db
        .select()
        .from(bills)
        .where(eq(bills.id, billId))
        .get())!
    })
  })
}

export function saveStructure(
  deps: BillDeps,
  billId: string,
  structure: BillStructureInput
): Effect.Effect<
  BillRow,
  BillNotFound | BillAlreadyPublished | UnknownPlayer | RepositoryError
> {
  return Effect.gen(function* () {
    const existing = yield* tryDb(() =>
      deps.db.select().from(bills).where(eq(bills.id, billId)).get()
    )
    if (!existing) return yield* new BillNotFound({ billId })
    if (existing.status !== "draft")
      return yield* new BillAlreadyPublished({ billId })

    yield* validatePlayerLinks(deps, structure.billPlayers)

    return yield* tryDb(() =>
      deps.db.transaction(async (tx: Tx) => {
        const now = nowUtcIso()
        // Unpublish + edit cycles replace the billPlayer rows, but payment
        // marks should survive for billPlayers that keep their ID, so they
        // are captured before the delete and restored after the insert.
        const billPlayerIds = (
          await tx
            .select({ id: billPlayers.id })
            .from(billPlayers)
            .where(eq(billPlayers.billId, billId))
            .all()
        ).map((p) => p.id)
        const previousStatuses =
          billPlayerIds.length > 0
            ? await tx
                .select()
                .from(paymentStatuses)
                .where(inArray(paymentStatuses.billPlayerId, billPlayerIds))
                .all()
            : []
        await tx
          .update(bills)
          .set({
            merchant: structure.header.merchant,
            title:
              structure.header.title === "" ? null : structure.header.title,
            orderDate: structure.header.orderDate,
            currency: structure.header.currency,
            sourceSubtotal: structure.header.sourceSubtotal,
            finalTotal: structure.header.finalTotal,
            updatedAt: now,
          })
          .where(eq(bills.id, billId))
          .run()

        // Drafts replace their whole structure; FK cascades clear old allocations.
        await tx.delete(items).where(eq(items.billId, billId)).run()
        await tx.delete(adjustments).where(eq(adjustments.billId, billId)).run()
        await tx.delete(billPlayers).where(eq(billPlayers.billId, billId)).run()

        await insertStructureRows(tx, billId, structure)

        const restoredStatuses = previousStatuses.filter((status) =>
          structure.billPlayers.some((p) => p.id === status.billPlayerId)
        )
        if (restoredStatuses.length > 0) {
          await tx
            .insert(paymentStatuses)
            .values(restoredStatuses)
            .onConflictDoNothing()
            .run()
        }

        return (await tx
          .select()
          .from(bills)
          .where(eq(bills.id, billId))
          .get())!
      })
    )
  })
}

function loadDetailRows(deps: BillDeps, billId: string) {
  return deps.db.transaction(async (tx: Tx) => {
    const bill = await tx.select().from(bills).where(eq(bills.id, billId)).get()
    if (!bill) return null
    const bySortOrder = (a: { sortOrder: number }, b: { sortOrder: number }) =>
      a.sortOrder - b.sortOrder
    const itemRows = (
      await tx.select().from(items).where(eq(items.billId, billId)).all()
    ).sort(bySortOrder)
    const adjustmentRows = (
      await tx
        .select()
        .from(adjustments)
        .where(eq(adjustments.billId, billId))
        .all()
    ).sort(bySortOrder)
    const billPlayerRows = (
      await tx
        .select()
        .from(billPlayers)
        .where(eq(billPlayers.billId, billId))
        .all()
    ).sort(bySortOrder)
    const itemIds = itemRows.map((i) => i.id)
    const allocationRows =
      itemIds.length > 0
        ? await tx
            .select()
            .from(itemAllocations)
            .where(inArray(itemAllocations.itemId, itemIds))
            .all()
        : []
    const adjustmentIds = adjustmentRows.map((a) => a.id)
    const adjustmentAllocationRows =
      adjustmentIds.length > 0
        ? await tx
            .select()
            .from(adjustmentAllocations)
            .where(inArray(adjustmentAllocations.adjustmentId, adjustmentIds))
            .all()
        : []
    const billPlayerIds = billPlayerRows.map((p) => p.id)
    const statusRows =
      billPlayerIds.length > 0
        ? await tx
            .select()
            .from(paymentStatuses)
            .where(inArray(paymentStatuses.billPlayerId, billPlayerIds))
            .all()
        : []
    return {
      bill,
      items: itemRows,
      adjustments: adjustmentRows,
      billPlayers: billPlayerRows,
      allocations: allocationRows,
      adjustmentAllocations: adjustmentAllocationRows,
      paymentStatuses: statusRows,
    }
  })
}

export function getBillDetail(
  deps: BillDeps,
  billId: string
): Effect.Effect<BillDetail, BillNotFound | RepositoryError> {
  return Effect.gen(function* () {
    const rows = yield* tryDb(() => loadDetailRows(deps, billId))
    if (!rows) return yield* new BillNotFound({ billId })
    return { ...rows, ...previewSplit(rows) }
  })
}

export function publishBill(
  deps: BillDeps,
  billId: string
): Effect.Effect<
  BillRow,
  | BillNotFound
  | BillAlreadyPublished
  | MissingBillImage
  | SplitReconciliationFailed
  | RepositoryError
> {
  return Effect.gen(function* () {
    const rows = yield* tryDb(() => loadDetailRows(deps, billId))
    if (!rows) return yield* new BillNotFound({ billId })
    if (rows.bill.status !== "draft")
      return yield* new BillAlreadyPublished({ billId })
    if (!rows.bill.imageObjectKey || !rows.bill.imageMediaType) {
      return yield* new MissingBillImage({ billId })
    }

    let split: SplitResult
    try {
      split = computeSplit(toSplitInput(rows))
    } catch (error) {
      if (error instanceof SplitValidationError) {
        return yield* new SplitReconciliationFailed({ issues: error.issues })
      }
      throw error
    }

    return yield* tryDb(() =>
      deps.db.transaction(async (tx: Tx) => {
        const now = nowUtcIso()
        if (rows.adjustments.length > 0) {
          await tx
            .delete(adjustmentAllocations)
            .where(
              inArray(
                adjustmentAllocations.adjustmentId,
                rows.adjustments.map((a) => a.id)
              )
            )
            .run()
          const allocationRows = split.shares.flatMap((share) =>
            share.adjustmentShares.map((adjShare) => ({
              id: newBillId(),
              adjustmentId: adjShare.adjustmentId,
              billPlayerId: share.billPlayerId,
              signedAmount: adjShare.amount,
            }))
          )
          if (allocationRows.length > 0) {
            await tx.insert(adjustmentAllocations).values(allocationRows).run()
          }
        }

        await tx
          .update(bills)
          .set({ status: "published", publishedAt: now, updatedAt: now })
          .where(eq(bills.id, billId))
          .run()

        await tx
          .insert(paymentStatuses)
          .values(
            rows.billPlayers.map((p) => ({
              billPlayerId: p.id,
              status: "unpaid",
              paidAt: null,
              lastChangedBy: null,
              updatedAt: now,
            }))
          )
          .onConflictDoNothing()
          .run()

        await refreshPlayerHoverSummaries(tx)

        return (await tx
          .select()
          .from(bills)
          .where(eq(bills.id, billId))
          .get())!
      })
    )
  })
}

/**
 * Reverts a published bill to a draft so the admin editor can change it
 * again. Payment marks survive (publish seeds statuses with
 * onConflictDoNothing); stored adjustment allocations are dropped because
 * they are recomputed from the structure on the next publish.
 */
export function unpublishBill(
  deps: BillDeps,
  billId: string
): Effect.Effect<BillRow, BillNotFound | BillNotPublished | RepositoryError> {
  return Effect.gen(function* () {
    const rows = yield* tryDb(() => loadDetailRows(deps, billId))
    if (!rows) return yield* new BillNotFound({ billId })
    if (rows.bill.status !== "published")
      return yield* new BillNotPublished({ billId })

    return yield* tryDb(() =>
      deps.db.transaction(async (tx: Tx) => {
        const now = nowUtcIso()
        if (rows.adjustments.length > 0) {
          await tx
            .delete(adjustmentAllocations)
            .where(
              inArray(
                adjustmentAllocations.adjustmentId,
                rows.adjustments.map((a) => a.id)
              )
            )
            .run()
        }
        await tx
          .update(bills)
          .set({ status: "draft", publishedAt: null, updatedAt: now })
          .where(eq(bills.id, billId))
          .run()
        await refreshPlayerHoverSummaries(tx)
        return (await tx
          .select()
          .from(bills)
          .where(eq(bills.id, billId))
          .get())!
      })
    )
  })
}

/**
 * Hides a bill from every list without touching its status: a published
 * bill stays live at /b/{publicId} while archived. Works on drafts and
 * published bills alike.
 */
export function archiveBill(
  deps: BillDeps,
  billId: string
): Effect.Effect<BillRow, BillNotFound | RepositoryError> {
  return setBillArchivedAt(deps, billId, nowUtcIso())
}

/** Clears the archive flag; the bill reappears in the active lists. */
export function unarchiveBill(
  deps: BillDeps,
  billId: string
): Effect.Effect<BillRow, BillNotFound | RepositoryError> {
  return setBillArchivedAt(deps, billId, null)
}

function setBillArchivedAt(
  deps: BillDeps,
  billId: string,
  archivedAt: string | null
): Effect.Effect<BillRow, BillNotFound | RepositoryError> {
  return Effect.gen(function* () {
    const row = yield* tryDb(() =>
      deps.db.transaction(async (tx: Tx) => {
        const updated = await tx
          .update(bills)
          .set({ archivedAt, updatedAt: nowUtcIso() })
          .where(eq(bills.id, billId))
          .run()
        if (updated.rowsAffected === 0) return null
        const bill = (await tx
          .select()
          .from(bills)
          .where(eq(bills.id, billId))
          .get())!
        if (bill.status === "published") await refreshPlayerHoverSummaries(tx)
        return bill
      })
    )
    if (!row) return yield* new BillNotFound({ billId })
    return row
  })
}

/**
 * Hard delete. Published bills are rejected first so payment history cannot
 * disappear in one click; the admin unpublishes deliberately instead. The
 * bill row delete cascades to billPlayers, items, allocations, adjustments,
 * and payment rows, and the receipt image is removed from the upload dir.
 */
export function deleteBill(
  deps: BillDeps,
  billId: string
): Effect.Effect<
  { ok: true },
  BillNotFound | BillStillPublished | RepositoryError
> {
  return Effect.gen(function* () {
    const existing = yield* tryDb(() =>
      deps.db.select().from(bills).where(eq(bills.id, billId)).get()
    )
    if (!existing) return yield* new BillNotFound({ billId })
    if (existing.status === "published") {
      return yield* new BillStillPublished({ billId })
    }

    yield* tryDb(() =>
      deps.db.transaction(async (tx: Tx) => {
        await tx.delete(bills).where(eq(bills.id, billId)).run()
      })
    )
    if (existing.imageObjectKey && deps.uploadDir) {
      try {
        deleteImage({ uploadDir: deps.uploadDir }, existing.imageObjectKey)
      } catch (cause) {
        console.error("[tabquest] failed to remove bill image", {
          billId,
          cause,
        })
      }
    }
    return { ok: true as const }
  })
}

export type AdminBillFilter = "active" | "archived" | "all"

export interface AdminBillListItem {
  id: string
  merchant: string
  title: string | null
  orderDate: string
  status: BillRow["status"]
  archived: boolean
  finalTotal: number
  billPlayerCount: number
  paidCount: number
}

/** All bills for the admin list, newest first, with paid counts. Default hides archived. */
export function listBillsAdmin(
  deps: BillDeps,
  filter: AdminBillFilter = "active"
): Effect.Effect<AdminBillListItem[], RepositoryError> {
  return Effect.gen(function* () {
    const archivedColumn = bills.archivedAt
    const where =
      filter === "active"
        ? isNull(archivedColumn)
        : filter === "archived"
          ? isNotNull(archivedColumn)
          : undefined
    const rows = yield* tryDb(() =>
      where
        ? deps.db.select().from(bills).where(where).all()
        : deps.db.select().from(bills).all()
    )
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (rows.length === 0) return []
    return yield* tryDb(async () => {
      const billIds = rows.map((bill) => bill.id)
      const billPlayerRows = await deps.db
        .select({ id: billPlayers.id, billId: billPlayers.billId })
        .from(billPlayers)
        .where(inArray(billPlayers.billId, billIds))
        .all()
      const paidStatuses =
        billPlayerRows.length === 0
          ? []
          : await deps.db
              .select({
                billPlayerId: paymentStatuses.billPlayerId,
                status: paymentStatuses.status,
              })
              .from(paymentStatuses)
              .where(
                inArray(
                  paymentStatuses.billPlayerId,
                  billPlayerRows.map((p) => p.id)
                )
              )
              .all()
      const billPlayerCounts = countByBillId(billPlayerRows)
      const paidCounts = paidCountsByBillId(billPlayerRows, paidStatuses)
      return rows.map((bill) => ({
        id: bill.id,
        merchant: bill.merchant,
        title: bill.title,
        orderDate: bill.orderDate,
        status: bill.status,
        archived: bill.archivedAt !== null,
        finalTotal: bill.finalTotal,
        billPlayerCount: billPlayerCounts.get(bill.id) ?? 0,
        paidCount: paidCounts.get(bill.id) ?? 0,
      }))
    })
  })
}

export function listPublishedByDate(
  deps: BillDeps,
  dateKey: string
): Effect.Effect<BillRow[], RepositoryError> {
  return tryDb(async () =>
    (
      await deps.db
        .select()
        .from(bills)
        .where(
          and(
            eq(bills.orderDate, dateKey),
            eq(bills.status, "published"),
            isNull(bills.archivedAt)
          )
        )
        .all()
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  )
}

/**
 * Published bills whose order date falls in the inclusive range
 * [fromKey, toKey], ordered by date and newest-first within a day.
 * Archived bills are excluded; their public pages still work directly.
 */
export function listPublishedByDateRange(
  deps: BillDeps,
  fromKey: string,
  toKey: string
): Effect.Effect<BillRow[], RepositoryError> {
  return tryDb(async () =>
    (
      await deps.db
        .select()
        .from(bills)
        .where(
          and(
            gte(bills.orderDate, fromKey),
            lte(bills.orderDate, toKey),
            eq(bills.status, "published"),
            isNull(bills.archivedAt)
          )
        )
        .all()
    ).sort(
      (a, b) =>
        a.orderDate.localeCompare(b.orderDate) ||
        b.createdAt.localeCompare(a.createdAt)
    )
  )
}

export interface BillListItem {
  id: string
  publicId: string
  merchant: string
  title: string | null
  orderDate: string
  sourceSubtotal: number
  finalTotal: number
  imageAvailable: boolean
  itemCount: number
  billPlayerCount: number
  paidCount: number
}

/**
 * Published bills over an inclusive order-date range plus the summary
 * counters the public calendar shows: line items, billPlayers, and how
 * many billPlayers have paid. Counts come from three batched queries over
 * the bill IDs so a whole month costs a fixed number of round trips.
 */
export function listPublishedSummariesBetween(
  deps: BillDeps,
  fromKey: string,
  toKey: string
): Effect.Effect<BillListItem[], RepositoryError> {
  return Effect.gen(function* () {
    const rows = yield* listPublishedByDateRange(deps, fromKey, toKey)
    if (rows.length === 0) return []
    return yield* tryDb(async () => {
      const billIds = rows.map((bill) => bill.id)
      const itemRows = await deps.db
        .select({ billId: items.billId })
        .from(items)
        .where(inArray(items.billId, billIds))
        .all()
      const billPlayerRows = await deps.db
        .select({ id: billPlayers.id, billId: billPlayers.billId })
        .from(billPlayers)
        .where(inArray(billPlayers.billId, billIds))
        .all()
      const paidStatuses =
        billPlayerRows.length === 0
          ? []
          : await deps.db
              .select({
                billPlayerId: paymentStatuses.billPlayerId,
                status: paymentStatuses.status,
              })
              .from(paymentStatuses)
              .where(
                inArray(
                  paymentStatuses.billPlayerId,
                  billPlayerRows.map((p) => p.id)
                )
              )
              .all()
      const itemCounts = countByBillId(itemRows)
      const billPlayerCounts = countByBillId(billPlayerRows)
      const paidCounts = paidCountsByBillId(billPlayerRows, paidStatuses)
      return rows.map((bill) => ({
        id: bill.id,
        publicId: bill.publicId,
        merchant: bill.merchant,
        title: bill.title,
        orderDate: bill.orderDate,
        sourceSubtotal: bill.sourceSubtotal,
        finalTotal: bill.finalTotal,
        imageAvailable: Boolean(bill.imageObjectKey),
        itemCount: itemCounts.get(bill.id) ?? 0,
        billPlayerCount: billPlayerCounts.get(bill.id) ?? 0,
        paidCount: paidCounts.get(bill.id) ?? 0,
      }))
    })
  })
}

export function listPublishedSummariesByDate(
  deps: BillDeps,
  dateKey: string
): Effect.Effect<BillListItem[], RepositoryError> {
  return listPublishedSummariesBetween(deps, dateKey, dateKey)
}

function countByBillId(rows: Array<{ billId: string }>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.billId, (counts.get(row.billId) ?? 0) + 1)
  }
  return counts
}

/** Per-bill count of billPlayers whose payment status is "paid". */
function paidCountsByBillId(
  billPlayerRows: Array<{ id: string; billId: string }>,
  statuses: Array<{ billPlayerId: string; status: string }>
): Map<string, number> {
  const paid = new Set(
    statuses.filter((s) => s.status === "paid").map((s) => s.billPlayerId)
  )
  const counts = new Map<string, number>()
  for (const billPlayer of billPlayerRows) {
    if (!paid.has(billPlayer.id)) continue
    counts.set(billPlayer.billId, (counts.get(billPlayer.billId) ?? 0) + 1)
  }
  return counts
}

export function getPublishedBill(
  deps: BillDeps,
  publicId: string
): Effect.Effect<PublicBillView, PublicBillNotFound | RepositoryError> {
  return Effect.gen(function* () {
    const rows = yield* tryDb(async () => {
      const bill = await deps.db
        .select()
        .from(bills)
        .where(eq(bills.publicId, publicId))
        .get()
      if (!bill) return null
      return loadDetailRows(deps, bill.id)
    })
    if (!rows || rows.bill.status !== "published")
      return yield* new PublicBillNotFound({ publicId })

    const split = computeSplit(toSplitInput(rows))
    const paidByBillPlayer = new Map(
      rows.paymentStatuses.map((s) => [s.billPlayerId, s.status === "paid"])
    )
    const itemById = new Map(rows.items.map((item) => [item.id, item]))
    const adjustmentById = new Map(rows.adjustments.map((a) => [a.id, a]))
    const itemCosts = new Map(
      rows.items.map((item) => [
        item.id,
        new Map(
          allocateItemCost(item, rows.allocations, rows.billPlayers).map(
            (share) => [share.billPlayerId, share.amount]
          )
        ),
      ])
    )

    const views: PublicBillPlayerView[] = rows.billPlayers.map((p) => {
      const share = split.shares.find((s) => s.billPlayerId === p.id)!
      const itemLines = rows.allocations
        .filter((a) => a.billPlayerId === p.id)
        .map((a) => {
          const item = itemById.get(a.itemId)!
          return {
            name: item.name,
            variantNotes: item.variantNotes,
            quantity: a.quantity,
            unitPrice: item.unitPrice,
            amount: itemCosts.get(item.id)!.get(p.id)!,
          }
        })
      const adjustmentLines = share.adjustmentShares.map((adjShare) => ({
        label: adjustmentById.get(adjShare.adjustmentId)?.label ?? "",
        amount: adjShare.amount,
      }))
      return {
        billPlayerId: p.id,
        alias: p.alias,
        playerId: p.playerId,
        itemSubtotal: share.itemSubtotal,
        percentage: share.percentage,
        total: share.total,
        paid: paidByBillPlayer.get(p.id) ?? false,
        itemLines,
        adjustmentLines,
      }
    })

    return {
      publicId: rows.bill.publicId,
      merchant: rows.bill.merchant,
      title: rows.bill.title,
      orderDate: rows.bill.orderDate,
      currency: rows.bill.currency,
      sourceSubtotal: rows.bill.sourceSubtotal,
      finalTotal: rows.bill.finalTotal,
      adjustmentsTotal: split.adjustmentsTotal,
      imageAvailable: Boolean(rows.bill.imageObjectKey),
      archived: rows.bill.archivedAt !== null,
      billPlayers: views,
      adjustments: rows.adjustments.map((a) => ({
        id: a.id,
        type: a.type,
        label: a.label,
        amount: a.signedAmount,
        originalAmount: a.originalAmount,
      })),
    }
  })
}

export function getPublishedImage(
  deps: BillDeps,
  publicId: string
): Effect.Effect<StoredImage, PublicBillNotFound | RepositoryError> {
  return Effect.gen(function* () {
    const bill = yield* tryDb(() =>
      deps.db.select().from(bills).where(eq(bills.publicId, publicId)).get()
    )
    if (
      !bill ||
      bill.status !== "published" ||
      !bill.imageObjectKey ||
      !bill.imageMediaType
    ) {
      return yield* new PublicBillNotFound({ publicId })
    }
    return {
      objectKey: bill.imageObjectKey,
      mediaType: bill.imageMediaType,
      byteSize: bill.imageByteSize ?? 0,
    }
  })
}

/** Draft-stage image access for the admin editor; any bill status. */
export function getAdminImage(
  deps: BillDeps,
  billId: string
): Effect.Effect<StoredImage, BillNotFound | RepositoryError> {
  return Effect.gen(function* () {
    const bill = yield* tryDb(() =>
      deps.db.select().from(bills).where(eq(bills.id, billId)).get()
    )
    if (!bill || !bill.imageObjectKey || !bill.imageMediaType) {
      return yield* new BillNotFound({ billId })
    }
    return {
      objectKey: bill.imageObjectKey,
      mediaType: bill.imageMediaType,
      byteSize: bill.imageByteSize ?? 0,
    }
  })
}
