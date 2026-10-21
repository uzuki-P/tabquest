import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { isValidDateString } from "@/lib/time"
import { getServerContext } from "@/server/context"
import { errorResponse, json, requireAdminRequest } from "@/server/http"
import { listPlayerInsights } from "@/server/services/insights"

export const Route = createFileRoute("/api/admin/insights/players")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const url = new URL(request.url)
        const from = url.searchParams.get("from")
        const to = url.searchParams.get("to")
        const given = from !== null || to !== null
        if (
          given &&
          (from === null ||
            to === null ||
            !isValidDateString(from) ||
            !isValidDateString(to) ||
            from > to)
        ) {
          return json(
            {
              error: "invalid-request",
              message: "from and to must be YYYY-MM-DD dates, from <= to.",
            },
            400
          )
        }

        const ctx = await getServerContext()
        try {
          const insights = await Effect.runPromise(
            listPlayerInsights(
              { db: ctx.db },
              from !== null && to !== null ? { from, to } : undefined
            )
          )
          return json({ ok: true, insights })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
