/**
 * Deny-by-default runtime gate, applied before route handling.
 *
 * The public process returns 404 for every admin page and mutation. Admin
 * paths are matched after aggressive normalization so encoded, doubled-slash,
 * and dot-segment variants cannot slip through. Server-function RPC calls
 * are inspected by function ID because their URLs do not carry the route
 * path.
 */

const SERVER_FN_PREFIX = "/_serverFn/"

export function normalizePath(rawPathname: string): string {
  let decoded = rawPathname
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  const segments: string[] = []
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `/${segments.join("/")}`
}

export function isAdminPath(pathname: string): boolean {
  const normalized = normalizePath(pathname)
  return (
    normalized === "/admin" ||
    normalized.startsWith("/admin/") ||
    normalized === "/api/admin" ||
    normalized.startsWith("/api/admin/")
  )
}

/** True for browser-visible admin pages (not the `/api/admin` RPC tree). */
export function isAdminPagePath(pathname: string): boolean {
  const normalized = normalizePath(pathname)
  return normalized === "/admin" || normalized.startsWith("/admin/")
}

/** Extracts the server-function ID from a `/_serverFn/<id>/...` path. */
export function serverFnIdFromPath(pathname: string): string | null {
  const normalized = normalizePath(pathname)
  if (normalized === SERVER_FN_PREFIX) return null
  if (!normalized.startsWith(SERVER_FN_PREFIX)) return null
  const id = normalized.slice(SERVER_FN_PREFIX.length).split("/")[0] ?? ""
  return id.length > 0 ? id : null
}

/**
 * Decides whether a server-function ID belongs to admin-only code. IDs
 * produced in dev are base64url JSON referencing the source file; IDs
 * produced by the build use the custom generator in vite.config.ts, which
 * encodes `path#export` the same way. Undecodable IDs are treated as admin
 * so unknown encodings fail closed.
 */
export function isAdminServerFnId(id: string): boolean {
  let decoded: string
  try {
    decoded = Buffer.from(id, "base64url").toString("utf8")
  } catch {
    return true
  }
  if (decoded.includes("\uFFFD")) return true
  return decoded.includes("routes/admin/") || decoded.includes("server/admin")
}

/**
 * Returns a 404 Response when the request must not reach route handling in
 * the public runtime, or null when the request may proceed.
 */
export function publicRuntimeGate(request: Request): Response | null {
  const url = new URL(request.url)
  if (isAdminPath(url.pathname)) {
    return isAdminPagePath(url.pathname) ? notFoundPage() : notFound()
  }
  const serverFnId = serverFnIdFromPath(url.pathname)
  if (serverFnId !== null && isAdminServerFnId(serverFnId)) {
    return notFound()
  }
  return null
}

export function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}

/**
 * Styled 404 for admin page requests in the public runtime. Mirrors the
 * app's not-found page (`src/routes/__root.tsx`) without loading the
 * router: the admin route tree still never renders. Colors match the
 * Tailwind theme in `src/styles.css` for light and dark schemes.
 */
export function notFoundPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · Tabquest</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: oklch(0.982446 0.010114 325.653);
  color: oklch(0.325698 0.116116 325.037);
  font-family: system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.card {
  width: 100%;
  max-width: 32rem;
  padding: 2.5rem 2rem 2rem;
  text-align: center;
  border: 1px solid oklch(0.923531 0.021247 328.096);
  border-radius: 0.45rem;
  background: oklch(0.971835 0.012884 321.894);
}
.code {
  margin: 0;
  font-size: 3.75rem;
  line-height: 1;
  font-weight: 600;
  color: oklch(0.591646 0.217985 0.584);
}
h1 { margin: 0.75rem 0 0; font-size: 1.25rem; font-weight: 500; }
p { margin: 0.5rem 0 0; font-size: 0.875rem; color: oklch(0.428932 0.163929 354.332); }
.button {
  display: inline-block;
  margin-top: 1.5rem;
  padding: 0.5rem 1.25rem;
  border-radius: 0.45rem;
  background: oklch(0.591646 0.217985 0.584);
  color: #fff;
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
}
.button:hover { filter: brightness(1.08); }
@media (prefers-color-scheme: dark) {
  body {
    background: oklch(0.22813 0.020366 307.469);
    color: oklch(0.980735 0.004092 301.426);
  }
  .card {
    border-color: oklch(0.266943 0.015262 302.425);
    background: oklch(0.267101 0.02016 311.799);
  }
  .code { color: oklch(0.460685 0.185347 4.099); }
  p { color: oklch(0.880303 0.03077 342.696); }
  .button { background: oklch(0.460685 0.185347 4.099); color: oklch(0.901233 0.057189 343.694); }
}
</style>
</head>
<body>
<main class="card">
<p class="code">404</p>
<h1>Page not found</h1>
<p>The page you are looking for does not exist or has moved.</p>
<a class="button" href="/">Go home</a>
</main>
</body>
</html>`
  return new Response(html, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  })
}
