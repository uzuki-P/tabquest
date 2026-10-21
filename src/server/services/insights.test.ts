import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import {
  archiveBill,
  createFullBill,
  publishBill,
  unarchiveBill,
  unpublishBill,
} from "./bills"
import { createPlayer } from "./players"
import {
  getPlayerProfile,
  getPlayerHoverSummary,
  listPlayerBoard,
  listPlayerInsights,
  listMonthlyLeaderboard,
  listMonthlyTips,
  listPublishedMonthKeys,
  refreshPlayerHoverSummaries,
} from "./insights"
import { recordPaidAmount } from "./payments"
import { billPlayers, playerHoverSummaries } from "@/db/schema"
import { eq } from "drizzle-orm"
import { fakeImage, makeHarness } from "../../../test/helpers"
import type { BillStructureInput } from "@/lib/bill-schema"

async function run<T>(effect: Effect.Effect<T, any>): Promise<T> {
  return Effect.runPromise(effect)
}

let billSeq = 0

/**
 * One-item bill split between two people, with fresh row IDs so several
 * bills can coexist in one database. Omitting playerB models a legacy
 * ad-hoc row: the API rejects those now, but insights must keep counting
 * the old ones.
 */
function billStructure(options: {
  orderDate: string
  quantity: number
  unitPrice: number
  aFirst: number
  discount?: number
  playerA: string
  playerB?: string
}): BillStructureInput {
  const seq = ++billSeq
  const lineTotal = options.quantity * options.unitPrice
  return {
    header: {
      merchant: "Kopi Sudirman",
      title: `Bill ${seq}`,
      orderDate: options.orderDate,
      currency: "IDR",
      sourceSubtotal: lineTotal,
      finalTotal: lineTotal + (options.discount ?? 0),
    },
    items: [
      {
        id: `item-${seq}`,
        name: "Tonic",
        variantNotes: "",
        quantity: options.quantity,
        unitPrice: options.unitPrice,
        lineTotal,
        sortOrder: 0,
      },
    ],
    adjustments:
      options.discount === undefined
        ? []
        : [
            {
              id: `adj-${seq}`,
              type: "discount",
              label: "Voucher",
              amount: options.discount,
              sortOrder: 0,
            },
          ],
    billPlayers: [
      {
        id: `p-${seq}-a`,
        alias: "A",
        playerId: options.playerA,
        sortOrder: 0,
      },
      {
        id: `p-${seq}-b`,
        alias: "B",
        playerId: (options.playerB ?? null) as string,
        sortOrder: 1,
      },
    ],
    allocations: [
      {
        itemId: `item-${seq}`,
        billPlayerId: `p-${seq}-a`,
        quantity: options.aFirst,
      },
      {
        itemId: `item-${seq}`,
        billPlayerId: `p-${seq}-b`,
        quantity: options.quantity - options.aFirst,
      },
    ],
  }
}

async function publishStructure(
  deps: { db: any },
  structure: BillStructureInput
) {
  const bill = await run(
    createFullBill(deps, structure.header, structure, fakeImage)
  )
  return run(publishBill(deps, bill.id))
}

