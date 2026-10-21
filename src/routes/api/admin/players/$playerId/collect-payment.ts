import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { Effect } from "effect"

import { getServerContext } from "@/server/context"
import {
  errorResponse,
  json,
  readJsonBody,
  requireAdminRequest,
} from "@/server/http"
import { resolveActor } from "@/server/identity"
import { collectPayment } from "@/server/services/payments"

/**
 * Settles every unpaid share of one player from a single handover:
 * `{ totalPaid }` covers the full outstanding amount plus any round-up,
 * which is recorded as a tip on the most recent bill.
 */
const bodySchema = z.object({
  totalPaid: z.number().int().min(0),
})

export const Route = createFileRoute(
  "/api/admin/players/$playerId/collect-payment"
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const body = await readJsonBody(request, bodySchema)
        if (!body.ok) return body.response

        const ctx = await getServerContext()
        const actor = resolveActor(
          request,
          ctx.env.TABQUEST_TRUST_TAILSCALE_HEADERS
        )
        try {
          const collected = await Effect.runPromise(
            collectPayment(
              { db: ctx.db },
              {
                playerId: params.playerId,
                totalPaid: body.value.totalPaid,
                actor,
              }
            )
          )
          return json({ ok: true, collected })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
