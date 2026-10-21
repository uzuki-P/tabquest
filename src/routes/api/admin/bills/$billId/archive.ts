import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { getServerContext } from "@/server/context"
import { errorResponse, json, requireAdminRequest } from "@/server/http"
import { archiveBill } from "@/server/services/bills"

export const Route = createFileRoute("/api/admin/bills/$billId/archive")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const ctx = await getServerContext()
        try {
          const bill = await Effect.runPromise(
            archiveBill({ db: ctx.db }, params.billId)
          )
          return json({ ok: true, bill })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
