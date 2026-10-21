import { allocateItemCost } from "@/domain/split"
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { Data, Effect } from "effect"

import type { Db, Tx } from "@/db/client"
import {
  adjustmentAllocations,
  bills,
  billPlayers,
  itemAllocations,
  items,
  players,
  paymentEvents,
  paymentStatuses,
} from "@/db/schema"
import type { PaymentEventRow, PaymentStatusRow } from "@/db/schema"
import type { PaymentState } from "@/lib/bill-schema"
import { nowUtcIso } from "@/lib/time"

import { RepositoryError, tryDb } from "./bills"
import { refreshPlayerHoverSummaries } from "./insights"
import type { BillDeps } from "./bills"
import { PlayerNotFound } from "./players"

export { RepositoryError }
export type PaymentDeps = BillDeps

export class BillPlayerNotFound extends Data.TaggedError("BillPlayerNotFound")<{
  billPlayerId: string
}> {}
export class InvalidPaymentTransition extends Data.TaggedError(
  "InvalidPaymentTransition"
)<{
  from: string
  to: string
}> {}
export class NothingToCollect extends Data.TaggedError("NothingToCollect")<{
  playerId: string
}> {}
export class InsufficientPayment extends Data.TaggedError(
  "InsufficientPayment"
)<{
  playerId: string
  totalOwed: number
  totalPaid: number
}> {}

/**
 * Toggles a billPlayer between the only two states, unpaid and paid, inside
 * one transaction that also records the audit event with the acting identity.
 * Setting the current state again is a no-op and writes no event.
 */
export function setPaymentState(
  deps: PaymentDeps,
  params: { billPlayerId: string; state: PaymentState; actor: string }
): Effect.Effect<
  PaymentStatusRow,
  BillPlayerNotFound | InvalidPaymentTransition | RepositoryError
> {
  return Effect.gen(function* () {
    const current = yield* tryDb(() =>
      deps.db
        .select()
        .from(paymentStatuses)
        .where(eq(paymentStatuses.billPlayerId, params.billPlayerId))
        .get()
    )
    if (!current)
      return yield* new BillPlayerNotFound({
        billPlayerId: params.billPlayerId,
      })

    if (current.status !== "unpaid" && current.status !== "paid") {
      return yield* new InvalidPaymentTransition({
        from: current.status,
        to: params.state,
      })
    }
    if (current.status === params.state) return current

    return yield* tryDb(() =>
      deps.db.transaction(async (tx: Tx) => {
        const now = nowUtcIso()
        await tx
          .insert(paymentEvents)
          .values({
            id: Bun.randomUUIDv7(),
            billPlayerId: params.billPlayerId,
            previousState: current.status,
            newState: params.state,
            eventTime: now,
            actorIdentity: params.actor,
          })
          .run()

        await tx
          .update(paymentStatuses)
          .set({
            status: params.state,
            paidAt: params.state === "paid" ? now : null,
            lastChangedBy: params.actor,
            updatedAt: now,
          })
          .where(eq(paymentStatuses.billPlayerId, params.billPlayerId))
          .run()

        await refreshPlayerHoverSummaries(tx)

        return (await tx
          .select()
          .from(paymentStatuses)
          .where(eq(paymentStatuses.billPlayerId, params.billPlayerId))
          .get())!
      })
    )
  })
}

export function listPaymentEvents(
  deps: PaymentDeps,
  billPlayerId: string
): Effect.Effect<PaymentEventRow[], RepositoryError> {
  return tryDb(() =>
    deps.db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.billPlayerId, billPlayerId))
      .all()
  )
}

/**
 * Records what the billPlayer actually handed over. Saving an amount also
 * marks the billPlayer paid (handing money over is paying); the state event
 * fires only when this actually flips them from unpaid. Saving null just
 * clears the recorded amount and leaves the status alone, so the same
 * rounded-up figure survives an unpaid/paid round trip.
 */
export function recordPaidAmount(
  deps: PaymentDeps,
  params: {
    billPlayerId: string
    paidAmount: number | null
    actor: string
  }
): Effect.Effect<
  PaymentStatusRow,
  BillPlayerNotFound | InvalidPaymentTransition | RepositoryError
