import { CrownIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { delayStyle } from "@/components/arena"
import { MiniTrendBars } from "@/components/player-charts"
import { PageBreadcrumb } from "@/components/page-breadcrumb"
import { PlayerHoverLink } from "@/components/player-hover-link"
import { PersonAvatar } from "@/components/person-avatar"
import { SearchField } from "@/components/search-field"
import { formatRupiah } from "@/domain/money"
import { cn } from "@/lib/utils"
import type { PlayerBoard, PlayerBoardRow } from "@/server/services/insights"

/**
 * The public players directory in the arena frame: the all-time top
 * three on slab tiles above the ink-ruled ledger table. Rows come from
 * listPlayerBoard, so ranks count published, non-archived bills and only
 * people linked in the directory.
 */
export function PlayerDirectory({ board }: { board: PlayerBoard }) {
  const { query, setQuery, filtered } = useNameFilter(board.rows)

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6">
      <PageBreadcrumb
        items={[{ label: "Home", to: "/" }, { label: "Players" }]}
      />

      <header className="mt-2 flex flex-wrap items-end justify-between gap-3 border-b-2 border-arena-line pb-3">
        <div>
          <h1 className="font-heading text-2xl font-black tracking-tight uppercase">
            Players
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All-time spending across {board.billCount} published bills. Guests
            without a directory link chipped in {formatRupiah(board.guestSpend)}{" "}
            on their own.
          </p>
        </div>
        <SearchField
          placeholder="Search players…"
          label="Search players by name"
          defaultValue={query}
          onChange={setQuery}
        />
      </header>

      {board.rows.length === 0 ? (
        <div className="mt-6 border-2 border-dashed border-arena-line/40 px-4 py-12 text-center">
          <p className="font-mono text-xs text-foreground/70 uppercase">
            No players ranked yet.
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Ranks count published bills and people linked in the directory.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {board.rows.slice(0, 3).map((row, index) => (
              <PodiumCard key={row.playerId} row={row} index={index} />
            ))}
          </div>

          <BoardTable rows={filtered} monthCount={board.monthKeys.length} />
          <p className="mt-3 text-xs text-muted-foreground">
            Click a column to re-sort. Trend shows monthly spend{" "}
            {board.monthKeys.length > 0 && "since the first published bill"}.
          </p>
        </>
      )}
    </main>
  )
}

