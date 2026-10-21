/**
 * Rupiah helpers. All money values are integer rupiah; anything outside the
 * safe integer range is rejected by the domain module.
 */

const MIN_SAFE = Number.MIN_SAFE_INTEGER
const MAX_SAFE = Number.MAX_SAFE_INTEGER

export function isSafeRupiah(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_SAFE &&
    value <= MAX_SAFE
  )
}

function groupDigits(digits: string): string {
  let out = ""
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += "."
    out += digits[i]
  }
  return out
}

/** Formats integer rupiah as `Rp230.000`, negative amounts as `-Rp103.500`. */
export function formatRupiah(value: number): string {
  if (!isSafeRupiah(value)) {
    throw new Error(`Not a safe integer rupiah value: ${value}`)
  }
  const sign = value < 0 ? "-" : ""
  return `${sign}Rp${groupDigits(String(Math.abs(value)))}`
}

/**
 * Normalizes money text as the user types: keeps an optional leading minus,
 * drops every non-digit, then groups the digits with commas so `1000000`
 * shows as `1,000,000`. Returns `"-"` when only a minus has been typed.
 */
export function formatAmountInput(input: string): string {
  const negative = input.trimStart().startsWith("-")
  const digits = input.replace(/\D/g, "").replace(/^0+(?=\d)/, "")
  if (digits === "") return negative ? "-" : ""
  let grouped = ""
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ","
    grouped += digits[i]
  }
  return negative ? `-${grouped}` : grouped
}

/**
 * Reads formatted money text back into a safe integer, ignoring the comma
 * grouping separators added by {@link formatAmountInput}. Empty or invalid
 * text yields null.
 */
export function parseAmountInput(
  value: string | null | undefined
): number | null {
  if (value === null || value === undefined || value.trim() === "") return null
  const cleaned = value.trim().replace(/[,\s]/g, "")
  if (!/^-?\d+$/.test(cleaned)) return null
  const parsed = Number(cleaned)
  return Number.isSafeInteger(parsed) ? parsed : null
}
