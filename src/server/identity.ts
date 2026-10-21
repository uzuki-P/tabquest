/**
 * Resolves the acting admin identity for audit events.
 *
 * Tailscale Serve strips incoming identity headers and adds its own, so the
 * values are trustworthy only when the request actually arrived through
 * Serve. That is controlled by TABQUEST_TRUST_TAILSCALE_HEADERS, which is set
 * only in the admin process that listens on loopback behind Serve.
 */

export const ANONYMOUS_ACTOR = "tailnet-anonymous"
export const LOCAL_ACTOR = "local"

export function resolveActor(
  request: Request,
  trustTailscaleHeaders: boolean
): string {
  if (!trustTailscaleHeaders) return LOCAL_ACTOR
  const login = request.headers.get("tailscale-user-login")
  if (login) return login
  const name = request.headers.get("tailscale-user-name")
  if (name) return name
  return ANONYMOUS_ACTOR
}

/**
 * True when the request's Origin matches where the browser actually saw the
 * app. Behind Caddy (dev-router) or Tailscale Serve, Bun sees the upstream
 * URL like http://127.0.0.1:54096 while the browser origin is
 * https://<hostname>; both proxies add X-Forwarded-Proto/-Host, so all three
 * candidate origins are compared.
 */
function originMatches(request: Request): boolean {
  const originHeader = request.headers.get("origin")
  if (!originHeader) return true
  let incomingOrigin: string
  try {
    incomingOrigin = new URL(originHeader).origin
  } catch {
    return false
  }

  const candidates = new Set<string>()
  try {
    candidates.add(new URL(request.url).origin)
  } catch {
    // Unparseable URL; rely on forwarded headers below.
  }
  const first = (value: string | null): string =>
    value?.split(",")[0]?.trim() ?? ""
  const proto = first(request.headers.get("x-forwarded-proto"))
  if (proto !== "http" && proto !== "https") {
    // No usable forwarded proto: direct connection, request.url decided.
    return candidates.has(incomingOrigin)
  }
  for (const host of [
    first(request.headers.get("x-forwarded-host")),
    first(request.headers.get("host")),
  ]) {
    if (host) candidates.add(`${proto}://${host}`)
  }
  return candidates.has(incomingOrigin)
}

/**
 * Rejects cross-site mutations aimed at the admin origin. Browsers cannot
 * forge Origin or Sec-Fetch-Site, so this blocks CSRF form posts; proxy
 * chains are accounted for via forwarded headers.
 */
export function isCrossSiteMutation(request: Request): boolean {
  const method = request.method.toUpperCase()
  if (method === "GET" || method === "HEAD" || method === "OPTIONS")
    return false
  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")
    return true
  return !originMatches(request)
}
