import {
  createFileRoute,
  notFound,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CopyIcon,
  DownloadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react"
import { Effect } from "effect"

import {
  ArenaChip,
  arenaButtonLabel,
  arenaPress,
  ArenaPanel,
  ArenaPanelTitle,
  ArenaSectionHeader,
  delayStyle,
} from "@/components/arena"
import { BillSummary } from "@/components/bill-summary"
import { PersonAvatar } from "@/components/person-avatar"
import { PlayerHoverLink } from "@/components/player-hover-link"
import {
  PersonCardSkeleton,
  PublicBillSkeleton,
} from "@/components/page-skeletons"
import { PageBreadcrumb } from "@/components/page-breadcrumb"
import { SearchField } from "@/components/search-field"
import { formatRupiah } from "@/domain/money"
import { publicBillQuerySchema } from "@/lib/bill-schema"
import { formatPercent } from "@/lib/format"
import { formatDisplayDate } from "@/lib/time"
import { publicBillUrl } from "@/lib/urls"
import { cn } from "@/lib/utils"
import { getServerContext } from "@/server/context"
import { getPublishedBill } from "@/server/services/bills"
import type { PublicBillPlayerView } from "@/server/services/bills"

const fetchPublicBill = createServerFn({ method: "GET" })
  .validator((publicId: string) => publicId)
  .handler(async ({ data }) => {
    const ctx = await getServerContext()
    // Unknown and unpublished bills come back as null so the loader can
    // raise the router's not-found page; repository failures still throw,
    // and network failures never reach this handler at all. Collapsing
    // every failure into notFound() here would make a network failure on
    // a live bill read as "this bill does not exist".
    return Effect.runPromise(
      getPublishedBill({ db: ctx.db }, data).pipe(
        Effect.catchTag("PublicBillNotFound", () => Effect.succeed(null))
      )
    )
  })

/** Seconds the Refresh button stays disabled after a click, so it can't be spammed. */
const REFRESH_COOLDOWN_SECONDS = 5

export const Route = createFileRoute("/b/$publicId")({
  validateSearch: publicBillQuerySchema,
  loader: async ({ params }) => {
    const bill = await fetchPublicBill({ data: params.publicId })
    if (!bill) throw notFound()
    return bill
  },
  component: PublicBillPage,
  pendingComponent: PublicBillSkeleton,
})

function PublicBillPage() {
  const bill = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const filter = Route.useSearch().p ?? ""
  const [copied, setCopied] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (cooldownSeconds <= 0) return
    const timer = setTimeout(
      () => setCooldownSeconds((seconds) => seconds - 1),
      1000
    )
    return () => clearTimeout(timer)
  }, [cooldownSeconds])

  const imageUrl = `/api/public/bills/${bill.publicId}/image`
  const downloadName = `${bill.merchant.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-receipt.webp`

  const query = filter.trim().toLowerCase()
  // Fixed order: unpaid people first (the ones to chase), then alphabetical.
  const billPlayers = (
    query === ""
      ? bill.billPlayers
      : bill.billPlayers.filter((billPlayer) =>
          billPlayer.alias.toLowerCase().includes(query)
        )
  )
    .slice()
    .sort(
      (a, b) =>
        Number(a.paid) - Number(b.paid) || a.alias.localeCompare(b.alias)
    )

  const paidCount = bill.billPlayers.filter((p) => p.paid).length
  const settledShare =
    bill.billPlayers.length === 0 ? 0 : paidCount / bill.billPlayers.length

  useEffect(() => {
    if (!previewOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPreviewOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    // Park focus inside the dialog so keyboard users start from its controls.
    closeRef.current?.focus()
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [previewOpen])

  async function refresh() {
    if (refreshing || cooldownSeconds > 0) return
    setRefreshing(true)
    setCooldownSeconds(REFRESH_COOLDOWN_SECONDS)
    try {
      await router.invalidate()
    } finally {
      setRefreshing(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicBillUrl(bill.publicId))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <main className="arena-rise mx-auto max-w-[1400px] px-4 py-8 md:px-6">
      <PageBreadcrumb
        items={[{ label: "Home", to: "/" }, { label: bill.merchant }]}
      />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-black tracking-tight uppercase">
            {bill.merchant}
          </h1>
          <p className="mt-1 font-mono text-xs tracking-[0.14em] text-foreground/70 uppercase">
            {formatDisplayDate(bill.orderDate)}
            {bill.title ? ` · ${bill.title}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={refreshing || cooldownSeconds > 0}
            onClick={() => void refresh()}
            className={cn(
              "inline-flex h-9 min-w-[9.5rem] items-center justify-center gap-1.5 px-3 disabled:opacity-40 disabled:shadow-none disabled:hover:translate-x-0 disabled:hover:translate-y-0",
              arenaButtonLabel,
              arenaPress
            )}
          >
            {refreshing ? (
              <>
                <ArrowsClockwiseIcon className="size-3.5 animate-spin" />
                Refreshing…
              </>
            ) : cooldownSeconds > 0 ? (
              `Refresh (${cooldownSeconds}s)`
            ) : (
              "Refresh"
            )}
          </button>
          <button
            type="button"
            onClick={() => void copyLink()}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-foreground",
              arenaButtonLabel,
              arenaPress
            )}
          >
            <CopyIcon className="size-3.5" weight="bold" />
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>

      {bill.archived && (
        <p className="arena-slide mt-4 border-2 border-dashed border-arena-line/60 bg-primary/5 px-3 py-2 font-mono text-xs tracking-wider text-foreground/70 uppercase">
          Archived by the merchant. This link keeps working, but the bill no
          longer appears in the public board.
        </p>
      )}

      {/* The money strip: the total and how much of it has settled */}
      <div className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b-2 border-arena-line pb-3">
          <p className="font-mono text-xs font-bold tracking-[0.2em] text-foreground/70 uppercase">
            Total to split
          </p>
          <p className="font-mono text-3xl font-bold tabular-nums md:text-4xl">
            {formatRupiah(bill.finalTotal)}
          </p>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div
            role="progressbar"
            aria-valuenow={paidCount}
            aria-valuemin={0}
            aria-valuemax={bill.billPlayers.length}
            className="h-3 flex-1 border-2 border-arena-line bg-card"
          >
            <div
              className="arena-sweep-x h-full w-full bg-primary"
              style={{
                ...delayStyle(0.15),
                transform: `scaleX(${Math.max(settledShare, 0.02)})`,
              }}
            />
          </div>
          <p className="shrink-0 font-mono text-xs font-bold tracking-[0.14em] uppercase tabular-nums">
            <span className="text-arena-accent">{paidCount}</span>
            <span className="text-foreground/45">
              /{bill.billPlayers.length}
            </span>{" "}
            settled
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section>
          <ArenaSectionHeader
            title="Splits"
            note={
              billPlayers.length === bill.billPlayers.length
                ? `${bill.billPlayers.length} players`
                : `${billPlayers.length} of ${bill.billPlayers.length} players`
            }
          />

          <SearchField
            placeholder="Filter by name or alias"
            label="Filter players by name or alias"
            defaultValue={filter}
            className="mt-4 max-w-none"
            onChange={(value) =>
              void navigate({
                to: ".",
                search: { p: value === "" ? undefined : value },
                replace: true,
              })
            }
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {refreshing
              ? Array.from(
                  {
                    length: billPlayers.length === 0 ? 6 : billPlayers.length,
                  },
                  (_, index) => <PersonCardSkeleton key={index} />
                )
              : billPlayers.map((billPlayer, index) => (
                  <PersonCard
                    key={billPlayer.billPlayerId}
                    billPlayer={billPlayer}
                    position={index + 1}
                  />
                ))}
          </div>
          {!refreshing && billPlayers.length === 0 && (
            <p className="mt-4 border-2 border-dashed border-arena-line/40 px-4 py-8 text-center font-mono text-xs text-foreground/70 uppercase">
              No player matches that filter.
            </p>
          )}
        </section>

        <aside className="space-y-6">
          {bill.imageAvailable && (
            <ArenaPanel>
              <ArenaPanelTitle>Original bill</ArenaPanelTitle>
              <div className="p-4">
                <button
                  type="button"
                  title="View full size"
                  className="w-full cursor-zoom-in"
                  onClick={() => setPreviewOpen(true)}
                >
                  <img
                    src={imageUrl}
                    alt={`Uploaded bill from ${bill.merchant}`}
                    className="w-full border-2 border-arena-line"
                    loading="lazy"
                  />
                </button>
              </div>
            </ArenaPanel>
          )}

          <ArenaPanel>
            <ArenaPanelTitle>Order adjustments</ArenaPanelTitle>
            <div className="p-4">
              <BillSummary
                sourceSubtotal={bill.sourceSubtotal}
                finalTotal={bill.finalTotal}
                adjustments={bill.adjustments}
              />
            </div>
          </ArenaPanel>
        </aside>
      </div>

      {/* Portaled to the body: main carries the arena-rise transform
          animation, which would otherwise become the containing block for
          this fixed overlay and stop it covering the whole viewport. */}
      {bill.imageAvailable &&
        previewOpen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Original bill from ${bill.merchant}`}
            className="fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden bg-black/80 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4"
            onClick={() => setPreviewOpen(false)}
          >
            <div
              className="relative z-10 mb-3 flex w-full shrink-0 items-center justify-end gap-2"
              onClick={(event) => event.stopPropagation()}
            >
              <a
                href={imageUrl}
                target="_blank"
                rel="noreferrer"
                title="Open in new tab"
                aria-label="Open in new tab"
                className="flex size-11 items-center justify-center border-2 border-white/70 bg-black/70 text-white transition-colors hover:bg-white/15"
              >
                <ArrowSquareOutIcon className="size-5" />
              </a>
              <a
                href={imageUrl}
                download={downloadName}
                title="Download"
                aria-label="Download"
                className="flex size-11 items-center justify-center border-2 border-white/70 bg-black/70 text-white transition-colors hover:bg-white/15"
              >
                <DownloadSimpleIcon className="size-5" />
              </a>
              <button
                type="button"
                ref={closeRef}
                title="Close"
                aria-label="Close"
                className="flex size-11 items-center justify-center border-2 border-white/70 bg-black/70 text-white transition-colors hover:bg-white/15"
                onClick={() => setPreviewOpen(false)}
              >
                <XIcon className="size-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <img
                src={imageUrl}
                alt={`Uploaded bill from ${bill.merchant}`}
                className="max-h-full max-w-full object-contain"
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          </div>,
          document.body
        )}
    </main>
  )
}

