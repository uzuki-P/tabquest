import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"

import { paymentEvents, paymentStatuses } from "@/db/schema"

import { createBill, createFullBill, publishBill, saveStructure } from "./bills"
import {
  collectPayment,
  listOutstandingPayments,
  listPaymentEvents,
  recordPaidAmount,
  setPaymentState,
} from "./payments"
import {
  createExamplePlayers,
  exampleStructure,
  fakeImage,
  makeHarness,
} from "../../../test/helpers"
import type { ExamplePlayers } from "../../../test/helpers"
import type { BillStructureInput } from "@/lib/bill-schema"

async function run<T>(effect: Effect.Effect<T, any>): Promise<T> {
  return Effect.runPromise(effect)
}

async function makePublishedBill() {
  const harness = await makeHarness()
  const deps = { db: harness.db }
  const structure = exampleStructure(await createExamplePlayers(deps))
  const bill = await run(createBill(deps, structure.header, fakeImage))
  await run(saveStructure(deps, bill.id, structure))
  await run(publishBill(deps, bill.id))
  return { harness, deps }
}

let billSeq = 0

/** One-item bill split between Raka (aFirst units) and Sinta (the rest). */
function twoPlayerBill(
  players: ExamplePlayers,
  options: { orderDate: string; quantity: number; aFirst: number }
): BillStructureInput {
  const seq = ++billSeq
  const lineTotal = options.quantity * 10000
  return {
    header: {
      merchant: "Kopi Sudirman",
      title: `Bill ${seq}`,
      orderDate: options.orderDate,
      currency: "IDR",
      sourceSubtotal: lineTotal,
      finalTotal: lineTotal,
    },
    items: [
      {
        id: `item-${seq}`,
        name: "Tonic",
        variantNotes: "",
        quantity: options.quantity,
        unitPrice: 10000,
        lineTotal,
        sortOrder: 0,
      },
    ],
    adjustments: [],
    billPlayers: [
      {
        id: `p-${seq}-raka`,
        alias: "Raka",
        playerId: players.raka,
        sortOrder: 0,
      },
      {
        id: `p-${seq}-sinta`,
        alias: "Sinta",
        playerId: players.sinta,
        sortOrder: 1,
      },
    ],
    allocations: [
      {
        itemId: `item-${seq}`,
        billPlayerId: `p-${seq}-raka`,
        quantity: options.aFirst,
      },
      {
        itemId: `item-${seq}`,
        billPlayerId: `p-${seq}-sinta`,
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

describe("payment service", () => {
  test("marking paid writes a status change and an audit event", async () => {
    const { harness, deps } = await makePublishedBill()

    const status = await run(
      setPaymentState(deps, {
        billPlayerId: "p-raka",
        state: "paid",
        actor: "raka@tailnet",
      })
    )
    expect(status.status).toBe("paid")
    expect(status.paidAt).toBeTruthy()
    expect(status.lastChangedBy).toBe("raka@tailnet")

    const events = await run(listPaymentEvents(deps, "p-raka"))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      billPlayerId: "p-raka",
      previousState: "unpaid",
      newState: "paid",
      actorIdentity: "raka@tailnet",
    })
    expect(events[0].eventTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)

    harness.cleanup()
  })

  test("repeating the same state writes no event", async () => {
    const { harness, deps } = await makePublishedBill()

    await run(
      setPaymentState(deps, {
        billPlayerId: "p-sinta",
        state: "paid",
        actor: "admin",
      })
    )
    await run(
      setPaymentState(deps, {
        billPlayerId: "p-sinta",
        state: "paid",
        actor: "admin",
      })
    )

    const events = await run(listPaymentEvents(deps, "p-sinta"))
    expect(events).toHaveLength(1)

    harness.cleanup()
  })

  test("toggling back to unpaid clears paidAt and appends an event", async () => {
    const { harness, deps } = await makePublishedBill()

    await run(
      setPaymentState(deps, {
        billPlayerId: "p-dewi",
        state: "paid",
        actor: "admin",
      })
    )
    const unpaid = await run(
      setPaymentState(deps, {
        billPlayerId: "p-dewi",
        state: "unpaid",
        actor: "admin",
      })
    )
    expect(unpaid.status).toBe("unpaid")
    expect(unpaid.paidAt).toBeNull()

    const events = await run(listPaymentEvents(deps, "p-dewi"))
    expect(events.map((e) => [e.previousState, e.newState])).toEqual([
      ["unpaid", "paid"],
      ["paid", "unpaid"],
    ])

    const stored = await deps.db
      .select()
      .from(paymentStatuses)
      .where(eq(paymentStatuses.billPlayerId, "p-dewi"))
      .get()
    expect(stored!.lastChangedBy).toBe("admin")

    harness.cleanup()
  })

  test("unknown billPlayers are rejected", async () => {
    const { harness, deps } = await makePublishedBill()
    await expect(
      Effect.runPromise(
        setPaymentState(deps, {
          billPlayerId: "does-not-exist",
          state: "paid",
          actor: "admin",
        })
      )
    ).rejects.toMatchObject({ _tag: "BillPlayerNotFound" })
    expect((await run(listPaymentEvents(deps, "does-not-exist"))).length).toBe(
      0
    )
    expect(await deps.db.select().from(paymentEvents).all()).toHaveLength(0)
    harness.cleanup()
  })
})

describe("recordPaidAmount", () => {
  test("recording an amount marks the billPlayer paid and stores it", async () => {
    const { harness, deps } = await makePublishedBill()

    const status = await run(
      recordPaidAmount(deps, {
        billPlayerId: "p-raka",
        paidAmount: 15000,
        actor: "admin",
      })
    )
    expect(status.status).toBe("paid")
    expect(status.paidAmount).toBe(15000)
    expect(status.paidAt).toBeTruthy()

    const events = await run(listPaymentEvents(deps, "p-raka"))
    expect(events.map((e) => [e.previousState, e.newState])).toEqual([
      ["unpaid", "paid"],
    ])

    harness.cleanup()
  })

  test("updating the amount on someone already paid writes no new event", async () => {
    const { harness, deps } = await makePublishedBill()

    await run(
      recordPaidAmount(deps, {
        billPlayerId: "p-sinta",
        paidAmount: 12000,
        actor: "admin",
      })
    )
    const updated = await run(
      recordPaidAmount(deps, {
        billPlayerId: "p-sinta",
        paidAmount: 13000,
        actor: "admin",
      })
    )
    expect(updated.status).toBe("paid")
    expect(updated.paidAmount).toBe(13000)

    const events = await run(listPaymentEvents(deps, "p-sinta"))
    expect(events).toHaveLength(1)

    harness.cleanup()
  })

  test("clearing the amount keeps the paid status", async () => {
    const { harness, deps } = await makePublishedBill()

    await run(
      recordPaidAmount(deps, {
        billPlayerId: "p-dewi",
        paidAmount: 9000,
        actor: "admin",
      })
    )
    const cleared = await run(
      recordPaidAmount(deps, {
        billPlayerId: "p-dewi",
        paidAmount: null,
        actor: "admin",
      })
    )
    expect(cleared.status).toBe("paid")
    expect(cleared.paidAmount).toBeNull()

    const events = await run(listPaymentEvents(deps, "p-dewi"))
    expect(events).toHaveLength(1)

    harness.cleanup()
  })

  test("unknown billPlayers are rejected", async () => {
    const { harness, deps } = await makePublishedBill()
    await expect(
      Effect.runPromise(
        recordPaidAmount(deps, {
          billPlayerId: "does-not-exist",
          paidAmount: 5000,
          actor: "admin",
        })
      )
    ).rejects.toMatchObject({ _tag: "BillPlayerNotFound" })
    harness.cleanup()
  })
})

describe("combined collection", () => {
  async function makeTwoBills() {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const players = await createExamplePlayers(deps)
    // Raka's shares: 10000 on the older bill, 30000 on the newer one.
    await publishStructure(
      deps,
      twoPlayerBill(players, {
        orderDate: "2026-08-01",
        quantity: 2,
        aFirst: 1,
      })
    )
    await publishStructure(
      deps,
      twoPlayerBill(players, {
        orderDate: "2026-09-01",
        quantity: 4,
        aFirst: 3,
      })
    )
    return { harness, deps, players }
  }

  test("lists unpaid shares oldest first", async () => {
    const { harness, deps, players } = await makeTwoBills()

    const outstanding = await run(listOutstandingPayments(deps, players.raka))
    expect(outstanding.player.name).toBe("Raka")
    expect(
      outstanding.items.map((item) => [item.orderDate, item.share])
    ).toEqual([
      ["2026-08-01", 10000],
      ["2026-09-01", 30000],
    ])
    expect(outstanding.totalOwed).toBe(40000)
    // Each bill carries the player's ordered lines for the collect dialog.
    expect(outstanding.items[0].items).toEqual([
      { name: "Tonic", variantNotes: null, quantity: 1 },
    ])
    expect(outstanding.items[1].items).toEqual([
      { name: "Tonic", variantNotes: null, quantity: 3 },
    ])

    harness.cleanup()
  })

  test("a rounded handover settles every bill and tips the newest", async () => {
    const { harness, deps, players } = await makeTwoBills()

    const collected = await run(
      collectPayment(deps, {
        playerId: players.raka,
        totalPaid: 45000,
        actor: "admin",
      })
    )
    expect(collected).toMatchObject({
      totalPaid: 45000,
      totalOwed: 40000,
      tip: 5000,
      appliedCount: 2,
    })
    expect(collected.tipBill?.merchant).toBe("Kopi Sudirman")

    const statuses = (
      await deps.db
        .select({
          id: paymentStatuses.billPlayerId,
          status: paymentStatuses.status,
          paidAmount: paymentStatuses.paidAmount,
        })
        .from(paymentStatuses)
        .all()
    ).sort((a, b) => a.id.localeCompare(b.id))
    const rakaRows = statuses.filter((row) => row.id.includes("raka"))
    expect(rakaRows.map((row) => [row.status, row.paidAmount])).toEqual([
      ["paid", 10000],
      ["paid", 35000],
    ])

    // Every settled billPlayer gets exactly one audit event.
    for (const row of rakaRows) {
      const events = await run(listPaymentEvents(deps, row.id))
      expect(
        events.map((event) => [event.previousState, event.newState])
      ).toEqual([["unpaid", "paid"]])
    }

    const after = await run(listOutstandingPayments(deps, players.raka))
    expect(after.items).toEqual([])
    expect(after.totalOwed).toBe(0)

    harness.cleanup()
  })

  test("collecting again with nothing outstanding is rejected", async () => {
    const { harness, deps, players } = await makeTwoBills()
    await run(
      collectPayment(deps, {
        playerId: players.raka,
        totalPaid: 40000,
        actor: "admin",
      })
    )

    await expect(
      Effect.runPromise(
        collectPayment(deps, {
          playerId: players.raka,
          totalPaid: 40000,
          actor: "admin",
        })
      )
    ).rejects.toMatchObject({ _tag: "NothingToCollect" })

    harness.cleanup()
  })

  test("a handover below the total owed changes nothing", async () => {
    const { harness, deps, players } = await makeTwoBills()

    await expect(
      Effect.runPromise(
        collectPayment(deps, {
          playerId: players.raka,
          totalPaid: 30000,
          actor: "admin",
        })
      )
    ).rejects.toMatchObject({
      _tag: "InsufficientPayment",
      totalOwed: 40000,
      totalPaid: 30000,
    })

    const stillUnpaid = (
      await deps.db
        .select({ status: paymentStatuses.status })
        .from(paymentStatuses)
        .all()
    ).every((row) => row.status === "unpaid")
    expect(stillUnpaid).toBe(true)
    expect(await deps.db.select().from(paymentEvents).all()).toHaveLength(0)

    harness.cleanup()
  })

  test("already paid bills drop out of the collection", async () => {
    const { harness, deps, players } = await makeTwoBills()

    const outstanding = await run(listOutstandingPayments(deps, players.raka))
    expect(outstanding.items).toHaveLength(2)
    const oldest = outstanding.items[0]
    await run(
      setPaymentState(deps, {
        billPlayerId: oldest.billPlayerId,
        state: "paid",
        actor: "admin",
      })
    )

    const after = await run(listOutstandingPayments(deps, players.raka))
    expect(after.items.map((item) => item.share)).toEqual([30000])
    expect(after.totalOwed).toBe(30000)

    const collected = await run(
      collectPayment(deps, {
        playerId: players.raka,
        totalPaid: 31000,
        actor: "admin",
      })
    )
    expect(collected.tip).toBe(1000)
    expect(collected.appliedCount).toBe(1)

    // The earlier exact-share billPlayer keeps its recorded amount.
    const untouched = await deps.db
      .select({ paidAmount: paymentStatuses.paidAmount })
      .from(paymentStatuses)
      .where(eq(paymentStatuses.billPlayerId, oldest.billPlayerId))
      .get()
    expect(untouched!.paidAmount).toBeNull()

    harness.cleanup()
  })

  test("unknown players are rejected", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }

    await expect(
      Effect.runPromise(listOutstandingPayments(deps, "nope"))
    ).rejects.toMatchObject({ _tag: "PlayerNotFound" })
    await expect(
      Effect.runPromise(
        collectPayment(deps, {
          playerId: "nope",
          totalPaid: 1000,
          actor: "admin",
        })
      )
    ).rejects.toMatchObject({ _tag: "PlayerNotFound" })

    harness.cleanup()
  })
})

