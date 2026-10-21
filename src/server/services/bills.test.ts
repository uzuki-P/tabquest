import type { InArgs } from "@libsql/client"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import {
  archiveBill,
  createBill,
  createFullBill,
  deleteBill,
  getBillDetail,
  getPublishedBill,
  getPublishedImage,
  listBillsAdmin,
  listPublishedByDate,
  listPublishedSummariesByDate,
  publishBill,
  replaceImage,
  saveStructure,
  unarchiveBill,
  unpublishBill,
} from "./bills"
import { setPaymentState } from "./payments"
import { createPlayer } from "./players"
import {
  createExamplePlayers,
  exampleStructure,
  fakeImage,
  makeHarness,
} from "../../../test/helpers"

async function run<T>(effect: Effect.Effect<T, any>): Promise<T> {
  return Effect.runPromise(effect)
}

async function runExpectError<TError>(
  effect: Effect.Effect<any, TError>
): Promise<TError> {
  try {
    await Effect.runPromise(effect)
  } catch (error) {
    return error as TError
  }
  throw new Error("expected a failure")
}

describe("bill service", () => {
  test("draft lifecycle: create, save structure, publish", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))

    const bill = await run(createBill(deps, structure.header, fakeImage))
    expect(bill.status).toBe("draft")
    expect(bill.publicId).toMatch(/[0-9a-f-]{36}/)

    const saved = await run(saveStructure(deps, bill.id, structure))
    expect(saved.sourceSubtotal).toBe(230000)

    const detail = await run(getBillDetail(deps, bill.id))
    expect(detail.split).not.toBeNull()
    expect(detail.split!.grandTotal).toBe(131000)

    const published = await run(publishBill(deps, bill.id))
    expect(published.status).toBe("published")
    expect(published.publishedAt).toBeTruthy()

    const afterPublish = await run(getBillDetail(deps, bill.id))
    expect(afterPublish.adjustmentAllocations).toHaveLength(9) // 3 adjustments x 3 billPlayers

    const voucherShares = Object.fromEntries(
      afterPublish.adjustmentAllocations
        .filter((a) => a.adjustmentId === "adj-voucher")
        .map((a) => [a.billPlayerId, a.signedAmount])
    )
    expect(voucherShares).toEqual({
      "p-raka": -35100,
      "p-sinta": -35550,
      "p-dewi": -32850,
    })

    const deliveryShares = Object.fromEntries(
      afterPublish.adjustmentAllocations
        .filter((a) => a.adjustmentId === "adj-delivery")
        .map((a) => [a.billPlayerId, a.signedAmount])
    )
    expect(deliveryShares).toEqual({
      "p-raka": 678,
      "p-sinta": 687,
      "p-dewi": 635,
    })

    expect(afterPublish.paymentStatuses).toHaveLength(3)
    expect(
      afterPublish.paymentStatuses.every((s) => s.status === "unpaid")
    ).toBe(true)

    harness.cleanup()
  })

  test("createFullBill persists items, adjustments, billPlayers, and allocations in one shot", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))

    const bill = await run(
      createFullBill(deps, structure.header, structure, fakeImage)
    )
    expect(bill.status).toBe("draft")
    expect(bill.imageObjectKey).toBe(fakeImage.objectKey)

    const detail = await run(getBillDetail(deps, bill.id))
    expect(detail.items).toHaveLength(5)
    expect(detail.adjustments).toHaveLength(3)
    expect(detail.billPlayers.map((p) => p.alias)).toEqual([
      "Raka",
      "Sinta",
      "Dewi",
    ])
    expect(detail.allocations).toHaveLength(8)
    expect(detail.split).not.toBeNull()
    expect(detail.split!.grandTotal).toBe(131000)

    const published = await run(publishBill(deps, bill.id))
    expect(published.status).toBe("published")
    harness.cleanup()
  })

  test("publish fails without an image", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const bill = await run(createBill(deps, structure.header, null))
    await run(saveStructure(deps, bill.id, structure))

    const error = await runExpectError(publishBill(deps, bill.id))
    expect(error).toMatchObject({ _tag: "MissingBillImage" })
    harness.cleanup()
  })

  test("publish fails with allocation errors and reports every issue", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    structure.allocations = structure.allocations.slice(0, -1)
    const bill = await run(createBill(deps, structure.header, fakeImage))
    await run(saveStructure(deps, bill.id, structure))

    const detail = await run(getBillDetail(deps, bill.id))
    expect(detail.split).toBeNull()
    expect(detail.splitIssues.map((i) => i.code)).toContain(
      "item-quantity-mismatch"
    )

    const error = await runExpectError(publishBill(deps, bill.id))
    expect(error).toMatchObject({ _tag: "SplitReconciliationFailed" })
    harness.cleanup()
  })

  test("drafts can be resaved and replace their whole structure", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const bill = await run(createBill(deps, structure.header, fakeImage))

    const partial = exampleStructure(await createExamplePlayers(deps))
    partial.items = partial.items.slice(0, 2)
    partial.allocations = []
    await run(saveStructure(deps, bill.id, partial))
    let detail = await run(getBillDetail(deps, bill.id))
    expect(detail.items).toHaveLength(2)

    await run(saveStructure(deps, bill.id, structure))
    detail = await run(getBillDetail(deps, bill.id))
    expect(detail.items).toHaveLength(5)
    expect(detail.allocations).toHaveLength(8)
    expect(detail.split).not.toBeNull()
    harness.cleanup()
  })

  test("published bills reject further edits", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const bill = await run(createBill(deps, structure.header, fakeImage))
    await run(saveStructure(deps, bill.id, structure))
    await run(publishBill(deps, bill.id))

    const error = await runExpectError(saveStructure(deps, bill.id, structure))
    expect(error).toMatchObject({ _tag: "BillAlreadyPublished" })
    harness.cleanup()
  })

  test("unpublish reverts to an editable draft and keeps payment marks", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const bill = await run(createBill(deps, structure.header, fakeImage))
    await run(saveStructure(deps, bill.id, structure))
    await run(publishBill(deps, bill.id))
    await run(
      setPaymentState(
        { db: harness.db },
        {
          billPlayerId: "p-raka",
          state: "paid",
          actor: "test",
        }
      )
    )

    const unpublished = await run(unpublishBill(deps, bill.id))
    expect(unpublished.status).toBe("draft")
    expect(unpublished.publishedAt).toBe(null)

    const detail = await run(getBillDetail(deps, bill.id))
    expect(detail.adjustmentAllocations).toHaveLength(0)
    expect(
      detail.paymentStatuses.find((s) => s.billPlayerId === "p-raka")?.status
    ).toBe("paid")

    // Draft again: structure edits and republish both work.
    const edited = exampleStructure(await createExamplePlayers(deps))
    edited.header.title = "Edited after unpublish"
    const saved = await run(saveStructure(deps, bill.id, edited))
    expect(saved.title).toBe("Edited after unpublish")

    // Unpublishing a draft is rejected.
    const draftError = await runExpectError(unpublishBill(deps, bill.id))
    expect(draftError).toMatchObject({ _tag: "BillNotPublished" })

    const republished = await run(publishBill(deps, bill.id))
    expect(republished.status).toBe("published")

    const view = await run(getPublishedBill(deps, bill.publicId))
    expect(view.billPlayers.find((p) => p.alias === "Raka")?.paid).toBe(true)

    const missingError = await runExpectError(
      unpublishBill(deps, crypto.randomUUID())
    )
    expect(missingError).toMatchObject({ _tag: "BillNotFound" })
    harness.cleanup()
  })

  test("images can be replaced while drafting", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const bill = await run(createBill(deps, structure.header, null))
    const updated = await run(replaceImage(deps, bill.id, fakeImage))
    expect(updated.imageObjectKey).toBe(fakeImage.objectKey)
    expect(updated.imageMediaType).toBe("image/webp")
    harness.cleanup()
  })

  test("date search lists only published bills for the Jakarta date", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const draft = await run(createBill(deps, structure.header, fakeImage))
    const other = {
      ...structure,
      header: { ...structure.header, orderDate: "2026-08-26" },
    }
    const published = await run(createBill(deps, other.header, fakeImage))
    await run(saveStructure(deps, published.id, other))
    await run(publishBill(deps, published.id))

    const matches = await run(listPublishedByDate(deps, "2026-08-26"))
    expect(matches.map((b) => b.id)).toEqual([published.id])
    expect(await run(listPublishedByDate(deps, "2026-08-27"))).toEqual([])
    expect((await run(listBillsAdmin(deps))).map((b) => b.id).sort()).toEqual(
      [draft.id, published.id].sort()
    )
    harness.cleanup()
  })

  test("date summaries add item, billPlayer, and paid counts", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const bill = await run(createBill(deps, structure.header, fakeImage))
    await run(saveStructure(deps, bill.id, structure))
    await run(publishBill(deps, bill.id))
    await run(
      setPaymentState(
        { db: harness.db },
        {
          billPlayerId: "p-raka",
          state: "paid",
          actor: "test",
        }
      )
    )

    const summaries = await run(
      listPublishedSummariesByDate(deps, "2026-08-27")
    )
    expect(summaries).toHaveLength(1)
    const summary = summaries[0]
    expect(summary.publicId).toBe(bill.publicId)
    expect(summary.merchant).toBe("Kopi Sudirman")
    expect(summary.itemCount).toBe(5)
    expect(summary.billPlayerCount).toBe(3)
    expect(summary.paidCount).toBe(1)
    expect(summary.imageAvailable).toBe(true)
    expect(summary.finalTotal).toBe(131000)

    expect(await run(listPublishedSummariesByDate(deps, "2026-08-26"))).toEqual(
      []
    )
    harness.cleanup()
  })

  test("public view exposes aliases, shares, and payment state only", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const bill = await run(createBill(deps, structure.header, fakeImage))
    await run(saveStructure(deps, bill.id, structure))
    await run(publishBill(deps, bill.id))

    const view = await run(getPublishedBill(deps, bill.publicId))
    expect(view.merchant).toBe("Kopi Sudirman")
    expect(view.finalTotal).toBe(131000)
    const totals = Object.fromEntries(
      view.billPlayers.map((p) => [p.alias, p.total])
    )
    expect(totals).toEqual({ Raka: 44426, Sinta: 44996, Dewi: 41578 })
    expect(view.billPlayers.every((p) => p.paid === false)).toBe(true)
    expect(view.imageAvailable).toBe(true)

    const image = await run(getPublishedImage(deps, bill.publicId))
    expect(image.objectKey).toBe(fakeImage.objectKey)

    const error = await runExpectError(
      getPublishedBill(deps, crypto.randomUUID())
    )
    expect(error).toMatchObject({ _tag: "PublicBillNotFound" })
    harness.cleanup()
  })

  test("archive and unarchive move bills between admin filters", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const draft = await run(createBill(deps, structure.header, fakeImage))
    const published = await run(createBill(deps, otherMonthHeader(), fakeImage))
    await run(saveStructure(deps, published.id, structure))
    await run(publishBill(deps, published.id))

    await run(archiveBill(deps, draft.id))
    const archivedDraft = await run(getBillDetail(deps, draft.id))
    expect(archivedDraft.bill.archivedAt).toBeTruthy()
    expect(archivedDraft.bill.status).toBe("draft")

    expect((await run(listBillsAdmin(deps))).map((b) => b.id)).toEqual([
      published.id,
    ])
    expect(
      (await run(listBillsAdmin(deps, "archived"))).map((b) => b.id)
    ).toEqual([draft.id])
    expect(
      (await run(listBillsAdmin(deps, "all"))).map((b) => b.id).sort()
    ).toEqual([draft.id, published.id].sort())

    const restored = await run(unarchiveBill(deps, draft.id))
    expect(restored.archivedAt).toBe(null)
    expect((await run(listBillsAdmin(deps))).map((b) => b.id).sort()).toEqual(
      [draft.id, published.id].sort()
    )

    const missing = await runExpectError(archiveBill(deps, "nope"))
    expect(missing).toMatchObject({ _tag: "BillNotFound" })
    harness.cleanup()
  })

  test("archived published bills leave public listings but keep their page", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const bill = await run(createBill(deps, structure.header, fakeImage))
    await run(saveStructure(deps, bill.id, structure))
    await run(publishBill(deps, bill.id))
    await run(archiveBill(deps, bill.id))

    // Date-search listings hide it...
    expect(await run(listPublishedByDate(deps, "2026-08-27"))).toEqual([])
    expect(await run(listPublishedSummariesByDate(deps, "2026-08-27"))).toEqual(
      []
    )

    // ...but the public page still renders, flagged as archived.
    const view = await run(getPublishedBill(deps, bill.publicId))
    expect(view.archived).toBe(true)
    expect(view.finalTotal).toBe(131000)
    const image = await run(getPublishedImage(deps, bill.publicId))
    expect(image.objectKey).toBe(fakeImage.objectKey)
    harness.cleanup()
  })

  test("deleteBill removes a draft, cascades rows, and removes the image", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db, uploadDir: harness.uploadDir }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const imageKey = `${crypto.randomUUID()}.webp`
    await Bun.write(`${harness.uploadDir}/${imageKey}`, "fake image bytes")
    const bill = await run(
      createBill(deps, structure.header, { ...fakeImage, objectKey: imageKey })
    )
    await run(saveStructure(deps, bill.id, structure))
    await run(publishBill(deps, bill.id))
    await run(unpublishBill(deps, bill.id))

    const result = await run(deleteBill(deps, bill.id))
    expect(result.ok).toBe(true)

    const raw = deps.db.$client
    const countRows = async (sql: string, args: InArgs = []) => {
      const counted = await raw.execute({ sql, args })
      return (counted.rows[0] as unknown as { n: number }).n
    }
    expect(
      await countRows("SELECT count(*) AS n FROM bills WHERE id = ?", [bill.id])
    ).toBe(0)
    expect(await countRows("SELECT count(*) AS n FROM bill_players")).toBe(0)
    expect(await countRows("SELECT count(*) AS n FROM items")).toBe(0)
    expect(await countRows("SELECT count(*) AS n FROM item_allocations")).toBe(
      0
    )
    expect(await countRows("SELECT count(*) AS n FROM adjustments")).toBe(0)
    expect(
      await countRows("SELECT count(*) AS n FROM adjustment_allocations")
    ).toBe(0)
    expect(await countRows("SELECT count(*) AS n FROM payment_statuses")).toBe(
      0
    )
    expect(await Bun.file(`${harness.uploadDir}/${imageKey}`).exists()).toBe(
      false
    )

    const gone = await runExpectError(deleteBill(deps, bill.id))
    expect(gone).toMatchObject({ _tag: "BillNotFound" })
    harness.cleanup()
  })

  test("deleteBill rejects published bills so payment history is safe", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const structure = exampleStructure(await createExamplePlayers(deps))
    const bill = await run(createBill(deps, structure.header, fakeImage))
    await run(saveStructure(deps, bill.id, structure))
    await run(publishBill(deps, bill.id))

    const error = await runExpectError(deleteBill(deps, bill.id))
    expect(error).toMatchObject({ _tag: "BillStillPublished" })

    const detail = await run(getBillDetail(deps, bill.id))
    expect(detail.bill.status).toBe("published")
    expect(detail.paymentStatuses).toHaveLength(3)
    harness.cleanup()
  })

  test("billPlayers keep their player link and unknown links fail", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const player = await run(createPlayer(deps, { name: "Bu Tari" }))
    const structure = exampleStructure(await createExamplePlayers(deps))
    structure.billPlayers[0].playerId = player.id

    const bill = await run(createBill(deps, structure.header, fakeImage))
    await run(saveStructure(deps, bill.id, structure))
    const detail = await run(getBillDetail(deps, bill.id))
    const raka = detail.billPlayers.find((p) => p.alias === "Raka")!
    expect(raka.playerId).toBe(player.id)
    expect(
      detail.billPlayers.find((p) => p.alias === "Sinta")!.playerId
    ).not.toBeNull()

    const bad = exampleStructure(await createExamplePlayers(deps))
    bad.billPlayers[1].playerId = "missing-player"
    const error = await runExpectError(saveStructure(deps, bill.id, bad))
    expect(error).toMatchObject({
      _tag: "UnknownPlayer",
      playerId: "missing-player",
    })
    harness.cleanup()
  })
})

