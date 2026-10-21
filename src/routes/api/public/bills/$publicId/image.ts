import { createFileRoute } from "@tanstack/react-router"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"

import { getServerContext } from "@/server/context"
import { errorResponse } from "@/server/http"
import { getPublishedImage } from "@/server/services/bills"

const OBJECT_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/

export const Route = createFileRoute("/api/public/bills/$publicId/image")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const ctx = await getServerContext()
        try {
          const image = await Effect.runPromise(
            getPublishedImage({ db: ctx.db }, params.publicId)
          )
          if (!OBJECT_KEY_PATTERN.test(image.objectKey)) {
            return new Response("Not Found", { status: 404 })
          }
          const filePath = path.join(
            path.resolve(ctx.uploadDir),
            image.objectKey
          )
          let body: Buffer
          try {
            body = await readFile(filePath)
          } catch {
            // Missing or unreadable files answer 404 on the public runtime;
            // the error details are never leaked.
            return new Response("Not Found", { status: 404 })
          }
          return new Response(new Uint8Array(body), {
            headers: {
              "content-type": image.mediaType,
              "cache-control": "public, max-age=86400",
              "x-content-type-options": "nosniff",
            },
          })
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})
