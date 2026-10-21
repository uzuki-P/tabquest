import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import { migrate } from "drizzle-orm/libsql/migrator"
import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"

/**
 * Opens the database. The url is any @libsql/client target: a Turso
 * database (libsql://...), a local file (file:./data/tabquest.db), or
 * :memory: for tests. Remote connections authenticate with a token; the
 * admin runtime uses a write token, the public runtime a read-only token,
 * so a compromised public process cannot mutate bill data.
 */
export async function openDatabase(
  url: string,
  options: { authToken?: string; readonly?: boolean } = {}
) {
  if (url.startsWith("file:")) {
    // libsql creates the database file but not its parent directory.
    mkdirSync(path.dirname(path.resolve(url.slice("file:".length))), {
      recursive: true,
    })
  }
  const client = createClient({
    url,
    authToken: options.authToken,
  })
  // Per-connection setting on writers. Turso classifies PRAGMA as a write,
  // so read-only tokens (the public runtime) must not attempt it — a
  // session that cannot write never triggers FK checks anyway.
  if (!options.readonly) {
    await client.execute("PRAGMA foreign_keys = ON")
  }
  const db = drizzle({ client })
  if (options.readonly) {
    // Drizzle implements libsql transactions as write-mode statement
    // batches, which Turso blocks for read-only tokens. The public runtime
    // only reads inside transactions (bill detail views), and a session
    // that cannot write has no atomicity to protect: run transaction
    // callbacks as plain reads against the base connection.
    const readonlyDb = db as Db & {
      transaction: <T>(callback: (tx: Tx) => T | Promise<T>) => Promise<T>
    }
    readonlyDb.transaction = async (callback) => callback(db as unknown as Tx)
  }
  return db
}

export type Db = Awaited<ReturnType<typeof openDatabase>>

/** Transaction handle for the async libsql driver, derived from the db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

/** Applies pending Drizzle Kit migrations from ./drizzle. */
export async function applyMigrations(db: Db): Promise<void> {
  // Resolved from cwd so the built server bundle finds the folder too.
  // `import.meta.dir` is only set when Bun executes the file directly; it is
  // undefined under vite's dev module runner, so guard before resolving.
  const candidates = [path.resolve(process.cwd(), "drizzle")]
  if (typeof import.meta.dir === "string") {
    candidates.push(path.resolve(import.meta.dir, "../../drizzle"))
  }
  const migrationsFolder = candidates.find((folder) => existsSync(folder))
  if (!migrationsFolder) {
    throw new Error(
      `Migrations folder not found: tried ${candidates.join(", ")}`
    )
  }
  await migrate(db, { migrationsFolder })
}