function otherMonthHeader() {
  const structure = exampleStructure({
    raka: "unused",
    sinta: "unused",
    dewi: "unused",
  })
  return { ...structure.header, orderDate: "2026-07-04" }
}

describe("getPublishedBill billPlayer links", () => {
  test("carries the directory link; legacy null links still render", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }
    const trio = await createExamplePlayers(deps)
    const structure = exampleStructure(trio)
    const bill = await run(createBill(deps, structure.header, fakeImage))
    await run(saveStructure(deps, bill.id, structure))
    await run(publishBill(deps, bill.id))

    const view = await run(getPublishedBill(deps, bill.publicId))
    expect(view.billPlayers.find((p) => p.alias === "Raka")?.playerId).toBe(
      trio.raka
    )
    expect(view.billPlayers.find((p) => p.alias === "Sinta")?.playerId).toBe(
      trio.sinta
    )

    // Rows from before the link was required still render, unlinked.
    const raw = deps.db.$client
    await raw.execute(
      "UPDATE bill_players SET player_id = NULL WHERE id = 'p-sinta'"
    )
    const legacy = await run(getPublishedBill(deps, bill.publicId))
    expect(legacy.billPlayers.find((p) => p.alias === "Sinta")?.playerId).toBe(
      null
    )
    harness.cleanup()
  })
})

test("buy 1 get 1 survives saving and publishing with exact public item amounts", async () => {
  const harness = await makeHarness()
  try {
    const deps = { db: harness.db }
    const playerIds = await createExamplePlayers(deps)
    const structure = exampleStructure(playerIds)
    structure.items = [
      {
        id: "promo",
        name: "Coffee",
        variantNotes: "Iced",
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
    const bill = await run(createBill(deps, structure.header, fakeImage))
    await run(saveStructure(deps, bill.id, structure))
    const detail = await run(getBillDetail(deps, bill.id))
    expect(detail.items[0].bundleSize).toBe(2)
    expect(detail.items[0].unitPrice).toBe(25001)
    await run(publishBill(deps, bill.id))
    const publicBill = await run(getPublishedBill(deps, bill.publicId))
    expect(publicBill.billPlayers.map((p) => p.itemLines[0].amount)).toEqual([
      12501, 12500,
    ])
    expect(publicBill.billPlayers.map((p) => p.total)).toEqual([12501, 12500])
  } finally {
    harness.cleanup()
  }
})
