/**
 * Deployed origins. The same build runs twice: the public runtime sits
 * behind Cloudflare, the admin runtime behind Tailscale Serve. Links that
 * cross between the two must be absolute, and shareable bill links must
 * always name the public origin so they resolve for people outside the
 * tailnet.
 */
export const PUBLIC_ORIGIN = "https://tabquest.example.com"
export const ADMIN_ORIGIN = "https://tabquest-admin.example.ts.net"

/** Canonical share URL for a published bill. */
export function publicBillUrl(publicId: string): string {
  return `${PUBLIC_ORIGIN}/b/${publicId}`
}
