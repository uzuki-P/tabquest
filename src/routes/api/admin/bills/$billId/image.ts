import { createFileRoute } from "@tanstack/react-router"
import path from "node:path"
import { Effect } from "effect"

import { getServerContext } from "@/server/context"
import { errorResponse, json, requireAdminRequest } from "@/server/http"
import { getAdminImage, replaceImage } from "@/server/services/bills"
import { storeBillImage } from "@/server/services/images"

const OBJECT_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/

export const Route = createFileRoute("/api/admin/bills/$billId/image")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const ctx = await getServerContext()
        try {
          const image = await Effect.runPromise(
            getAdminImage({ db: ctx.db }, params.billId)
          )
          if (!OBJECT_KEY_PATTERN.test(image.objectKey)) {
            return new Response("Not Found", { status: 404 })
          }
          const file = Bun.file(
            path.join(path.resolve(ctx.uploadDir), image.objectKey)
          )
          if (!(await file.exists()))
            return new Response("Not Found", { status: 404 })
          return new Response(file, {
            headers: {
              "content-type": image.mediaType,
              "cache-control": "no-store",
            },
          })
        } catch (error) {
          return errorResponse(error)
        }
      },
      POST: async ({ request, params }) => {
        const denied = await requireAdminRequest(request)
        if (denied) return denied

        const ctx = await getServerContext()
        try {
          const form = await request.formData()
          const file = form.get("image")
          if (!(file instanceof File) || file.size === 0) {
            return json(
              {
                error: "invalid-request",
                message: "Attach the bill image as the image field.",
              },
              400
            )
          }
          const stored = await Effect.runPromise(
            storeBillImage({ uploadDir: ctx.uploadDir }, file)
          )
          const bill = await Effect.runPromise(
            replaceImage({ db: ctx.db }, params.billId, stored)
          )
          return json({ ok: true, bill })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
