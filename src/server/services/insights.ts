import { allocateItemCost } from "@/domain/split"
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm"
import { Effect } from "effect"

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
  playerHoverSummaries,
} from "@/db/schema"
import type { BillRow } from "@/db/schema"
import { monthSpanKeys } from "@/lib/time"
import { RepositoryError, tryDb } from "./bills"
import type { BillDeps } from "./bills"

export { RepositoryError }
export type InsightDeps = BillDeps

export interface PlayerInsight {
  playerId: string
  name: string
  /** Distinct published bills in range where the player has a row. */
  orderCount: number
  /** Sum of allocated quantities. */
  itemCount: number
  /** Sum of charged item costs allocated to the player. */
  totalSpend: number
  /** Discount allocations as a positive rupiah figure. */
  totalDiscount: number
  /** totalDiscount / totalSpend; 0 when the player spent nothing. */
  discountRate: number
}

export interface InsightRange {
  /** Inclusive order-date bounds as YYYY-MM-DD keys. */
  from: string
  to: string
}

/**
 * Per-player aggregates over published, non-archived bills in an inclusive
 * order-date range. Drafts are excluded on purpose: they are estimates and
 * must not inflate "who buys the most".
 *
 * Honest caveat: the split policy distributes adjustments proportionally to
 * item subtotal, so within any single bill every billPlayer gets the same
 * discount rate. Cross-bill differences in discountRate come from which
 * bills a player joined, not from per-player pricing.
 */
export function listPlayerInsights(
  deps: InsightDeps,
  range?: InsightRange
): Effect.Effect<PlayerInsight[], RepositoryError> {
  return Effect.gen(function* () {
    const billFilters = [
      eq(bills.status, "published"),
      isNull(bills.archivedAt),
    ]
    if (range) {
      billFilters.push(gte(bills.orderDate, range.from))
      billFilters.push(lte(bills.orderDate, range.to))
    }

    const billRows = yield* tryDb(() =>
      deps.db
        .select({ id: bills.id })
        .from(bills)
        .where(and(...billFilters))
        .all()
    )
    if (billRows.length === 0) return []
    const billIds = billRows.map((b) => b.id)

    return yield* tryDb(() => computeInsights(deps.db, billIds))
  })
}

async function computeInsights(
  db: Db,
  billIds: string[]
): Promise<PlayerInsight[]> {
  const billPlayerRows = await db
    .select({
      id: billPlayers.id,
      billId: billPlayers.billId,
      playerId: billPlayers.playerId,
    })
    .from(billPlayers)
    .where(inArray(billPlayers.billId, billIds))
    .orderBy(billPlayers.sortOrder)
    .all()

  const playerIds = [
    ...new Set(
      billPlayerRows
        .map((p) => p.playerId)
        .filter((id): id is string => id !== null)
    ),
  ]
  if (playerIds.length === 0) return []

  const playerRows = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(inArray(players.id, playerIds))
    .all()
  const nameById = new Map(playerRows.map((c) => [c.id, c.name]))

  // Per-player tallies; orderCount counts distinct bills.
  const stats = new Map<string, PlayerInsight>()
  const billsByPlayer = new Map<string, Set<string>>()
  const playerIdByBillPlayer = new Map<string, string>()
  for (const billPlayer of billPlayerRows) {
    if (billPlayer.playerId === null) continue
    playerIdByBillPlayer.set(billPlayer.id, billPlayer.playerId)
    if (!stats.has(billPlayer.playerId)) {
      stats.set(billPlayer.playerId, {
        playerId: billPlayer.playerId,
        name: nameById.get(billPlayer.playerId) ?? "",
        orderCount: 0,
        itemCount: 0,
        totalSpend: 0,
        totalDiscount: 0,
        discountRate: 0,
      })
    }
    const billSet = billsByPlayer.get(billPlayer.playerId) ?? new Set()
    billSet.add(billPlayer.billId)
    billsByPlayer.set(billPlayer.playerId, billSet)
  }

  const itemRows = await db
    .select()
    .from(items)
    .where(inArray(items.billId, billIds))
    .all()

  const itemIds = itemRows.map((i) => i.id)
  if (itemIds.length > 0) {
    const allocationRows = await db
      .select()
      .from(itemAllocations)
      .where(inArray(itemAllocations.itemId, itemIds))
      .all()
    const itemCosts = new Map(
      itemRows.flatMap((item) =>
        allocateItemCost(item, allocationRows, billPlayerRows).map(
          (share) =>
            [`${item.id}::${share.billPlayerId}`, share.amount] as const
        )
      )
    )
    for (const allocation of allocationRows) {
      const playerId = playerIdByBillPlayer.get(allocation.billPlayerId)
      if (playerId === undefined) continue
      const stat = stats.get(playerId)!
      stat.itemCount += allocation.quantity
      stat.totalSpend +=
        itemCosts.get(`${allocation.itemId}::${allocation.billPlayerId}`) ?? 0
    }
  }

  const discountIds = (
    await db
      .select({ id: adjustments.id })
      .from(adjustments)
      .where(
        and(
          inArray(adjustments.billId, billIds),
          eq(adjustments.type, "discount")
        )
      )
      .all()
  ).map((a) => a.id)
  if (discountIds.length > 0) {
    const discountRows = await db
      .select()
      .from(adjustmentAllocations)
      .where(inArray(adjustmentAllocations.adjustmentId, discountIds))
      .all()
    for (const row of discountRows) {
      const playerId = playerIdByBillPlayer.get(row.billPlayerId)
      if (playerId === undefined) continue
      const stat = stats.get(playerId)!
      // Signed negative on the ledger; reported as a positive figure.
      stat.totalDiscount += -row.signedAmount
    }
  }

  for (const [playerId, stat] of stats) {
    stat.orderCount = billsByPlayer.get(playerId)?.size ?? 0
    stat.discountRate =
      stat.totalSpend > 0 ? stat.totalDiscount / stat.totalSpend : 0
  }

  return [...stats.values()].sort(
    (a, b) => b.totalSpend - a.totalSpend || a.name.localeCompare(b.name)
  )
}