test("collecting a promo bill uses its discounted share even when another player has paid", async () => {
  const harness = await makeHarness()
  try {
    const deps = { db: harness.db }
    const players = await createExamplePlayers(deps)
    const structure = exampleStructure(players)
    structure.items = [
      {
        id: "promo",
        name: "Coffee",
        variantNotes: "",
        quantity: 1,
        unitPrice: 25001,
        lineTotal: 25001,
        bundleSize: 2,
        sortOrder: 0,
      },
    ]
    structure.billPlayers = structure.billPlayers.slice(0, 2)
    structure.allocations = structure.billPlayers.map((p) => ({
      itemId: "promo",
      billPlayerId: p.id,
      quantity: 1,
    }))
    structure.adjustments = []
    structure.header.sourceSubtotal = 25001
    structure.header.finalTotal = 25001
    const bill = await run(
      createFullBill(deps, structure.header, structure, fakeImage)
    )
    await run(publishBill(deps, bill.id))
    await run(
      recordPaidAmount(deps, {
        billPlayerId: structure.billPlayers[0].id,
        paidAmount: 12501,
        actor: "admin",
      })
    )
    const outstanding = await run(
      listOutstandingPayments(deps, structure.billPlayers[1].playerId)
    )
    expect(outstanding.totalOwed).toBe(12500)
    const collected = await run(
      collectPayment(deps, {
        playerId: structure.billPlayers[1].playerId,
        totalPaid: 13000,
        actor: "admin",
      })
    )
    expect(collected.totalOwed).toBe(12500)
    expect(collected.tip).toBe(500)
  } finally {
    harness.cleanup()
  }
})
