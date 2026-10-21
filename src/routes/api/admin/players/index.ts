import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { playerCreateSchema } from "@/lib/player-schema"
import { getServerContext } from "@/server/context"
import {
  errorResponse,
  json,
  readJsonBody,
  requireAdminRequest,
} from "@/server/http"
import { createPlayer, listPlayers } from "@/server/services/players"

export const Route = createFileRoute("/api/admin/players/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const url = new URL(request.url)
        const q = url.searchParams.get("q") ?? undefined
        const includeArchived =
          url.searchParams.get("includeArchived") === "true"

        const ctx = await getServerContext()
        try {
          const rows = await Effect.runPromise(
            listPlayers({ db: ctx.db }, { q, includeArchived })
          )
          return json({ ok: true, players: rows })
        } catch (error) {
          return errorResponse(error)
        }
      },
      POST: async ({ request }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const body = await readJsonBody(request, playerCreateSchema)
        if (!body.ok) return body.response

        const ctx = await getServerContext()
        try {
          const player = await Effect.runPromise(
            createPlayer({ db: ctx.db }, body.value)
          )
          return json({ ok: true, player }, 201)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