export interface LeaderboardOrder {
  publicId: string
  merchant: string
  title: string | null
  orderDate: string
  /** The person's own share of that bill, integer rupiah. */
  total: number
}

export interface LeaderboardRow {
  playerId: string
  name: string
  /** Distinct published bills in the month with a linked row for this person. */
  orderCount: number
  /** Item allocations plus signed adjustment allocations, integer rupiah. */
  totalSpend: number
  /** Discount allocations as a positive rupiah figure. */
  totalDiscount: number
  /** totalDiscount / totalSpend; 0 when the person spent nothing. */
  discountRate: number
  /** The person's largest single-bill share in the month, if any. */
  biggestOrder: LeaderboardOrder | null
}

export interface MonthlyLeaderboard {
  /** Sorted by spend, highest first. */
  rows: LeaderboardRow[]
  /** Sum of bill finalTotal over the month (includes unlinked billPlayers). */
  monthTotal: number
  billCount: number
}

/**
 * Per-player leaderboard for one calendar month (inclusive bounds), the
 * public home page's rank rail: spending rank, discount haul, and each
 * person's biggest single order. Same scope rules as
 * {@link listPlayerInsights}: published, non-archived bills, linked
 * players only. Note that a billPlayer's total here includes their share
 * of adjustments, where totalSpend in PlayerInsight counts items only.
 */
export function listMonthlyLeaderboard(
  deps: InsightDeps,
  fromKey: string,
  toKey: string
): Effect.Effect<MonthlyLeaderboard, RepositoryError> {
  return Effect.gen(function* () {
    const billFilters = [
      eq(bills.status, "published"),
      isNull(bills.archivedAt),
      gte(bills.orderDate, fromKey),
      lte(bills.orderDate, toKey),
    ]
    const billRows = yield* tryDb(() =>
      deps.db
        .select()
        .from(bills)
        .where(and(...billFilters))
        .all()
    )
    const monthTotal = billRows.reduce((sum, bill) => sum + bill.finalTotal, 0)
    if (billRows.length === 0) return { rows: [], monthTotal: 0, billCount: 0 }
    const billById = new Map(billRows.map((bill) => [bill.id, bill]))

    return yield* tryDb(() => computeLeaderboard(deps.db, billById, monthTotal))
  })
}

async function computeLeaderboard(
  db: Db,
  billById: Map<string, BillRow>,
  monthTotal: number
): Promise<MonthlyLeaderboard> {
  const billIds = [...billById.keys()]
  const billPlayerRows = await db
    .select({
      id: billPlayers.id,
      billId: billPlayers.billId,
      playerId: billPlayers.playerId,
    })
    .from(billPlayers)
    .where(inArray(billPlayers.billId, billIds))
    .orderBy(billPlayers.sortOrder)
    .all()
  const linked = billPlayerRows.filter(
    (p): p is typeof p & { playerId: string } => p.playerId !== null
  )
  if (linked.length === 0)
    return { rows: [], monthTotal, billCount: billById.size }

  const playerIds = [...new Set(linked.map((p) => p.playerId))]
  const playerRows = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(inArray(players.id, playerIds))
    .all()
  const nameById = new Map(playerRows.map((c) => [c.id, c.name]))
  const playerIdByBillPlayer = new Map(linked.map((p) => [p.id, p.playerId]))

  // Item spend per linked billPlayer.
  const itemRows = await db
    .select()
    .from(items)
    .where(inArray(items.billId, billIds))
    .all()
  const itemSpend = new Map<string, number>()
  const itemIds = itemRows.map((i) => i.id)
  if (itemIds.length > 0) {
    const allocationRows = await db
      .select()
      .from(itemAllocations)
      .where(inArray(itemAllocations.itemId, itemIds))
      .all()
    const itemCosts = new Map(
      itemRows.flatMap((item) =>
        allocateItemCost(item, allocationRows, billPlayerRows).map(
          (share) =>
            [`${item.id}::${share.billPlayerId}`, share.amount] as const
        )
      )
    )
    for (const allocation of allocationRows) {
      if (!playerIdByBillPlayer.has(allocation.billPlayerId)) continue
      itemSpend.set(
        allocation.billPlayerId,
        (itemSpend.get(allocation.billPlayerId) ?? 0) +
          (itemCosts.get(`${allocation.itemId}::${allocation.billPlayerId}`) ??
            0)
      )
    }
  }

  // Signed adjustment totals per linked billPlayer; discounts tracked
  // separately as a positive figure.
  const adjustmentRows = await db
    .select({ id: adjustments.id, type: adjustments.type })
    .from(adjustments)
    .where(inArray(adjustments.billId, billIds))
    .all()
  const discountIds = new Set(
    adjustmentRows
      .filter((adjustment) => adjustment.type === "discount")
      .map((adjustment) => adjustment.id)
  )
  const adjustmentTotal = new Map<string, number>()
  const discountTotal = new Map<string, number>()
  const adjustmentIds = adjustmentRows.map((a) => a.id)
  if (adjustmentIds.length > 0) {
    const allocationRows = await db
      .select()
      .from(adjustmentAllocations)
      .where(inArray(adjustmentAllocations.adjustmentId, adjustmentIds))
      .all()
    for (const row of allocationRows) {
      if (!playerIdByBillPlayer.has(row.billPlayerId)) continue
      adjustmentTotal.set(
        row.billPlayerId,
        (adjustmentTotal.get(row.billPlayerId) ?? 0) + row.signedAmount
      )
      if (discountIds.has(row.adjustmentId)) {
        // Signed negative on the ledger; reported as a positive figure.
        discountTotal.set(
          row.billPlayerId,
          (discountTotal.get(row.billPlayerId) ?? 0) - row.signedAmount
        )
      }
    }
  }

  // Fold per-billPlayer totals into per-player stats.
  const stats = new Map<string, LeaderboardRow>()
  const billsByPlayer = new Map<string, Set<string>>()
  for (const billPlayer of linked) {
    const playerId = billPlayer.playerId
    const bill = billById.get(billPlayer.billId)!
    const total =
      (itemSpend.get(billPlayer.id) ?? 0) +
      (adjustmentTotal.get(billPlayer.id) ?? 0)
    let stat = stats.get(playerId)
    if (!stat) {
      stat = {
        playerId,
        name: nameById.get(playerId) ?? "",
        orderCount: 0,
        totalSpend: 0,
        totalDiscount: 0,
        discountRate: 0,
        biggestOrder: null,
      }
      stats.set(playerId, stat)
    }
    stat.totalSpend += total
    stat.totalDiscount += discountTotal.get(billPlayer.id) ?? 0
    const billSet = billsByPlayer.get(playerId) ?? new Set()
    billSet.add(billPlayer.billId)
    billsByPlayer.set(playerId, billSet)
    if (total > 0 && (!stat.biggestOrder || total > stat.biggestOrder.total)) {
      stat.biggestOrder = {
        publicId: bill.publicId,
        merchant: bill.merchant,
        title: bill.title,
        orderDate: bill.orderDate,
        total,
      }
    }
  }

  for (const [playerId, stat] of stats) {
    stat.orderCount = billsByPlayer.get(playerId)?.size ?? 0
    stat.discountRate =
      stat.totalSpend > 0 ? stat.totalDiscount / stat.totalSpend : 0
  }

  return {
    rows: [...stats.values()].sort(
      (a, b) => b.totalSpend - a.totalSpend || a.name.localeCompare(b.name)
    ),
    monthTotal,
    billCount: billIds.length,
  }
}

