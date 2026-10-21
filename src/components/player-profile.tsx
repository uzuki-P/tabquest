import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { ArenaChip, ArenaSectionHeader, delayStyle } from "@/components/arena"
import {
  ItemSpendBars,
  merchantSegmentColor,
  MerchantStackBar,
  MonthSpendChart,
} from "@/components/player-charts"
import { PageBreadcrumb } from "@/components/page-breadcrumb"
import { PlayerBadges } from "@/components/player-badges"
import { PlayerHoverLink } from "@/components/player-hover-link"
import { PersonAvatar } from "@/components/person-avatar"
import { formatRupiah } from "@/domain/money"
import { formatPercent } from "@/lib/format"
import { formatDisplayDate } from "@/lib/time"
import type { PlayerProfile } from "@/server/services/insights"

/**
 * The public player profile as an arena dossier: a centered stat header,
 * then one ruled section per question (how much, month by month, where it
 * goes, what they usually order, and who they order with). Data comes from
 * getPlayerProfile, so every number follows the published-bill scope of
 * the home leaderboard.
 */
export function PlayerProfile({ profile }: { profile: PlayerProfile }) {
  const { player } = profile

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
      <PageBreadcrumb
        items={[
          { label: "Home", to: "/" },
          { label: "Players", to: "/players" },
          { label: player.name },
        ]}
      />

      <header className="arena-rise mt-4 flex flex-col items-center text-center">
        <PersonAvatar
          name={player.name}
          className="size-16 rounded-none border-2 border-arena-line text-xl"
        />
        <h1 className="mt-3 font-heading text-3xl font-black tracking-tight uppercase">
          {player.name}
        </h1>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <ArenaChip tone="solid">
            #{profile.rank} of {profile.playerCount} players
          </ArenaChip>
          {player.note && <ArenaChip tone="neutral">{player.note}</ArenaChip>}
        </div>
        <p className="mt-5 font-mono text-5xl font-bold tabular-nums">
          {formatRupiah(profile.totalSpend)}
        </p>
        <p className="mt-1 font-mono text-xs tracking-[0.14em] text-foreground/70 uppercase">
          all-time spend
          {profile.firstOrder && profile.lastOrder && (
            <>
              {" "}
              · {formatDisplayDate(profile.firstOrder)} to{" "}
              {formatDisplayDate(profile.lastOrder)}
            </>
          )}
        </p>
        <p className="mt-3 flex flex-wrap justify-center gap-x-2 font-mono text-xs tracking-wider text-foreground/75 uppercase tabular-nums">
          <span>{profile.orderCount} bills</span>
          <span className="text-foreground/30">/</span>
          <span>{profile.itemCount} items</span>
          <span className="text-foreground/30">/</span>
          <span>avg {formatRupiah(profile.avgPerOrder)}</span>
          {profile.totalDiscount > 0 && (
            <>
              <span className="text-foreground/30">/</span>
              <span className="font-bold text-success">
                saved {formatRupiah(profile.totalDiscount)} (
                {formatPercent(profile.discountRate)})
              </span>
            </>
          )}
        </p>
      </header>

      {profile.outstandingTotal > 0 && (
        <p className="arena-rise mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border border-arena-line bg-primary/10 px-4 py-3 text-center text-sm">
          <span>
            To pay:{" "}
            <span className="font-mono text-base font-bold text-arena-accent tabular-nums">
              {formatRupiah(profile.outstandingTotal)}
            </span>{" "}
            <span className="text-foreground/70">
              ({profile.outstandingBillCount}{" "}
              {profile.outstandingBillCount === 1 ? "bill" : "bills"})
            </span>
          </span>
          <CopyAmountButton amount={profile.outstandingTotal} />
        </p>
      )}

      {profile.biggestOrder && (
        <p className="arena-rise mt-6 border-2 border-gold bg-gold/10 px-4 py-3 text-center text-sm">
          Biggest bill: {profile.biggestOrder.merchant} on{" "}
          {formatDisplayDate(profile.biggestOrder.orderDate)} for{" "}
          <span className="font-mono font-bold tabular-nums">
            {formatRupiah(profile.biggestOrder.total)}
          </span>
        </p>
      )}

      <section className="mt-10">
        <ArenaSectionHeader
          title="Monthly badges"
          note={`${profile.badges.length} earned`}
        />
        <div className="mt-4">
          <PlayerBadges badges={profile.badges} />
        </div>
      </section>

      <section className="mt-10">
        <ArenaSectionHeader title="Month by month" />
        <div className="mt-4">
          <MonthSpendChart monthly={profile.monthly} />
        </div>
      </section>

      <section className="mt-10">
        <ArenaSectionHeader
          title="Where it goes"
          note={`${profile.merchantSplit.length} merchants`}
        />
        <div className="mt-4">
          <MerchantStackBar segments={profile.merchantSplit} />
          <ul className="mt-4 space-y-2">
            {profile.merchantSplit.map((merchant, index) => (
              <li
                key={merchant.merchant}
                className="flex items-center gap-2.5 text-sm"
              >
                <span
                  className="size-2.5 shrink-0"
                  style={{ backgroundColor: merchantSegmentColor(index) }}
                  aria-hidden
                />
                <span className="min-w-0 truncate font-heading text-sm font-black uppercase">
                  {merchant.merchant}
                </span>
                <span className="ml-auto shrink-0 font-mono text-xs whitespace-nowrap text-foreground/70 tabular-nums">
                  {merchant.orders}× · {formatRupiah(merchant.spend)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {profile.favoriteItems.length > 0 && (
        <section className="mt-10">
          <ArenaSectionHeader title="The usual order" />
          <div className="mt-4">
            <ItemSpendBars items={profile.favoriteItems} />
          </div>
        </section>
      )}

      <section className="mt-10">
        <ArenaSectionHeader
          title="Recent bills"
          note={`${profile.recentOrders.length} latest`}
        />
        <ul>
          {profile.recentOrders.map((order, index) => (
            <li
              key={order.publicId}
              className="arena-slide"
              style={delayStyle(Math.min(index * 0.05, 0.25))}
            >
              <Link
                to="/b/$publicId"
                params={{ publicId: order.publicId }}
                className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b-2 border-arena-line px-1 py-3 hover:bg-primary/10 sm:flex sm:items-center sm:gap-3"
              >
                <span className="col-start-1 row-start-1 font-mono text-xs font-bold tracking-wider text-foreground/70 uppercase sm:w-28 sm:shrink-0">
                  {formatDisplayDate(order.orderDate)}
                </span>
                <span className="col-start-1 row-start-2 min-w-0 sm:flex-1">
                  <span className="block font-heading text-sm font-black break-words uppercase group-hover:text-arena-accent sm:truncate">
                    {order.merchant}
                  </span>
                  {order.title && (
                    <span className="block text-xs text-muted-foreground">
                      {order.title}
                    </span>
                  )}
                  <span className="block font-mono text-xs text-foreground/70 uppercase tabular-nums">
                    {itemCountLabel(order.itemCount)}
                  </span>
                </span>
                <span className="col-start-2 row-start-1 sm:shrink-0">
                  <ArenaChip tone={order.paid ? "solid" : "pending"}>
                    {order.paid ? "Paid" : "Unpaid"}
                  </ArenaChip>
                </span>
                <span className="col-start-2 row-start-2 shrink-0 self-start text-right font-mono text-sm font-bold tabular-nums sm:w-24">
                  {formatRupiah(order.share)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {profile.companions.length > 0 && (
        <section className="mt-10 pb-6">
          <ArenaSectionHeader title="The crew" />
          <div className="mt-4 flex flex-wrap gap-2">
            {profile.companions.map((companion) => (
              <PlayerHoverLink
                key={companion.playerId}
                playerId={companion.playerId}
                className="inline-flex items-center gap-2 border-2 border-arena-line bg-card py-1 pr-2.5 pl-1 font-mono text-xs font-bold tracking-wider uppercase transition-[translate,box-shadow] duration-100 hover:-translate-y-0.5 hover:text-arena-accent hover:shadow-[3px_3px_0_0_var(--arena-shadow)] motion-reduce:transition-none"
              >
                <PersonAvatar
                  name={companion.name}
                  size="sm"
                  className="rounded-none border border-arena-line"
                />
                {companion.name}
                <span className="text-foreground/70 tabular-nums">
                  {companion.billCount}×
                </span>
              </PlayerHoverLink>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

/** "3 items", "1 item", or "fees only" when the share has no item rows. */
function itemCountLabel(count: number): string {
  if (count === 0) return "fees only"
  return `${count} ${count === 1 ? "item" : "items"}`
}

/**
 * Copies the raw amount digits (e.g. "9720") so they paste straight into
 * an e-wallet or bank app's transfer field. The label flips to "Copied"
 * for a moment, mirroring the admin bill page's copy-link button.
 */
function CopyAmountButton({ amount }: { amount: number }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard
      .writeText(String(amount))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => setCopied(false))
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="border border-arena-line px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider text-foreground/75 uppercase transition-colors hover:text-arena-accent"
    >
      {copied ? "Copied" : "Copy amount"}
    </button>
  )
}
