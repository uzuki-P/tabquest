import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { getServerContext } from "@/server/context"
import { errorResponse, json } from "@/server/http"
import { getPublishedBill } from "@/server/services/bills"

export const Route = createFileRoute("/api/public/bills/$publicId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const ctx = await getServerContext()
        try {
          const view = await Effect.runPromise(
            getPublishedBill({ db: ctx.db }, params.publicId)
          )
          return json(view, 200, { "cache-control": "no-store" })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
