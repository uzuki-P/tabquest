/**
 * Deployed origins. The same build runs twice: the public runtime sits
 * behind Cloudflare, the admin runtime behind Tailscale Serve. Links that
 * cross between the two must be absolute, and shareable bill links must
 * always name the public origin so they resolve for people outside the
 * tailnet.
 *
 * Real hostnames stay out of the repository: set them in the untracked
 * .env.local (and the Vercel project environment). Production builds refuse
 * to run without them (vite.config.ts, deploy/check-prod.ts).
 */
export const PUBLIC_ORIGIN: string =
  import.meta.env.VITE_TABQUEST_PUBLIC_ORIGIN || "https://tabquest.example.com"
export const ADMIN_ORIGIN: string =
  import.meta.env.VITE_TABQUEST_ADMIN_ORIGIN ||
  "https://tabquest-admin.example.ts.net"

/** Canonical share URL for a published bill. */
export function publicBillUrl(publicId: string): string {
  return `${PUBLIC_ORIGIN}/b/${publicId}`
}