/**
 * Per-person split card in the arena frame: a rank strip on top (position
 * in the chase order plus their share of the items), who they are, what
 * they owe in the big mono figure, the items they took, and the money
 * detail (line amounts, fee shares, subtotal) behind a disclosure. Paid
 * cards tint primary with a primary slab so settled money reads at a
 * glance. Copy shares just the raw unformatted amount.
 */
function PersonCard({
  billPlayer,
  position,
}: {
  billPlayer: PublicBillPlayerView
  position: number
}) {
  const [copied, setCopied] = useState(false)

  async function copyAmount() {
    try {
      await navigator.clipboard.writeText(String(billPlayer.total))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className={cn(
        "arena-deal relative isolate flex min-w-0 flex-col border-2 border-arena-line focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
        "transition-[translate,box-shadow] duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none motion-reduce:transition-none",
        billPlayer.paid
          ? "bg-primary/5 shadow-[5px_5px_0_0_var(--primary)] hover:shadow-[7px_7px_0_0_var(--primary)]"
          : "bg-card shadow-[5px_5px_0_0_var(--arena-shadow)] hover:shadow-[7px_7px_0_0_var(--arena-shadow)]"
      )}
      style={delayStyle(Math.min(position * 0.05, 0.3))}
    >
      <div
        className={cn(
          "flex items-center justify-between border-b-2 px-3 py-1.5 font-mono text-xs font-bold tracking-[0.2em] uppercase",
          billPlayer.paid
            ? "border-primary/30 text-primary"
            : "border-arena-line bg-primary/10 text-arena-accent"
        )}
      >
        <span>{String(position).padStart(2, "0")}</span>
        <span>{formatPercent(billPlayer.percentage)} of items</span>
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-center gap-3">
          <PersonAvatar
            name={billPlayer.alias}
            size="lg"
            className="rounded-none border-2 text-base"
          />
          <div className="min-w-0 flex-1">
            {billPlayer.playerId ? (
              <PlayerHoverLink
                playerId={billPlayer.playerId}
                className="block truncate font-heading text-base font-black uppercase after:absolute after:inset-0 after:z-10 hover:text-arena-accent"
              >
                {billPlayer.alias}
              </PlayerHoverLink>
            ) : (
              <p className="truncate font-heading text-base font-black uppercase">
                {billPlayer.alias}
              </p>
            )}
          </div>
          <ArenaChip tone={billPlayer.paid ? "solid" : "pending"}>
            {billPlayer.paid ? "Paid" : "Unpaid"}
          </ArenaChip>
        </div>

        <p className="mt-3 font-mono text-2xl font-bold tabular-nums">
          {formatRupiah(billPlayer.total)}
        </p>

        <ul className="mt-2 space-y-0.5 font-mono text-xs text-foreground/70">
          {billPlayer.itemLines.map((line, index) => (
            <li key={index} className="truncate">
              {line.quantity}× {line.name}
              {line.variantNotes ? ` (${line.variantNotes})` : ""}
            </li>
          ))}
        </ul>

        <details className="group mt-3 flex-1">
          <summary className="relative z-20 flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 border-2 border-arena-line bg-card px-3 py-2 font-mono text-sm font-bold tracking-[0.08em] text-foreground uppercase select-none group-open:mb-2 hover:bg-accent [&::-webkit-details-marker]:hidden">
            <span>Breakdown</span>
            <CaretDownIcon
              className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </summary>
          <ul className="space-y-1 font-mono text-xs">
            {billPlayer.itemLines.map((line, index) => (
              <li key={index} className="flex justify-between gap-4">
                <span className="min-w-0">
                  {line.quantity}× {line.name}
                  {line.variantNotes ? (
                    <span className="text-foreground/70">
                      {" "}
                      ({line.variantNotes})
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatRupiah(line.amount)}
                </span>
              </li>
            ))}
            {billPlayer.adjustmentLines.map((line, index) => (
              <li
                key={`adj-${index}`}
                className="flex justify-between gap-4 text-foreground/70"
              >
                <span className="min-w-0 truncate">{line.label}</span>
                <span className="shrink-0 tabular-nums">
                  {formatRupiah(line.amount)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between border-t-2 border-arena-line pt-2 font-mono text-xs font-bold">
            <span>Subtotal</span>
            <span className="tabular-nums">
              {formatRupiah(billPlayer.itemSubtotal)}
            </span>
          </p>
        </details>

        <button
          type="button"
          onClick={() => void copyAmount()}
          className={cn(
            "relative z-20 mt-4 flex h-9 w-full items-center justify-center gap-1.5",
            arenaButtonLabel,
            arenaPress
          )}
        >
          <CopyIcon className="size-3.5" weight="bold" />
          {copied ? "Copied" : "Copy amount"}
        </button>
      </div>
    </div>
  )
}
