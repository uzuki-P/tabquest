import { Link } from "@tanstack/react-router"
import {
  CrownIcon,
  HandCoinsIcon,
  HeartIcon,
  MedalIcon,
} from "@phosphor-icons/react"
import { motion, useReducedMotion } from "motion/react"

import { delayStyle } from "@/components/arena"
import { PersonAvatar } from "@/components/person-avatar"
import { PlayerHoverLink } from "@/components/player-hover-link"
import { formatRupiah } from "@/domain/money"
import { monthLabel } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { MonthlyTips, TipRow } from "@/server/services/insights"

/** Formats a net tip with its sign, since shorts now pull players down. */
function signedRupiah(value: number): string {
  return value < 0 ? formatRupiah(value) : `+${formatRupiah(value)}`
}

/**
 * The public tip wall, in the arena frame the home board set: ink
 * rules, slab shadows, mono micro-labels. The month's top tipper takes the
 * inverted ink band (the same treatment as the home tip jar) with drifting
 * hearts, medals go to #2 and #3, and the rest of the field lines up as
 * ink-ruled rows. Every ranked person links to their public profile.
 *
 * Rows come from listMonthlyTips, so only payments the admin recorded
 * as actually paid count. Net tips rank, shorts included: paying short
 * pulls a player down the wall.
 */
export interface TipBoardProps {
  /** The month being rendered, as YYYY-MM. Null when nothing is published. */
  monthKey: string | null
  /** Months that have published bills, ascending. */
  monthKeys: string[]
  board: MonthlyTips
}

export function TipBoard({ monthKey, monthKeys, board }: TipBoardProps) {
  const rows = board.rows
  // Players who never missed the split take no rank slot; everyone else
  // ranks by net tips, negative nets included.
  const ranked = rows.filter((row) => row.tipTotal !== 0 || row.tipCount !== 0)
  const exactCount = rows.reduce(
    (sum, row) => sum + (row.paymentCount - row.tipCount),
    0
  )

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 md:py-10">
      <header className="arena-rise">
        <div className="flex items-center justify-between gap-3 border-b-2 border-arena-line pb-2">
          <h1 className="font-heading text-2xl font-black tracking-tight uppercase md:text-3xl">
            {monthKey
              ? `${monthLabel(`${monthKey}-01`)}’s most generous`
              : "Tips"}
          </h1>
          <HandCoinsIcon
            weight="fill"
            className="size-6 shrink-0 text-arena-accent"
            aria-hidden
          />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Some people hand over more than their split and wave off the change.
        </p>
        <p className="mt-1 font-heading text-base font-black text-arena-accent uppercase">
          Terima Kasih Orang Baik
        </p>
        {board.recordedCount > 0 && (
          <p className="mt-1.5 font-mono text-xs tracking-[0.14em] text-foreground/70 uppercase tabular-nums">
            {formatRupiah(board.tippedTotal)} net across {board.recordedCount}{" "}
            recorded payment
            {board.recordedCount === 1 ? "" : "s"}
          </p>
        )}
      </header>

      {monthKeys.length > 1 && (
        <nav aria-label="Month" className="mt-5 flex flex-wrap gap-2">
          {monthKeys.map((key) => (
            <Link
              key={key}
              to="/tips"
              search={{ month: key }}
              className={cn(
                "border-2 px-2.5 py-1 font-mono text-xs font-bold tracking-[0.18em] uppercase transition-[translate,box-shadow] duration-100 motion-reduce:transition-none",
                key === monthKey
                  ? "border-arena-line bg-arena-ink text-arena-paper shadow-[3px_3px_0_0_var(--primary)]"
                  : "border-arena-line bg-card text-foreground/70 shadow-[3px_3px_0_0_var(--arena-shadow)] hover:-translate-y-0.5 hover:text-foreground hover:shadow-[5px_5px_0_0_var(--arena-shadow)]"
              )}
            >
              {monthLabel(`${key}-01`).replace(/ \d{4}$/, "")}
            </Link>
          ))}
        </nav>
      )}

      {ranked.length === 0 ? (
        <div className="mt-6 border-2 border-dashed border-arena-line/40 px-4 py-10 text-center">
          <p className="font-mono text-xs text-foreground/70 uppercase">
            No tips in the jar this month.
          </p>
          {exactCount > 0 && (
            <p className="mt-1.5 text-sm text-muted-foreground">
              {exactCount} payment{exactCount === 1 ? "" : "s"} landed exactly.
            </p>
          )}
        </div>
      ) : (
        <section aria-label="Tip ranking" className="mt-6">
          {ranked.slice(0, 3).map((row, index) => (
            <div key={row.playerId} className={index > 0 ? "mt-2" : ""}>
              <TipCard row={row} rank={index + 1} index={index} />
            </div>
          ))}
          {ranked.length > 3 && <PodiumDivider />}
          {ranked.length > 3 && (
            <div
              className="arena-rise overflow-hidden border-2 border-arena-line bg-card shadow-[5px_5px_0_0_var(--arena-shadow)]"
              style={delayStyle(0.25)}
            >
              {ranked.slice(3).map((row, fieldIndex) => (
                <FieldRow key={row.playerId} row={row} rank={fieldIndex + 4} />
              ))}
            </div>
          )}
        </section>
      )}

      <footer className="mt-8 space-y-1 border-t-2 border-arena-line pt-3 text-xs text-muted-foreground">
        <p>
          Ranked from what the admin recorded as actually paid, minus the split.
          Paying short counts against a player.
        </p>
        {exactCount > 0 && (
          <p>
            {exactCount} payment{exactCount === 1 ? "" : "s"} landed exactly on
            the split.
          </p>
        )}
      </footer>
    </main>
  )
}

