import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { Effect } from "effect"

import { applyMigrations, openDatabase } from "@/db/client"
import type { Db } from "@/db/client"
import type { BillStructureInput } from "@/lib/bill-schema"
import { createPlayer } from "@/server/services/players"

export interface TestHarness {
  db: Db
  uploadDir: string
  cleanup: () => void
}

export async function makeHarness(): Promise<TestHarness> {
  const db = await openDatabase(":memory:")
  await applyMigrations(db)
  const uploadDir = mkdtempSync(path.join(tmpdir(), "tabquest-test-"))
  return {
    db,
    uploadDir,
    cleanup: () => {
      rmSync(uploadDir, { recursive: true, force: true })
    },
  }
}

export interface ExamplePlayers {
  raka: string
  sinta: string
  dewi: string
}

/**
 * Creates the three directory players the example structure links to. Every
 * bill player must represent a saved player, so tests that save structures
 * need these to exist first.
 */
export async function createExamplePlayers(deps: {
  db: Db
}): Promise<ExamplePlayers> {
  const mk = (name: string) =>
    Effect.runPromise(createPlayer({ db: deps.db }, { name }))
  const [raka, sinta, dewi] = await Promise.all([
    mk("Raka"),
    mk("Sinta"),
    mk("Dewi"),
  ])
  return { raka: raka.id, sinta: sinta.id, dewi: dewi.id }
}

export function exampleStructure(players: ExamplePlayers): BillStructureInput {
  return {
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
    billPlayers: [
      { id: "p-raka", alias: "Raka", playerId: players.raka, sortOrder: 0 },
      { id: "p-sinta", alias: "Sinta", playerId: players.sinta, sortOrder: 1 },
      { id: "p-dewi", alias: "Dewi", playerId: players.dewi, sortOrder: 2 },
    ],
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
}

export const fakeImage = {
  objectKey: `${crypto.randomUUID()}.webp`,
  mediaType: "image/webp",
  byteSize: 1234,
}
