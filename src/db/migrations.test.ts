import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, test } from "bun:test"

/**
 * Guards against migrations that drop a table other tables cascade from.
 *
 * Drizzle's migrator runs inside a transaction, where SQLite ignores
 * `PRAGMA foreign_keys=OFF`. Dropping a parent table there fires every
 * child's `ON DELETE CASCADE` and erases the child rows. drizzle-kit emits
 * exactly that drop when it rebuilds a table, for example to change a foreign
 * key action. See docs/adr/0001-service-guard-for-player-delete.md.
 */

interface Migration {
  name: string
  sql: string
  /** Schema after this migration, as written by drizzle-kit. */
  snapshot: Snapshot
}

interface Snapshot {
  ddl: Array<{
    entityType: string
    table?: string
    tableTo?: string
    onDelete?: string
  }>
}

const DROP_TABLE = /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?/i

/** Maps each parent table to the child tables that cascade from it. */
function cascadeChildren(snapshot: Snapshot | undefined) {
  const children = new Map<string, Set<string>>()
  for (const entity of snapshot?.ddl ?? []) {
    if (entity.entityType !== "fks") continue
    if (entity.onDelete?.toUpperCase() !== "CASCADE") continue
    if (!entity.table || !entity.tableTo) continue
    if (entity.table === entity.tableTo) continue
    const set = children.get(entity.tableTo) ?? new Set<string>()
    set.add(entity.table)
    children.set(entity.tableTo, set)
  }
  return children
}

/**
 * Returns one message per statement that drops a table while another table
 * still cascades from it. The schema before each migration comes from the
 * previous migration's snapshot. Children dropped earlier in the same
 * migration no longer count.
 */
function findCascadingDrops(migrations: Migration[]): string[] {
  const problems: string[] = []
  migrations.forEach((migration, index) => {
    const children = cascadeChildren(migrations[index - 1]?.snapshot)
    const dropped = new Set<string>()
    for (const statement of migration.sql.split("--> statement-breakpoint")) {
      const table = DROP_TABLE.exec(statement)?.[1]
      if (!table) continue
      const live = [...(children.get(table) ?? [])].filter(
        (child) => !dropped.has(child)
      )
      if (live.length > 0) {
        problems.push(
          `${migration.name} drops \`${table}\`, which ${live.join(", ")} cascade from`
        )
      }
      dropped.add(table)
    }
  })
  return problems
}

function loadMigrations(folder: string): Migration[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(path.join(folder, name, "migration.sql"), "utf8"),
      snapshot: JSON.parse(
        readFileSync(path.join(folder, name, "snapshot.json"), "utf8")
      ) as Snapshot,
    }))
}

const parentWithCascadingChild: Snapshot = {
  ddl: [
    { entityType: "tables", table: "players" },
    { entityType: "tables", table: "payments" },
    {
      entityType: "fks",
      table: "payments",
      tableTo: "players",
      onDelete: "CASCADE",
    },
  ],
}

describe("findCascadingDrops", () => {
  test("flags a table rebuild of a cascade parent", () => {
    const rebuild = [
      "CREATE TABLE `__new_players` (`id` text PRIMARY KEY NOT NULL);",
      "INSERT INTO `__new_players`(`id`) SELECT `id` FROM `players`;",
      "DROP TABLE `players`;",
      "ALTER TABLE `__new_players` RENAME TO `players`;",
    ].join("--> statement-breakpoint\n")
    const problems = findCascadingDrops([
      { name: "0001_init", sql: "", snapshot: parentWithCascadingChild },
      {
        name: "0002_rebuild",
        sql: rebuild,
        snapshot: parentWithCascadingChild,
      },
    ])
    expect(problems).toEqual([
      "0002_rebuild drops `players`, which payments cascade from",
    ])
  })

  test("allows dropping a parent after its cascading children", () => {
    const sql = [
      "DROP TABLE IF EXISTS `payments`;",
      'DROP TABLE "players";',
    ].join("--> statement-breakpoint\n")
    const problems = findCascadingDrops([
      { name: "0001_init", sql: "", snapshot: parentWithCascadingChild },
      { name: "0002_drop", sql, snapshot: { ddl: [] } },
    ])
    expect(problems).toEqual([])
  })
})

test("no migration drops a table that other tables cascade from", () => {
  const migrations = loadMigrations(
    path.resolve(import.meta.dir, "../../drizzle")
  )
  expect(migrations.length).toBeGreaterThan(0)
  expect(findCascadingDrops(migrations)).toEqual([])
})
