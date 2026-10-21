import { createFileRoute, useRouter } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { useCallback, useMemo, useState } from "react"
import { Effect } from "effect"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ThemeToggle } from "@/components/theme-toggle"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorDialog } from "@/components/error-dialog"
import { AdminPlayersSkeleton } from "@/components/page-skeletons"
import { PageBreadcrumb } from "@/components/page-breadcrumb"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatRupiah } from "@/domain/money"
import { cn } from "@/lib/utils"
import { getServerContext } from "@/server/context"
import { listPlayers } from "@/server/services/players"
import { listPlayerInsights } from "@/server/services/insights"
import type { PlayerInsight } from "@/server/services/insights"
import {
  listOutstandingPayments,
  listOutstandingTotalsByPlayer,
} from "@/server/services/payments"
import { CollectPaymentDialog } from "@/components/collect-payment-dialog"

/**
 * Player directory plus per-player insights: who buys the most and who
 * benefits most from discounted pricing, ranked over published bills.
 */

interface PlayerRowView {
  id: string
  name: string
  note: string | null
  archivedAt: string | null
}

const fetchAdminPlayers = createServerFn({ method: "GET" })
  .validator((includeArchived: boolean) => includeArchived)
  .handler(async ({ data }) => {
    const ctx = await getServerContext()
    return Effect.runPromise(
      listPlayers({ db: ctx.db }, { includeArchived: data })
    )
  })

const fetchPlayerInsights = createServerFn({ method: "GET" })
  .validator((range: { from?: string; to?: string }) => range)
  .handler(async ({ data }) => {
    const ctx = await getServerContext()
    return Effect.runPromise(
      listPlayerInsights(
        { db: ctx.db },
        data.from && data.to ? { from: data.from, to: data.to } : undefined
      )
    )
  })

const fetchOutstandingPayments = createServerFn({ method: "GET" })
  .validator((playerId: string) => playerId)
  .handler(async ({ data }) => {
    const ctx = await getServerContext()
    return Effect.runPromise(listOutstandingPayments({ db: ctx.db }, data))
  })

const fetchOutstandingTotals = createServerFn({ method: "GET" }).handler(
  async () => {
    const ctx = await getServerContext()
    return Effect.runPromise(listOutstandingTotalsByPlayer({ db: ctx.db }))
  }
)

type RangePreset = "all" | "this-month" | "last-month"

function presetRange(preset: RangePreset): { from?: string; to?: string } {
  if (preset === "all") return {}
  const today = Temporal.Now.zonedDateTimeISO("Asia/Jakarta").toPlainDate()
  const first = today.with({ day: 1 })
  if (preset === "this-month") {
    const last = first.add({ months: 1 }).subtract({ days: 1 })
    return { from: first.toString(), to: last.toString() }
  }
  const firstOfLast = first.subtract({ months: 1 })
  const lastOfLast = first.subtract({ days: 1 })
  return { from: firstOfLast.toString(), to: lastOfLast.toString() }
}

function presetFromRange(range: { from?: string; to?: string }): RangePreset {
  const current = presetRange("this-month")
  if (range.from === current.from && range.to === current.to) {
    return "this-month"
  }
  const last = presetRange("last-month")
  if (range.from === last.from && range.to === last.to) return "last-month"
  return "all"
}

type SortKey = "name" | "orders" | "spend" | "discount"

const sortHints: Record<SortKey, string | null> = {
  name: null,
  orders: "Players with the most published orders in range.",
  spend: "Buys the most, by item spend in range.",
  discount: "Got the most discounted pricing in range.",
}

export const Route = createFileRoute("/admin/players/")({
  validateSearch: (search: Record<string, unknown>) => ({
    // TanStack JSON-parses search values, so ?archived=true arrives as a boolean.
    archived: search.archived === true ? (true as const) : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
  }),
  loaderDeps: ({ search: { archived, from, to } }) => ({
    archived: archived === true,
    from,
    to,
  }),
  loader: async ({ deps }) => {
    const [players, insights, outstandingTotals] = await Promise.all([
      fetchAdminPlayers({ data: deps.archived }),
      fetchPlayerInsights({ data: { from: deps.from, to: deps.to } }),
      fetchOutstandingTotals(),
    ])
    return { players, insights, outstandingTotals }
  },
  component: PlayersPage,
  pendingComponent: AdminPlayersSkeleton,
})

