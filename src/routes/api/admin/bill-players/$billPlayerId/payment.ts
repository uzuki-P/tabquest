import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { Effect } from "effect"

import { paymentStateSchema } from "@/lib/bill-schema"
import { getServerContext } from "@/server/context"
import {
  errorResponse,
  json,
  readJsonBody,
  requireAdminRequest,
} from "@/server/http"
import { resolveActor } from "@/server/identity"
import { recordPaidAmount, setPaymentState } from "@/server/services/payments"

/**
 * Two one-shot actions: `{ state }` toggles unpaid/paid, `{ paidAmount }`
 * records what the billPlayer actually handed over (null clears it) and
 * marks them paid.
 */
const bodySchema = z
  .object({
    state: paymentStateSchema.optional(),
    paidAmount: z.number().int().min(0).nullable().optional(),
  })
  .refine(
    (body) => body.state !== undefined || body.paidAmount !== undefined,
    "Provide a state or a paidAmount"
  )

export const Route = createFileRoute(
  "/api/admin/bill-players/$billPlayerId/payment"
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
          const status =
            body.value.paidAmount !== undefined
              ? await Effect.runPromise(
                  recordPaidAmount(
                    { db: ctx.db },
                    {
                      billPlayerId: params.billPlayerId,
                      paidAmount: body.value.paidAmount,
                      actor,
                    }
                  )
                )
              : await Effect.runPromise(
                  setPaymentState(
                    { db: ctx.db },
                    {
                      billPlayerId: params.billPlayerId,
                      state: body.value.state!,
                      actor,
                    }
                  )
                )
          return json({ ok: true, status })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
