/** 0.084 -> "8.4%", 0 -> "0%". */
export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1).replace(/\.0$/, "")}%`
}
