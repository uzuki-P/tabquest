/**
 * Copy Turso into a new local SQLite file using SELECT queries only.
 * The source credential must be a read-only database token. No migration or
 * PRAGMA write is sent to Turso. The local file is staged and verified before
 * it receives its final name. --replace atomically refreshes an existing
 * destination after verification; stop dev servers before refreshing it.
 *
 * Usage: put TABQUEST_TURSO_URL and TABQUEST_TURSO_READONLY_TOKEN in
 *        .env.local for this worktree, then run this script with
 *        [--to ./data/tabquest-turso.db] [--replace].
 */

import { createClient } from "@libsql/client"
import type { Client, InValue } from "@libsql/client"
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
} from "node:fs"
import path from "node:path"
import { tursoReadonlyCredentials } from "./turso-readonly"

type SchemaObject = {
  type: "table" | "index" | "trigger" | "view"
  name: string
  sql: string
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

async function schemaObjects(source: Client): Promise<SchemaObject[]> {
  const result = await source.execute(
    `SELECT type, name, sql FROM sqlite_schema
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1
                        WHEN 'view' THEN 2 ELSE 3 END, name`
  )
  return result.rows.map((row) => ({
    type: String(row.type) as SchemaObject["type"],
    name: String(row.name),
    sql: String(row.sql),
  }))
}

export async function pullDatabase(
  source: Client,
  destination: string,
  options: { replace?: boolean } = {}
) {
  const targetFile = path.resolve(destination)
  if (existsSync(targetFile) && !options.replace) {
    throw new Error(`Refusing to replace existing database: ${targetFile}`)
  }
  if (
    options.replace &&
    ["-wal", "-shm", "-journal"].some((suffix) =>
      existsSync(`${targetFile}${suffix}`)
    )
  ) {
    throw new Error(
      `Stop local database users before refreshing: ${targetFile}`
    )
  }

  mkdirSync(path.dirname(targetFile), { recursive: true })
  const stagedFile = `${targetFile}.partial-${process.pid}`
  if (existsSync(stagedFile)) {
    throw new Error(`Staging path already exists: ${stagedFile}`)
  }

  closeSync(openSync(stagedFile, "wx", 0o600))
  const local = createClient({ url: `file:${stagedFile}` })
  try {
    await local.execute("PRAGMA journal_mode = DELETE")
    await local.execute("PRAGMA foreign_keys = OFF")
    const objects = await schemaObjects(source)
    const tables = objects.filter((object) => object.type === "table")
    if (tables.length === 0) throw new Error("Turso returned no tables.")

    for (const table of tables) await local.execute(table.sql)

    for (const table of tables) {
      const identifier = quoteIdentifier(table.name)
      const result = await source.execute(`SELECT * FROM ${identifier}`)
      const columns = result.columns
      if (columns.length > 0 && result.rows.length > 0) {
        const sql = `INSERT INTO ${identifier} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
        const batchSize = 100
        for (let start = 0; start < result.rows.length; start += batchSize) {
          const batch = result.rows
            .slice(start, start + batchSize)
            .map((row) => {
              const record = row as unknown as Record<string, InValue>
              return {
                sql,
                args: columns.map((column) => {
                  const value = record[column]
                  return value instanceof ArrayBuffer
                    ? new Uint8Array(value)
                    : (value ?? null)
                }),
              }
            })
          await local.batch(batch, "write")
        }
      }
      const localCount = await local.execute(
        `SELECT count(*) AS n FROM ${identifier}`
      )
      if (Number(localCount.rows[0]?.n ?? 0) !== result.rows.length) {
        throw new Error(`Row count mismatch for ${table.name}.`)
      }
      console.log(`[db-pull] ${table.name}: ${result.rows.length} rows`)
    }

    for (const object of objects.filter((item) => item.type !== "table")) {
      await local.execute(object.sql)
    }
    await local.execute("PRAGMA foreign_keys = ON")
    const foreignKeys = await local.execute("PRAGMA foreign_key_check")
    if (foreignKeys.rows.length > 0)
      throw new Error("Local foreign key check failed.")
    const integrity = await local.execute("PRAGMA integrity_check")
    if (integrity.rows[0]?.integrity_check !== "ok") {
      throw new Error("Local SQLite integrity check failed.")
    }

    local.close()
    if (
      ["-wal", "-shm", "-journal"].some((suffix) =>
        existsSync(`${stagedFile}${suffix}`)
      )
    ) {
      throw new Error("Staged SQLite file still has a journal sidecar.")
    }
    if (
      options.replace &&
      ["-wal", "-shm", "-journal"].some((suffix) =>
        existsSync(`${targetFile}${suffix}`)
      )
    ) {
      throw new Error(
        `Stop local database users before refreshing: ${targetFile}`
      )
    }
    chmodSync(stagedFile, 0o600)
    // A failed pull leaves the previous copy untouched. Same-directory rename
    // makes the verified replacement visible in one step.
    renameSync(stagedFile, targetFile)
    console.log(`[db-pull] verified local copy: ${targetFile}`)
  } catch (error) {
    local.close()
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      rmSync(`${stagedFile}${suffix}`, { force: true })
    }
    throw error
  }
}

if (import.meta.main) {
  const { url, authToken } = tursoReadonlyCredentials()
  const toIndex = process.argv.indexOf("--to")
  const destination =
    toIndex >= 0 ? process.argv[toIndex + 1] : "./data/tabquest-turso.db"
  if (!destination) throw new Error("--to needs a destination path.")
  const source = createClient({ url, authToken })
  try {
    await pullDatabase(source, destination, {
      replace: process.argv.includes("--replace"),
    })
  } finally {
    source.close()
  }
}
