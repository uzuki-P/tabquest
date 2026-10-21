/**
 * One-time cutover: copies the local SQLite database into Turso.
 *
 * Applies pending Drizzle migrations to the target database, then copies
 * every user table row by row (the drizzle migrations journal is written
 * by the migrator, not copied). Foreign keys are disabled on the target
 * connection for the duration, so table order does not matter. Refuses to
 * run when the target already holds rows, so a double run cannot duplicate
 * data. Receipt images are not part of this: they ship with `just publish`.
 *
 * The target comes from TABQUEST_DATABASE_URL (+ TABQUEST_DATABASE_AUTH_TOKEN
 * for remote databases); the source defaults to ./data/tabquest.db.
 *
 * Usage: bun run scripts/import-to-turso.ts [--from ./data/tabquest.db]
 */

import { createClient } from "@libsql/client"
import type { Client, InValue } from "@libsql/client"
import { existsSync } from "node:fs"
import path from "node:path"

import { applyMigrations, openDatabase } from "../src/db/client"

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`
  for (const item of process.argv.slice(2)) {
    if (item.startsWith(prefix)) return item.slice(prefix.length)
  }
  const index = process.argv.indexOf(`--${name}`)
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1]
  return fallback
}

const targetUrl = process.env.TABQUEST_DATABASE_URL
if (!targetUrl) {
  console.error(
    "[import] TABQUEST_DATABASE_URL is not set; point it at the Turso database (libsql://...)."
  )
  process.exit(1)
}
const authToken = process.env.TABQUEST_DATABASE_AUTH_TOKEN

const fromArg = arg("from", "./data/tabquest.db")
const fromFile = path.resolve(process.cwd(), fromArg)
if (!existsSync(fromFile)) {
  console.error(`[import] source database not found: ${fromFile}`)
  process.exit(1)
}
if (targetUrl.startsWith("file:")) {
  const targetFile = path.resolve(
    process.cwd(),
    targetUrl.slice("file:".length)
  )
  if (targetFile === fromFile) {
    console.error("[import] refusing: source and target are the same file.")
    process.exit(1)
  }
}

const BATCH_ROWS = 100

async function main() {
  const source = createClient({ url: `file:${fromFile}` })
  const target = createClient({ url: targetUrl!, authToken })

  console.log(`[import] applying migrations to ${targetUrl}`)
  const db = await openDatabase(targetUrl!, { authToken })
  await applyMigrations(db)

  // Refuse to import into a database that already has data.
  const targetTables = await listUserTables(target)
  for (const table of targetTables) {
    const counted = await target.execute(`SELECT count(*) AS n FROM "${table}"`)
    const n = Number((counted.rows[0] as unknown as { n: number }).n)
    if (n > 0) {
      console.error(
        `[import] refusing: target table "${table}" already has ${n} row(s). ` +
          `Import runs into a fresh database only.`
      )
      process.exit(1)
    }
  }

  const tables = await listUserTables(source)
  console.log(`[import] tables: ${tables.join(", ")}`)

  // FK checks off for the copy; rows arrive in arbitrary table order.
  await target.execute("PRAGMA foreign_keys = OFF")

  for (const table of tables) {
    const sourceRows = await source.execute(`SELECT * FROM "${table}"`)
    if (sourceRows.columns.length === 0) continue
    const columns = sourceRows.columns
    const placeholders = `(${columns.map(() => "?").join(", ")})`
    const insert = `INSERT INTO "${table}" (${columns
      .map((c) => `"${c}"`)
      .join(", ")}) VALUES ${placeholders}`

    let copied = 0
    let batch: { sql: string; args: InValue[] }[] = []
    const flush = async () => {
      if (batch.length === 0) return
      await target.batch(batch, "write")
      copied += batch.length
      batch = []
    }

    for (const row of sourceRows.rows) {
      const record = row as unknown as Record<string, InValue>
      batch.push({
        sql: insert,
        args: columns.map((c) => record[c] ?? null),
      })
      if (batch.length >= BATCH_ROWS) await flush()
    }
    await flush()
    console.log(`[import] ${table}: ${copied} rows`)
  }

  await target.execute("PRAGMA foreign_keys = ON")

  // Verification: row counts must match per table.
  let failed = false
  for (const table of tables) {
    const a = await source.execute(`SELECT count(*) AS n FROM "${table}"`)
    const b = await target.execute(`SELECT count(*) AS n FROM "${table}"`)
    const sn = Number((a.rows[0] as unknown as { n: number }).n)
    const tn = Number((b.rows[0] as unknown as { n: number }).n)
    if (sn !== tn) {
      console.error(`[import] MISMATCH ${table}: source ${sn}, target ${tn}`)
      failed = true
    }
  }
  if (failed) process.exit(1)
  console.log(
    `[import] done and verified. Now point the runtimes at ${targetUrl}: the admin runtime with a write token, the public runtime with a read-only token.`
  )
  source.close()
  target.close()
}

async function listUserTables(client: Client): Promise<string[]> {
  const result = await client.execute(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name != '__drizzle_migrations'
     ORDER BY name`
  )
  return result.rows.map((row) => String(row.name))
}

await main()
