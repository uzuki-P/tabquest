import "./temporal"

export const JAKARTA = "Asia/Jakarta"

/** Current instant as a UTC ISO-8601 string, used for all event timestamps. */
export function nowUtcIso(): string {
  return new Date().toISOString()
}

/** Today's calendar date in Asia/Jakarta as YYYY-MM-DD. */
export function todayJakarta(): string {
  return Temporal.Now.zonedDateTimeISO(JAKARTA).toPlainDate().toString()
}

/**
 * Calendar date in Asia/Jakarta for a given instant (ISO string or Date).
 * Jakarta is UTC+7 with no DST, so days flip at 17:00 UTC the previous day;
 * date search keys are always derived through this conversion.
 */
export function jakartaDateFor(instant: string | Date): string {
  const epochMs =
    typeof instant === "string" ? Date.parse(instant) : instant.getTime()
  if (Number.isNaN(epochMs)) throw new Error(`Not a valid instant: ${instant}`)
  return Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO(JAKARTA)
    .toPlainDate()
    .toString()
}

/** Validates YYYY-MM-DD strings as real calendar dates. */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" })
    return true
  } catch {
    return false
  }
}

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

/** Renders a YYYY-MM-DD key as "August 2026". */
export function monthLabel(dateKey: string): string {
  const date = Temporal.PlainDate.from(dateKey)
  return `${MONTH_LONG[date.month - 1]} ${date.year}`
}

/**
 * Renders a YYYY-MM-DD key as "Fri, 28 Aug 2026". Timezone-free by design:
 * the key already names a calendar day. Values that fail validation pass
 * through unchanged so bad data stays visible instead of throwing mid-render.
 */
export function formatDisplayDate(value: string): string {
  if (!isValidDateString(value)) return value
  const date = Temporal.PlainDate.from(value)
  const weekday = WEEKDAY_SHORT[date.dayOfWeek - 1]
  const month = MONTH_SHORT[date.month - 1]
  const day = String(date.day).padStart(2, "0")
  return `${weekday}, ${day} ${month} ${date.year}`
}

/**
 * Parses a YYYY-MM-DD key into a Date at local noon. Noon keeps the calendar
 * day stable across DST shifts in the browser's timezone.
 */
export function dateKeyToDate(key: string): Date | null {
  if (!isValidDateString(key)) return null
  const [year, month, day] = key.split("-").map(Number)
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

/** Formats a Date as a YYYY-MM-DD key from its local calendar fields. */
export function dateToDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** Renders a YYYY-MM key as "Mar '26", for compact chart axes. */
export function shortMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-")
  const name = MONTH_SHORT[Number(month) - 1]
  if (!name || !year) return monthKey
  return `${name} '${year.slice(-2)}`
}

/**
 * Inclusive list of YYYY-MM keys spanning two YYYY-MM-DD keys. Used to give
 * every player analytics chart the same month axis. Invalid or inverted
 * ranges yield an empty span.
 */
export function monthSpanKeys(fromKey: string, toKey: string): string[] {
  if (!isValidDateString(fromKey) || !isValidDateString(toKey)) return []
  if (fromKey > toKey) return []
  let cursor = Temporal.PlainDate.from(fromKey).with({ day: 1 })
  const last = Temporal.PlainDate.from(toKey).with({ day: 1 })
  const keys: string[] = []
  while (Temporal.PlainDate.compare(cursor, last) <= 0) {
    keys.push(`${cursor.year}-${String(cursor.month).padStart(2, "0")}`)
    cursor = cursor.add({ months: 1 })
  }
  return keys
}