/**
 * Gold, silver, bronze for the podium; muted for the field. Kept faint:
 * the amount stack sits on top of the numeral, so a strong tint turns the
 * money line unreadable.
 */
function rankWatermarkTint(rank: number): string {
  if (rank === 1) return "text-gold/25"
  if (rank === 2) return "text-silver/20"
  if (rank === 3) return "text-bronze/20"
  return "text-foreground/10"
}

/** Big translucent "#N" printed into a rank card's top-right corner. */
function RankWatermark({
  rank,
  className,
}: {
  rank: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute -top-2 right-2 font-heading text-7xl leading-none font-black tabular-nums select-none",
        className
      )}
    >
      #{rank}
    </span>
  )
}

/** Staggered heights and rhythms so the drift looks hand-scattered. */
const FLOATING_HEARTS = [
  { left: "10%", delay: 0, duration: 3.4, size: 13, drift: 8 },
  { left: "28%", delay: 1.3, duration: 4.2, size: 10, drift: -7 },
  { left: "46%", delay: 0.7, duration: 3.1, size: 15, drift: 6 },
  { left: "63%", delay: 2, duration: 4.5, size: 11, drift: -9 },
  { left: "80%", delay: 0.4, duration: 3.7, size: 14, drift: 7 },
]

/**
 * Little hearts drifting up the champion card, forever. Hidden under
 * reduced motion.
 */
function FloatingHearts() {
  const reducedMotion = useReducedMotion()
  if (reducedMotion) return null
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {FLOATING_HEARTS.map((heart, index) => (
        <motion.span
          key={index}
          className="absolute bottom-1 text-gold/60 dark:text-gold/50"
          style={{ left: heart.left }}
          animate={{
            y: [0, -160],
            x: [0, heart.drift, -heart.drift / 2, 0],
            opacity: [0, 1, 1, 0],
            scale: [0.6, 1.1, 1],
          }}
          transition={{
            duration: heart.duration,
            delay: heart.delay,
            repeat: Infinity,
            repeatDelay: 1.2,
            ease: "easeOut",
          }}
        >
          <HeartIcon weight="fill" size={heart.size} aria-hidden />
        </motion.span>
      ))}
    </div>
  )
}

function OwedPaid({
  row,
  onInk = false,
}: {
  row: NonNullable<TipRow["biggest"]>
  onInk?: boolean
}) {
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        onInk ? "text-arena-paper-muted" : "text-foreground/70"
      )}
    >
      {row.merchant} · owed {formatRupiah(row.share)}
      <span className="mx-1" aria-hidden>
        →
      </span>
      paid {formatRupiah(row.paid)}
    </span>
  )
}

const MEDAL_STYLES = ["text-silver", "text-bronze"] as const

/**
 * One rank slot on the wall. #1 is the ink band with the crown and the
 * drifting hearts, #2 and #3 take medal cards. Every slot is a link to the
 * person's public profile; #4 down compact into FieldRow.
 */