// ---- Round-up board ----------------------------------------------------
// The public appreciation board for people who handed over more than their
// split. A tip exists only where the admin recorded the amount actually
// paid on a billPlayer (payment_statuses.paid_amount); exact and short
// payments are tallied but never ranked. Same scope rules as the other
// boards: published, non-archived bills, linked players only.

export interface TipMoment {
  publicId: string
  merchant: string
  orderDate: string
  /** The person's share of the bill, integer rupiah. */
  share: number
  /** What they actually handed over. */
  paid: number
  /** paid - share; positive is a tip, negative a shortfall. */
  diff: number
}

export interface TipRow {
  playerId: string
  name: string
  /** Net of paid minus split; shorts subtract, so a player can go negative. */
  tipTotal: number
  /** Recorded payments that did not land exactly on the split. */
  tipCount: number
  /** Every recorded payment for the player, exact ones included. */
  paymentCount: number
  /** The person's largest single tip, if any. */
  biggest: TipMoment | null
  lastTip: string | null
}

export interface MonthlyTips {
  /** Sorted by net tips, highest first. */
  rows: TipRow[]
  /** Net tips across the month; shorts subtract from the jar. */
  tippedTotal: number
  /** Recorded payments of any kind in the month. */
  recordedCount: number
  billCount: number
}

export function listMonthlyTips(
  deps: InsightDeps,
  fromKey: string,
  toKey: string
): Effect.Effect<MonthlyTips, RepositoryError> {
  return Effect.gen(function* () {
    const billRows = yield* tryDb(() =>
      deps.db
        .select()
        .from(bills)
        .where(
          and(
            eq(bills.status, "published"),
            isNull(bills.archivedAt),
            gte(bills.orderDate, fromKey),
            lte(bills.orderDate, toKey)
          )
        )
        .all()
    )
    if (billRows.length === 0)
      return { rows: [], tippedTotal: 0, recordedCount: 0, billCount: 0 }
    return yield* tryDb(() => computeTips(deps.db, billRows))
  })
}

/** Months (YYYY-MM) that have at least one published, non-archived bill. */
export function listPublishedMonthKeys(
  deps: InsightDeps
): Effect.Effect<string[], RepositoryError> {
  return tryDb(async () => {
    const rows = await deps.db
      .select({ orderDate: bills.orderDate })
      .from(bills)
      .where(and(eq(bills.status, "published"), isNull(bills.archivedAt)))
      .all()
    return [...new Set(rows.map((row) => row.orderDate.slice(0, 7)))].sort()
  })
}

