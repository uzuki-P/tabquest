import { createClient } from "@libsql/client"
import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { pullDatabase } from "./pull-from-turso"

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true })
})

test("copies schema, rows, blobs, and migration history into a new local database", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tabquest-db-pull-"))
  tempDirs.push(dir)
  const source = createClient({ url: `file:${path.join(dir, "source.db")}` })
  await source.execute(
    "CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL)"
  )
  await source.execute(
    "CREATE TABLE receipts (id TEXT PRIMARY KEY, player_id TEXT REFERENCES players(id), photo BLOB)"
  )
  await source.execute(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT)"
  )
  await source.execute(
    "CREATE INDEX receipts_player_idx ON receipts(player_id)"
  )
  await source.execute({
    sql: "INSERT INTO players VALUES (?, ?)",
    args: ["p1", "Raka"],
  })
  await source.execute({
    sql: "INSERT INTO receipts VALUES (?, ?, ?)",
    args: ["r1", "p1", new Uint8Array([1, 2, 3])],
  })
  await source.execute("INSERT INTO __drizzle_migrations VALUES (1, 'applied')")

  const destination = path.join(dir, "copy.db")
  await pullDatabase(source, destination)
  const copy = createClient({ url: `file:${destination}` })
  const players = await copy.execute("SELECT name FROM players")
  const receipts = await copy.execute("SELECT photo FROM receipts")
  const migrations = await copy.execute("SELECT hash FROM __drizzle_migrations")
  const index = await copy.execute(
    "SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'receipts_player_idx'"
  )
  expect(players.rows[0]?.name).toBe("Raka")
  expect(
    Array.from(new Uint8Array(receipts.rows[0]?.photo as ArrayBuffer))
  ).toEqual([1, 2, 3])
  expect(migrations.rows[0]?.hash).toBe("applied")
  expect(index.rows).toHaveLength(1)
  await expect(pullDatabase(source, destination)).rejects.toThrow(
    "Refusing to replace existing database"
  )
  copy.close()

  await source.execute("UPDATE players SET name = 'Dina' WHERE id = 'p1'")
  await pullDatabase(source, destination, { replace: true })
  const refreshed = createClient({ url: `file:${destination}` })
  expect(
    (await refreshed.execute("SELECT name FROM players")).rows[0]?.name
  ).toBe("Dina")
  refreshed.close()

  writeFileSync(`${destination}-wal`, "active")
  await expect(
    pullDatabase(source, destination, { replace: true })
  ).rejects.toThrow("Stop local database users")
  expect(existsSync(destination)).toBe(true)
  source.close()
})
