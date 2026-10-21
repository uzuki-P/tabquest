import path from "node:path"
import { pathToFileURL } from "node:url"

import { loadEnv } from "../src/server/env"

const projectRoot = path.resolve(import.meta.dir, "..")
const clientDir = path.join(projectRoot, "dist", "client")
const serverBundle = path.join(projectRoot, "dist", "server", "server.js")

const env = loadEnv()

/**
 * Activates the plugin's SPA render mode in the server bundle, mirroring
 * the `spa: { enabled: true }` plugin option (which sets this define only
 * in dev): every document request serves the root shell instead of SSR,
 * while `/api/*` routes and `/_serverFn/*` RPCs are untouched. The public
 * runtime gate still runs ahead of this in src/server.ts. Must be set
 * before the bundle below is imported.
 */
process.env.TSS_SHELL = "true"

const { default: app } = (await import(
  pathToFileURL(serverBundle).toString()
)) as {
  default: { fetch: (request: Request) => Response | Promise<Response> }
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
}

function serveStatic(pathname: string): Response | null {
  if (pathname.includes("..")) return null
  const relative = pathname.replace(/^\/+/, "")
  if (relative.length === 0) return null
  const filePath = path.join(clientDir, relative)
  const file = Bun.file(filePath)
  // Hashed build output is immutable; everything else revalidates.
  const immutable = relative.startsWith("assets/")
  return new Response(file, {
    headers: {
      "content-type":
        MIME_TYPES[path.extname(filePath).toLowerCase()] ??
        "application/octet-stream",
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    },
  })
}

const server = Bun.serve({
  hostname: env.TABQUEST_HOST,
  port: env.TABQUEST_PORT,
  idleTimeout: 30,
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "GET" || request.method === "HEAD") {
      const headers = new Headers()
      // Never let the origin advertise stronger framing for shared bill pages.
      headers.set("x-content-type-options", "nosniff")
      headers.set("referrer-policy", "strict-origin-when-cross-origin")
      const candidate = [
        "manifest.json",
        "robots.txt",
        "favicon.svg",
        "favicon.ico",
        "service-worker.js",
      ]
      const relative = url.pathname.replace(/^\/+/, "")
      if (relative.startsWith("assets/") || candidate.includes(relative)) {
        const response = serveStatic(url.pathname)
        if (response) {
          for (const [key, value] of headers) response.headers.set(key, value)
          return response
        }
      }
    }
    return app.fetch(request)
  },
})

console.log(
  `[tabquest] runtime=${env.TABQUEST_RUNTIME} listening on http://${server.hostname}:${server.port} (db: ${env.TABQUEST_DATABASE_URL})`
)
