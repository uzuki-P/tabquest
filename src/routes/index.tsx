import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { MonthLeaderboard } from "@/components/month-leaderboard"
import { HomeBoardSkeleton } from "@/components/page-skeletons"
import { publicBillQuerySchema } from "@/lib/bill-schema"
import { isValidDateString, todayJakarta } from "@/lib/time"
import { getServerContext } from "@/server/context"
import { listPublishedSummariesBetween } from "@/server/services/bills"
import {
  listMonthlyLeaderboard,
  listMonthlyTips,
} from "@/server/services/insights"

const listBillsForMonth = createServerFn({ method: "GET" })
  .validator((date: string) => date)
  .handler(async ({ data }) => {
    const anchor = isValidDateString(data) ? data : todayJakarta()
    const first = Temporal.PlainDate.from(anchor).with({ day: 1 })
    const last = first.add({ months: 1 }).subtract({ days: 1 })
    const ctx = await getServerContext()
    return Effect.runPromise(
      listPublishedSummariesBetween(
        { db: ctx.db },
        first.toString(),
        last.toString()
      )
    )
  })

const fetchLeaderboard = createServerFn({ method: "GET" })
  .validator((range: { from: string; to: string }) => range)
  .handler(async ({ data }) => {
    const ctx = await getServerContext()
    return Effect.runPromise(
      listMonthlyLeaderboard({ db: ctx.db }, data.from, data.to)
    )
  })

const fetchTips = createServerFn({ method: "GET" })
  .validator((range: { from: string; to: string }) => range)
  .handler(async ({ data }) => {
    const ctx = await getServerContext()
    return Effect.runPromise(
      listMonthlyTips({ db: ctx.db }, data.from, data.to)
    )
  })

export const Route = createFileRoute("/")({
  validateSearch: publicBillQuerySchema,
  loaderDeps: ({ search: { date } }) => ({ date }),
  loader: async ({ deps: { date } }) => {
    const day = date ?? todayJakarta()
    const first = Temporal.PlainDate.from(day).with({ day: 1 })
    const last = first.add({ months: 1 }).subtract({ days: 1 })
    const previousMonth = first.subtract({ months: 1 }).toString()
    const [bills, previousBills, leaderboard, tips] = await Promise.all([
      listBillsForMonth({ data: day }),
      listBillsForMonth({ data: previousMonth }),
      fetchLeaderboard({
        data: { from: first.toString(), to: last.toString() },
      }),
      fetchTips({ data: { from: first.toString(), to: last.toString() } }),
    ])
    return { date: day, bills, previousBills, leaderboard, tips }
  },
  component: HomePage,
  pendingComponent: HomeBoardSkeleton,
})

function HomePage() {
  const { date, bills, previousBills, leaderboard, tips } =
    Route.useLoaderData()

  return (
    <MonthLeaderboard
      anchorKey={date}
      bills={bills}
      previousBills={previousBills}
      leaderboard={leaderboard}
      tips={tips}
    />
  )
}
