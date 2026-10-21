import { Link, useNavigate } from "@tanstack/react-router"
import {
  CaretLeftIcon,
  CaretRightIcon,
  CrownIcon,
  HandCoinsIcon,
  HeartIcon,
  LightningIcon,
  PercentIcon,
  ReceiptIcon,
  RepeatIcon,
  TrophyIcon,
  XIcon,
} from "@phosphor-icons/react"
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"

import { ArenaChip, arenaPress, delayStyle, EASE } from "@/components/arena"
import { PersonAvatar } from "@/components/person-avatar"
import { PlayerHoverLink } from "@/components/player-hover-link"
import { formatRupiah } from "@/domain/money"
import { formatPercent } from "@/lib/format"
import { getHoliday } from "@/lib/holidays"
import { monthLabel, todayJakarta } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { BillListItem } from "@/server/services/bills"
import type {
  LeaderboardRow,
  MonthlyLeaderboard,
  MonthlyTips,
  TipRow,
} from "@/server/services/insights"

/**
 * The public home board, played as an arena: a sticky month header with
 * live tallies, unpaid splits flagged on top, spender cards with tiers,
 * badges and overtake gaps, the tip jar as a three-tile podium, the month
 * as a selectable week strip, and an events feed mixing orders with
 * holidays. All figures come from listMonthlyLeaderboard and
 * listMonthlyTips, so ranks cover published, non-archived bills and
 * only people linked in the players directory; nothing game-flavoured is
 * invented.
 *
 * Motion: the board deals in on load and re-deals when the month changes
 * (the board subtree is keyed by month). Entrances, sweeps, and the crown
 * bob are pure CSS (see the arena-* keyframes in styles.css) so the page
 * reads fully with JavaScript disabled, and reduced-motion users get the
 * finished board at once. The rupiah tallies count up via motion values
 * after hydration; without JS they render their final figures.
 */
export interface MonthLeaderboardProps {
  /** Any date inside the month to render, as YYYY-MM-DD. */
  anchorKey: string
  bills: BillListItem[]
  leaderboard: MonthlyLeaderboard
  tips: MonthlyTips
}

/** Giant figures only: 12_345_678 -> "Rp12,3 jt", 650_000 -> "Rp650 rb". */
function compactRupiah(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    const jt = Math.round((value / 1_000_000) * 10) / 10
    return `Rp${String(jt).replace(".", ",")} jt`
  }
  if (Math.abs(value) >= 1_000) {
    return `Rp${Math.round(value / 1_000)} rb`
  }
  return formatRupiah(value)
}

/** Only actual tips take a podium slot; exact payers stay off it. */
function tipsOf(tips: MonthlyTips): TipRow[] {
  return tips.rows.filter((row) => row.tipTotal > 0)
}

function isCurrentMonthKey(anchorKey: string): boolean {
  return (
    Temporal.PlainDate.from(anchorKey).toString().slice(0, 7) ===
    todayJakarta().slice(0, 7)
  )
}

const MONTH_SHORT = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
]

/* ---------------------------------------------------------------- */
/* Game rules: tiers, badges, gaps. Data-honest, nothing invented.   */
/* ---------------------------------------------------------------- */

function tierFor(spend: number, topSpend: number): string {
  if (topSpend <= 0) return "ROOKIE"
  const share = spend / topSpend
  if (share >= 0.75) return "FINAL BOSS"
  if (share >= 0.5) return "MINIBOSS"
  if (share >= 0.25) return "REGULAR"
  return "ROOKIE"
}

const BADGES = [
  { label: "Top spender", icon: CrownIcon },
  { label: "Big heart", icon: HeartIcon },
  { label: "Discount hunter", icon: PercentIcon },
  { label: "Loyal", icon: RepeatIcon },
  { label: "Biggest strike", icon: LightningIcon },
] as const

/** One earned badge per player, first match in the priority order above. */
function badgeFor(
  row: LeaderboardRow,
  rows: LeaderboardRow[],
  topTip: TipRow | undefined
): string | null {
  if (rows.at(0) && row.playerId === rows.at(0)!.playerId) return "Top spender"
  if (topTip && topTip.playerId === row.playerId) return "Big heart"
  const biggestDiscount = rows.reduce(
    (best, r) => (r.totalDiscount > (best?.totalDiscount ?? 0) ? r : best),
    rows.at(0)
  )
  if (
    biggestDiscount &&
    biggestDiscount.playerId === row.playerId &&
    row.totalDiscount > 0
  )
    return "Discount hunter"
  const mostOrders = rows.reduce(
    (best, r) => (r.orderCount > (best?.orderCount ?? 0) ? r : best),
    rows.at(0)
  )
  if (mostOrders && mostOrders.playerId === row.playerId && row.orderCount >= 2)
    return "Loyal"
  const biggestStrike = rows.reduce(
    (best, r) =>
      (r.biggestOrder?.total ?? 0) > (best?.biggestOrder?.total ?? 0)
        ? r
        : best,
    rows.at(0)
  )
  if (biggestStrike?.biggestOrder && biggestStrike.playerId === row.playerId)
    return "Biggest strike"
  return null
}