describe("insights service", () => {
  test("stored hover summaries follow bills and paid amounts", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const first = await run(createPlayer(deps, { name: "First" }))
    const second = await run(createPlayer(deps, { name: "Second" }))
    const structure = billStructure({
      orderDate: "2026-09-10",
      quantity: 3,
      unitPrice: 10000,
      aFirst: 2,
      playerA: first.id,
      playerB: second.id,
    })
    const bill = await publishStructure(deps, structure)

    const stored = await harness.db.select().from(playerHoverSummaries).all()
    expect(stored).toHaveLength(2)
    expect(await run(getPlayerHoverSummary(deps, first.id))).toEqual({
      name: "First",
      rank: 1,
      totalSpend: 20000,
      totalTips: 0,
      orderCount: 1,
      badges: [{ monthKey: "2026-09", kind: "spending", amount: 20000 }],
    })

    await run(
      recordPaidAmount(deps, {
        billPlayerId: structure.billPlayers[1].id,
        paidAmount: 13000,
        actor: "admin",
      })
    )
    expect((await run(getPlayerHoverSummary(deps, second.id)))?.badges).toEqual(
      [{ monthKey: "2026-09", kind: "tips", amount: 3000 }]
    )

    await run(archiveBill(deps, bill.id))
    expect(await harness.db.select().from(playerHoverSummaries).all()).toEqual(
      []
    )
    await run(unarchiveBill(deps, bill.id))
    expect(
      await harness.db.select().from(playerHoverSummaries).all()
    ).toHaveLength(2)
    await run(unpublishBill(deps, bill.id))
    expect(await harness.db.select().from(playerHoverSummaries).all()).toEqual(
      []
    )
    harness.cleanup()
  })

  test("existing bills can be backfilled after migration", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const player = await run(createPlayer(deps, { name: "Existing" }))
    const other = await run(createPlayer(deps, { name: "Other" }))
    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-09-10",
        quantity: 2,
        unitPrice: 10000,
        aFirst: 1,
        playerA: player.id,
        playerB: other.id,
      })
    )
    await harness.db.delete(playerHoverSummaries).run()
    expect(await run(getPlayerHoverSummary(deps, player.id))).toMatchObject({
      name: "Existing",
      totalSpend: 10000,
    })
    await harness.db.transaction((tx) => refreshPlayerHoverSummaries(tx))
    expect(await run(getPlayerHoverSummary(deps, player.id))).toMatchObject({
      name: "Existing",
      totalSpend: 10000,
    })
    harness.cleanup()
  })

  test("per-player metrics over published bills, both rankings", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const custA = await run(createPlayer(deps, { name: "Bu Tari" }))
    const custB = await run(createPlayer(deps, { name: "Mas Budi" }))

    // Bill 1: no discount. A spends 30000, B spends 10000.
    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-10",
        quantity: 4,
        unitPrice: 10000,
        aFirst: 3,
        playerA: custA.id,
        playerB: custB.id,
      })
    )
    // Bill 2: -12000 discount, split by subtotal share. A spends 10000 with
    // -4000; B spends 20000 with -8000.
    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-20",
        quantity: 3,
        unitPrice: 10000,
        aFirst: 1,
        discount: -12000,
        playerA: custA.id,
        playerB: custB.id,
      })
    )

    const insights = await run(listPlayerInsights(deps))
    expect(insights).toHaveLength(2)

    // Default ordering is by spend: "buys the most" first.
    expect(insights[0].name).toBe("Bu Tari")
    const byDiscount = [...insights].sort(
      (a, b) => b.totalDiscount - a.totalDiscount
    )
    // "Got the most discounted pricing": Mas Budi.
    expect(byDiscount[0].name).toBe("Mas Budi")

    expect(insights.find((i) => i.playerId === custA.id)).toEqual({
      playerId: custA.id,
      name: "Bu Tari",
      orderCount: 2,
      itemCount: 4,
      totalSpend: 40000,
      totalDiscount: 4000,
      discountRate: 0.1,
    })
    expect(insights.find((i) => i.playerId === custB.id)).toEqual({
      playerId: custB.id,
      name: "Mas Budi",
      orderCount: 2,
      itemCount: 3,
      totalSpend: 30000,
      totalDiscount: 8000,
      discountRate: 8000 / 30000,
    })
    harness.cleanup()
  })

  test("drafts and archived bills are excluded, range filters apply", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const cust = await run(createPlayer(deps, { name: "Bu Tari" }))

    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-10",
        quantity: 3,
        unitPrice: 10000,
        aFirst: 2,
        playerA: cust.id,
      })
    )

    // Draft in range: excluded.
    await run(
      createFullBill(
        deps,
        billStructure({
          orderDate: "2026-08-15",
          quantity: 5,
          unitPrice: 10000,
          aFirst: 4,
          playerA: cust.id,
        }).header,
        billStructure({
          orderDate: "2026-08-15",
          quantity: 5,
          unitPrice: 10000,
          aFirst: 4,
          playerA: cust.id,
        }),
        fakeImage
      )
    )

    // Published but out of range: excluded.
    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-07-01",
        quantity: 8,
        unitPrice: 10000,
        aFirst: 7,
        playerA: cust.id,
      })
    )

    const inRange = await run(
      listPlayerInsights(deps, { from: "2026-08-01", to: "2026-08-31" })
    )
    expect(inRange).toHaveLength(1)
    expect(inRange[0].orderCount).toBe(1)
    expect(inRange[0].totalSpend).toBe(20000)

    // Archived published bills are excluded too.
    const archived = await run(
      createFullBill(
        deps,
        billStructure({
          orderDate: "2026-08-20",
          quantity: 3,
          unitPrice: 10000,
          aFirst: 2,
          playerA: cust.id,
        }).header,
        billStructure({
          orderDate: "2026-08-20",
          quantity: 3,
          unitPrice: 10000,
          aFirst: 2,
          playerA: cust.id,
        }),
        fakeImage
      )
    )
    await run(publishBill(deps, archived.id))
    await run(archiveBill(deps, archived.id))

    const afterArchive = await run(
      listPlayerInsights(deps, { from: "2026-08-01", to: "2026-08-31" })
    )
    expect(afterArchive[0].orderCount).toBe(1)
    expect(afterArchive[0].totalSpend).toBe(20000)

    const allTime = await run(listPlayerInsights(deps))
    expect(allTime[0].orderCount).toBe(2)
    expect(allTime[0].totalSpend).toBe(90000)
    harness.cleanup()
  })
})