> {
  return Effect.gen(function* () {
    const current = yield* tryDb(() =>
      deps.db
        .select()
        .from(paymentStatuses)
        .where(eq(paymentStatuses.billPlayerId, params.billPlayerId))
        .get()
    )
    if (!current)
      return yield* new BillPlayerNotFound({
        billPlayerId: params.billPlayerId,
      })

    return yield* tryDb(() =>
      deps.db.transaction(async (tx: Tx) => {
        const now = nowUtcIso()
        const becomesPaid =
          current.status !== "paid" && params.paidAmount !== null
        if (becomesPaid) {
          await tx
            .insert(paymentEvents)
            .values({
              id: Bun.randomUUIDv7(),
              billPlayerId: params.billPlayerId,
              previousState: current.status,
              newState: "paid",
              eventTime: now,
              actorIdentity: params.actor,
            })
            .run()
        }

        await tx
          .update(paymentStatuses)
          .set({
            paidAmount: params.paidAmount,
            ...(becomesPaid ? { status: "paid", paidAt: now } : {}),
            lastChangedBy: params.actor,
            updatedAt: now,
          })
          .where(eq(paymentStatuses.billPlayerId, params.billPlayerId))
          .run()

        await refreshPlayerHoverSummaries(tx)

        return (await tx
          .select()
          .from(paymentStatuses)
          .where(eq(paymentStatuses.billPlayerId, params.billPlayerId))
          .get())!
      })
    )
  })
}

// ---- Combined payment across bills ------------------------------------
// A player sometimes settles several bills in one handover, rounding the
// total up. Every unpaid share is stored exactly; the round-up lands as a
// single tip on that player's most recent bill, so the per-billPlayer tip
// math (paidAmount - share) keeps working unchanged.

export interface OutstandingBillItemLine {
  name: string
  variantNotes: string | null
  quantity: number
}

export interface OutstandingPaymentItem {
  billPlayerId: string
  billId: string
  publicId: string
  merchant: string
  title: string | null
  orderDate: string
  /** The player's share of that bill: item allocations plus adjustments. */
  share: number
  /** What they ordered on this bill, in receipt order. */
  items: OutstandingBillItemLine[]
}

export interface OutstandingPayments {
  player: { id: string; name: string }
  /** Oldest bill first; the newest one absorbs any round-up. */
  items: OutstandingPaymentItem[]
  totalOwed: number
}

/**
 * Share per billPlayer over published-bill rows: stored item allocations
 * split by allocated items plus stored signed adjustment allocations. The one
 * share definition behind the collect flow and the directory column.
 */
async function sharesForBillPlayers(
  db: Db,
  billPlayerIds: string[],
  billIds: string[]
): Promise<Map<string, number>> {
  const shares = new Map<string, number>()
  if (billPlayerIds.length === 0) return shares

  const itemRows = await db
    .select()
    .from(items)
    .where(inArray(items.billId, billIds))
    .all()
  const allBillPlayers = await db
    .select({ id: billPlayers.id })
    .from(billPlayers)
    .where(inArray(billPlayers.billId, billIds))
    .orderBy(billPlayers.sortOrder)
    .all()
  const itemSpend = new Map<string, number>()
  if (itemRows.length > 0) {
    const allocationRows = await db
      .select()
      .from(itemAllocations)
      .where(
        inArray(
          itemAllocations.itemId,
          itemRows.map((item) => item.id)
        )
      )
      .all()
    for (const item of itemRows) {
      for (const { billPlayerId, amount } of allocateItemCost(
        item,
        allocationRows,
        allBillPlayers
      )) {
        itemSpend.set(billPlayerId, (itemSpend.get(billPlayerId) ?? 0) + amount)
      }
    }
  }

  const adjustmentTotal = new Map<string, number>()
  const adjustmentRows = await db
    .select()
    .from(adjustmentAllocations)
    .where(inArray(adjustmentAllocations.billPlayerId, billPlayerIds))
    .all()
  for (const row of adjustmentRows) {
    adjustmentTotal.set(
      row.billPlayerId,
      (adjustmentTotal.get(row.billPlayerId) ?? 0) + row.signedAmount
    )
  }

  for (const id of billPlayerIds) {
    shares.set(id, (itemSpend.get(id) ?? 0) + (adjustmentTotal.get(id) ?? 0))
  }
  return shares
}

