import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server"

import { loadEnv } from "./server/env"
import { publicRuntimeGate } from "./server/gate"

const env = loadEnv()
const appFetch = createStartHandler(defaultStreamHandler)

/**
 * Applied to every response leaving the app, whichever host fronts it: the
 * local runner (scripts/serve.ts) and the Vercel function both serve shared
 * bill pages, and neither should let the origin re-sniff content types or
 * leak referrers cross-origin. scripts/serve.ts sets the same pair on its
 * static file responses; Headers.set overwrites, so the duplication is
 * harmless.
 *
 * Builds a new Response instead of mutating in place: the Vercel function
 * runtime (h3/srvx) freezes response headers before this wrapper sees them,
 * and Headers.set on a frozen instance throws "Headers are frozen", which
 * 500s every render.
 */
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set("x-content-type-options", "nosniff")
  headers.set("referrer-policy", "strict-origin-when-cross-origin")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (env.TABQUEST_RUNTIME === "public") {
      const denied = publicRuntimeGate(request)
      if (denied) return withSecurityHeaders(denied)
    }
    return Promise.resolve(appFetch(request)).then(withSecurityHeaders)
  },
}