describe("listMonthlyLeaderboard", () => {
  test("ranks spend, tracks discounts, and records each biggest order", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const custA = await run(createPlayer(deps, { name: "Bu Tari" }))
    const custB = await run(createPlayer(deps, { name: "Mas Budi" }))

    // Bill 1: 40000 subtotal, A takes 30000, B 10000.
    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-10",
        quantity: 4,
        unitPrice: 10000,
        aFirst: 3,
        playerA: custA.id,
        playerB: custB.id,
      })
    )
    // Bill 2: 30000 subtotal, -12000 voucher. Shares: A 10000 - 4000,
    // B 20000 - 8000.
    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-20",
        quantity: 3,
        unitPrice: 10000,
        aFirst: 1,
        discount: -12000,
        playerA: custA.id,
        playerB: custB.id,
      })
    )

    const board = await run(
      listMonthlyLeaderboard(deps, "2026-08-01", "2026-08-31")
    )
    expect(board.billCount).toBe(2)
    expect(board.monthTotal).toBe(58000)
    expect(board.rows.map((row) => row.name)).toEqual(["Bu Tari", "Mas Budi"])

    const [first, second] = board.rows
    expect(first.orderCount).toBe(2)
    expect(first.totalSpend).toBe(36000)
    expect(first.totalDiscount).toBe(4000)
    expect(first.biggestOrder).toMatchObject({
      merchant: "Kopi Sudirman",
      total: 30000,
    })
    expect(second.biggestOrder).toMatchObject({ total: 12000 })
    // Biggest order links back to the public bill page.
    expect(typeof second.biggestOrder?.publicId).toBe("string")
    harness.cleanup()
  })

  test("unlinked billPlayers stay out of the ranks but count in the month total", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const cust = await run(createPlayer(deps, { name: "Bu Tari" }))

    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-10",
        quantity: 2,
        unitPrice: 10000,
        aFirst: 1,
        playerA: cust.id,
      })
    )

    const board = await run(
      listMonthlyLeaderboard(deps, "2026-08-01", "2026-08-31")
    )
    expect(board.rows).toHaveLength(1)
    expect(board.rows[0].totalSpend).toBe(10000)
    expect(board.monthTotal).toBe(20000)
    harness.cleanup()
  })

  test("an empty month yields an empty board", async () => {
    const harness = await makeHarness()
    const board = await run(
      listMonthlyLeaderboard({ db: harness.db }, "2027-01-01", "2027-01-31")
    )
    expect(board).toEqual({ rows: [], monthTotal: 0, billCount: 0 })
    harness.cleanup()
  })
})

