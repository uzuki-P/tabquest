import { isValidDateString } from "./time"

/**
 * Indonesian national holidays ("libur nasional") and collective leave
 * ("cuti bersama"), transcribed from https://kalenderku.id/ (2025 and 2026
 * lists). The government publishes the next year's SKB 3 Menteri near the
 * end of each year, so years without an entry simply render as plain days.
 */

export type HolidayKind = "national" | "cuti"

export interface HolidayEntry {
  /** YYYY-MM-DD order date key. */
  date: string
  name: string
  kind: HolidayKind
}

const HOLIDAYS: HolidayEntry[] = [
  // 2025 — 17 libur nasional + 10 cuti bersama
  { date: "2025-01-01", name: "Tahun Baru Masehi 2025", kind: "national" },
  {
    date: "2025-01-27",
    name: "Isra Mikraj Nabi Muhammad SAW",
    kind: "national",
  },
  {
    date: "2025-01-28",
    name: "Cuti Tahun Baru Imlek 2576 Kongzili",
    kind: "cuti",
  },
  {
    date: "2025-01-29",
    name: "Tahun Baru Imlek 2576 Kongzili",
    kind: "national",
  },
  {
    date: "2025-03-28",
    name: "Cuti Hari Suci Nyepi Tahun Baru Saka 1947",
    kind: "cuti",
  },
  {
    date: "2025-03-29",
    name: "Hari Suci Nyepi Tahun Baru Saka 1947",
    kind: "national",
  },
  {
    date: "2025-03-31",
    name: "Hari Raya Idulfitri 1446 Hijriah",
    kind: "national",
  },
  {
    date: "2025-04-01",
    name: "Hari Raya Idulfitri 1446 Hijriah",
    kind: "national",
  },
  {
    date: "2025-04-02",
    name: "Cuti Hari Raya Idulfitri 1446 Hijriah",
    kind: "cuti",
  },
  {
    date: "2025-04-03",
    name: "Cuti Hari Raya Idulfitri 1446 Hijriah",
    kind: "cuti",
  },
  {
    date: "2025-04-04",
    name: "Cuti Hari Raya Idulfitri 1446 Hijriah",
    kind: "cuti",
  },
  {
    date: "2025-04-07",
    name: "Cuti Hari Raya Idulfitri 1446 Hijriah",
    kind: "cuti",
  },
  { date: "2025-04-18", name: "Wafat Yesus Kristus", kind: "national" },
  { date: "2025-04-20", name: "Hari Paskah", kind: "national" },
  { date: "2025-05-01", name: "Hari Buruh Internasional", kind: "national" },
  { date: "2025-05-12", name: "Hari Raya Waisak 2569", kind: "national" },
  { date: "2025-05-13", name: "Cuti Hari Raya Waisak 2569", kind: "cuti" },
  { date: "2025-05-29", name: "Kenaikan Yesus Kristus", kind: "national" },
  { date: "2025-05-30", name: "Cuti Kenaikan Yesus Kristus", kind: "cuti" },
  { date: "2025-06-01", name: "Hari Lahir Pancasila", kind: "national" },
  {
    date: "2025-06-06",
    name: "Hari Raya Iduladha 1446 Hijriah",
    kind: "national",
  },
  {
    date: "2025-06-09",
    name: "Cuti Hari Raya Iduladha 1446 Hijriah",
    kind: "cuti",
  },
  {
    date: "2025-06-27",
    name: "Tahun Baru Islam 1447 Hijriah",
    kind: "national",
  },
  {
    date: "2025-08-17",
    name: "Hari Kemerdekaan Republik Indonesia",
    kind: "national",
  },
  { date: "2025-09-05", name: "Maulid Nabi Muhammad SAW", kind: "national" },
  { date: "2025-12-25", name: "Hari Raya Natal", kind: "national" },
  { date: "2025-12-26", name: "Cuti Hari Raya Natal", kind: "cuti" },

  // 2026 — 17 libur nasional + 8 cuti bersama
  { date: "2026-01-01", name: "Tahun Baru Masehi 2026", kind: "national" },
  {
    date: "2026-01-16",
    name: "Isra Mikraj Nabi Muhammad SAW",
    kind: "national",
  },
  {
    date: "2026-02-16",
    name: "Cuti Tahun Baru Imlek 2577 Kongzili",
    kind: "cuti",
  },
  {
    date: "2026-02-17",
    name: "Tahun Baru Imlek 2577 Kongzili",
    kind: "national",
  },
  {
    date: "2026-03-18",
    name: "Cuti Hari Suci Nyepi Tahun Baru Saka 1948",
    kind: "cuti",
  },
  {
    date: "2026-03-19",
    name: "Hari Suci Nyepi Tahun Baru Saka 1948",
    kind: "national",
  },
  {
    date: "2026-03-20",
    name: "Cuti Hari Raya Idulfitri 1447 Hijriah",
    kind: "cuti",
  },
  {
    date: "2026-03-21",
    name: "Hari Raya Idulfitri 1447 Hijriah",
    kind: "national",
  },
  {
    date: "2026-03-22",
    name: "Hari Raya Idulfitri 1447 Hijriah",
    kind: "national",
  },
  {
    date: "2026-03-23",
    name: "Cuti Hari Raya Idulfitri 1447 Hijriah",
    kind: "cuti",
  },
  {
    date: "2026-03-24",
    name: "Cuti Hari Raya Idulfitri 1447 Hijriah",
    kind: "cuti",
  },
  { date: "2026-04-03", name: "Wafat Yesus Kristus", kind: "national" },
  { date: "2026-04-05", name: "Hari Paskah", kind: "national" },
  { date: "2026-05-01", name: "Hari Buruh Internasional", kind: "national" },
  { date: "2026-05-14", name: "Kenaikan Yesus Kristus", kind: "national" },
  { date: "2026-05-15", name: "Cuti Kenaikan Yesus Kristus", kind: "cuti" },
  {
    date: "2026-05-27",
    name: "Hari Raya Iduladha 1447 Hijriah",
    kind: "national",
  },
  {
    date: "2026-05-28",
    name: "Cuti Hari Raya Iduladha 1447 Hijriah",
    kind: "cuti",
  },
  { date: "2026-05-31", name: "Hari Raya Waisak 2570", kind: "national" },
  { date: "2026-06-01", name: "Hari Lahir Pancasila", kind: "national" },
  {
    date: "2026-06-16",
    name: "Tahun Baru Islam 1448 Hijriah",
    kind: "national",
  },
  {
    date: "2026-08-17",
    name: "Hari Kemerdekaan Republik Indonesia",
    kind: "national",
  },
  { date: "2026-08-25", name: "Maulid Nabi Muhammad SAW", kind: "national" },
  { date: "2026-12-24", name: "Cuti Hari Raya Natal", kind: "cuti" },
  { date: "2026-12-25", name: "Hari Raya Natal", kind: "national" },
]

const holidayByDate = new Map(HOLIDAYS.map((entry) => [entry.date, entry]))

/** The libur nasional / cuti bersama on a date, if any. */
export function getHoliday(dateKey: string): HolidayEntry | undefined {
  return holidayByDate.get(dateKey)
}

/** Saturday or Sunday (Asia/Jakarta dates carry no DST, so weekday is stable). */
export function isWeekend(dateKey: string): boolean {
  if (!isValidDateString(dateKey)) return false
  return Temporal.PlainDate.from(dateKey).dayOfWeek >= 6
}

/**
 * A "tanggal merah" day: weekend, libur nasional, or cuti bersama. Drives
 * the red background on the public calendar.
 */
export function isRedDay(dateKey: string): boolean {
  return holidayByDate.has(dateKey) || isWeekend(dateKey)
}