async function computeTips(db: Db, billRows: BillRow[]): Promise<MonthlyTips> {
  const billIds = billRows.map((bill) => bill.id)
  const billById = new Map(billRows.map((bill) => [bill.id, bill]))

  const billPlayerRows = await db
    .select({
      id: billPlayers.id,
      billId: billPlayers.billId,
      playerId: billPlayers.playerId,
    })
    .from(billPlayers)
    .where(inArray(billPlayers.billId, billIds))
    .orderBy(billPlayers.sortOrder)
    .all()
  const linked = billPlayerRows.filter(
    (p): p is typeof p & { playerId: string } => p.playerId !== null
  )
  if (linked.length === 0)
    return {
      rows: [],
      tippedTotal: 0,
      recordedCount: 0,
      billCount: billRows.length,
    }

  const playerRows = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(inArray(players.id, [...new Set(linked.map((p) => p.playerId))]))
    .all()
  const nameById = new Map(playerRows.map((c) => [c.id, c.name]))

  // Share per billPlayer: item allocations plus signed adjustment shares.
  const itemRows = await db
    .select()
    .from(items)
    .where(inArray(items.billId, billIds))
    .all()
  const itemSpend = new Map<string, number>()
  const itemIds = itemRows.map((i) => i.id)
  if (itemIds.length > 0) {
    const allocationRows = await db
      .select()
      .from(itemAllocations)
      .where(inArray(itemAllocations.itemId, itemIds))
      .all()
    const itemCosts = new Map(
      itemRows.flatMap((item) =>
        allocateItemCost(item, allocationRows, billPlayerRows).map(
          (share) =>
            [`${item.id}::${share.billPlayerId}`, share.amount] as const
        )
      )
    )
    for (const allocation of allocationRows) {
      itemSpend.set(
        allocation.billPlayerId,
        (itemSpend.get(allocation.billPlayerId) ?? 0) +
          (itemCosts.get(`${allocation.itemId}::${allocation.billPlayerId}`) ??
            0)
      )
    }
  }

  const adjustmentIds = (
    await db
      .select({ id: adjustments.id })
      .from(adjustments)
      .where(inArray(adjustments.billId, billIds))
      .all()
  ).map((a) => a.id)
  const adjustmentTotal = new Map<string, number>()
  if (adjustmentIds.length > 0) {
    const allocationRows = await db
      .select()
      .from(adjustmentAllocations)
      .where(inArray(adjustmentAllocations.adjustmentId, adjustmentIds))
      .all()
    for (const row of allocationRows) {
      adjustmentTotal.set(
        row.billPlayerId,
        (adjustmentTotal.get(row.billPlayerId) ?? 0) + row.signedAmount
      )
    }
  }

  // Recorded amounts per billPlayer.
  const paidAmount = new Map<string, number>()
  const statusRows = await db
    .select({
      billPlayerId: paymentStatuses.billPlayerId,
      paidAmount: paymentStatuses.paidAmount,
    })
    .from(paymentStatuses)
    .where(
      inArray(
        paymentStatuses.billPlayerId,
        linked.map((p) => p.id)
      )
    )
    .all()
  for (const status of statusRows) {
    if (status.paidAmount !== null)
      paidAmount.set(status.billPlayerId, status.paidAmount)
  }

  const stats = new Map<string, TipRow>()
  for (const billPlayer of linked) {
    const recorded = paidAmount.get(billPlayer.id)
    if (recorded === undefined) continue
    const bill = billById.get(billPlayer.billId)!
    const share =
      (itemSpend.get(billPlayer.id) ?? 0) +
      (adjustmentTotal.get(billPlayer.id) ?? 0)

    let stat = stats.get(billPlayer.playerId)
    if (!stat) {
      stat = {
        playerId: billPlayer.playerId,
        name: nameById.get(billPlayer.playerId) ?? "",
        tipTotal: 0,
        tipCount: 0,
        paymentCount: 0,
        biggest: null,
        lastTip: null,
      }
      stats.set(billPlayer.playerId, stat)
    }

    const diff = recorded - share
    stat.tipTotal += diff
    stat.paymentCount += 1
    if (diff !== 0) stat.tipCount += 1
    if (diff > 0) {
      if (!stat.biggest || diff > stat.biggest.diff) {
        stat.biggest = {
          publicId: bill.publicId,
          merchant: bill.merchant,
          orderDate: bill.orderDate,
          share,
          paid: recorded,
          diff,
        }
      }
      if (!stat.lastTip || bill.orderDate > stat.lastTip)
        stat.lastTip = bill.orderDate
    }
  }

  const rows = [...stats.values()].sort(
    (a, b) =>
      b.tipTotal - a.tipTotal ||
      b.tipCount - a.tipCount ||
      a.name.localeCompare(b.name)
  )
  return {
    rows,
    tippedTotal: rows.reduce((sum, row) => sum + row.tipTotal, 0),
    recordedCount: rows.reduce((sum, row) => sum + row.paymentCount, 0),
    billCount: billRows.length,
  }
}

// ---- All-time player board and profile ------------------------------
// The public players directory (rank rail + podium) and the per-player
// analytics profile. Same scope rules as the monthly leaderboard: published,
// non-archived bills, people linked in the players directory. Shares
// include adjustment allocations, so totals reconcile with the home board.

export interface BoardMonthPoint {
  monthKey: string
  spend: number
  orders: number
}

export interface PlayerBoardRow {
  playerId: string
  name: string
  /** 1-based all-time spend rank. */
  rank: number
  orderCount: number
  itemCount: number
  totalSpend: number
  /** Recorded payments minus shares across published bills. */
  totalTips: number
  totalDiscount: number
  discountRate: number
  avgPerOrder: number
  /** Spend per month across the board's full month span, zeros included. */
  monthly: BoardMonthPoint[]
}

export interface PlayerBoard {
  /** Sorted by all-time spend, highest first. */
  rows: PlayerBoardRow[]
  /** Every month from the first to the last published bill, YYYY-MM keys. */
  monthKeys: string[]
  billCount: number
  /** Sum of shares over linked players. */
  allSpend: number
  /** Sum of shares over billPlayers without a directory link. */
  guestSpend: number
}