describe("listPlayerBoard", () => {
  test("ranks all-time spend and aligns monthly series to the bill span", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const custA = await run(createPlayer(deps, { name: "Bu Tari" }))
    const custB = await run(createPlayer(deps, { name: "Mas Budi" }))

    // Bill 1: 40000 subtotal, A takes 30000, B 10000.
    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-10",
        quantity: 4,
        unitPrice: 10000,
        aFirst: 3,
        playerA: custA.id,
        playerB: custB.id,
      })
    )
    // Bill 2 in an earlier month: 30000 subtotal, -12000 voucher.
    // Shares: A 10000 - 4000, B 20000 - 8000.
    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-07-20",
        quantity: 3,
        unitPrice: 10000,
        aFirst: 1,
        discount: -12000,
        playerA: custA.id,
        playerB: custB.id,
      })
    )

    const board = await run(listPlayerBoard(deps))
    expect(board.billCount).toBe(2)
    expect(board.monthKeys).toEqual(["2026-07", "2026-08"])
    expect(board.allSpend).toBe(58000)
    expect(board.guestSpend).toBe(0)
    expect(board.rows.map((row) => row.name)).toEqual(["Bu Tari", "Mas Budi"])

    const [first, second] = board.rows
    expect(first.rank).toBe(1)
    expect(first.totalSpend).toBe(36000)
    expect(first.totalDiscount).toBe(4000)
    expect(first.avgPerOrder).toBe(18000)
    expect(first.monthly).toEqual([
      { monthKey: "2026-07", spend: 6000, orders: 1 },
      { monthKey: "2026-08", spend: 30000, orders: 1 },
    ])
    expect(second.rank).toBe(2)
    expect(second.totalSpend).toBe(22000)
    harness.cleanup()
  })

  test("unlinked billPlayers feed guestSpend and drafts stay out", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const cust = await run(createPlayer(deps, { name: "Bu Tari" }))

    // Linked A takes half, the unlinked "B" alias takes the other half.
    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-10",
        quantity: 2,
        unitPrice: 10000,
        aFirst: 1,
        playerA: cust.id,
      })
    )
    // Draft: never counts.
    await run(
      createFullBill(
        deps,
        billStructure({
          orderDate: "2026-08-15",
          quantity: 9,
          unitPrice: 10000,
          aFirst: 9,
          playerA: cust.id,
        }).header,
        billStructure({
          orderDate: "2026-08-15",
          quantity: 9,
          unitPrice: 10000,
          aFirst: 9,
          playerA: cust.id,
        }),
        fakeImage
      )
    )

    const board = await run(listPlayerBoard(deps))
    expect(board.rows).toHaveLength(1)
    expect(board.rows[0].totalSpend).toBe(10000)
    expect(board.guestSpend).toBe(10000)
    harness.cleanup()
  })

  test("no published bills means an empty board", async () => {
    const harness = await makeHarness()
    const board = await run(listPlayerBoard({ db: harness.db }))
    expect(board).toEqual({
      rows: [],
      monthKeys: [],
      billCount: 0,
      allSpend: 0,
      guestSpend: 0,
    })
    harness.cleanup()
  })
})

