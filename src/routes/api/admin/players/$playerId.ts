import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { playerUpdateSchema } from "@/lib/player-schema"
import { getServerContext } from "@/server/context"
import {
  errorResponse,
  json,
  readJsonBody,
  requireAdminRequest,
} from "@/server/http"
import { deletePlayer, updatePlayer } from "@/server/services/players"

export const Route = createFileRoute("/api/admin/players/$playerId")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const body = await readJsonBody(request, playerUpdateSchema)
        if (!body.ok) return body.response

        const ctx = await getServerContext()
        try {
          const player = await Effect.runPromise(
            updatePlayer({ db: ctx.db }, params.playerId, body.value)
          )
          return json({ ok: true, player })
        } catch (error) {
          return errorResponse(error)
        }
      },
      DELETE: async ({ request, params }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const ctx = await getServerContext()
        try {
          await Effect.runPromise(deletePlayer({ db: ctx.db }, params.playerId))
          return json({ ok: true })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
