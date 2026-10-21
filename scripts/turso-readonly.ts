/** Read-only Turso credentials from local dev env or the production env file. */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export function tursoReadonlyCredentials() {
  const filename = path.resolve(".env.prod")
  const config = existsSync(filename) ? readFileSync(filename, "utf8") : ""
  const fromProd = (name: string) =>
    config
      .match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, "")
  const url = fromProd("TABQUEST_DATABASE_URL") || process.env.TABQUEST_TURSO_URL
  const authToken =
    fromProd("TABQUEST_TURSO_READONLY_TOKEN") ||
    process.env.TABQUEST_TURSO_READONLY_TOKEN
  if (!url?.startsWith("libsql://") || !authToken) {
    throw new Error(
      "Set a Turso URL and TABQUEST_TURSO_READONLY_TOKEN in .env.local for development or .env.prod on production."
    )
  }
  return { url, authToken }
}