describe("getPlayerProfile", () => {
  test("shapes one player's orders, items, merchants, and companions", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const custA = await run(createPlayer(deps, { name: "Bu Tari" }))
    const custB = await run(createPlayer(deps, { name: "Mas Budi" }))

    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-10",
        quantity: 4,
        unitPrice: 10000,
        aFirst: 3,
        playerA: custA.id,
        playerB: custB.id,
      })
    )
    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-07-20",
        quantity: 3,
        unitPrice: 10000,
        aFirst: 1,
        discount: -12000,
        playerA: custA.id,
        playerB: custB.id,
      })
    )

    const profile = await run(getPlayerProfile(deps, custA.id))
    expect(profile).not.toBeNull()
    const data = profile!
    expect(data.rank).toBe(1)
    expect(data.playerCount).toBe(2)
    expect(data.totalSpend).toBe(36000)
    expect(data.orderCount).toBe(2)
    expect(data.itemCount).toBe(4)
    expect(data.firstOrder).toBe("2026-07-20")
    expect(data.lastOrder).toBe("2026-08-10")
    expect(data.biggestOrder).toMatchObject({
      merchant: "Kopi Sudirman",
      total: 30000,
    })
    expect(data.favoriteItems).toEqual([
      { name: "Tonic", quantity: 4, spend: 40000 },
    ])
    expect(data.merchantSplit).toEqual([
      { merchant: "Kopi Sudirman", spend: 36000, orders: 2 },
    ])
    // Newest bill first, each with a linkable public id.
    expect(data.recentOrders.map((order) => order.orderDate)).toEqual([
      "2026-08-10",
      "2026-07-20",
    ])
    expect(typeof data.recentOrders[0].publicId).toBe("string")
    expect(data.companions).toEqual([
      {
        playerId: custB.id,
        name: "Mas Budi",
        billCount: 2,
        lastTogether: "2026-08-10",
      },
    ])
    harness.cleanup()
  })

  test("unknown and orderless players yield null", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }

    expect(await run(getPlayerProfile(deps, "nope"))).toBeNull()

    // Exists in the directory but never joined a published bill: no stats.
    const orderless = await run(createPlayer(deps, { name: "Mas Budi" }))
    expect(await run(getPlayerProfile(deps, orderless.id))).toBeNull()

    harness.cleanup()
  })

  test("outstanding total counts only unpaid shares", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const custA = await run(createPlayer(deps, { name: "Bu Tari" }))
    const custB = await run(createPlayer(deps, { name: "Mas Budi" }))

    // Shares: A 30000, B 10000. A 10000, B 20000.
    await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-10",
        quantity: 4,
        unitPrice: 10000,
        aFirst: 3,
        playerA: custA.id,
        playerB: custB.id,
      })
    )
    const julyBill = await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-07-20",
        quantity: 3,
        unitPrice: 10000,
        aFirst: 1,
        playerA: custA.id,
        playerB: custB.id,
      })
    )

    const before = await run(getPlayerProfile(deps, custA.id))
    expect(before!.outstandingTotal).toBe(40000)
    expect(before!.outstandingBillCount).toBe(2)

    // A settles the July bill; only the August share stays outstanding.
    const julyRow = (
      await deps.db
        .select({ id: billPlayers.id, alias: billPlayers.alias })
        .from(billPlayers)
        .where(eq(billPlayers.billId, julyBill.id))
        .all()
    ).find((row) => row.alias === "A")!
    await run(
      recordPaidAmount(deps, {
        billPlayerId: julyRow.id,
        paidAmount: 10000,
        actor: "admin",
      })
    )

    const after = await run(getPlayerProfile(deps, custA.id))
    expect(after!.outstandingTotal).toBe(30000)
    expect(after!.outstandingBillCount).toBe(1)

    harness.cleanup()
  })
})

