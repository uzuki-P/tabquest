import { expect, test } from "bun:test"
import { join } from "node:path"

/**
 * Regression guard for the iOS Safari crash (`Can't find variable: Temporal`).
 * Runs the date libs in a fresh engine that has no Temporal global, mirroring
 * what every WebKit browser does with the client bundle.
 */
test("date libs load and run in an engine without Temporal (iOS Safari)", async () => {
  const proc = Bun.spawn(
    ["bun", join(import.meta.dir, "safari-temporal-fixture.ts")],
    { stdout: "pipe", stderr: "pipe" }
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (code !== 0) {
    throw new Error(`fixture exited ${code}:\n${stderr}`)
  }
  expect(stdout).toContain("OK")
})
