export {}

/**
 * Spawned by safari-temporal.test.ts to stand in for iOS Safari (JavaScriptCore
 * ships no Temporal global). Deleting the global must happen before any app
 * module is imported so the libs load exactly the way a Safari client loads
 * them.
 */
delete (globalThis as unknown as { Temporal?: unknown }).Temporal

const time = await import("../src/lib/time.ts")
const holidays = await import("../src/lib/holidays.ts")

const today = time.todayJakarta()
time.jakartaDateFor(new Date().toISOString())
if (!time.isValidDateString(today))
  throw new Error(`rejects a valid key: ${today}`)
if (time.isValidDateString("2026-02-30")) throw new Error("accepts 2026-02-30")
if (time.monthLabel(today) === "") throw new Error("empty month label")
time.formatDisplayDate(today)
time.dateKeyToDate(today)
time.dateToDateKey(new Date())
holidays.getHoliday("2026-01-01")
holidays.isWeekend(today)
holidays.isRedDay(today)

// routes/index.tsx and month-calendar.tsx touch the bare global directly while
// rendering, so the identifier must resolve after the libs have loaded.
const first = Temporal.PlainDate.from(today).with({ day: 1 })
if (first.day !== 1) throw new Error("PlainDate.with({ day: 1 }) failed")

console.log(`OK ${today}`)