interface PlayerAnalytics {
  playerId: string
  name: string
  note: string | null
  totalSpend: number
  totalTips: number
  totalDiscount: number
  itemCount: number
  billsSeen: Set<string>
  firstOrder: string | null
  lastOrder: string | null
  biggestOrder: { bill: BillRow; share: number } | null
  monthly: Map<string, { spend: number; orders: number }>
  monthlyTips: Map<string, number>
  items: Map<string, { quantity: number; spend: number }>
  merchants: Map<string, { spend: number; orders: number }>
  recentOrders: Array<{
    bill: BillRow
    share: number
    itemCount: number
    paid: boolean
  }>
  companions: Map<string, { billCount: number; lastTogether: string }>
  /** Sum of shares over the player's billPlayers not marked paid. */
  outstandingSpend: number
  /** Distinct bills with at least one unpaid share for the player. */
  outstandingBills: Set<string>
}

interface PlayerAnalyticsBlob {
  byPlayer: Map<string, PlayerAnalytics>
  monthKeys: string[]
  billCount: number
  allSpend: number
  guestSpend: number
}

/**
 * Fetched published bills plus per-player tallies for the board and the
 * profile. One pass over the ledger so both pages agree on the numbers.
 */
async function computePlayerAnalytics(
  db: Db | Tx,
  billRows: BillRow[]
): Promise<PlayerAnalyticsBlob> {
  const blob: PlayerAnalyticsBlob = {
    byPlayer: new Map(),
    monthKeys: [],
    billCount: billRows.length,
    allSpend: 0,
    guestSpend: 0,
  }
  if (billRows.length === 0) return blob
  const billById = new Map(billRows.map((bill) => [bill.id, bill]))
  const billIds = [...billById.keys()]

  const ensure = (playerId: string): PlayerAnalytics => {
    let entry = blob.byPlayer.get(playerId)
    if (!entry) {
      entry = {
        playerId,
        name: "",
        note: null,
        totalSpend: 0,
        totalTips: 0,
        totalDiscount: 0,
        itemCount: 0,
        billsSeen: new Set(),
        firstOrder: null,
        lastOrder: null,
        biggestOrder: null,
        monthly: new Map(),
        monthlyTips: new Map(),
        items: new Map(),
        merchants: new Map(),
        recentOrders: [],
        companions: new Map(),
        outstandingSpend: 0,
        outstandingBills: new Set(),
      }
      blob.byPlayer.set(playerId, entry)
    }
    return entry
  }

  const billPlayerRows = await db
    .select({
      id: billPlayers.id,
      billId: billPlayers.billId,
      playerId: billPlayers.playerId,
      paidStatus: paymentStatuses.status,
      paidAmount: paymentStatuses.paidAmount,
    })
    .from(billPlayers)
    .leftJoin(paymentStatuses, eq(paymentStatuses.billPlayerId, billPlayers.id))
    .where(inArray(billPlayers.billId, billIds))
    .orderBy(billPlayers.sortOrder)
    .all()
  const linked = billPlayerRows.filter(
    (p): p is typeof p & { playerId: string } => p.playerId !== null
  )
  const playerIds = [...new Set(linked.map((p) => p.playerId))]
  if (playerIds.length > 0) {
    const playerRows = await db
      .select({
        id: players.id,
        name: players.name,
        note: players.note,
      })
      .from(players)
      .where(inArray(players.id, playerIds))
      .all()
    for (const row of playerRows) {
      const entry = ensure(row.id)
      entry.name = row.name
      entry.note = row.note
    }
  }
  const linkedIdsByBill = new Map<string, string[]>()
  for (const billPlayer of linked) {
    const ids = linkedIdsByBill.get(billPlayer.billId) ?? []
    ids.push(billPlayer.playerId)
    linkedIdsByBill.set(billPlayer.billId, ids)
  }

  // Item shares per billPlayer, keeping item names for the usual-order
  // tallies.
  const itemRows = await db
    .select()
    .from(items)
    .where(inArray(items.billId, billIds))
    .all()
  const itemById = new Map(itemRows.map((item) => [item.id, item]))
  const billPlayerSpend = new Map<string, { spend: number; count: number }>()
  const billPlayerItems = new Map<
    string,
    Map<string, { quantity: number; spend: number }>
  >()
  const itemIds = itemRows.map((item) => item.id)
  if (itemIds.length > 0) {
    const allocationRows = await db
      .select()
      .from(itemAllocations)
      .where(inArray(itemAllocations.itemId, itemIds))
      .all()
    const itemCosts = new Map(
      itemRows.flatMap((item) =>
        allocateItemCost(item, allocationRows, billPlayerRows).map(
          (share) =>
            [`${item.id}::${share.billPlayerId}`, share.amount] as const
        )
      )
    )
    for (const allocation of allocationRows) {
      const item = itemById.get(allocation.itemId)
      if (!item) continue
      const lineSpend =
        itemCosts.get(`${allocation.itemId}::${allocation.billPlayerId}`) ?? 0
      const spend = billPlayerSpend.get(allocation.billPlayerId) ?? {
        spend: 0,
        count: 0,
      }
      spend.spend += lineSpend
      spend.count += allocation.quantity
      billPlayerSpend.set(allocation.billPlayerId, spend)

      let tally = billPlayerItems.get(allocation.billPlayerId)
      if (!tally) {
        tally = new Map()
        billPlayerItems.set(allocation.billPlayerId, tally)
      }
      const itemTally = tally.get(item.name) ?? { quantity: 0, spend: 0 }
      itemTally.quantity += allocation.quantity
      itemTally.spend += lineSpend
      tally.set(item.name, itemTally)
    }
  }

  // Signed adjustment totals per billPlayer; discounts also tracked as a
  // positive figure.
  const adjustmentRows = await db
    .select({ id: adjustments.id, type: adjustments.type })
    .from(adjustments)
    .where(inArray(adjustments.billId, billIds))
    .all()
  const adjustmentIds = adjustmentRows.map((adjustment) => adjustment.id)
  const billPlayerAdjustment = new Map<string, number>()
  const billPlayerDiscount = new Map<string, number>()
  if (adjustmentIds.length > 0) {
    const allocationRows = await db
      .select()
      .from(adjustmentAllocations)
      .where(inArray(adjustmentAllocations.adjustmentId, adjustmentIds))
      .all()
    const discountIds = new Set(
      adjustmentRows
        .filter((adjustment) => adjustment.type === "discount")
        .map((adjustment) => adjustment.id)
    )
    for (const row of allocationRows) {
      billPlayerAdjustment.set(
        row.billPlayerId,
        (billPlayerAdjustment.get(row.billPlayerId) ?? 0) + row.signedAmount
      )
      if (discountIds.has(row.adjustmentId)) {
        // Signed negative on the ledger; reported as a positive figure.
        billPlayerDiscount.set(
          row.billPlayerId,
          (billPlayerDiscount.get(row.billPlayerId) ?? 0) - row.signedAmount
        )
      }
    }
  }

  // Fold per-billPlayer totals into per-player tallies.
  for (const billPlayer of billPlayerRows) {
    const spend =
      (billPlayerSpend.get(billPlayer.id)?.spend ?? 0) +
      (billPlayerAdjustment.get(billPlayer.id) ?? 0)
    const itemCount = billPlayerSpend.get(billPlayer.id)?.count ?? 0
    if (billPlayer.playerId === null) {
      blob.guestSpend += spend
      continue
    }
    const bill = billById.get(billPlayer.billId)!
    const entry = ensure(billPlayer.playerId)
    const monthKey = bill.orderDate.slice(0, 7)

    blob.allSpend += spend
    entry.totalSpend += spend
    if (billPlayer.paidAmount !== null) {
      const tip = billPlayer.paidAmount - spend
      entry.totalTips += tip
      entry.monthlyTips.set(
        monthKey,
        (entry.monthlyTips.get(monthKey) ?? 0) + tip
      )
    }
    entry.totalDiscount += billPlayerDiscount.get(billPlayer.id) ?? 0
    entry.itemCount += itemCount
    entry.billsSeen.add(bill.id)
    entry.firstOrder =
      entry.firstOrder === null || bill.orderDate < entry.firstOrder
        ? bill.orderDate
        : entry.firstOrder
    entry.lastOrder =
      entry.lastOrder === null || bill.orderDate > entry.lastOrder
        ? bill.orderDate
        : entry.lastOrder
    if (
      spend > 0 &&
      (!entry.biggestOrder || spend > entry.biggestOrder.share)
    ) {
      entry.biggestOrder = { bill, share: spend }
    }

    const month = entry.monthly.get(monthKey) ?? { spend: 0, orders: 0 }
    month.spend += spend
    month.orders += 1
    entry.monthly.set(monthKey, month)

    const merchant = entry.merchants.get(bill.merchant) ?? {
      spend: 0,
      orders: 0,
    }
    merchant.spend += spend
    merchant.orders += 1
    entry.merchants.set(bill.merchant, merchant)

    entry.recentOrders.push({
      bill,
      share: spend,
      itemCount,
      paid: billPlayer.paidStatus === "paid",
    })
    if (billPlayer.paidStatus !== "paid") {
      entry.outstandingSpend += spend
      entry.outstandingBills.add(bill.id)
    }

    const itemTally = billPlayerItems.get(billPlayer.id)
    if (itemTally) {
      for (const [name, tally] of itemTally) {
        const total = entry.items.get(name) ?? { quantity: 0, spend: 0 }
        total.quantity += tally.quantity
        total.spend += tally.spend
        entry.items.set(name, total)
      }
    }
  }

  // Companion counts: linked players sharing a bill, second pass so every
  // analytics entry exists before the cross-references.
  for (const [billId, ids] of linkedIdsByBill) {
    const bill = billById.get(billId)!
    for (const playerId of ids) {
      const entry = blob.byPlayer.get(playerId)
      if (!entry) continue
      for (const otherId of ids) {
        if (otherId === playerId) continue
        const companion = entry.companions.get(otherId) ?? {
          billCount: 0,
          lastTogether: "",
        }
        companion.billCount += 1
        if (bill.orderDate > companion.lastTogether) {
          companion.lastTogether = bill.orderDate
        }
        entry.companions.set(otherId, companion)
      }
    }
  }

  const firstKey = billRows.reduce(
    (min, bill) => (bill.orderDate < min ? bill.orderDate : min),
    billRows[0].orderDate
  )
  const lastKey = billRows.reduce(
    (max, bill) => (bill.orderDate > max ? bill.orderDate : max),
    billRows[0].orderDate
  )
  blob.monthKeys = monthSpanKeys(firstKey, lastKey)
  return blob
}

