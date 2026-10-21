import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import {
  archivePlayer,
  createPlayer,
  deletePlayer,
  listPlayers,
  restorePlayer,
  updatePlayer,
} from "./players"
import { createFullBill } from "./bills"
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

describe("player service", () => {
  test("CRUD round-trip with archive and restore", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }

    const created = await run(
      createPlayer(deps, {
        name: "Bu Tari",
        note: "office",
      })
    )
    expect(created.name).toBe("Bu Tari")
    expect(created.archivedAt).toBe(null)

    const updated = await run(updatePlayer(deps, created.id, { name: "Tari" }))
    expect(updated.name).toBe("Tari")

    const archived = await run(archivePlayer(deps, created.id))
    expect(archived.archivedAt).toBeTruthy()
    // Archive hides from the default listing only; nothing is blocked.
    expect(await run(listPlayers(deps))).toEqual([])
    expect(
      (await run(listPlayers(deps, { includeArchived: true }))).map((c) => c.id)
    ).toEqual([created.id])

    const restored = await run(restorePlayer(deps, created.id))
    expect(restored.archivedAt).toBe(null)
    expect((await run(listPlayers(deps))).map((c) => c.id)).toEqual([
      created.id,
    ])

    const missing = await runExpectError(
      updatePlayer(deps, "nope", { name: "x" })
    )
    expect(missing).toMatchObject({ _tag: "PlayerNotFound" })
    harness.cleanup()
  })

  test("duplicate names are allowed and search matches the name", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }

    const first = await run(createPlayer(deps, { name: "Bu Tari" }))
    const second = await run(createPlayer(deps, { name: "Bu Tari" }))
    expect(second.id).not.toBe(first.id)
    expect(await run(listPlayers(deps))).toHaveLength(2)

    expect(
      (await run(listPlayers(deps, { q: "tari" }))).map((c) => c.id).sort()
    ).toEqual([first.id, second.id].sort())
    expect(await run(listPlayers(deps, { q: "nobody" }))).toEqual([])
    harness.cleanup()
  })

  test("delete is blocked while referenced and allowed afterwards", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }

    const trio = await createExamplePlayers(deps)
    const structure = exampleStructure(trio)
    const bill = await run(
      createFullBill(deps, structure.header, structure, fakeImage)
    )

    const inUse = await runExpectError(deletePlayer(deps, trio.raka))
    expect(inUse).toMatchObject({ _tag: "PlayerInUse" })

    // Removing the bill clears the referencing billPlayer rows.
    const raw = deps.db.$client
    await raw.execute({
      sql: "DELETE FROM bills WHERE id = ?",
      args: [bill.id],
    })
    await run(deletePlayer(deps, trio.raka))
    const remaining = await run(listPlayers(deps, { includeArchived: true }))
    expect(remaining.map((p) => p.id)).not.toContain(trio.raka)

    const missing = await runExpectError(deletePlayer(deps, trio.raka))
    expect(missing).toMatchObject({ _tag: "PlayerNotFound" })
    harness.cleanup()
  })

  test("raw player deletion nulls billPlayer links as the last resort", async () => {
    const harness = await makeHarness()
    const deps = { db: harness.db }

    const trio = await createExamplePlayers(deps)
    const structure = exampleStructure(trio)
    await run(createFullBill(deps, structure.header, structure, fakeImage))

    // The service guard refuses while referenced. Direct SQL bypasses it,
    // and the FK (ON DELETE SET NULL) keeps the bill rows alive, unlinking
    // instead of cascading away bill history.
    const raw = deps.db.$client
    await raw.execute({
      sql: "DELETE FROM players WHERE id = ?",
      args: [trio.raka],
    })

    const billCount = (await raw.execute("SELECT count(*) AS n FROM bills"))
      .rows[0] as unknown as { n: number }
    expect(billCount.n).toBe(1)
    const link = (
      await raw.execute(
        "SELECT player_id FROM bill_players WHERE id = 'p-raka'"
      )
    ).rows[0] as unknown as { player_id: string | null }
    expect(link.player_id).toBe(null)
    harness.cleanup()
  })
})
