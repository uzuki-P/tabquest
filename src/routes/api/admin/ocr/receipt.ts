import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { getServerContext } from "@/server/context"
import { errorResponse, json, requireAdminRequest } from "@/server/http"
import { OcrNotConfigured, parseReceiptImage } from "@/server/services/ocr"

export const Route = createFileRoute("/api/admin/ocr/receipt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const ctx = await getServerContext()
        const visionApiUrl = ctx.env.VISION_API_URL
        if (!ctx.env.VISION_API_TOKEN || !visionApiUrl) {
          return errorResponse(new OcrNotConfigured())
        }

        try {
          let form: FormData
          try {
            form = await request.formData()
          } catch {
            return json(
              {
                error: "invalid-request",
                message: "Send the receipt as multipart form data.",
              },
              400
            )
          }
          const file = form.get("image")
          if (!(file instanceof File) || file.size === 0) {
            return json(
              {
                error: "invalid-request",
                message: "Attach a receipt image in the image field.",
              },
              400
            )
          }

          const { receipt, redactions } = await Effect.runPromise(
            parseReceiptImage(
              {
                token: ctx.env.VISION_API_TOKEN,
                model: ctx.env.VISION_API_MODEL,
                reasoningEffort: ctx.env.VISION_API_REASONING_EFFORT,
                baseUrl: visionApiUrl,
                timeoutMs: ctx.env.VISION_API_TIMEOUT_MS,
              },
              file
            )
          )
          return json({ ok: true, receipt, redactions })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