describe("monthly tips", () => {
  test("ranks net tips, shorts included", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const custA = await run(createPlayer(deps, { name: "Bu Tari" }))
    const custB = await run(createPlayer(deps, { name: "Mas Budi" }))

    const billPlayerIds = async (billId: string) =>
      deps.db
        .select({ id: billPlayers.id, alias: billPlayers.alias })
        .from(billPlayers)
        .where(eq(billPlayers.billId, billId))
        .all()

    // Shares: A 30000, B 10000. B rounds up to 12000, A pays exact.
    const firstBill = await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-10",
        quantity: 4,
        unitPrice: 10000,
        aFirst: 3,
        playerA: custA.id,
        playerB: custB.id,
      })
    )
    const firstParts = await billPlayerIds(firstBill.id)
    const aFirstBill = firstParts.find((p) => p.alias === "A")!.id
    const bFirstBill = firstParts.find((p) => p.alias === "B")!.id
    await run(
      recordPaidAmount(deps, {
        billPlayerId: aFirstBill,
        paidAmount: 30000,
        actor: "admin",
      })
    )
    await run(
      recordPaidAmount(deps, {
        billPlayerId: bFirstBill,
        paidAmount: 12000,
        actor: "admin",
      })
    )

    // Second bill: shares 10000 each; A comes back with 9000 (short 1000).
    const secondBill = await publishStructure(
      deps,
      billStructure({
        orderDate: "2026-08-20",
        quantity: 2,
        unitPrice: 10000,
        aFirst: 1,
        playerA: custA.id,
        playerB: custB.id,
      })
    )
    const secondParts = await billPlayerIds(secondBill.id)
    await run(
      recordPaidAmount(deps, {
        billPlayerId: secondParts.find((p) => p.alias === "A")!.id,
        paidAmount: 9000,
        actor: "admin",
      })
    )

    const board = await run(listMonthlyTips(deps, "2026-08-01", "2026-08-31"))
    expect(board.tippedTotal).toBe(1000)
    expect(board.recordedCount).toBe(3)
    expect(board.billCount).toBe(2)
    expect(board.rows.map((row) => row.name)).toEqual(["Mas Budi", "Bu Tari"])

    const [budi, tari] = board.rows
    expect(budi.tipTotal).toBe(2000)
    expect(budi.tipCount).toBe(1)
    expect(budi.paymentCount).toBe(1)
    expect(budi.biggest).toMatchObject({
      share: 10000,
      paid: 12000,
      diff: 2000,
    })
    expect(budi.lastTip).toBe("2026-08-10")

    // Exact payment, then 1000 short: the short pulls the net down.
    expect(tari.tipTotal).toBe(-1000)
    const players = await run(listPlayerBoard(deps))
    expect(
      players.rows.find((row) => row.playerId === custA.id)?.totalTips
    ).toBe(-1000)
    expect(
      players.rows.find((row) => row.playerId === custB.id)?.totalTips
    ).toBe(2000)
    const budiProfile = await run(getPlayerProfile(deps, custB.id))
    expect(budiProfile?.badges).toContainEqual({
      monthKey: "2026-08",
      kind: "tips",
      amount: 2000,
    })
    const tariProfile = await run(getPlayerProfile(deps, custA.id))
    expect(tariProfile?.badges).toContainEqual({
      monthKey: "2026-08",
      kind: "spending",
      amount: 40000,
    })
    expect(tari.tipCount).toBe(1)
    expect(tari.paymentCount).toBe(2)
    expect(tari.biggest).toBeNull()
    expect(tari.lastTip).toBeNull()

    const keys = await run(listPublishedMonthKeys(deps))
    expect(keys).toEqual(["2026-08"])

    // Unrecorded months stay empty.
    const september = await run(
      listMonthlyTips(deps, "2026-09-01", "2026-09-30")
    )
    expect(september.rows).toEqual([])

    harness.cleanup()
  })
})

test("promotion spending, profile, hover summary, and tips match the published split", async () => {
  const harness = await makeHarness()
  try {
    const deps = { db: harness.db }
    const a = await run(createPlayer(deps, { name: "Promo A" }))
    const b = await run(createPlayer(deps, { name: "Promo B" }))
    const structure = billStructure({
      orderDate: "2026-10-05",
      quantity: 2,
      unitPrice: 25001,
      aFirst: 1,
      playerA: a.id,
      playerB: b.id,
    })
    structure.items[0].quantity = 1
    structure.items[0].bundleSize = 2
    structure.items[0].lineTotal = 25001
    structure.header.sourceSubtotal = 25001
    structure.header.finalTotal = 25001
    await publishStructure(deps, structure)
    const insights = await run(listPlayerInsights(deps))
    expect(insights.find((p) => p.playerId === a.id)!.totalSpend).toBe(12501)
    const leaderboard = await run(
      listMonthlyLeaderboard(deps, "2026-10-01", "2026-10-31")
    )
    expect(leaderboard.rows.find((p) => p.playerId === a.id)!.totalSpend).toBe(
      12501
    )
    expect(leaderboard.rows.find((p) => p.playerId === b.id)!.totalSpend).toBe(
      12500
    )
    const profile = await run(getPlayerProfile(deps, a.id))
    expect(profile!.totalSpend).toBe(12501)
    expect(profile!.favoriteItems[0].spend).toBe(12501)
    expect((await run(getPlayerHoverSummary(deps, a.id)))!.totalSpend).toBe(
      12501
    )
    await run(
      recordPaidAmount(deps, {
        billPlayerId: structure.billPlayers[0].id,
        paidAmount: 13000,
        actor: "admin",
      })
    )
    const tips = await run(listMonthlyTips(deps, "2026-10-01", "2026-10-31"))
    expect(tips.tippedTotal).toBe(499)
  } finally {
    harness.cleanup()
  }
})