function badgeIconFor(label: string) {
  return BADGES.find((badge) => badge.label === label)?.icon ?? CrownIcon
}

/** Rupiah still needed to pass the rank above; null for rank 1. */
function gapToNext(row: LeaderboardRow, rows: LeaderboardRow[]): number | null {
  const index = rows.findIndex((r) => r.playerId === row.playerId)
  const above = index > 0 ? rows.at(index - 1) : undefined
  if (!above) return null
  return above.totalSpend - row.totalSpend
}

/* ---------------------------------------------------------------- */
/* Motion pieces. Entrances live in CSS (styles.css); this is the    */
/* JS-driven remainder plus the delay helper the CSS classes read.   */
/* ---------------------------------------------------------------- */

/**
 * Integer tally that sweeps up from zero once scrolled into view. SSR and
 * no-JS render the final figure; after hydration the tally snaps to zero
 * and counts up, and reduced-motion users keep the final figure throughout.
 */
function CountUp({
  value,
  format = String,
  duration = 0.9,
}: {
  value: number
  format?: (value: number) => string
  duration?: number
}) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const progress = useMotionValue(1)
  const text = useTransform(progress, (t) => format(Math.round(value * t)))

  useEffect(() => {
    if (reduced) return
    progress.set(0)
  }, [reduced, progress])

  useEffect(() => {
    if (!inView || reduced) return
    const controls = animate(progress, 1, { duration, ease: EASE })
    return () => controls.stop()
  }, [inView, reduced, progress, duration])

  return <motion.span ref={ref}>{text}</motion.span>
}

/** Share-of-top fill that sweeps to size on load, via scaleX only. */
function AnimatedBar({
  value,
  className,
  height = "h-3",
  delay = 0,
}: {
  value: number
  /** Extra classes for the track; later classes win conflicts. */
  className?: string
  height?: string
  delay?: number
}) {
  const scale = Math.max(0.02, Math.min(value, 100)) / 100
  return (
    <div
      className={cn("border-2 border-arena-line bg-card", height, className)}
    >
      <div
        className="arena-sweep-x h-full w-full bg-primary"
        style={{ ...delayStyle(delay), transform: `scaleX(${scale})` }}
      />
    </div>
  )
}

/**
 * The reigning champion's crown: drops in once, then idles with a small bob
 * so the leader stays marked. Pure CSS (arena-drop-bob).
 */
function ChampionCrown() {
  return (
    <span className="arena-drop-bob inline-flex" aria-hidden>
      <CrownIcon weight="fill" className="size-3 text-arena-accent-ink" />
    </span>
  )
}

function Hearts({ count, delay = 0 }: { count: number; delay?: number }) {
  if (count <= 0) return null
  return (
    <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
      {Array.from({ length: Math.min(count, 5) }, (_, i) => (
        <span
          key={i}
          className="arena-pop inline-flex"
          style={delayStyle(delay + 0.15 + i * 0.09)}
        >
          <HeartIcon weight="fill" className="size-3 text-arena-accent-ink" />
        </span>
      ))}
    </span>
  )
}

/* ---------------------------------------------------------------- */
/* Chrome                                                            */
/* ---------------------------------------------------------------- */

function MonthControls({ anchorKey }: { anchorKey: string }) {
  const navigate = useNavigate()
  const first = Temporal.PlainDate.from(anchorKey).with({ day: 1 })
  const isCurrentMonth = isCurrentMonthKey(anchorKey)

  const shiftMonth = (months: number) => {
    const next = first.add({ months })
    void navigate({ to: "/", search: { date: next.toString() } })
  }

  return (
    <div className="flex items-center gap-2 sm:gap-2.5">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => shiftMonth(-1)}
        className={cn(
          "flex size-9 items-center justify-center sm:size-11",
          arenaPress
        )}
      >
        <CaretLeftIcon weight="bold" className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => {
          void navigate({ to: "/", search: { date: undefined } })
        }}
        disabled={isCurrentMonth}
        className={cn(
          "h-9 bg-primary px-2.5 font-mono text-xs font-bold tracking-[0.18em] text-foreground uppercase disabled:opacity-40 disabled:shadow-none disabled:hover:translate-x-0 disabled:hover:translate-y-0 sm:h-11 sm:px-4 sm:text-xs",
          arenaPress
        )}
      >
        Today
      </button>
      <button
        type="button"
        aria-label="Next month"
        onClick={() => shiftMonth(1)}
        className={cn(
          "flex size-9 items-center justify-center sm:size-11",
          arenaPress
        )}
      >
        <CaretRightIcon weight="bold" className="size-4" aria-hidden />
      </button>
    </div>
  )
}

function BadgeChip({
  label,
  inverted = false,
}: {
  label: string
  inverted?: boolean
}) {
  const Icon = badgeIconFor(label)
  return (
    <ArenaChip tone={inverted ? "outline" : "tint"}>
      <Icon weight="fill" className="size-3" aria-hidden />
      {label}
    </ArenaChip>
  )
}