/**
 * Shares for one player's unpaid billPlayers on published, non-archived
 * bills, oldest first. Same share math as the insights boards: stored item
 * allocations plus stored signed adjustment allocations.
 */
async function loadOutstanding(
  db: Db,
  playerId: string
): Promise<OutstandingPaymentItem[]> {
  const rows = await db
    .select({
      billPlayerId: billPlayers.id,
      billId: bills.id,
      publicId: bills.publicId,
      merchant: bills.merchant,
      title: bills.title,
      orderDate: bills.orderDate,
    })
    .from(billPlayers)
    .innerJoin(bills, eq(bills.id, billPlayers.billId))
    .innerJoin(
      paymentStatuses,
      eq(paymentStatuses.billPlayerId, billPlayers.id)
    )
    .where(
      and(
        eq(billPlayers.playerId, playerId),
        eq(bills.status, "published"),
        isNull(bills.archivedAt),
        eq(paymentStatuses.status, "unpaid")
      )
    )
    .all()
  if (rows.length === 0) return []

  const shares = await sharesForBillPlayers(
    db,
    rows.map((row) => row.billPlayerId),
    [...new Set(rows.map((row) => row.billId))]
  )

  // Ordered item lines per billPlayer, receipt order, for the collect UI.
  const itemLineRows = await db
    .select({
      billPlayerId: itemAllocations.billPlayerId,
      quantity: itemAllocations.quantity,
      name: items.name,
      variantNotes: items.variantNotes,
      sortOrder: items.sortOrder,
    })
    .from(itemAllocations)
    .innerJoin(items, eq(items.id, itemAllocations.itemId))
    .where(
      inArray(
        itemAllocations.billPlayerId,
        rows.map((row) => row.billPlayerId)
      )
    )
    .all()
  const linesByBillPlayer = new Map<string, OutstandingBillItemLine[]>()
  for (const row of [...itemLineRows].sort(
    (a, b) => a.sortOrder - b.sortOrder
  )) {
    const lines = linesByBillPlayer.get(row.billPlayerId) ?? []
    lines.push({
      name: row.name,
      variantNotes: row.variantNotes,
      quantity: row.quantity,
    })
    linesByBillPlayer.set(row.billPlayerId, lines)
  }

  return rows
    .map((row) => ({
      ...row,
      share: shares.get(row.billPlayerId) ?? 0,
      items: linesByBillPlayer.get(row.billPlayerId) ?? [],
    }))
    .sort(
      (a, b) =>
        a.orderDate.localeCompare(b.orderDate) ||
        a.merchant.localeCompare(b.merchant) ||
        a.billPlayerId.localeCompare(b.billPlayerId)
    )
}

/**
 * Outstanding total per player id: the sum of that player's unpaid shares
 * over published, non-archived bills. Same share math as the collect flow,
 * so the admin directory column always matches the collect dialog.
 */
export function listOutstandingTotalsByPlayer(
  deps: PaymentDeps
): Effect.Effect<Record<string, number>, RepositoryError> {
  return tryDb(async () => {
    const rows = await deps.db
      .select({
        playerId: billPlayers.playerId,
        billPlayerId: billPlayers.id,
        billId: billPlayers.billId,
      })
      .from(billPlayers)
      .innerJoin(bills, eq(bills.id, billPlayers.billId))
      .innerJoin(
        paymentStatuses,
        eq(paymentStatuses.billPlayerId, billPlayers.id)
      )
      .where(
        and(
          isNotNull(billPlayers.playerId),
          eq(bills.status, "published"),
          isNull(bills.archivedAt),
          eq(paymentStatuses.status, "unpaid")
        )
      )
      .all()

    const shares = await sharesForBillPlayers(
      deps.db,
      rows.map((row) => row.billPlayerId),
      [...new Set(rows.map((row) => row.billId))]
    )

    const totals: Record<string, number> = {}
    for (const row of rows) {
      if (row.playerId === null) continue
      totals[row.playerId] =
        (totals[row.playerId] ?? 0) + (shares.get(row.billPlayerId) ?? 0)
    }
    return totals
  })
}

