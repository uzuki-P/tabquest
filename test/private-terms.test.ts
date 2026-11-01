// This repository is public. Tracked files must not name the private
// deployment or the people in it; see scripts/private-terms.ts.
import path from "node:path"
import { describe, expect, test } from "bun:test"

import { findPrivateTerms, loadTerms, matcher } from "../scripts/private-terms"

describe("private terms", () => {
  test("matches whole words in any case", () => {
    const pattern = matcher(["ana", "example.org"])
    expect("Paid by ANA, ana-2".match(pattern)).toEqual(["ANA", "ana"])
    expect("banana analysis".match(pattern)).toBeNull()
    expect("see https://example.org/b".match(pattern)).toEqual(["example.org"])
  })

  test("includes the built-in deployment names", () => {
    expect(
      loadTerms(path.resolve(import.meta.dir, "..")).length
    ).toBeGreaterThanOrEqual(2)
  })

  test("no tracked file contains a private term", () => {
    const root = path.resolve(import.meta.dir, "..")
    expect(findPrivateTerms(root)).toEqual([])
  })
})