function TipCard({
  row,
  rank,
  index,
  showHearts = true,
}: {
  row: TipRow
  rank: number
  /** Position in the ranking, for the entrance stagger. */
  index: number
  /** Hearts only run on the dedicated board. */
  showHearts?: boolean
}) {
  const payments = row.paymentCount
  const entrance = {
    className: "arena-rise block",
    style: delayStyle(Math.min(index * 0.06, 0.3)),
  }

  if (rank === 1) {
    return (
      <PlayerHoverLink
        playerId={row.playerId}
        {...entrance}
        className={cn(
          entrance.className,
          "relative overflow-hidden border-2 border-arena-line bg-arena-ink text-arena-paper shadow-[5px_5px_0_0_var(--gold)] transition-[translate,box-shadow] duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_0_var(--gold)] motion-reduce:transition-none"
        )}
      >
        <RankWatermark rank={rank} className={rankWatermarkTint(rank)} />
        {showHearts && <FloatingHearts />}
        <div className="relative flex flex-wrap items-center gap-4 p-5">
          <PersonAvatar
            name={row.name}
            className="size-14 rounded-none border-2 border-gold text-lg"
          />
          <div className="min-w-[12rem] grow">
            <p className="flex items-center gap-1.5 font-mono text-xs font-bold tracking-[0.2em] text-arena-accent-ink uppercase">
              <span className="arena-drop-bob inline-flex" aria-hidden>
                <CrownIcon
                  weight="fill"
                  className="size-3.5 text-arena-gold-ink"
                />
              </span>
              Top tipper
            </p>
            <p className="mt-0.5 truncate font-heading text-xl font-black uppercase">
              {row.name}
            </p>
            <p className="mt-0.5 font-mono text-xs text-arena-paper-muted uppercase tabular-nums">
              {row.tipCount} of {payments} payment
              {payments === 1 ? "" : "s"} tipped
            </p>
            {row.biggest && (
              <p className="mt-1.5">
                <OwedPaid row={row.biggest} onInk />
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-3xl font-bold text-arena-gold-ink tabular-nums">
              {signedRupiah(row.tipTotal)}
            </p>
            <p className="font-mono text-xs tracking-wider text-arena-paper-muted uppercase">
              net, this month
            </p>
          </div>
        </div>
      </PlayerHoverLink>
    )
  }

  if (rank <= 3) {
    const medal = MEDAL_STYLES[rank - 2]
    return (
      <PlayerHoverLink
        playerId={row.playerId}
        {...entrance}
        className={cn(
          entrance.className,
          "relative overflow-hidden border-2 border-arena-line bg-card shadow-[5px_5px_0_0_var(--arena-shadow)] transition-[translate,box-shadow] duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_0_var(--arena-shadow)] motion-reduce:transition-none"
        )}
      >
        <RankWatermark rank={rank} className={rankWatermarkTint(rank)} />
        {/* Wraps like the champion card: on narrow phones the amount drops
            below the name instead of squeezing the text into an ellipsis. */}
        <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-4 sm:pr-16">
          <MedalIcon
            weight="fill"
            className={cn("size-5 shrink-0", medal)}
            aria-hidden
          />
          <PersonAvatar
            name={row.name}
            className="rounded-none border-2 border-arena-line"
          />
          <div className="min-w-[11rem] grow">
            <p className="truncate font-heading text-base font-black uppercase">
              {row.name}
            </p>
            <p className="truncate font-mono text-xs text-foreground/70 tabular-nums">
              {row.tipCount} tip
              {row.tipCount === 1 ? "" : "s"}
              {payments > 0
                ? ` · ${Math.round((row.tipCount / payments) * 100)}% of payments`
                : ""}
            </p>
            {row.biggest && (
              <p className="mt-0.5 hidden sm:block">
                <OwedPaid row={row.biggest} />
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p
              className={cn(
                "font-mono text-lg font-bold tabular-nums",
                row.tipTotal < 0 ? "text-destructive" : "text-success"
              )}
            >
              {signedRupiah(row.tipTotal)}
            </p>
          </div>
        </div>
      </PlayerHoverLink>
    )
  }
}

/** The field from #4 down: one ink-ruled row inside the shared frame. */
function FieldRow({ row, rank }: { row: TipRow; rank: number }) {
  return (
    <PlayerHoverLink
      playerId={row.playerId}
      className="flex items-center gap-2.5 border-b-2 border-arena-line px-4 py-2.5 transition-colors last:border-b-0 hover:bg-primary/10"
    >
      <span className="w-6 shrink-0 font-mono text-xs font-bold text-foreground/70 tabular-nums">
        {rank}
      </span>
      <PersonAvatar
        name={row.name}
        size="sm"
        className="rounded-none border border-arena-line"
      />
      <span className="min-w-0 grow">
        <span className="block truncate font-heading text-sm font-black uppercase">
          {row.name}
        </span>
        <span className="block truncate font-mono text-xs text-foreground/70 tabular-nums">
          {row.tipCount} tip{row.tipCount === 1 ? "" : "s"}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 font-mono text-sm font-bold tabular-nums",
          row.tipTotal < 0 ? "text-destructive" : "text-success"
        )}
      >
        {signedRupiah(row.tipTotal)}
      </span>
    </PlayerHoverLink>
  )
}

/**
 * Break between the podium and the rest of the field, so the top three read
 * as their own block.
 */
function PodiumDivider() {
  return (
    <div
      role="separator"
      aria-label="Podium"
      className="flex items-center gap-3 py-3"
    >
      <span className="h-0.5 grow bg-gold/60" />
      <span className="font-mono text-xs font-bold tracking-[0.2em] text-foreground/70 uppercase">
        Also in the jar
      </span>
      <span className="h-0.5 grow bg-gold/60" />
    </div>
  )
}