function PlayersPage() {
  const { players, insights, outstandingTotals } = Route.useLoaderData()
  const router = useRouter()
  const { archived, from, to } = Route.useSearch()

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [pendingDelete, setPendingDelete] = useState<{
    id: string
    name: string
  } | null>(null)
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null)
  const [collectingFor, setCollectingFor] = useState<PlayerRowView | null>(null)
  const [collectedMessage, setCollectedMessage] = useState<string | null>(null)

  // Stable so the dialog's load-on-open effect does not refire on rerenders.
  const loadOutstanding = useCallback(
    (playerId: string) => fetchOutstandingPayments({ data: playerId }),
    []
  )

  async function call(url: string, init: RequestInit) {
    setError(null)
    setBusy(true)
    try {
      const response = await fetch(url, init)
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        if (body.error === "PlayerInUse") {
          setDeleteBlocked(
            body.message ??
              "This player still has bills linked to them; archive instead of deleting."
          )
        } else {
          setError(body.message ?? "The action failed.")
        }
        return false
      }
      await router.invalidate()
      return true
    } finally {
      setBusy(false)
    }
  }

  async function create() {
    const name = newName.trim()
    if (name === "") return
    if (
      await call("/api/admin/players", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      })
    ) {
      setNewName("")
    }
  }

  const insightByPlayer = useMemo(
    () => new Map(insights.map((i) => [i.playerId, i])),
    [insights]
  )

  const sorted = useMemo(() => {
    const rows = [...players]
    rows.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name)
      const metrics = (row: PlayerRowView) =>
        insightByPlayer.get(row.id) ?? {
          orderCount: 0,
          totalSpend: 0,
          totalDiscount: 0,
        }
      const ma = metrics(a)
      const mb = metrics(b)
      const key = (m: typeof ma) =>
        sortKey === "orders"
          ? m.orderCount
          : sortKey === "spend"
            ? m.totalSpend
            : m.totalDiscount
      return key(mb) - key(ma) || a.name.localeCompare(b.name)
    })
    return rows
  }, [players, insightByPlayer, sortKey])

  const preset = presetFromRange({ from, to })

  function applyPreset(next: RangePreset) {
    const range = presetRange(next)
    void router.navigate({
      to: "/admin/players",
      search: (prev) => ({
        archived: prev.archived,
        from: range.from,
        to: range.to,
      }),
    })
  }
  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <PageBreadcrumb
        items={[{ label: "Home", to: "/" }, { label: "Players" }]}
      />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-medium">Players</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Directory of recurring people. Insights cover published bills in the
            selected range.
          </p>
        </div>
        <ThemeToggle />
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {collectedMessage && (
        <p className="mt-4 text-sm text-success">{collectedMessage}</p>
      )}

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="new-player">New player</Label>
          <Input
            id="new-player"
            placeholder="e.g. Bu Tari"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void create()
              }
            }}
          />
        </div>
        <Button
          disabled={busy || newName.trim() === ""}
          onClick={() => void create()}
        >
          Add
        </Button>
        <div className="ml-2 flex items-center gap-2 pb-0.5">
          <Switch
            id="show-archived"
            checked={archived}
            onCheckedChange={(checked) =>
              void router.navigate({
                to: "/admin/players",
                search: (prev) => ({
                  archived: checked || undefined,
                  from: prev.from,
                  to: prev.to,
                }),
              })
            }
          />
          <Label htmlFor="show-archived" className="text-sm">
            Show archived
          </Label>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {(
            [
              ["all", "All time"],
              ["this-month", "This month"],
              ["last-month", "Last month"],
            ] as Array<[RangePreset, string]>
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={preset === value ? "default" : "ghost"}
              onClick={() => applyPreset(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {sortHints[sortKey] && (
        <p className="mt-4 text-sm text-muted-foreground">
          {sortHints[sortKey]}
        </p>
      )}

      <Card className="mt-4">
        <CardContent className="pt-6">
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {archived
                ? "No archived players."
                : "No players yet. Add the first one above, or pick them while creating a bill."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader
                    label="Name"
                    active={sortKey === "name"}
                    onClick={() => setSortKey("name")}
                  />
                  <TableHead>Note</TableHead>
                  <SortHeader
                    label="Orders"
                    active={sortKey === "orders"}
                    onClick={() => setSortKey("orders")}
                  />
                  <SortHeader
                    label="Spend"
                    align="right"
                    active={sortKey === "spend"}
                    onClick={() => setSortKey("spend")}
                  />
                  <SortHeader
                    label="Discount"
                    align="right"
                    active={sortKey === "discount"}
                    onClick={() => setSortKey("discount")}
                  />
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((player) => (
                  <PlayerRow
                    key={player.id}
                    player={player}
                    insight={insightByPlayer.get(player.id)}
                    outstanding={outstandingTotals[player.id] ?? 0}
                    busy={busy}
                    onSave={(input) =>
                      void call(`/api/admin/players/${player.id}`, {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify(input),
                      })
                    }
                    onToggleArchive={() =>
                      void call(
                        `/api/admin/players/${player.id}/${
                          player.archivedAt ? "restore" : "archive"
                        }`,
                        { method: "POST" }
                      )
                    }
                    onDelete={() => setPendingDelete(player)}
                    onCollect={() => {
                      setCollectedMessage(null)
                      setCollectingFor(player)
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Discounts are split proportionally to each person&apos;s share of the
        item subtotal, so everyone on one bill sees the same discount rate.
        Differences between players come from which bills they join, not from
        per-player pricing.
      </p>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={pendingDelete ? `Delete player "${pendingDelete.name}"?` : ""}
        description="Only possible while no bills link to them."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (!pendingDelete) return
          const player = pendingDelete
          setPendingDelete(null)
          void call(`/api/admin/players/${player.id}`, {
            method: "DELETE",
          })
        }}
      />

      <ErrorDialog
        open={deleteBlocked !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteBlocked(null)
        }}
        title="Player is still in use"
        description={deleteBlocked ?? ""}
      />

      <CollectPaymentDialog
        player={collectingFor ?? { id: "", name: "" }}
        open={collectingFor !== null}
        onOpenChange={(open) => {
          if (!open) setCollectingFor(null)
        }}
        load={loadOutstanding}
        onCollected={(message) => {
          setCollectingFor(null)
          setCollectedMessage(message)
          void router.invalidate()
        }}
      />
    </main>
  )
}

function SortHeader({
  label,
  active,
  onClick,
  align = "left",
}: {
  label: string
  active: boolean
  onClick: () => void
  /** Matches the column's value alignment. */
  align?: "left" | "right"
}) {
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        className={cn(
          active
            ? "font-medium text-foreground underline underline-offset-4"
            : "text-muted-foreground hover:text-foreground",
          align === "right" && "w-full text-right"
        )}
        onClick={onClick}
      >
        {label}
      </button>
    </TableHead>
  )
}

function PlayerRow({
  player,
  insight,
  outstanding,
  busy,
  onSave,
  onToggleArchive,
  onDelete,
  onCollect,
}: {
  player: PlayerRowView
  insight?: PlayerInsight
  outstanding: number
  busy: boolean
  onSave: (input: { name: string; note?: string }) => void
  onToggleArchive: () => void
  onDelete: () => void
  onCollect: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(player.name)
  const [note, setNote] = useState(player.note ?? "")

  if (editing) {
    return (
      <TableRow>
        <TableCell>
          <Input
            aria-label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </TableCell>
        <TableCell>
          <Input
            aria-label="Note"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </TableCell>
        <TableCell colSpan={4} />
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              disabled={busy || name.trim() === ""}
              onClick={() => {
                onSave({
                  name: name.trim(),
                  note: note.trim(),
                })
                setEditing(false)
              }}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setName(player.name)
                setNote(player.note ?? "")
                setEditing(false)
              }}
            >
              Cancel
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow>
      <TableCell>
        {player.name}
        {player.archivedAt && (
          <Badge variant="outline" className="ml-2">
            archived
          </Badge>
        )}
      </TableCell>
      <TableCell className="max-w-48 truncate">{player.note ?? "—"}</TableCell>
      <TableCell>{insight?.orderCount ?? 0}</TableCell>
      <TableCell className="text-right">
        {insight ? formatRupiah(insight.totalSpend) : "—"}
      </TableCell>
      <TableCell className="text-right">
        {insight ? formatRupiah(insight.totalDiscount) : "—"}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {outstanding > 0 ? (
          <span className="font-bold text-arena-accent">
            {formatRupiah(outstanding)}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || outstanding === 0}
            title={
              outstanding === 0 ? "Nothing outstanding to collect" : undefined
            }
            onClick={onCollect}
          >
            Collect
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onToggleArchive}
          >
            {player.archivedAt ? "Restore" : "Archive"}
          </Button>
          {!player.archivedAt && (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={onDelete}
            >
              Delete
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