function useNameFilter(rows: PlayerBoardRow[]) {
  const [query, setQuery] = useState("")
  const filtered = query.trim()
    ? rows.filter((row) =>
        row.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : rows
  return { query, setQuery, filtered }
}

/**
 * One podium tile: the champion takes the gold frame and the drop-bob crown.
 * Tiles render in rank order so the mobile stack reads 1, 2, 3; on the
 * three-column grid the orders lift the champion to the middle slot.
 */
const PODIUM_ORDER = ["sm:order-2", "sm:order-1", "sm:order-3"] as const

function PodiumCard({ row, index }: { row: PlayerBoardRow; index: number }) {
  const first = row.rank === 1
  return (
    <PlayerHoverLink
      playerId={row.playerId}
      className={cn(
        "arena-rise relative flex flex-col items-center border-2 p-5 text-center transition-[translate,box-shadow] duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 motion-reduce:transition-none",
        PODIUM_ORDER[index],
        first
          ? "border-gold bg-gold/10 shadow-[5px_5px_0_0_var(--gold)] hover:shadow-[7px_7px_0_0_var(--gold)]"
          : "border-arena-line bg-card shadow-[5px_5px_0_0_var(--arena-shadow)] hover:shadow-[7px_7px_0_0_var(--arena-shadow)]"
      )}
      style={delayStyle(Math.min(index * 0.08, 0.2))}
    >
      <span
        className={cn(
          "absolute top-3 left-3 flex size-6 items-center justify-center border-2 font-mono text-xs font-bold tabular-nums",
          first
            ? "border-gold bg-gold/15 text-gold"
            : "border-arena-line bg-muted text-foreground/70"
        )}
      >
        {row.rank}
      </span>
      {first && (
        <span
          className="arena-drop-bob absolute top-3 right-3 inline-flex"
          aria-hidden
        >
          <CrownIcon weight="fill" className="size-4 text-gold" />
        </span>
      )}
      <PersonAvatar
        name={row.name}
        className="size-14 rounded-none border-2 border-arena-line text-lg"
      />
      <p className="mt-2 max-w-full truncate font-heading text-sm font-black uppercase">
        {row.name}
      </p>
      <p className="font-mono text-xl font-bold tabular-nums">
        {formatRupiah(row.totalSpend)}
      </p>
      <p className="mt-0.5 font-mono text-xs text-foreground/70 uppercase tabular-nums">
        {row.orderCount} bills
        {row.totalDiscount > 0 && ` · saved ${formatRupiah(row.totalDiscount)}`}
      </p>
    </PlayerHoverLink>
  )
}

type SortKey = "spend" | "bills" | "items" | "saved" | "avg"

const SORT_CONFIG: Array<{ key: Exclude<SortKey, "spend">; label: string }> = [
  { key: "bills", label: "Bills" },
  { key: "items", label: "Items" },
  { key: "saved", label: "Saved" },
  { key: "avg", label: "Avg/order" },
]

function BoardTable({
  rows,
  monthCount,
}: {
  rows: PlayerBoardRow[]
  monthCount: number
}) {
  const [sortKey, setSortKey] = useState<SortKey>("spend")
  const sorted = [...rows].sort((a, b) => {
    switch (sortKey) {
      case "bills":
        return b.orderCount - a.orderCount || b.totalSpend - a.totalSpend
      case "items":
        return b.itemCount - a.itemCount || b.totalSpend - a.totalSpend
      case "saved":
        return b.totalDiscount - a.totalDiscount || b.totalSpend - a.totalSpend
      case "avg":
        return b.avgPerOrder - a.avgPerOrder || b.totalSpend - a.totalSpend
      default:
        return b.totalSpend - a.totalSpend
    }
  })
  const maxSpend = Math.max(...sorted.map((row) => row.totalSpend), 1)
  const sortHead = (key: Exclude<SortKey, "spend">, label: string) => (
    <th
      key={key}
      aria-sort={sortKey === key ? "descending" : undefined}
      className="px-2 py-2.5 text-right"
    >
      <SortButton
        label={label}
        active={sortKey === key}
        onClick={() => setSortKey(key)}
      />
    </th>
  )

  return (
    <div className="mt-4 overflow-x-auto border-2 border-arena-line bg-card shadow-[5px_5px_0_0_var(--arena-shadow)]">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b-2 border-arena-line text-left font-mono text-xs font-bold tracking-[0.16em] text-foreground/70 uppercase">
            <th className="px-4 py-2.5 font-bold">#</th>
            <th className="px-2 py-2.5 font-bold">Person</th>
            {SORT_CONFIG.map((config) => sortHead(config.key, config.label))}
            <th className="px-2 py-2.5 text-center font-bold">Trend</th>
            <th
              aria-sort={sortKey === "spend" ? "descending" : undefined}
              className="px-4 py-2.5 text-right"
            >
              <SortButton
                label="Spend"
                active={sortKey === "spend"}
                onClick={() => setSortKey("spend")}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.playerId}
              className="border-b-2 border-arena-line transition-colors last:border-b-0 hover:bg-primary/10"
            >
              <td className="px-4 py-2.5 font-mono text-xs text-foreground/70 tabular-nums">
                {row.rank}
              </td>
              <td className="px-2 py-2.5">
                <PlayerHoverLink
                  playerId={row.playerId}
                  className="flex items-center gap-2.5"
                >
                  <PersonAvatar
                    name={row.name}
                    size="sm"
                    className="rounded-none border border-arena-line"
                  />
                  <span className="font-heading text-sm font-black uppercase hover:text-arena-accent">
                    {row.name}
                  </span>
                </PlayerHoverLink>
              </td>
              <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">
                {row.orderCount}
              </td>
              <td className="px-2 py-2.5 text-right font-mono text-xs text-foreground/70 tabular-nums">
                {row.itemCount}
              </td>
              <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">
                {row.totalDiscount > 0 ? (
                  <span className="text-success">
                    {formatRupiah(row.totalDiscount)}
                  </span>
                ) : (
                  <span className="text-foreground/70">Rp0</span>
                )}
              </td>
              <td className="px-2 py-2.5 text-right font-mono text-xs text-foreground/70 tabular-nums">
                {formatRupiah(row.avgPerOrder)}
              </td>
              <td className="px-2 py-2.5">
                <div className="flex justify-center">
                  {monthCount > 0 ? (
                    <MiniTrendBars monthly={row.monthly} />
                  ) : (
                    <span className="font-mono text-xs text-foreground/70">
                      Rp0
                    </span>
                  )}
                </div>
              </td>
              <td className="w-40 px-4 py-2.5 text-right">
                <p className="font-mono text-sm font-bold tabular-nums">
                  {formatRupiah(row.totalSpend)}
                </p>
                <div className="mt-1 h-2 border-2 border-arena-line bg-card">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: `${Math.max(3, (row.totalSpend / maxSpend) * 100)}%`,
                    }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SortButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "transition-colors hover:text-foreground",
        active && "text-arena-accent"
      )}
    >
      {label}
      {active && " ↓"}
    </button>
  )
}
