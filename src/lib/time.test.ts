import { describe, expect, test } from "bun:test"

import {
  dateKeyToDate,
  dateToDateKey,
  formatDisplayDate,
  isValidDateString,
  jakartaDateFor,
  monthSpanKeys,
  shortMonthLabel,
} from "./time"

describe("jakartaDateFor", () => {
  // Asia/Jakarta is UTC+7 with no DST: the calendar day flips at 17:00 UTC.
  test("keeps the same Jakarta date before 17:00 UTC", () => {
    expect(jakartaDateFor("2026-08-27T16:59:59Z")).toBe("2026-08-27")
    expect(jakartaDateFor("2026-08-27T00:00:00Z")).toBe("2026-08-27")
  })

  test("rolls over to the next Jakarta date at exactly 17:00 UTC", () => {
    expect(jakartaDateFor("2026-08-27T17:00:00Z")).toBe("2026-08-28")
    expect(jakartaDateFor("2026-08-27T23:59:59Z")).toBe("2026-08-28")
  })

  test("handles month and year boundaries at the day flip", () => {
    expect(jakartaDateFor("2025-12-31T17:00:00Z")).toBe("2026-01-01")
    expect(jakartaDateFor("2026-02-28T17:00:00Z")).toBe("2026-03-01") // non-leap year
    expect(jakartaDateFor("2024-02-29T16:00:00Z")).toBe("2024-02-29") // leap day, still Feb 29 locally
  })

  test("matches Date objects as inputs", () => {
    expect(jakartaDateFor(new Date("2026-08-27T17:30:00Z"))).toBe("2026-08-28")
  })

  test("rejects invalid instants", () => {
    expect(() => jakartaDateFor("not-a-date")).toThrow()
  })
})

describe("isValidDateString", () => {
  test("accepts real calendar dates only", () => {
    expect(isValidDateString("2026-08-27")).toBe(true)
    expect(isValidDateString("2026-02-29")).toBe(false) // not a leap year
    expect(isValidDateString("2024-02-29")).toBe(true)
    expect(isValidDateString("2026-13-01")).toBe(false)
    expect(isValidDateString("2026-8-27")).toBe(false)
  })
})

describe("formatDisplayDate", () => {
  test("renders DDD, DD MMM YYYY with a zero-padded day", () => {
    expect(formatDisplayDate("2026-08-28")).toBe("Fri, 28 Aug 2026")
    expect(formatDisplayDate("2026-08-03")).toBe("Mon, 03 Aug 2026")
    expect(formatDisplayDate("2026-01-01")).toBe("Thu, 01 Jan 2026")
    expect(formatDisplayDate("2024-02-29")).toBe("Thu, 29 Feb 2024")
  })

  test("passes invalid values through unchanged", () => {
    expect(formatDisplayDate("2026-02-30")).toBe("2026-02-30")
    expect(formatDisplayDate("garbage")).toBe("garbage")
  })
})

describe("dateKeyToDate and dateToDateKey round-trip", () => {
  test("round-trips a calendar key through a local Date", () => {
    const date = dateKeyToDate("2026-08-28")
    expect(date).not.toBeNull()
    expect(dateToDateKey(date!)).toBe("2026-08-28")
    // Noon keeps the calendar day stable across DST shifts.
    expect(date!.getHours()).toBe(12)
  })

  test("returns null for invalid keys", () => {
    expect(dateKeyToDate("2026-02-30")).toBeNull()
    expect(dateKeyToDate("nope")).toBeNull()
  })

  test("round-trips year boundaries", () => {
    expect(dateToDateKey(dateKeyToDate("2026-01-01")!)).toBe("2026-01-01")
    expect(dateToDateKey(dateKeyToDate("2025-12-31")!)).toBe("2025-12-31")
  })
})

describe("shortMonthLabel", () => {
  test("renders a compact chart-axis label", () => {
    expect(shortMonthLabel("2026-03")).toBe("Mar '26")
  })

  test("passes malformed keys through unchanged", () => {
    expect(shortMonthLabel("garbage")).toBe("garbage")
  })
})

describe("monthSpanKeys", () => {
  test("spans months inclusively across a year boundary", () => {
    expect(monthSpanKeys("2025-11-15", "2026-02-03")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ])
  })

  test("a single-month span yields one key", () => {
    expect(monthSpanKeys("2026-08-01", "2026-08-31")).toEqual(["2026-08"])
  })

  test("inverted or invalid ranges yield nothing", () => {
    expect(monthSpanKeys("2026-08-01", "2026-07-01")).toEqual([])
    expect(monthSpanKeys("nope", "2026-07-01")).toEqual([])
  })
})
