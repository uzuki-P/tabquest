import { and, eq, inArray, isNull, like } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import { Data, Effect } from "effect"

import { players, billPlayers } from "@/db/schema"
import type { PlayerRow } from "@/db/schema"
import type { PlayerCreateInput, PlayerUpdateInput } from "@/lib/player-schema"
import { nowUtcIso } from "@/lib/time"
import { newBillId, RepositoryError, tryDb } from "./bills"
import { refreshPlayerHoverSummaries } from "./insights"
import type { BillDeps } from "./bills"

export { RepositoryError }
export type PlayerDeps = BillDeps

export class PlayerNotFound extends Data.TaggedError("PlayerNotFound")<{
  playerId: string
}> {}
export class PlayerInUse extends Data.TaggedError("PlayerInUse")<{
  playerId: string
}> {}

export interface PlayerListOptions {
  q?: string
  includeArchived?: boolean
}

/** Absent input keeps the stored value; an empty string clears it. */
function mergeOptionalText(
  input: string | undefined,
  stored: string | null
): string | null {
  if (input === undefined) return stored
  return input === "" ? null : input
}

/**
 * Directory of recurring people. Archiving is always allowed; deleting is
 * blocked while any billPlayer row still references the player so bill
 * history keeps its attribution.
 */
export function createPlayer(
  deps: PlayerDeps,
  input: PlayerCreateInput
): Effect.Effect<PlayerRow, RepositoryError> {
  return tryDb(async () => {
    const now = nowUtcIso()
    const row: typeof players.$inferInsert = {
      id: newBillId(),
      name: input.name,
      note: mergeOptionalText(input.note, null),
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await deps.db.insert(players).values(row).run()
    return (await deps.db
      .select()
      .from(players)
      .where(eq(players.id, row.id))
      .get())!
  })
}

export function updatePlayer(
  deps: PlayerDeps,
  playerId: string,
  input: PlayerUpdateInput
): Effect.Effect<PlayerRow, PlayerNotFound | RepositoryError> {
  return Effect.gen(function* () {
    const existing = yield* tryDb(() =>
      deps.db.select().from(players).where(eq(players.id, playerId)).get()
    )
    if (!existing) return yield* new PlayerNotFound({ playerId })

    // PATCH semantics: absent fields keep their value, empty strings clear.
    const updated = yield* tryDb(() =>
      deps.db.transaction(async (tx) => {
        const result = await tx
          .update(players)
          .set({
            name: input.name,
            note: mergeOptionalText(input.note, existing.note),
            updatedAt: nowUtcIso(),
          })
          .where(eq(players.id, playerId))
          .run()
        if (
          result.rowsAffected > 0 &&
          input.name &&
          input.name !== existing.name
        )
          await refreshPlayerHoverSummaries(tx)
        return result
      })
    )
    if (updated.rowsAffected === 0) {
      return yield* new PlayerNotFound({ playerId })
    }
    return yield* tryDb(
      async () =>
        (await deps.db
          .select()
          .from(players)
          .where(eq(players.id, playerId))
          .get())!
    )
  })
}

export function archivePlayer(
  deps: PlayerDeps,
  playerId: string
): Effect.Effect<PlayerRow, PlayerNotFound | RepositoryError> {
  return setPlayerArchivedAt(deps, playerId, nowUtcIso())
}

export function restorePlayer(
  deps: PlayerDeps,
  playerId: string
): Effect.Effect<PlayerRow, PlayerNotFound | RepositoryError> {
  return setPlayerArchivedAt(deps, playerId, null)
}

function setPlayerArchivedAt(
  deps: PlayerDeps,
  playerId: string,
  archivedAt: string | null
): Effect.Effect<PlayerRow, PlayerNotFound | RepositoryError> {
  return Effect.gen(function* () {
    const updated = yield* tryDb(() =>
      deps.db
        .update(players)
        .set({ archivedAt, updatedAt: nowUtcIso() })
        .where(eq(players.id, playerId))
        .run()
    )
    if (updated.rowsAffected === 0) {
      return yield* new PlayerNotFound({ playerId })
    }
    return yield* tryDb(
      async () =>
        (await deps.db
          .select()
          .from(players)
          .where(eq(players.id, playerId))
          .get())!
    )
  })
}

/**
 * Hard delete, refused while billPlayers still reference the player.
 * The FK is ON DELETE SET NULL as a safety net, but the service guard keeps
 * historical bills attributed; the admin archives instead.
 */
export function deletePlayer(
  deps: PlayerDeps,
  playerId: string
): Effect.Effect<{ ok: true }, PlayerNotFound | PlayerInUse | RepositoryError> {
  return Effect.gen(function* () {
    const existing = yield* tryDb(() =>
      deps.db.select().from(players).where(eq(players.id, playerId)).get()
    )
    if (!existing) return yield* new PlayerNotFound({ playerId })

    const referencing = yield* tryDb(() =>
      deps.db
        .select({ id: billPlayers.id })
        .from(billPlayers)
        .where(eq(billPlayers.playerId, playerId))
        .all()
    )
    if (referencing.length > 0) {
      return yield* new PlayerInUse({ playerId })
    }

    yield* tryDb(() =>
      deps.db.delete(players).where(eq(players.id, playerId)).run()
    )
    return { ok: true as const }
  })
}

/**
 * Directory listing for the admin page and the bill-form picker. `q`
 * searches the name (SQLite LIKE is case-insensitive for ASCII);
 * archived rows stay hidden unless explicitly requested.
 */
export function listPlayers(
  deps: PlayerDeps,
  options: PlayerListOptions = {}
): Effect.Effect<PlayerRow[], RepositoryError> {
  return tryDb(async () => {
    const filters: SQL[] = []
    if (!options.includeArchived) filters.push(isNull(players.archivedAt))
    const q = options.q?.trim()
    if (q) {
      filters.push(like(players.name, `%${q}%`))
    }
    const where = filters.length > 0 ? and(...filters) : undefined
    const rows = where
      ? await deps.db.select().from(players).where(where).all()
      : await deps.db.select().from(players).all()
    return rows.sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt)
    )
  })
}

/** Counts billPlayer references per player, used by the directory. */
export function countPlayersReferenced(
  deps: PlayerDeps,
  playerIds: string[]
): Effect.Effect<Map<string, number>, RepositoryError> {
  return tryDb(async () => {
    if (playerIds.length === 0) return new Map<string, number>()
    const rows = await deps.db
      .select({ playerId: billPlayers.playerId })
      .from(billPlayers)
      .where(inArray(billPlayers.playerId, playerIds))
      .all()
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (row.playerId === null) continue
      counts.set(row.playerId, (counts.get(row.playerId) ?? 0) + 1)
    }
    return counts
  })
}
