import { Link } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { useState } from "react"
import type { ComponentProps } from "react"

import { PlayerBadges } from "@/components/player-badges"
import { PersonAvatar } from "@/components/person-avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatRupiah } from "@/domain/money"
import { profileLink } from "@/lib/links"
import { getServerContext } from "@/server/context"
import { getPlayerHoverSummary } from "@/server/services/insights"
import type { PlayerHoverSummary } from "@/server/services/insights"

const fetchPlayerHover = createServerFn({ method: "GET" })
  .validator((playerId: string) => playerId)
  .handler(async ({ data }): Promise<PlayerHoverSummary | null> => {
    const ctx = await getServerContext()
    return Effect.runPromise(getPlayerHoverSummary({ db: ctx.db }, data))
  })

const pendingHoverRequests = new Map<
  string,
  Promise<PlayerHoverSummary | null>
>()

function loadPlayer(playerId: string) {
  const pending = pendingHoverRequests.get(playerId)
  if (pending) return pending
  const request = fetchPlayerHover({ data: playerId })
  pendingHoverRequests.set(playerId, request)
  const clear = () => pendingHoverRequests.delete(playerId)
  request.then(clear, clear)
  return request
}

export function PlayerHoverLink({
  playerId,
  children,
  ...props
}: Pick<ComponentProps<"a">, "children" | "className" | "style" | "title"> & {
  playerId: string
}) {
  const [data, setData] = useState<PlayerHoverSummary | null>(null)
  const [loading, setLoading] = useState(false)

  function onOpenChange(open: boolean) {
    if (!open) return
    if (!data) setLoading(true)
    loadPlayer(playerId)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  return (
    <Tooltip onOpenChange={onOpenChange}>
      <TooltipTrigger
        render={
          <Link {...profileLink(playerId)} {...props}>
            {children}
          </Link>
        }
      />
      <TooltipContent
        side="bottom"
        className="w-72 max-w-[calc(100vw-2rem)] border-2 border-arena-line bg-card p-3 text-foreground shadow-[4px_4px_0_0_var(--arena-shadow)]"
      >
        {data ? (
          <>
            <div className="flex items-center gap-2 border-b border-arena-line pb-2">
              <PersonAvatar
                name={data.name}
                size="sm"
                className="rounded-none border border-arena-line"
              />
              <div className="min-w-0">
                <p className="truncate font-heading text-sm font-black uppercase">
                  {data.name}
                </p>
                <p className="font-mono text-[10px] text-foreground/70 uppercase">
                  #{data.rank} · {data.orderCount} bills
                </p>
              </div>
            </div>
            <p className="mt-2 font-mono text-xs tabular-nums">
              Spent {formatRupiah(data.totalSpend)} · Net tips{" "}
              {formatRupiah(data.totalTips)}
            </p>
            <div className="mt-2">
              <PlayerBadges badges={data.badges} compact />
            </div>
          </>
        ) : (
          <p className="font-mono text-xs">
            {loading ? "Loading player…" : "Player details unavailable."}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
