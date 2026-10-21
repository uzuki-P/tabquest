import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { billStructureSchema } from "@/lib/bill-schema"
import { getServerContext } from "@/server/context"
import {
  errorResponse,
  json,
  readJsonBody,
  requireAdminRequest,
} from "@/server/http"
import { deleteBill, saveStructure } from "@/server/services/bills"

export const Route = createFileRoute("/api/admin/bills/$billId")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const body = await readJsonBody(request, billStructureSchema)
        if (!body.ok) return body.response

        const ctx = await getServerContext()
        try {
          const bill = await Effect.runPromise(
            saveStructure({ db: ctx.db }, params.billId, body.value)
          )
          return json({ ok: true, bill })
        } catch (error) {
          return errorResponse(error)
        }
      },
      DELETE: async ({ request, params }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const ctx = await getServerContext()
        try {
          await Effect.runPromise(
            deleteBill({ db: ctx.db, uploadDir: ctx.uploadDir }, params.billId)
          )
          return json({ ok: true })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