function shapeMonthly(
  entry: PlayerAnalytics,
  monthKeys: string[]
): BoardMonthPoint[] {
  return monthKeys.map((monthKey) => {
    const month = entry.monthly.get(monthKey)
    return {
      monthKey,
      spend: month?.spend ?? 0,
      orders: month?.orders ?? 0,
    }
  })
}

function analyticsOrderCount(entry: PlayerAnalytics): number {
  return entry.billsSeen.size
}

function shapeBoardRow(
  entry: PlayerAnalytics,
  monthKeys: string[]
): PlayerBoardRow {
  const orderCount = analyticsOrderCount(entry)
  return {
    playerId: entry.playerId,
    name: entry.name,
    rank: 0,
    orderCount,
    itemCount: entry.itemCount,
    totalSpend: entry.totalSpend,
    totalTips: entry.totalTips,
    totalDiscount: entry.totalDiscount,
    discountRate:
      entry.totalSpend > 0 ? entry.totalDiscount / entry.totalSpend : 0,
    avgPerOrder: orderCount > 0 ? Math.round(entry.totalSpend / orderCount) : 0,
    monthly: shapeMonthly(entry, monthKeys),
  }
}

/**
 * The all-time player board behind the public directory: one row per
 * linked player with rank, discount haul, and monthly spend, plus the
 * guests-also-paid figure for the page subtitle.
 */
