import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { TipBoard } from "@/components/tip-board"
import { TipsSkeleton } from "@/components/page-skeletons"
import { getServerContext } from "@/server/context"
import {
  listMonthlyTips,
  listPublishedMonthKeys,
} from "@/server/services/insights"

const fetchMonthKeys = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await getServerContext()
  return Effect.runPromise(listPublishedMonthKeys({ db: ctx.db }))
})

const fetchTips = createServerFn({ method: "GET" })
  .validator((monthKey: string) => monthKey)
  .handler(async ({ data }) => {
    const ctx = await getServerContext()
    const first = `${data}-01`
    const last = Temporal.PlainDate.from(first)
      .add({ months: 1 })
      .subtract({ days: 1 })
      .toString()
    return Effect.runPromise(listMonthlyTips({ db: ctx.db }, first, last))
  })

const emptyBoard = {
  rows: [],
  tippedTotal: 0,
  recordedCount: 0,
  billCount: 0,
}

export const Route = createFileRoute("/tips")({
  // Undefined, not null, so the router drops the param and /tips stays a
  // clean URL instead of growing ?month=null on every visit.
  validateSearch: (search: Record<string, unknown>) => ({
    month:
      typeof search.month === "string" && /^\d{4}-\d{2}$/.test(search.month)
        ? search.month
        : undefined,
  }),
  loaderDeps: ({ search: { month } }) => ({ month }),
  loader: async ({ deps: { month } }) => {
    const monthKeys = await fetchMonthKeys()
    // No month chosen means the latest one with published bills, so the
    // board opens on something populated instead of an empty current month.
    const chosen =
      month && monthKeys.includes(month) ? month : (monthKeys.at(-1) ?? null)
    const board = chosen ? await fetchTips({ data: chosen }) : emptyBoard
    return { monthKey: chosen, monthKeys, board }
  },
  component: TipsPage,
  pendingComponent: TipsSkeleton,
})

function TipsPage() {
  const { monthKey, monthKeys, board } = Route.useLoaderData()
  return <TipBoard monthKey={monthKey} monthKeys={monthKeys} board={board} />
}
