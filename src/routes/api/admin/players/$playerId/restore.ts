import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { getServerContext } from "@/server/context"
import { errorResponse, json, requireAdminRequest } from "@/server/http"
import { restorePlayer } from "@/server/services/players"

export const Route = createFileRoute("/api/admin/players/$playerId/restore")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const ctx = await getServerContext()
        try {
          const player = await Effect.runPromise(
            restorePlayer({ db: ctx.db }, params.playerId)
          )
          return json({ ok: true, player })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