export function listPlayerBoard(
  deps: InsightDeps
): Effect.Effect<PlayerBoard, RepositoryError> {
  return Effect.gen(function* () {
    const billRows = yield* tryDb(() =>
      deps.db
        .select()
        .from(bills)
        .where(and(eq(bills.status, "published"), isNull(bills.archivedAt)))
        .all()
    )
    const blob = yield* tryDb(() => computePlayerAnalytics(deps.db, billRows))

    const rows = [...blob.byPlayer.values()]
      .map((entry) => shapeBoardRow(entry, blob.monthKeys))
      .sort(
        (a, b) => b.totalSpend - a.totalSpend || a.name.localeCompare(b.name)
      )
    for (const [index, row] of rows.entries()) row.rank = index + 1

    return {
      rows,
      monthKeys: blob.monthKeys,
      billCount: blob.billCount,
      allSpend: blob.allSpend,
      guestSpend: blob.guestSpend,
    }
  })
}

export interface ProfileOrder {
  publicId: string
  merchant: string
  title: string | null
  orderDate: string
  /** The person's own share of that bill, integer rupiah. */
  share: number
  itemCount: number
  /** Whether this person's share on the bill is marked paid. */
  paid: boolean
}

export interface ProfileCompanion {
  playerId: string
  name: string
  billCount: number
  lastTogether: string
}

export interface PlayerProfile {
  player: {
    id: string
    name: string
    note: string | null
  }
  /** 1-based all-time spend rank among players with published orders. */
  rank: number
  playerCount: number
  totalSpend: number
  totalTips: number
  orderCount: number
  itemCount: number
  totalDiscount: number
  discountRate: number
  avgPerOrder: number
  firstOrder: string | null
  lastOrder: string | null
  biggestOrder: LeaderboardOrder | null
  /** Every month from the first to the last published bill, zeros included. */
  monthKeys: string[]
  monthly: BoardMonthPoint[]
  badges: PlayerBadge[]
  /** Top items by allocated quantity. */
  favoriteItems: Array<{ name: string; quantity: number; spend: number }>
  merchantSplit: Array<{ merchant: string; spend: number; orders: number }>
  recentOrders: ProfileOrder[]
  /** Players sharing the most bills, closest companions first. */
  companions: ProfileCompanion[]
  /** Sum of the player's unpaid shares over published bills. */
  outstandingTotal: number
  /** How many of those bills still have an unpaid share. */
  outstandingBillCount: number
}

export interface PlayerBadge {
  monthKey: string
  kind: "spending" | "tips"
  amount: number
}

export interface PlayerHoverSummary {
  name: string
  rank: number
  totalSpend: number
  totalTips: number
  orderCount: number
  badges: PlayerBadge[]
}

function badgesForPlayer(
  entry: PlayerAnalytics,
  ranked: PlayerAnalytics[],
  monthKeys: string[]
): PlayerBadge[] {
  const badges: PlayerBadge[] = []
  for (const monthKey of monthKeys) {
    const spend = entry.monthly.get(monthKey)?.spend ?? 0
    const highestSpend = Math.max(
      0,
      ...ranked.map((player) => player.monthly.get(monthKey)?.spend ?? 0)
    )
    if (spend > 0 && spend === highestSpend)
      badges.push({ monthKey, kind: "spending", amount: spend })
    const tips = entry.monthlyTips.get(monthKey) ?? 0
    const highestTips = Math.max(
      0,
      ...ranked.map((player) => player.monthlyTips.get(monthKey) ?? 0)
    )
    if (tips > 0 && tips === highestTips)
      badges.push({ monthKey, kind: "tips", amount: tips })
  }
  return badges
}

/** Call inside the transaction that changes published bills or payments. */
export async function refreshPlayerHoverSummaries(db: Db | Tx): Promise<void> {
  const billRows = await db
    .select()
    .from(bills)
    .where(and(eq(bills.status, "published"), isNull(bills.archivedAt)))
    .all()
  const blob = await computePlayerAnalytics(db, billRows)
  const ranked = [...blob.byPlayer.values()].sort(
    (a, b) => b.totalSpend - a.totalSpend || a.name.localeCompare(b.name)
  )
  await db.delete(playerHoverSummaries).run()
  if (ranked.length === 0) return
  await db
    .insert(playerHoverSummaries)
    .values(
      ranked.map((entry, index) => ({
        playerId: entry.playerId,
        rank: index + 1,
        totalSpend: entry.totalSpend,
        totalTips: entry.totalTips,
        orderCount: analyticsOrderCount(entry),
        badgesJson: JSON.stringify(
          badgesForPlayer(entry, ranked, blob.monthKeys)
        ),
      }))
    )
    .run()
}