/* ---------------------------------------------------------------- */
/* Tip podium: top three tippers, gold/silver/bronze trophies        */
/* ---------------------------------------------------------------- */

const TROPHY_STYLES = [
  "text-arena-gold-ink",
  "text-arena-silver-ink",
  "text-arena-bronze-ink",
] as const

/**
 * Podium rank slot: trophy for the top three, plain number below. The gold
 * trophy drops in once (arena-drop-bob); that is the first-position
 * celebration.
 */
function TrophySlot({ rank }: { rank: number }) {
  if (rank > TROPHY_STYLES.length) {
    return (
      <span className="font-mono text-xs text-arena-paper-muted tabular-nums">
        {String(rank).padStart(2, "0")}
      </span>
    )
  }
  return (
    <span
      className={cn("inline-flex", rank === 1 && "arena-drop-bob")}
      aria-hidden
    >
      <TrophyIcon
        weight="fill"
        className={cn("size-4", TROPHY_STYLES[rank - 1])}
      />
    </span>
  )
}

/**
 * One podium tile in the jar: trophy, tipper, their hearts, their cut of
 * the jar as a share bar. Rank 1 gets the pink frame and the tallying
 * amount.
 */
function PodiumCard({
  tip,
  rank,
  jarTotal,
}: {
  tip: TipRow
  rank: number
  jarTotal: number
}) {
  const master = rank === 1
  const share = jarTotal > 0 ? tip.tipTotal / jarTotal : 0
  return (
    <PlayerHoverLink
      playerId={tip.playerId}
      className={cn(
        "block border-2 p-3 transition-[translate,box-shadow] duration-100 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-arena-paper motion-reduce:transition-none",
        master
          ? "border-primary"
          : "border-arena-paper/25 bg-arena-paper/[0.04]"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <TrophySlot rank={rank} />
        <Hearts count={tip.tipCount} delay={0.3} />
      </div>
      <div className="mt-2.5 flex items-center gap-2.5">
        <PersonAvatar
          name={tip.name}
          className={cn(
            "rounded-none border-2",
            master
              ? "size-10 border-primary text-sm"
              : "size-9 border-arena-paper/30 text-xs"
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="block truncate font-heading text-sm font-black uppercase">
            {tip.name}
          </p>
          {master && (
            <p className="font-mono text-xs tracking-[0.2em] text-arena-accent-ink uppercase">
              Top tipper
            </p>
          )}
        </div>
      </div>
      <p className="mt-2.5 font-mono text-lg font-bold text-arena-accent-ink tabular-nums">
        {master ? (
          <CountUp
            value={tip.tipTotal}
            format={(v) => `+${formatRupiah(v)}`}
            duration={0.7}
          />
        ) : (
          `+${formatRupiah(tip.tipTotal)}`
        )}
      </p>
      <AnimatedBar
        value={share * 100}
        height="h-2"
        delay={0.25}
        className="mt-2 border-arena-paper/30 bg-transparent"
      />
      <p className="mt-1.5 font-mono text-xs tracking-[0.14em] text-arena-paper-muted uppercase tabular-nums">
        {Math.round(share * 100)}% of the jar
      </p>
    </PlayerHoverLink>
  )
}

/* ---------------------------------------------------------------- */
/* Player card                                                       */
/* ---------------------------------------------------------------- */

function PlayerCard({
  row,
  rank,
  share,
  gap,
  badge,
  tier,
  champion,
  index,
}: {
  row: LeaderboardRow
  rank: number
  share: number
  gap: number | null
  badge: string | null
  tier: string
  champion: boolean
  index: number
}) {
  return (
    <div
      className={cn(
        "group arena-deal relative isolate border-2 border-arena-line transition-[translate,box-shadow] duration-100 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
        "hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none motion-reduce:transition-none",
        champion
          ? "bg-arena-ink text-arena-paper shadow-[5px_5px_0_0_var(--primary)] hover:shadow-[7px_7px_0_0_var(--primary)]"
          : "bg-card shadow-[5px_5px_0_0_var(--arena-shadow)] hover:shadow-[7px_7px_0_0_var(--arena-shadow)]"
      )}
      style={
        {
          "--anim-delay": `${Math.min(index * 0.07, 0.45)}s`,
          "--arena-tilt": champion ? "0deg" : undefined,
        } as CSSProperties
      }
    >
      <div
        className={cn(
          "flex items-center justify-between border-b-2 px-3 py-1.5 font-mono text-xs font-bold tracking-[0.2em] uppercase",
          champion
            ? "border-arena-paper/25 text-arena-accent-ink"
            : "border-arena-line bg-primary/10 text-arena-accent"
        )}
      >
        <span>Player {String(rank).padStart(2, "0")}</span>
        <span>{tier}</span>
      </div>

      <div className="p-3.5">
        <div className="flex items-center gap-3">
          <PersonAvatar
            name={row.name}
            className="size-11 rounded-none border-2 border-primary text-base"
          />
          <div className="min-w-0 flex-1">
            <PlayerHoverLink
              playerId={row.playerId}
              className={cn(
                "block truncate font-heading text-base font-black uppercase group-hover:underline after:absolute after:inset-0 after:z-20",
                champion && "hover:text-arena-accent-ink"
              )}
            >
              {row.name}
            </PlayerHoverLink>
            <p
              className={cn(
                "font-mono text-xs tabular-nums",
                champion ? "text-arena-paper-muted" : "text-foreground/70"
              )}
            >
              {row.orderCount} bill
              {row.orderCount === 1 ? "" : "s"} · saved{" "}
              {formatRupiah(row.totalDiscount)} (
              {formatPercent(row.discountRate)})
            </p>
          </div>
        </div>

        <p
          className={cn(
            "mt-3 font-mono text-2xl font-bold tabular-nums",
            champion && "text-arena-accent-ink"
          )}
        >
          <CountUp
            value={row.totalSpend}
            format={formatRupiah}
            duration={0.8}
          />
        </p>
        <AnimatedBar
          value={share * 100}
          delay={0.2}
          className={cn(
            "mt-1.5",
            champion && "border-arena-paper/60 bg-transparent"
          )}
        />
        <p
          className={cn(
            "mt-1.5 font-mono text-xs tracking-wider uppercase",
            champion ? "text-arena-accent-ink" : "text-foreground/75"
          )}
        >
          {champion ? (
            <span className="flex items-center gap-1 font-bold">
              <ChampionCrown />
              Champion of the month
            </span>
          ) : gap !== null ? (
            <StealLine gap={gap} above={index} />
          ) : null}
        </p>

        {badge && (
          <div className="mt-2">
            <BadgeChip label={badge} inverted={champion} />
          </div>
        )}
      </div>
    </div>
  )
}

/** The overtake target; nudges toward it once the card has landed. */
function StealLine({ gap, above }: { gap: number; above: number }) {
  return (
    <span className="arena-nudge inline-flex items-baseline gap-1">
      <span>Steal #{above} for</span>
      <span className="font-bold text-foreground">{formatRupiah(gap)}</span>
    </span>
  )
}

/* ---------------------------------------------------------------- */
/* Week strip + events feed: the selectable chronicle                */
/* ---------------------------------------------------------------- */

interface MonthWeek {
  label: string
  rangeLabel: string
  orders: number
  holidayNames: string[]
}

/** The month split into Monday-start weeks, with order counts and holiday names per week. */
function useMonthWeeks(anchorKey: string, bills: BillListItem[]): MonthWeek[] {
  return useMemo(() => {
    const first = Temporal.PlainDate.from(anchorKey).with({ day: 1 })
    const gridStart = first.subtract({ days: first.dayOfWeek - 1 })
    const ordersByDate = new Map<string, number>()
    for (const bill of bills) {
      ordersByDate.set(
        bill.orderDate,
        (ordersByDate.get(bill.orderDate) ?? 0) + 1
      )
    }

    // Six rows is the calendar worst case (31-day month starting on a
    // Sunday); most months fit in five, February in four.
    const weekCount = Math.ceil((first.dayOfWeek - 1 + first.daysInMonth) / 7)
    return Array.from({ length: weekCount }, (_, week) => {
      const inMonth = Array.from({ length: 7 }, (_unused, day) =>
        gridStart.add({ days: week * 7 + day })
      ).filter((day) => day.month === first.month && day.year === first.year)
      const start = inMonth.at(0)
      const end = inMonth.at(-1)
      return {
        label: `Week ${week + 1}`,
        rangeLabel:
          start && end
            ? `${MONTH_SHORT[start.month - 1]} ${start.day}-${end.day}`
            : "",
        orders: inMonth.reduce(
          (sum, day) => sum + (ordersByDate.get(day.toString()) ?? 0),
          0
        ),
        holidayNames: inMonth.flatMap(
          (day) => getHoliday(day.toString())?.name ?? []
        ),
      }
    })
  }, [anchorKey, bills])
}

interface BoardEvent {
  key: string
  kind: "order" | "holiday"
  /** 0-based week inside the month grid, for the week filter. */
  weekIndex: number
  dateKey: string
  dayOfMonth: number
  bill?: BillListItem
  holidayName?: string
}

/** Orders and holidays of the month, latest first, tagged with their week. */
function useMonthEvents(
  anchorKey: string,
  bills: BillListItem[]
): BoardEvent[] {
  return useMemo(() => {
    const first = Temporal.PlainDate.from(anchorKey).with({ day: 1 })
    const gridStart = first.subtract({ days: first.dayOfWeek - 1 })
    const billsByDate = new Map<string, BillListItem[]>()
    for (const bill of bills) {
      const list = billsByDate.get(bill.orderDate)
      if (list) list.push(bill)
      else billsByDate.set(bill.orderDate, [bill])
    }

    const events: BoardEvent[] = []
    for (let week = 0; week < 6; week++) {
      for (let day = 0; day < 7; day++) {
        const date = gridStart.add({ days: week * 7 + day })
        if (date.month !== first.month || date.year !== first.year) continue
        const dateKey = date.toString()
        const holiday = getHoliday(dateKey)
        if (holiday) {
          events.push({
            key: `holiday-${dateKey}`,
            kind: "holiday",
            weekIndex: week,
            dateKey,
            dayOfMonth: date.day,
            holidayName: holiday.name,
          })
        }
        for (const bill of billsByDate.get(dateKey) ?? []) {
          events.push({
            key: bill.id,
            kind: "order",
            weekIndex: week,
            dateKey,
            dayOfMonth: date.day,
            bill,
          })
        }
      }
    }
    return events.sort((a, b) => b.dateKey.localeCompare(a.dateKey))
  }, [anchorKey, bills])
}

/** One week as a toggleable column: label, bar sweeping to order share. */

/**
 * Grid columns per week count (a month spans 4-6 Monday-start weeks). Kept
 * as complete class strings so the Tailwind scanner picks them up; sized to
 * the real count so short months don't leave a phantom empty column.
 */
const WEEK_GRID_COLS: Record<number, string> = {
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
}

function WeekBox({
  week,
  fill,
  index,
  selected,
  onToggle,
}: {
  week: MonthWeek
  fill: number
  index: number
  selected: boolean
  onToggle: () => void
}) {
  const scale = Math.min(Math.max(fill, 0), 1)
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      title={selected ? "Show all weeks" : `Filter events to ${week.label}`}
      className={cn(
        "arena-rise border-2 px-3 py-2.5 text-left transition-[translate,box-shadow] duration-100 motion-reduce:transition-none",
        "hover:-translate-y-0.5",
        selected
          ? "border-primary bg-arena-ink text-arena-paper shadow-[4px_4px_0_0_var(--primary)]"
          : week.orders > 0
            ? "border-arena-line bg-card shadow-[4px_4px_0_0_var(--arena-shadow)] hover:shadow-[6px_6px_0_0_var(--arena-shadow)]"
            : "border-arena-line bg-card/50 hover:shadow-[6px_6px_0_0_var(--arena-shadow)]"
      )}
      style={delayStyle(Math.min(index * 0.05, 0.35))}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p
          className={cn(
            "font-mono text-xs font-bold tracking-[0.2em] uppercase",
            selected ? "text-arena-accent-ink" : "text-arena-accent"
          )}
        >
          {week.label}
        </p>
        <p
          className={cn(
            "truncate font-mono text-xs uppercase",
            selected ? "text-arena-paper-muted" : "text-foreground/70"
          )}
        >
          {week.rangeLabel}
        </p>
      </div>
      <div
        className={cn(
          "mt-2 h-12 border-2",
          selected ? "border-arena-paper/60" : "border-arena-line bg-card"
        )}
      >
        <div
          className={cn(
            "arena-sweep-y h-full w-full",
            week.orders > 0 ? "bg-primary" : "bg-transparent"
          )}
          style={{
            ...delayStyle(0.15 + Math.min(index * 0.05, 0.3)),
            transform: `scaleY(${scale})`,
          }}
        />
      </div>
      <p
        className={cn(
          "mt-2 font-mono text-xs tabular-nums",
          selected && "text-arena-paper"
        )}
      >
        {week.orders} order{week.orders === 1 ? "" : "s"}
      </p>
      {week.holidayNames.length > 0 && (
        <p
          className={cn(
            "truncate font-mono text-xs font-bold uppercase",
            selected ? "text-arena-accent-ink" : "text-arena-accent"
          )}
          title={week.holidayNames.join(", ")}
        >
          {week.holidayNames[0]}
          {week.holidayNames.length > 1
            ? ` +${week.holidayNames.length - 1}`
            : ""}
        </p>
      )}
    </button>
  )
}

/**
 * The chronicle pair: the selectable week strip and the events feed it
 * filters. Pick a week to narrow the feed to that week; pick it again,
 * or hit "Show all events", to see the whole month. Holidays sit in the
 * feed beside the orders.
 */
function WeekEvents({
  anchorKey,
  bills,
}: {
  anchorKey: string
  bills: BillListItem[]
}) {
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const weeks = useMonthWeeks(anchorKey, bills)
  const events = useMonthEvents(anchorKey, bills)
  const busiestWeek = Math.max(
    weeks.reduce((busiest, week) => Math.max(busiest, week.orders), 0),
    1
  )
  const visibleEvents =
    selectedWeek === null
      ? events.slice(0, 8)
      : events.filter((event) => event.weekIndex === selectedWeek)
  const selectedMeta = selectedWeek === null ? null : weeks[selectedWeek]

  return (
    <>
      {/* Week strip: the month at a glance, doubles as the events filter */}
      <section aria-label="Week strip" className="mt-10">
        <div className="flex items-center justify-between border-b-2 border-arena-line pb-2">
          <h2 className="font-heading text-lg font-black uppercase">
            The month in weeks
          </h2>
          <span className="font-mono text-xs tracking-[0.2em] text-foreground/70 uppercase">
            select a week to filter events
          </span>
        </div>
        <div
          className={cn(
            "mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3",
            WEEK_GRID_COLS[weeks.length] ?? "lg:grid-cols-6"
          )}
        >
          {weeks.map((week, index) => (
            <WeekBox
              key={week.label}
              week={week}
              fill={week.orders / busiestWeek}
              index={index}
              selected={selectedWeek === index}
              onToggle={() =>
                setSelectedWeek((current) => (current === index ? null : index))
              }
            />
          ))}
        </div>
      </section>

      {/* Recent events: orders and holidays, latest first */}
      <section aria-label="Recent events" className="mt-10 pb-6">
        <div className="flex items-center justify-between border-b-2 border-arena-line pb-2">
          <h2 className="font-heading text-lg font-black uppercase">
            Recent events
          </h2>
          {selectedMeta ? (
            <div className="flex items-center gap-2">
              <span className="hidden font-mono text-xs tracking-[0.2em] text-foreground/70 uppercase sm:inline">
                {selectedMeta.label} · {selectedMeta.rangeLabel}
              </span>
              <button
                type="button"
                onClick={() => setSelectedWeek(null)}
                title="Show every event of the month"
                className="flex items-center gap-1.5 border-2 border-arena-line px-2 py-1 font-mono text-xs font-bold tracking-[0.2em] text-foreground/70 uppercase transition-[translate,box-shadow] duration-100 hover:-translate-y-0.5 hover:shadow-[2px_2px_0_0_var(--arena-shadow)] motion-reduce:transition-none"
              >
                Show all events
                <XIcon className="size-3" aria-hidden />
              </button>
            </div>
          ) : (
            <span className="font-mono text-xs tracking-[0.2em] text-foreground/70 uppercase">
              latest {visibleEvents.length}
            </span>
          )}
        </div>
        {visibleEvents.length === 0 ? (
          <div className="arena-rise mt-5 border-2 border-dashed border-arena-line/40 px-4 py-10 text-center font-mono text-xs text-foreground/70 uppercase">
            <ReceiptIcon className="mx-auto size-6" aria-hidden />
            <p className="mt-2">
              {selectedWeek === null
                ? "Nothing logged this month yet."
                : "Nothing logged for this week."}
            </p>
          </div>
        ) : (
          <ul>
            {visibleEvents.map((event, index) => {
              if (event.kind === "holiday") {
                return (
                  <li
                    key={event.key}
                    className="arena-slide"
                    style={delayStyle(Math.min(index * 0.05, 0.3))}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b-2 border-arena-line bg-primary/5 px-3 py-3 sm:flex sm:items-center sm:gap-3">
                      <span className="col-start-1 row-start-1 font-mono text-xs font-bold uppercase tabular-nums sm:w-20 sm:shrink-0">
                        {MONTH_SHORT[Number(event.dateKey.slice(5, 7)) - 1]}{" "}
                        {event.dayOfMonth}
                      </span>
                      <span className="col-span-2 row-start-2 min-w-0 font-heading text-sm font-black text-arena-accent uppercase sm:flex-1 sm:truncate">
                        {event.holidayName}
                      </span>
                      <span className="col-start-2 row-start-1 border border-arena-line/40 px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider text-arena-accent sm:shrink-0">
                        Holiday
                      </span>
                      <span className="hidden w-[104px] shrink-0 text-right font-mono text-sm font-bold text-foreground/70 sm:block">
                        day off
                      </span>
                    </div>
                  </li>
                )
              }

              const bill = event.bill!
              const allPaid =
                bill.billPlayerCount > 0 &&
                bill.paidCount >= bill.billPlayerCount
              return (
                <li
                  key={event.key}
                  className="arena-slide"
                  style={delayStyle(Math.min(index * 0.05, 0.3))}
                >
                  <Link
                    to="/b/$publicId"
                    params={{ publicId: bill.publicId }}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b-2 border-arena-line px-3 py-3 hover:bg-primary/10 sm:flex sm:items-center sm:gap-3"
                  >
                    <span className="col-start-1 row-start-1 font-mono text-xs font-bold uppercase tabular-nums sm:w-20 sm:shrink-0">
                      {MONTH_SHORT[Number(event.dateKey.slice(5, 7)) - 1]}{" "}
                      {event.dayOfMonth}
                    </span>
                    <span className="col-start-1 row-start-2 min-w-0 sm:flex-1">
                      <span className="block font-heading text-sm font-black break-words uppercase group-hover:text-arena-accent sm:truncate">
                        {bill.merchant}
                      </span>
                      <span className="block font-mono text-xs text-foreground/70 tabular-nums">
                        {bill.billPlayerCount} player
                        {bill.billPlayerCount === 1 ? "" : "s"}
                        {bill.itemCount > 0 && ` · ${bill.itemCount} items`}
                      </span>
                    </span>
                    <span className="col-start-2 row-start-1 flex items-center justify-end gap-1.5 sm:shrink-0">
                      {event.dateKey === todayJakarta() && (
                        <span className="border border-arena-line bg-primary px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider text-foreground">
                          Today
                        </span>
                      )}
                      <span
                        className={cn(
                          "border px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider",
                          allPaid
                            ? "border-arena-line bg-primary text-foreground"
                            : "border-arena-line bg-primary/10 text-arena-accent"
                        )}
                      >
                        {allPaid
                          ? "Paid"
                          : `${bill.paidCount}/${bill.billPlayerCount} unpaid`}
                      </span>
                    </span>
                    <span className="col-start-2 row-start-2 shrink-0 self-start text-right font-mono text-sm font-bold tabular-nums sm:w-[104px]">
                      {formatRupiah(bill.finalTotal)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

/* ---------------------------------------------------------------- */
/* The board                                                         */
/* ---------------------------------------------------------------- */

export function MonthLeaderboard({
  anchorKey,
  bills,
  leaderboard,
  tips,
}: MonthLeaderboardProps) {
  const rows = leaderboard.rows
  const tipRows = useMemo(
    () => tipsOf(tips).sort((a, b) => b.tipTotal - a.tipTotal),
    [tips]
  )
  const topTip = tipRows.at(0)
  const topSpend = Math.max(rows.at(0)?.totalSpend ?? 1, 1)
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? rows : rows.slice(0, 6)
  const unpaidBills = useMemo(
    () =>
      bills
        .filter(
          (bill) =>
            bill.billPlayerCount > 0 && bill.paidCount < bill.billPlayerCount
        )
        .sort((a, b) => b.orderDate.localeCompare(a.orderDate)),
    [bills]
  )

  return (
    <div>
      {/* Slim arena header: month, controls, live tallies. Sticks to the
          top once the site nav scrolls away. */}
      <header className="sticky top-0 z-20 border-b-2 border-arena-line bg-card">
        {/* One row on phones: the controls shrink and the month title
            shares their line; sm+ lets the tallies wrap below instead. */}
        <div className="mx-auto flex max-w-[1400px] flex-nowrap items-center gap-x-2.5 gap-y-3 px-4 py-3.5 sm:flex-wrap sm:gap-x-5 md:px-6">
          <MonthControls anchorKey={anchorKey} />
          <h1 className="min-w-0 flex-1 truncate font-heading text-lg font-black tracking-tight uppercase sm:text-2xl md:text-3xl">
            {monthLabel(anchorKey)}
          </h1>
          <div className="ml-auto hidden flex-wrap items-center gap-x-4 font-mono text-xs tracking-[0.14em] uppercase tabular-nums sm:flex">
            <span>
              <span className="font-bold">
                <CountUp key={anchorKey} value={leaderboard.billCount} />
              </span>{" "}
              bills
            </span>
            <span className="text-foreground/40">/</span>
            <span>
              <span className="font-bold">
                <CountUp
                  key={anchorKey}
                  value={leaderboard.monthTotal}
                  format={compactRupiah}
                />
              </span>{" "}
              billed
            </span>
            <span className="text-foreground/40">/</span>
            <span>
              <span className="font-bold text-arena-accent">
                <CountUp
                  key={anchorKey}
                  value={tips.tippedTotal}
                  format={compactRupiah}
                />
              </span>{" "}
              tipped
            </span>
          </div>
        </div>
      </header>

      {/* Keyed by month: a month switch visibly re-deals the whole board */}
      <main className="mx-auto max-w-[1400px] px-4 py-8 md:px-6">
        <div key={anchorKey}>
          {/* Unpaid splits lead the page: money on the table comes first */}
          {unpaidBills.length > 0 && (
            <section aria-label="Unpaid splits" className="arena-rise">
              <div className="flex items-center justify-between border-b-2 border-arena-line pb-2">
                <h2 className="font-heading text-lg font-black uppercase">
                  Unpaid splits
                </h2>
                <span className="font-mono text-xs tracking-[0.2em] text-arena-accent uppercase">
                  {unpaidBills.length} waiting
                </span>
              </div>
              <ul>
                {unpaidBills.map((bill, index) => {
                  const day = Temporal.PlainDate.from(bill.orderDate)
                  return (
                    <li
                      key={bill.id}
                      className="arena-slide"
                      style={delayStyle(Math.min(index * 0.05, 0.3))}
                    >
                      <Link
                        to="/b/$publicId"
                        params={{ publicId: bill.publicId }}
                        className="group flex items-center gap-3 border-b-2 border-arena-line px-3 py-3 hover:bg-primary/10"
                      >
                        <span className="w-20 shrink-0 font-mono text-xs font-bold uppercase tabular-nums">
                          {MONTH_SHORT[day.month - 1]} {day.day}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-heading text-sm font-black uppercase group-hover:text-arena-accent">
                            {bill.merchant}
                          </span>
                          <span className="block font-mono text-xs text-foreground/70 tabular-nums">
                            {bill.billPlayerCount} player
                            {bill.billPlayerCount === 1 ? "" : "s"}
                            {bill.itemCount > 0 && ` · ${bill.itemCount} items`}
                          </span>
                        </span>
                        <span className="shrink-0 border border-arena-line bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider text-arena-accent">
                          {bill.paidCount}/{bill.billPlayerCount} unpaid
                        </span>
                        <span className="w-[104px] shrink-0 text-right font-mono text-sm font-bold tabular-nums">
                          {formatRupiah(bill.finalTotal)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* Players */}
          <section
            aria-label="Player cards"
            className={unpaidBills.length > 0 ? "mt-10" : ""}
          >
            <div className="flex items-center justify-between border-b-2 border-arena-line pb-2">
              <h2 className="font-heading text-lg font-black uppercase">
                Players
              </h2>
              <span className="font-mono text-xs tracking-[0.2em] text-foreground/70 uppercase">
                ranked by spend
              </span>
            </div>

            {rows.length === 0 ? (
              <div className="arena-rise mt-5 border-2 border-dashed border-arena-line/40 px-4 py-12 text-center font-mono text-xs text-foreground/70 uppercase">
                <p>No players ranked this month.</p>
                <p className="mt-1 normal-case">
                  Ranks count published bills and players linked in the
                  directory.
                </p>
              </div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((row, index) => {
                  const rank = index + 1
                  const share = topSpend > 0 ? row.totalSpend / topSpend : 0
                  return (
                    <PlayerCard
                      key={row.playerId}
                      row={row}
                      rank={rank}
                      share={share}
                      gap={gapToNext(row, rows)}
                      badge={badgeFor(row, rows, topTip)}
                      tier={tierFor(row.totalSpend, topSpend)}
                      champion={rank === 1}
                      index={index}
                    />
                  )
                })}
              </div>
            )}

            {rows.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAll((open) => !open)}
                className="mt-4 w-full border-2 border-arena-line bg-card py-2.5 font-mono text-xs font-bold tracking-[0.18em] uppercase shadow-[5px_5px_0_0_var(--arena-shadow)] transition-[translate,box-shadow] duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-primary hover:shadow-[7px_7px_0_0_var(--arena-shadow)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none motion-reduce:transition-none"
              >
                {showAll ? "Fold the roster" : `Show ${rows.length - 6} more`}
              </button>
            )}
          </section>

          {/* Tip jar band with the tipping podium */}
          <section aria-label="Tip jar" className="mt-10">
            <div
              className="arena-rise border-2 border-arena-line bg-arena-ink text-arena-paper shadow-[5px_5px_0_0_var(--primary)]"
              style={delayStyle(0.1)}
            >
              <div className="px-5 pt-5">
                <p className="flex items-center gap-1.5 font-mono text-xs tracking-[0.2em] text-arena-accent-ink uppercase">
                  <HandCoinsIcon
                    weight="fill"
                    className="size-3.5"
                    aria-hidden
                  />
                  Tip jar
                </p>
                <p className="mt-1.5 font-heading text-4xl font-black text-arena-accent-ink tabular-nums md:text-5xl">
                  <CountUp
                    value={tips.tippedTotal}
                    format={formatRupiah}
                    duration={1.1}
                  />
                </p>
                <p className="mt-1 font-mono text-xs text-arena-paper-muted uppercase">
                  dropped in by {tipRows.length} player
                  {tipRows.length === 1 ? "" : "s"} this month
                </p>
              </div>

              {tipRows.length === 0 ? (
                <p className="mt-4 border-t-2 border-arena-paper/20 px-5 py-5 font-mono text-xs text-arena-paper-muted uppercase">
                  Jar is empty. Exact payers only.
                </p>
              ) : (
                <div className="mt-4 border-t-2 border-arena-paper/20 px-5 pt-4 pb-5">
                  <div
                    className={cn(
                      "grid gap-3",
                      tipRows.length === 1
                        ? "grid-cols-1"
                        : tipRows.length === 2
                          ? "grid-cols-1 sm:grid-cols-2"
                          : "sm:grid-cols-3"
                    )}
                  >
                    {tipRows.slice(0, 3).map((tip, index) => (
                      <PodiumCard
                        key={tip.playerId}
                        tip={tip}
                        rank={index + 1}
                        jarTotal={tips.tippedTotal}
                      />
                    ))}
                  </div>
                  {tipRows.length > 3 && (
                    <p className="mt-2.5 font-mono text-xs tracking-[0.14em] text-arena-paper-muted uppercase tabular-nums">
                      +{tipRows.length - 3} more in the jar
                    </p>
                  )}
                  <Link
                    to="/tips"
                    search={{ month: anchorKey.slice(0, 7) }}
                    className="mt-3 block border-2 border-arena-paper px-3 py-2 text-center font-mono text-xs font-bold tracking-[0.2em] uppercase hover:border-primary hover:bg-primary"
                  >
                    See the tip jar
                  </Link>
                </div>
              )}
            </div>
          </section>

          <WeekEvents anchorKey={anchorKey} bills={bills} />
        </div>
      </main>
    </div>
  )
}
