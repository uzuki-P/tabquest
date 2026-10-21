/**
 * End-to-end smoke test for the acceptance checks that need real HTTP:
 * the production runner, the public runtime gate, the admin flow, and the
 * public bill pages. Uses a throwaway data directory and two server
 * processes built from the same bundle, mirroring the deployment design.
 *
 * Run with: bun test test/smoke.e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { cpSync, mkdirSync } from "node:fs"
import path from "node:path"

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

const PROJECT_ROOT = import.meta.dir + "/.."
const DATA_DIR = PROJECT_ROOT + "/.scratch/smoke-e2e"

let adminPort = 0
let publicPort = 0
let adminProc: Bun.Subprocess<"ignore", "ignore", "ignore"> | null = null
let publicProc: Bun.Subprocess<"ignore", "ignore", "ignore"> | null = null
/** Set by the full-flow test; the bill the restore check must still serve. */
let publishedPublicId = ""

async function waitForHealthy(port: number) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      if (response.status === 200) return
    } catch {
      // retry
    }
    await Bun.sleep(200)
  }
  throw new Error(`server on ${port} never became healthy`)
}

beforeAll(async () => {
  Bun.spawn(["rm", "-rf", DATA_DIR]).exited
  adminPort = 4101 + Math.floor(Math.random() * 500)
  publicPort = adminPort + 1

  const env = {
    ...process.env,
    TABQUEST_DATABASE_URL: `file:${DATA_DIR}/tabquest.db`,
    TABQUEST_UPLOAD_DIR: `${DATA_DIR}/uploads`,
  }
  adminProc = Bun.spawn(["bun", "run", "scripts/serve.ts"], {
    cwd: PROJECT_ROOT,
    env: {
      ...env,
      TABQUEST_RUNTIME: "admin",
      TABQUEST_PORT: String(adminPort),
      TABQUEST_HOST: "127.0.0.1",
    },
    stdout: "ignore",
    stderr: "ignore",
  })
  await waitForHealthy(adminPort)

  publicProc = Bun.spawn(["bun", "run", "scripts/serve.ts"], {
    cwd: PROJECT_ROOT,
    env: {
      ...env,
      TABQUEST_RUNTIME: "public",
      TABQUEST_PORT: String(publicPort),
      TABQUEST_HOST: "127.0.0.1",
    },
    stdout: "ignore",
    stderr: "ignore",
  })
  await waitForHealthy(publicPort)

  // Every bill player must represent a saved directory player.
  const roster = ["Raka", "Sinta", "Dewi"]
  const playerIds: Record<string, string> = {}
  for (const name of roster) {
    const response = await admin("/api/admin/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { player: { id: string } }
    playerIds[name.toLowerCase()] = body.player.id
  }
  STRUCTURE.billPlayers = roster.map((name, index) => ({
    id: `p-${name.toLowerCase()}`,
    alias: name,
    playerId: playerIds[name.toLowerCase()],
    sortOrder: index,
  }))
})

afterAll(() => {
  adminProc?.kill()
  publicProc?.kill()
})

function admin(urlPath: string, init?: RequestInit) {
  return fetch(`http://127.0.0.1:${adminPort}${urlPath}`, init)
}
function publicOrigin(urlPath: string, init?: RequestInit) {
  return fetch(`http://127.0.0.1:${publicPort}${urlPath}`, init)
}

const STRUCTURE = {
  header: {
    merchant: "Kopi Sudirman",
    title: "Friday drinks",
    orderDate: "2026-08-27",
    currency: "IDR",
    sourceSubtotal: 230000,
    finalTotal: 131000,
  },
  items: [
    {
      id: "item-tonic",
      name: "Cold Tonic",
      variantNotes: "Original",
      quantity: 3,
      unitPrice: 28000,
      lineTotal: 84000,
      sortOrder: 0,
    },
    {
      id: "item-croissant",
      name: "Butter Croissant",
      variantNotes: "",
      quantity: 2,
      unitPrice: 25000,
      lineTotal: 50000,
      sortOrder: 1,
    },
    {
      id: "item-flatwhite",
      name: "Flat White",
      variantNotes: "",
      quantity: 2,
      unitPrice: 22000,
      lineTotal: 44000,
      sortOrder: 2,
    },
    {
      id: "item-matcha",
      name: "Matcha Latte",
      variantNotes: "Iced",
      quantity: 1,
      unitPrice: 26000,
      lineTotal: 26000,
      sortOrder: 3,
    },
    {
      id: "item-nasgor",
      name: "Nasi Goreng Kampung",
      variantNotes: "",
      quantity: 1,
      unitPrice: 26000,
      lineTotal: 26000,
      sortOrder: 4,
    },
  ],
  adjustments: [
    {
      id: "adj-voucher",
      type: "discount",
      label: "Voucher GOFOODAUH28",
      amount: -103500,
      sortOrder: 0,
    },
    {
      id: "adj-delivery",
      type: "delivery",
      label: "Delivery fee",
      amount: 2000,
      sortOrder: 1,
    },
    {
      id: "adj-service",
      type: "service",
      label: "Service fee",
      amount: 2500,
      sortOrder: 2,
    },
  ],
  // Player IDs are filled in beforeAll, after the directory rows exist.
  billPlayers: [] as Array<{
    id: string
    alias: string
    playerId: string
    sortOrder: number
  }>,
  allocations: [
    { itemId: "item-tonic", billPlayerId: "p-raka", quantity: 2 },
    { itemId: "item-tonic", billPlayerId: "p-sinta", quantity: 1 },
    { itemId: "item-croissant", billPlayerId: "p-sinta", quantity: 1 },
    { itemId: "item-croissant", billPlayerId: "p-dewi", quantity: 1 },
    { itemId: "item-flatwhite", billPlayerId: "p-raka", quantity: 1 },
    { itemId: "item-flatwhite", billPlayerId: "p-dewi", quantity: 1 },
    { itemId: "item-matcha", billPlayerId: "p-sinta", quantity: 1 },
    { itemId: "item-nasgor", billPlayerId: "p-dewi", quantity: 1 },
  ],
}

describe("production runtimes", () => {
  test("public runtime returns 404 for every admin route, including encoded variants", async () => {
    for (const urlPath of [
      "/admin",
      "/admin/",
      "/admin/bills/new",
      "//admin",
      "/%61dmin",
      "/adm%69n",
      "/foo/../admin",
      "/api/admin/bills",
      "/api%2Fadmin%2Fbills",
      "/api/admin/bill-players/x/payment",
    ]) {
      const response = await publicOrigin(urlPath, { method: "POST" })
      expect([urlPath, response.status]).toEqual([urlPath, 404])
    }
    const get = await publicOrigin("/admin")
    expect(get.status).toBe(404)
  })

  test("admin runtime serves admin pages and the public home", async () => {
    const home = await admin("/")
    expect(home.status).toBe(200)
    const adminList = await admin("/admin")
    expect(adminList.status).toBe(200)
  })

  test("full admin flow: create, upload, save, publish, payment, public visibility", async () => {
    const png = Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0))
    const createForm = new FormData()
    createForm.set("merchant", "Kopi Sudirman")
    createForm.set("title", "Friday drinks")
    createForm.set("orderDate", "2026-08-27")
    createForm.set("billPlayerCount", "3")
    createForm.set("sourceSubtotal", "230000")
    createForm.set("finalTotal", "131000")
    createForm.set(
      "image",
      new File([png], "receipt.png", { type: "image/png" })
    )

    const created = await admin("/api/admin/bills", {
      method: "POST",
      body: createForm,
    })
    expect(created.status).toBe(201)
    const createdBody = (await created.json()) as {
      billId: string
      publicId: string
    }
    publishedPublicId = createdBody.publicId

    // Draft bill stays invisible on the public runtime: the page URL
    // serves the generic SPA shell (client-side 404), while the JSON API
    // and image endpoints still answer with real 404s.
    const draftPublic = await publicOrigin(`/b/${createdBody.publicId}`)
    expect(draftPublic.status).toBe(200)
    expect(await draftPublic.text()).not.toContain("Friday drinks")
    const draftApi = await publicOrigin(
      `/api/public/bills/${createdBody.publicId}`
    )
    expect(draftApi.status).toBe(404)
    const draftImage = await publicOrigin(
      `/api/public/bills/${createdBody.publicId}/image`
    )
    expect(draftImage.status).toBe(404)

    // Publish fails while allocations are incomplete.
    const badSave = await admin(`/api/admin/bills/${createdBody.billId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...STRUCTURE,
        allocations: STRUCTURE.allocations.slice(0, -1),
      }),
    })
    expect(badSave.status).toBe(200)
    const badPublish = await admin(
      `/api/admin/bills/${createdBody.billId}/publish`,
      { method: "POST" }
    )
    expect(badPublish.status).toBe(422)

    // Complete structure publishes.
    const save = await admin(`/api/admin/bills/${createdBody.billId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(STRUCTURE),
    })
    expect(save.status).toBe(200)
    const publish = await admin(
      `/api/admin/bills/${createdBody.billId}/publish`,
      { method: "POST" }
    )
    expect(publish.status).toBe(200)

    // Public JSON carries the exact reconciled totals.
    const summary = await publicOrigin(
      `/api/public/bills/${createdBody.publicId}`
    )
    expect(summary.status).toBe(200)
    const summaryBody = (await summary.json()) as {
      finalTotal: number
      billPlayers: Array<{ alias: string; total: number; paid: boolean }>
    }
    expect(summaryBody.finalTotal).toBe(131000)
    expect(
      Object.fromEntries(summaryBody.billPlayers.map((p) => [p.alias, p.total]))
    ).toEqual({
      Raka: 44426,
      Sinta: 44996,
      Dewi: 41578,
    })
    expect(summaryBody.billPlayers.every((p) => !p.paid)).toBe(true)

    // Public page and re-encoded image are visible after publishing.
    const publicPage = await publicOrigin(`/b/${createdBody.publicId}`)
    expect(publicPage.status).toBe(200)
    const image = await publicOrigin(
      `/api/public/bills/${createdBody.publicId}/image`
    )
    expect(image.status).toBe(200)
    expect(image.headers.get("content-type")).toBe("image/webp")
    expect(image.headers.get("x-content-type-options")).toBe("nosniff")

    // Payment change appears publicly.
    const markPaid = await admin("/api/admin/bill-players/p-raka/payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "paid" }),
    })
    expect(markPaid.status).toBe(200)
    const afterPaid = await publicOrigin(
      `/api/public/bills/${createdBody.publicId}`
    )
    const afterPaidBody = (await afterPaid.json()) as {
      billPlayers: Array<{ alias: string; paid: boolean }>
    }
    expect(
      afterPaidBody.billPlayers.find((p) => p.alias === "Raka")?.paid
    ).toBe(true)

    // Payment state only moves between unpaid and paid.
    const invalidState = await admin("/api/admin/bill-players/p-raka/payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "refund" }),
    })
    expect(invalidState.status).toBe(400)

    // Published bills are locked.
    const editAfterPublish = await admin(
      `/api/admin/bills/${createdBody.billId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(STRUCTURE),
      }
    )
    expect(editAfterPublish.status).toBe(409)

    // Date search is a client-side concern now: both queries return the
    // same generic shell, so the data assertions stay on the public JSON
    // API above and in the restore test below.
    const search = await publicOrigin("/?date=2026-08-27")
    expect(search.status).toBe(200)
    expect(await search.text()).not.toContain("Kopi Sudirman")
    const emptyDay = await publicOrigin("/?date=2026-01-01")
    expect(emptyDay.status).toBe(200)
  })

  test("rejects invalid image uploads through the API", async () => {
    const textFile = new File([new TextEncoder().encode("nope")], "x.txt", {
      type: "text/plain",
    })
    const createForm = new FormData()
    createForm.set("merchant", "Broken")
    createForm.set("orderDate", "2026-08-27")
    createForm.set("sourceSubtotal", "0")
    createForm.set("finalTotal", "0")
    createForm.set("image", textFile)
    const response = await admin("/api/admin/bills", {
      method: "POST",
      body: createForm,
    })
    expect(response.status).toBe(422)
  })

  test("create accepts the full structure in one request and publishes straight away", async () => {
    // Client ids are unique per bill, so prefix them to avoid clashing with
    // the ids the full-flow test already stored for its own bill.
    const prefix = <T extends { id: string }>(row: T): T => ({
      ...row,
      id: `os-${row.id}`,
    })
    const png = Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0))
    const createForm = new FormData()
    createForm.set("merchant", "Kopi Sudirman")
    createForm.set("title", "One-shot create")
    createForm.set("orderDate", "2026-08-27")
    createForm.set("sourceSubtotal", "230000")
    createForm.set("finalTotal", "131000")
    createForm.set(
      "structure",
      JSON.stringify({
        items: STRUCTURE.items.map(prefix),
        adjustments: STRUCTURE.adjustments.map(prefix),
        billPlayers: STRUCTURE.billPlayers.map(prefix),
        allocations: STRUCTURE.allocations.map((a) => ({
          itemId: `os-${a.itemId}`,
          billPlayerId: `os-${a.billPlayerId}`,
          quantity: a.quantity,
        })),
      })
    )
    createForm.set(
      "image",
      new File([png], "receipt.png", { type: "image/png" })
    )

    const created = await admin("/api/admin/bills", {
      method: "POST",
      body: createForm,
    })
    expect(created.status).toBe(201)
    const { billId, publicId } = (await created.json()) as {
      billId: string
      publicId: string
    }

    const publish = await admin(`/api/admin/bills/${billId}/publish`, {
      method: "POST",
    })
    expect(publish.status).toBe(200)

    const summary = await publicOrigin(`/api/public/bills/${publicId}`)
    expect(summary.status).toBe(200)
    const summaryBody = (await summary.json()) as {
      finalTotal: number
      billPlayers: Array<{ alias: string; total: number }>
    }
    expect(summaryBody.finalTotal).toBe(131000)
    expect(summaryBody.billPlayers).toHaveLength(3)
  })

  test("unpublish returns a bill to an editable draft and republishing keeps payment marks", async () => {
    const prefix = <T extends { id: string }>(row: T): T => ({
      ...row,
      id: `up-${row.id}`,
    })
    const png = Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0))
    const createForm = new FormData()
    createForm.set("merchant", "Kopi Sudirman")
    createForm.set("title", "Unpublish flow")
    createForm.set("orderDate", "2026-08-27")
    createForm.set("sourceSubtotal", "230000")
    createForm.set("finalTotal", "131000")
    createForm.set(
      "structure",
      JSON.stringify({
        items: STRUCTURE.items.map(prefix),
        adjustments: STRUCTURE.adjustments.map(prefix),
        billPlayers: STRUCTURE.billPlayers.map(prefix),
        allocations: STRUCTURE.allocations.map((a) => ({
          itemId: `up-${a.itemId}`,
          billPlayerId: `up-${a.billPlayerId}`,
          quantity: a.quantity,
        })),
      })
    )
    createForm.set(
      "image",
      new File([png], "receipt.png", { type: "image/png" })
    )

    const created = await admin("/api/admin/bills", {
      method: "POST",
      body: createForm,
    })
    expect(created.status).toBe(201)
    const { billId, publicId } = (await created.json()) as {
      billId: string
      publicId: string
    }

    const publish = await admin(`/api/admin/bills/${billId}/publish`, {
      method: "POST",
    })
    expect(publish.status).toBe(200)

    // A paid mark recorded while published...
    const markPaid = await admin("/api/admin/bill-players/up-p-raka/payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "paid" }),
    })
    expect(markPaid.status).toBe(200)

    // ...survives unpublish -> edit -> republish.
    const unpublish = await admin(`/api/admin/bills/${billId}/unpublish`, {
      method: "POST",
    })
    expect(unpublish.status).toBe(200)
    const unpublishedBody = (await unpublish.json()) as {
      bill: { status: string; publishedAt: string | null }
    }
    expect(unpublishedBody.bill.status).toBe("draft")
    expect(unpublishedBody.bill.publishedAt).toBe(null)

    // The public page stops serving the bill right away.
    const hiddenSummary = await publicOrigin(`/api/public/bills/${publicId}`)
    expect(hiddenSummary.status).toBe(404)

    // Back in draft, the structure is editable again.
    const edit = await admin(`/api/admin/bills/${billId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...STRUCTURE,
        header: { ...STRUCTURE.header, title: "Unpublish flow, edited" },
        items: STRUCTURE.items.map(prefix),
        adjustments: STRUCTURE.adjustments.map(prefix),
        billPlayers: STRUCTURE.billPlayers.map(prefix),
        allocations: STRUCTURE.allocations.map((a) => ({
          itemId: `up-${a.itemId}`,
          billPlayerId: `up-${a.billPlayerId}`,
          quantity: a.quantity,
        })),
      }),
    })
    expect(edit.status).toBe(200)

    // Unpublishing a draft is rejected.
    const unpublishDraft = await admin(`/api/admin/bills/${billId}/unpublish`, {
      method: "POST",
    })
    expect(unpublishDraft.status).toBe(409)

    const republish = await admin(`/api/admin/bills/${billId}/publish`, {
      method: "POST",
    })
    expect(republish.status).toBe(200)
    const summary = await publicOrigin(`/api/public/bills/${publicId}`)
    expect(summary.status).toBe(200)
    const summaryBody = (await summary.json()) as {
      title: string | null
      billPlayers: Array<{ alias: string; paid: boolean }>
    }
    expect(summaryBody.title).toBe("Unpublish flow, edited")
    expect(summaryBody.billPlayers.find((p) => p.alias === "Raka")?.paid).toBe(
      true
    )
  })

  test("create rejects a malformed structure payload", async () => {
    const createForm = new FormData()
    createForm.set("merchant", "Broken structure")
    createForm.set("orderDate", "2026-08-27")
    createForm.set("sourceSubtotal", "0")
    createForm.set("finalTotal", "0")
    createForm.set("structure", JSON.stringify({ items: "nope" }))
    const response = await admin("/api/admin/bills", {
      method: "POST",
      body: createForm,
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { issues?: string[] }
    expect(body.issues?.length).toBeGreaterThan(0)
  })

  test("public runtime rejects cross-site admin mutations via the admin port only", async () => {
    // The public port 404s anyway; the admin port enforces same-origin for mutations.
    const response = await admin("/api/admin/bills", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      body: new FormData(),
    })
    expect(response.status).toBe(403)
  })

  test("restored backup serves published bills on a clean instance", async () => {
    expect(publishedPublicId).not.toBe("")

    const restoreDir = `${DATA_DIR}-restore`
    await Bun.spawn(["rm", "-rf", restoreDir]).exited
    mkdirSync(path.join(restoreDir, "uploads"), { recursive: true })

    // VACUUM INTO snapshot: consistent while the live database keeps
    // serving writes, the same trick the Turso import replaces.
    const snapshotDb = new Database(path.join(DATA_DIR, "tabquest.db"), {
      readonly: true,
    })
    try {
      snapshotDb.run(`VACUUM INTO '${restoreDir}/tabquest.db'`)
    } finally {
      snapshotDb.close()
    }
    cpSync(path.join(DATA_DIR, "uploads"), path.join(restoreDir, "uploads"), {
      recursive: true,
    })

    const port = publicPort + 1
    const proc = Bun.spawn(["bun", "run", "scripts/serve.ts"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        TABQUEST_RUNTIME: "public",
        TABQUEST_HOST: "127.0.0.1",
        TABQUEST_PORT: String(port),
        TABQUEST_DATABASE_URL: `file:${restoreDir}/tabquest.db`,
        TABQUEST_UPLOAD_DIR: `${restoreDir}/uploads`,
      },
      stdout: "ignore",
      stderr: "ignore",
    })
    try {
      await waitForHealthy(port)

      // The published bill URL still resolves after the restore. The page
      // is the generic shell (SPA mode), so the restore check keeps its
      // teeth on the JSON and image endpoints below.
      const page = await fetch(
        `http://127.0.0.1:${port}/b/${publishedPublicId}`
      )
      expect(page.status).toBe(200)

      const summary = await fetch(
        `http://127.0.0.1:${port}/api/public/bills/${publishedPublicId}`
      )
      expect(summary.status).toBe(200)
      const body = (await summary.json()) as {
        merchant: string
        title: string | null
        finalTotal: number
        imageAvailable: boolean
        billPlayers: Array<{ alias: string }>
      }
      expect(body.merchant).toBe("Kopi Sudirman")
      expect(body.title).toBe("Friday drinks")
      expect(body.finalTotal).toBe(131000)
      expect(body.imageAvailable).toBe(true)
      expect(body.billPlayers).toHaveLength(3)

      const image = await fetch(
        `http://127.0.0.1:${port}/api/public/bills/${publishedPublicId}/image`
      )
      expect(image.status).toBe(200)
      expect(image.headers.get("content-type")).toBe("image/webp")
      expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0)
    } finally {
      proc.kill()
    }
  })
})
