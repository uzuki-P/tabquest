import { mkdirSync } from "node:fs"
import path from "node:path"

import { applyMigrations, openDatabase } from "@/db/client"
import type { Db } from "@/db/client"
import { playerHoverSummaries } from "@/db/schema"
import { refreshPlayerHoverSummaries } from "./services/insights"
import { loadEnv } from "./env"
import type { Env } from "./env"

export interface ServerContext {
  env: Env
  db: Db
  uploadDir: string
}

let cached: Promise<ServerContext> | null = null

/**
 * Process-wide server context. Opening the database is async (remote
 * connections run a PRAGMA handshake, migrations run over the wire), so
 * the first call starts creation and every caller awaits the same promise.
 * The public runtime connects with a read-only token; the admin runtime
 * applies pending migrations at startup.
 */
export function getServerContext(): Promise<ServerContext> {
  cached ??= createServerContext(loadEnv())
  return cached
}

export async function createServerContext(env: Env): Promise<ServerContext> {
  const db = await openDatabase(env.TABQUEST_DATABASE_URL, {
    authToken: env.TABQUEST_DATABASE_AUTH_TOKEN,
    readonly: env.TABQUEST_RUNTIME === "public",
  })
  if (env.TABQUEST_RUNTIME !== "public") {
    await applyMigrations(db)
    const existingSummary = await db
      .select({ playerId: playerHoverSummaries.playerId })
      .from(playerHoverSummaries)
      .limit(1)
      .get()
    if (!existingSummary) {
      await db.transaction((tx) => refreshPlayerHoverSummaries(tx))
    }
    mkdirSync(path.resolve(env.TABQUEST_UPLOAD_DIR), { recursive: true })
  }
  return { env, db, uploadDir: env.TABQUEST_UPLOAD_DIR }
}