/** Reads one stored row. The fallback covers deployment before admin backfill. */
export function getPlayerHoverSummary(
  deps: InsightDeps,
  playerId: string
): Effect.Effect<PlayerHoverSummary | null, RepositoryError> {
  return Effect.gen(function* () {
    const row = yield* tryDb(() =>
      deps.db
        .select({
          name: players.name,
          rank: playerHoverSummaries.rank,
          totalSpend: playerHoverSummaries.totalSpend,
          totalTips: playerHoverSummaries.totalTips,
          orderCount: playerHoverSummaries.orderCount,
          badgesJson: playerHoverSummaries.badgesJson,
        })
        .from(playerHoverSummaries)
        .innerJoin(players, eq(players.id, playerHoverSummaries.playerId))
        .where(eq(playerHoverSummaries.playerId, playerId))
        .get()
    )
    if (row) {
      const { badgesJson, ...summary } = row
      return { ...summary, badges: JSON.parse(badgesJson) as PlayerBadge[] }
    }
    const profile = yield* getPlayerProfile(deps, playerId)
    if (!profile) return null
    return {
      name: profile.player.name,
      rank: profile.rank,
      totalSpend: profile.totalSpend,
      totalTips: profile.totalTips,
      orderCount: profile.orderCount,
      badges: profile.badges,
    }
  })
}

/**
 * Everything the public profile page renders for one player, or null when
 * the id is unknown or the player has no published orders to show.
 */
export function getPlayerProfile(
  deps: InsightDeps,
  playerId: string
): Effect.Effect<PlayerProfile | null, RepositoryError> {
  return Effect.gen(function* () {
    const playerRow = yield* tryDb(() =>
      deps.db.select().from(players).where(eq(players.id, playerId)).get()
    )
    if (!playerRow) return null

    const billRows = yield* tryDb(() =>
      deps.db
        .select()
        .from(bills)
        .where(and(eq(bills.status, "published"), isNull(bills.archivedAt)))
        .all()
    )
    const blob = yield* tryDb(() => computePlayerAnalytics(deps.db, billRows))

    const ranked = [...blob.byPlayer.values()].sort(
      (a, b) => b.totalSpend - a.totalSpend || a.name.localeCompare(b.name)
    )
    const index = ranked.findIndex((entry) => entry.playerId === playerId)
    // Directory pages only list people with published orders; a player
    // without any has no public stats to show.
    if (index === -1) return null
    const entry = ranked[index]
    const orderCount = analyticsOrderCount(entry)
    const badges = badgesForPlayer(entry, ranked, blob.monthKeys)

    const favoriteItems = [...entry.items.entries()]
      .map(([name, tally]) => ({ name, ...tally }))
      .sort((a, b) => b.quantity - a.quantity || b.spend - a.spend)
      .slice(0, 6)
    const merchantSplit = [...entry.merchants.entries()]
      .map(([merchant, tally]) => ({ merchant, ...tally }))
      .sort((a, b) => b.spend - a.spend)
    const recentOrders = [...entry.recentOrders]
      .sort(
        (a, b) =>
          b.bill.orderDate.localeCompare(a.bill.orderDate) ||
          a.bill.merchant.localeCompare(b.bill.merchant)
      )
      .slice(0, 8)
      .map((order) => ({
        publicId: order.bill.publicId,
        merchant: order.bill.merchant,
        title: order.bill.title,
        orderDate: order.bill.orderDate,
        share: order.share,
        itemCount: order.itemCount,
        paid: order.paid,
      }))
    const companions = [...entry.companions.entries()]
      .map(([companionId, tally]) => ({
        playerId: companionId,
        name: blob.byPlayer.get(companionId)?.name ?? "",
        ...tally,
      }))
      .sort(
        (a, b) =>
          b.billCount - a.billCount ||
          b.lastTogether.localeCompare(a.lastTogether)
      )
      .slice(0, 5)

    return {
      player: {
        id: playerRow.id,
        name: playerRow.name,
        note: playerRow.note,
      },
      rank: index + 1,
      playerCount: ranked.length,
      totalSpend: entry.totalSpend,
      totalTips: entry.totalTips,
      orderCount,
      itemCount: entry.itemCount,
      totalDiscount: entry.totalDiscount,
      discountRate:
        entry.totalSpend > 0 ? entry.totalDiscount / entry.totalSpend : 0,
      avgPerOrder:
        orderCount > 0 ? Math.round(entry.totalSpend / orderCount) : 0,
      firstOrder: entry.firstOrder,
      lastOrder: entry.lastOrder,
      biggestOrder: entry.biggestOrder
        ? {
            publicId: entry.biggestOrder.bill.publicId,
            merchant: entry.biggestOrder.bill.merchant,
            title: entry.biggestOrder.bill.title,
            orderDate: entry.biggestOrder.bill.orderDate,
            total: entry.biggestOrder.share,
          }
        : null,
      monthKeys: blob.monthKeys,
      monthly: shapeMonthly(entry, blob.monthKeys),
      badges,
      favoriteItems,
      merchantSplit,
      recentOrders,
      companions,
      outstandingTotal: entry.outstandingSpend,
      outstandingBillCount: entry.outstandingBills.size,
    }
  })
}
