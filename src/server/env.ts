import { z } from "zod"

/**
 * Environment validation. Bun loads .env automatically; Zod checks required
 * values once at startup.
 */

const envSchema = z.object({
  /** "admin" serves public and admin routes; "public" denies admin routes. */
  TABQUEST_RUNTIME: z.enum(["admin", "public"]).default("admin"),
  TABQUEST_HOST: z.string().default("127.0.0.1"),
  TABQUEST_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /**
   * Any @libsql/client url: libsql:// for Turso, file:./data/tabquest.db for
   * local development (the default), :memory: for throwaway runs. Remote
   * cutover sets this in the environment; nothing else changes.
   */
  TABQUEST_DATABASE_URL: z.string().min(1).default("file:./data/tabquest.db"),
  /** Auth token for remote databases. The public runtime sets a read-only
   * token, the admin runtime a write token. Unset for file:/memory urls. */
  TABQUEST_DATABASE_AUTH_TOKEN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional()
  ),
  TABQUEST_UPLOAD_DIR: z.string().min(1).default("./data/uploads"),
  TABQUEST_TRUST_TAILSCALE_HEADERS: z.stringbool().default(false),
  /** vision-api bearer token for receipt OCR. OCR is disabled when unset. */
  VISION_API_TOKEN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional()
  ),
  /** vision-api base URL. OCR is disabled when unset. */
  VISION_API_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url().optional()
  ),
  VISION_API_MODEL: z.string().min(1).default("zai-coding-plan/glm-5.3-flash"),
  VISION_API_REASONING_EFFORT: z.string().min(1).default("low"),
  /** Overall submit+poll budget for one OCR job. */
  VISION_API_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(150_000),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(
  source: Record<string, string | undefined> = process.env
): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")
    throw new Error(`Invalid environment configuration: ${details}`)
  }
  return parsed.data
}
