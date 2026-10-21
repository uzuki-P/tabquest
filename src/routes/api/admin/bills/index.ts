import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import {
  billHeaderSchema,
  billStructureRowsSchema,
  parseRupiahField,
} from "@/lib/bill-schema"
import { getServerContext } from "@/server/context"
import {
  errorResponse,
  json,
  requireAdminRequest,
  zodIssues,
} from "@/server/http"
import { createBill, createFullBill } from "@/server/services/bills"
import { storeBillImage } from "@/server/services/images"

export const Route = createFileRoute("/api/admin/bills/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const ctx = await getServerContext()
        try {
          const form = await request.formData()
          const stringField = (name: string): string | null => {
            const value = form.get(name)
            return typeof value === "string" ? value : null
          }
          const header = billHeaderSchema.safeParse({
            merchant: String(form.get("merchant") ?? ""),
            title: String(form.get("title") ?? ""),
            orderDate: String(form.get("orderDate") ?? ""),
            currency: "IDR",
            sourceSubtotal: parseRupiahField(stringField("sourceSubtotal")),
            finalTotal: parseRupiahField(stringField("finalTotal")),
          })
          if (!header.success) {
            return json(
              { error: "invalid-request", issues: zodIssues(header.error) },
              400
            )
          }

          const file = form.get("image")
          let stored = null
          if (file instanceof File && file.size > 0) {
            stored = await Effect.runPromise(
              storeBillImage({ uploadDir: ctx.uploadDir }, file)
            )
          }

          // Full form: header fields plus the non-header structure rows in
          // one request, created in a single transaction.
          const structureRaw = stringField("structure")
          if (structureRaw !== null) {
            let rowsJson: unknown
            try {
              rowsJson = JSON.parse(structureRaw)
            } catch {
              return json(
                { error: "invalid-request", message: "structure: not JSON" },
                400
              )
            }
            const rows = billStructureRowsSchema.safeParse(rowsJson)
            if (!rows.success) {
              return json(
                {
                  error: "invalid-request",
                  issues: zodIssues(rows.error),
                  message: "The bill structure is invalid.",
                },
                400
              )
            }
            const bill = await Effect.runPromise(
              createFullBill({ db: ctx.db }, header.data, rows.data, stored)
            )
            return json(
              { ok: true, billId: bill.id, publicId: bill.publicId },
              201
            )
          }

          // Header-only fallback: placeholders for billPlayers.
          const billPlayerCountRaw = Number(form.get("billPlayerCount") ?? 1)
          const billPlayerCount = Number.isInteger(billPlayerCountRaw)
            ? Math.min(Math.max(billPlayerCountRaw, 1), 50)
            : 1

          const bill = await Effect.runPromise(
            createBill({ db: ctx.db }, header.data, stored, billPlayerCount)
          )
          return json(
            { ok: true, billId: bill.id, publicId: bill.publicId },
            201
          )
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
