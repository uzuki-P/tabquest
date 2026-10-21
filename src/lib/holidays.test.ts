import { describe, expect, test } from "bun:test"

import { getHoliday, isRedDay, isWeekend } from "./holidays"

describe("getHoliday", () => {
  test("finds national holidays", () => {
    expect(getHoliday("2026-08-17")).toEqual({
      date: "2026-08-17",
      name: "Hari Kemerdekaan Republik Indonesia",
      kind: "national",
    })
  })

  test("finds cuti bersama", () => {
    expect(getHoliday("2026-12-24")?.kind).toBe("cuti")
  })

  test("returns undefined for plain days", () => {
    expect(getHoliday("2026-08-28")).toBeUndefined()
  })
})

describe("isWeekend", () => {
  test("saturday and sunday are weekend", () => {
    expect(isWeekend("2026-08-29")).toBe(true) // Saturday
    expect(isWeekend("2026-08-30")).toBe(true) // Sunday
  })

  test("weekdays are not weekend", () => {
    expect(isWeekend("2026-08-28")).toBe(false) // Friday
    expect(isWeekend("2026-08-31")).toBe(false) // Monday
  })

  test("rejects invalid date keys", () => {
    expect(isWeekend("not-a-date")).toBe(false)
  })
})

describe("isRedDay", () => {
  test("holidays are red even on weekdays", () => {
    expect(isRedDay("2026-08-17")).toBe(true) // Monday, national holiday
    expect(isRedDay("2026-03-18")).toBe(true) // Wednesday, cuti bersama
  })

  test("weekends are red without a holiday entry", () => {
    expect(isRedDay("2026-08-29")).toBe(true)
  })

  test("plain weekdays are not red", () => {
    expect(isRedDay("2026-08-28")).toBe(false)
  })
})