export function listOutstandingPayments(
  deps: PaymentDeps,
  playerId: string
): Effect.Effect<OutstandingPayments, PlayerNotFound | RepositoryError> {
  return Effect.gen(function* () {
    const playerRow = yield* tryDb(() =>
      deps.db.select().from(players).where(eq(players.id, playerId)).get()
    )
    if (!playerRow) return yield* new PlayerNotFound({ playerId })

    const outstanding = yield* tryDb(() => loadOutstanding(deps.db, playerId))
    return {
      player: { id: playerRow.id, name: playerRow.name },
      items: outstanding,
      totalOwed: outstanding.reduce((sum, item) => sum + item.share, 0),
    }
  })
}

export interface CollectedPayment {
  totalPaid: number
  totalOwed: number
  /** totalPaid - totalOwed; the round-up handed to the most recent bill. */
  tip: number
  /** How many unpaid shares the handover settled. */
  appliedCount: number
  /** The bill that absorbed the tip, so the UI can say where it landed. */
  tipBill: { publicId: string; merchant: string } | null
}

/**
 * Marks every unpaid share of one player paid from a single handover.
 * Older bills record their exact share; the most recent bill records its
 * share plus the whole round-up (totalPaid - totalOwed). Refuses a handover
 * below the total owed; shortfalls go through the per-bill page instead,
 * where the admin picks which bill comes up short.
 */
export function collectPayment(
  deps: PaymentDeps,
  params: { playerId: string; totalPaid: number; actor: string }
): Effect.Effect<
  CollectedPayment,
  PlayerNotFound | NothingToCollect | InsufficientPayment | RepositoryError
> {
  return Effect.gen(function* () {
    const playerRow = yield* tryDb(() =>
      deps.db
        .select()
        .from(players)
        .where(eq(players.id, params.playerId))
        .get()
    )
    if (!playerRow)
      return yield* new PlayerNotFound({ playerId: params.playerId })

    const outstanding = yield* tryDb(() =>
      loadOutstanding(deps.db, params.playerId)
    )
    if (outstanding.length === 0) {
      return yield* new NothingToCollect({ playerId: params.playerId })
    }

    const totalOwed = outstanding.reduce((sum, item) => sum + item.share, 0)
    if (params.totalPaid < totalOwed) {
      return yield* new InsufficientPayment({
        playerId: params.playerId,
        totalOwed,
        totalPaid: params.totalPaid,
      })
    }
    const tip = params.totalPaid - totalOwed
    const tipBill = outstanding[outstanding.length - 1]

    const applied = yield* tryDb(() =>
      deps.db.transaction(async (tx: Tx) => {
        const now = nowUtcIso()
        const updated: Array<{ billPlayerId: string; paidAmount: number }> = []
        for (const item of outstanding) {
          const paidAmount =
            item.billPlayerId === tipBill.billPlayerId
              ? item.share + tip
              : item.share

          // Re-read inside the transaction so a concurrent mark does not
          // produce a duplicate unpaid→paid event.
          const current = await tx
            .select()
            .from(paymentStatuses)
            .where(eq(paymentStatuses.billPlayerId, item.billPlayerId))
            .get()
          if (!current || current.status === "paid") continue

          await tx
            .insert(paymentEvents)
            .values({
              id: Bun.randomUUIDv7(),
              billPlayerId: item.billPlayerId,
              previousState: current.status,
              newState: "paid",
              eventTime: now,
              actorIdentity: params.actor,
            })
            .run()

          await tx
            .update(paymentStatuses)
            .set({
              status: "paid",
              paidAmount,
              paidAt: now,
              lastChangedBy: params.actor,
              updatedAt: now,
            })
            .where(eq(paymentStatuses.billPlayerId, item.billPlayerId))
            .run()

          updated.push({ billPlayerId: item.billPlayerId, paidAmount })
        }
        if (updated.length > 0) await refreshPlayerHoverSummaries(tx)
        return updated
      })
    )

    return {
      totalPaid: params.totalPaid,
      totalOwed,
      tip,
      appliedCount: applied.length,
      tipBill:
        tip !== 0
          ? { publicId: tipBill.publicId, merchant: tipBill.merchant }
          : null,
    }
  })
}
