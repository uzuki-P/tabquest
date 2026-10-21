import { CrownIcon, HeartIcon } from "@phosphor-icons/react"

import { formatRupiah } from "@/domain/money"
import { monthLabel } from "@/lib/time"
import type { PlayerBadge } from "@/server/services/insights"

const FIRST_STICKER_MONTH = "2026-08"
const LAST_STICKER_MONTH = "2027-08"

export function PlayerBadges({
  badges,
  compact = false,
}: {
  badges: PlayerBadge[]
  compact?: boolean
}) {
  if (badges.length === 0)
    return (
      <p className="text-xs text-muted-foreground">No monthly badges yet.</p>
    )

  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((badge) => {
        const Icon = badge.kind === "spending" ? CrownIcon : HeartIcon
        const label = badge.kind === "spending" ? "Most spending" : "Most tips"
        const month = monthLabel(`${badge.monthKey}-01`)
        const detail = `${label} in ${month}: ${formatRupiah(badge.amount)}`
        const sticker =
          badge.monthKey >= FIRST_STICKER_MONTH &&
          badge.monthKey <= LAST_STICKER_MONTH
            ? `/stickers/player-badges/${badge.kind}-${badge.monthKey}`
            : null
        if (sticker) {
          return (
            <span key={`${badge.monthKey}-${badge.kind}`} title={detail}>
              <picture>
                <source srcSet={`${sticker}.webp`} type="image/webp" />
                <img
                  src={`${sticker}.png`}
                  alt={detail}
                  width={compact ? 96 : 160}
                  height={compact ? 96 : 160}
                  className={
                    compact
                      ? "size-24 object-contain"
                      : "size-40 object-contain"
                  }
                />
              </picture>
            </span>
          )
        }
        return (
          <div
            key={`${badge.monthKey}-${badge.kind}`}
            title={detail}
            className={`inline-flex items-center gap-2 border-2 px-2 py-1 ${badge.kind === "spending" ? "border-gold bg-gold/10 text-gold" : "border-success bg-success/10 text-success"}`}
          >
            <span
              className="flex h-10 w-9 shrink-0 flex-col items-center justify-center border border-current"
              aria-hidden
            >
              <Icon weight="fill" className="size-4" />
              <span className="font-mono text-[9px] font-black tracking-tight">
                {monthLabel(`${badge.monthKey}-01`).slice(0, 3).toUpperCase()}
              </span>
            </span>
            <span className="text-left">
              <span className="block font-mono text-[10px] font-bold uppercase">
                {label} · {monthLabel(`${badge.monthKey}-01`)}
              </span>
              {!compact && (
                <span className="block font-mono text-xs tabular-nums">
                  {formatRupiah(badge.amount)}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
