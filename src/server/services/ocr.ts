import { Data, Effect } from "effect"
import { z } from "zod"

import { boxFromModelPixels } from "@/lib/redaction"
import type { RedactionBox } from "@/lib/redaction"

import { InvalidImage, ImageTooLarge, MAX_UPLOAD_BYTES } from "./images"

/**
 * Receipt OCR. Sends a prepared receipt image to the vision-api service's
 * job endpoint, which runs it through a provider CLI (Claude Code by
 * default, agent tools denied) and returns the model's JSON reply. The reply is mapped onto the bill
 * form's shapes. The admin stays responsible for checking every parsed
 * value against the original image. The same reply also suggests areas
 * holding personal data, which the admin reviews before the image is
 * saved with the bill.
 */

export const ADJUSTMENT_TYPES = [
  "discount",
  "delivery",
  "service",
  "tax",
  "other",
] as const

const safeInt = z
  .number()
  .int()
  .refine((n) => Number.isSafeInteger(n), "outside the safe integer range")
const missingText = z
  .string()
  .trim()
  .nullish()
  .transform((value) => value ?? "")
const missingInt = safeInt.nullish().transform((value) => value ?? 0)

const ocrItemSchema = z.object({
  name: missingText,
  variantNotes: missingText,
  quantity: missingInt.pipe(safeInt.min(0)),
  unitPrice: missingInt.pipe(safeInt.min(0)),
})

const ocrAdjustmentSchema = z.object({
  type: z
    .enum(ADJUSTMENT_TYPES)
    .nullish()
    .transform((type) => type ?? ("other" as const)),
  label: missingText,
  amount: missingInt,
})

export const receiptOcrSchema = z.object({
  merchant: missingText,
  orderDate: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/)
    .nullish()
    .transform((date) => date ?? ""),
  items: z.array(ocrItemSchema).min(1),
  adjustments: z
    .array(ocrAdjustmentSchema)
    .nullish()
    .transform((rows) => rows ?? []),
  sourceSubtotal: missingInt.pipe(safeInt.min(0)),
  finalTotal: missingInt,
})
export type ReceiptOcr = z.infer<typeof receiptOcrSchema>

export type ParsedReceipt = {
  receipt: ReceiptOcr
  /** Suggested areas to black out, as fractions of the image size. */
  redactions: RedactionBox[]
}

const modelRedactionSchema = z.object({
  label: z.string().trim().catch(""),
  box: z.array(z.number()).length(4),
})

/**
 * Reads the model's `redactions` list. Suggestions are a convenience, so a
 * malformed entry is dropped instead of failing the whole parse.
 */
export function readRedactions(
  raw: unknown,
  imageWidth: number,
  imageHeight: number
): RedactionBox[] {
  if (!Array.isArray(raw)) return []
  const boxes: RedactionBox[] = []
  for (const entry of raw) {
    const parsed = modelRedactionSchema.safeParse(entry)
    if (!parsed.success) continue
    const box = boxFromModelPixels(
      parsed.data.box,
      imageWidth,
      imageHeight,
      parsed.data.label || undefined
    )
    if (box) boxes.push(box)
  }
  return boxes
}

export class OcrNotConfigured extends Data.TaggedError(
  "OcrNotConfigured"
)<{}> {}
export class OcrRequestFailed extends Data.TaggedError("OcrRequestFailed")<{
  cause: unknown
}> {}
export class OcrParseFailed extends Data.TaggedError("OcrParseFailed")<{
  reason: string
}> {}

export interface OcrDeps {
  token: string
  provider: "opencode" | "codex" | "claude"
  model: string
  reasoningEffort: string
  baseUrl: string
  /** Overall budget for submitting the job and waiting for it to finish. */
  timeoutMs: number
  /** How often to poll job status. vision-api suggests 3s. */
  pollIntervalMs?: number
  fetchImpl?: typeof fetch
}

const ocrPrompt = (width: number, height: number) =>
  [
    "This is a food-order receipt. Extract its contents and reply with a JSON object of this exact shape:",
    '{"merchant": string, "orderDate": string, "items": [{"name": string, "variantNotes": string, "quantity": int, "unitPrice": int}], "adjustments": [{"type": "discount"|"delivery"|"service"|"tax"|"other", "label": string, "amount": int}], "sourceSubtotal": int, "finalTotal": int, "redactions": [{"label": string, "box": [x0, y0, x1, y1]}]}',
    "Rules: unitPrice is per single unit when the line shows a multiplier like '3 x Cold Tonic'.",
    "For missing or unreadable numbers use 0. For missing text use an empty string. Do not guess values; the user can enter them in the form.",
    'For an unreadable adjustment type use "other". Omit adjustments that are not visible.',
    "Rupiah values are plain integers (Rp26.000 -> 26000).",
    'variantNotes is the grey option text under an item, "" if none.',
    "adjustment amounts keep the sign as printed (a voucher discount is negative).",
    'orderDate is YYYY-MM-DD if the receipt shows one, otherwise "".',
    'merchant is the restaurant or store name, "" if not shown.',
    "sourceSubtotal is the menu subtotal before adjustments; finalTotal is the amount actually charged.",
    "redactions lists personal or identifying values visible on the image: order or transaction numbers, booking IDs, customer names, driver names, phone numbers, the customer's delivery address, email addresses, vehicle plates, and card or account numbers.",
    "Do not list the merchant name, the store's own address, menu items, prices, or dates.",
    `Each box tightly covers the value text only, not its label, in pixel coordinates of this ${width}x${height} image: x0,y0 is the top-left corner and x1,y1 the bottom-right.`,
    'label names what the box hides, like "order number". Use [] when nothing personal is visible.',
  ].join("\n")

const ACCEPTED_SOURCE_FORMATS = new Set(["png", "jpeg", "webp", "avif"])

/** Re-encoded images sent to the model never exceed this longest edge. */
const MAX_OCR_EDGE = 2000

interface JobPayload {
  id?: unknown
  status?: unknown
  response?: { result?: unknown } | null
  error?: { code?: string; message?: string } | null
}

export function parseReceiptImage(
  deps: OcrDeps,
  file: File
): Effect.Effect<
  ParsedReceipt,
  | InvalidImage
  | ImageTooLarge
  | OcrNotConfigured
  | OcrRequestFailed
  | OcrParseFailed
> {
  return Effect.gen(function* () {
    if (file.size === 0)
      return yield* new InvalidImage({ reason: "The uploaded file is empty." })
    if (file.size > MAX_UPLOAD_BYTES) {
      return yield* new ImageTooLarge({
        reason: `The uploaded file exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MiB limit.`,
      })
    }

    const source = new Uint8Array(
      yield* Effect.promise(() => file.arrayBuffer())
    )

    const metadata = yield* Effect.tryPromise({
      try: () => new Bun.Image(source).metadata(),
      catch: () =>
        new InvalidImage({
          reason: "The uploaded file is not a supported image.",
        }),
    })
    if (!ACCEPTED_SOURCE_FORMATS.has(metadata.format)) {
      return yield* new InvalidImage({
        reason: `Unsupported image format "${metadata.format}". Upload PNG, JPEG, WebP, or AVIF.`,
      })
    }

    let image = new Bun.Image(source)
    let sentWidth = metadata.width
    let sentHeight = metadata.height
    if (Math.max(metadata.width, metadata.height) > MAX_OCR_EDGE) {
      const scale = MAX_OCR_EDGE / Math.max(metadata.width, metadata.height)
      sentWidth = Math.round(metadata.width * scale)
      sentHeight = Math.round(metadata.height * scale)
      image = image.resize(sentWidth, sentHeight)
    }
    const encoded = yield* Effect.tryPromise({
      try: () => image.jpeg({ quality: 85 }).bytes(),
      catch: () =>
        new OcrParseFailed({
          reason: "The image could not be prepared for OCR.",
        }),
    })

    const base = deps.baseUrl.replace(/\/+$/, "")
    const doFetch = deps.fetchImpl ?? fetch
    const auth = { authorization: `Bearer ${deps.token}` }
    const deadline = Date.now() + deps.timeoutMs
    const pollIntervalMs = deps.pollIntervalMs ?? 3_000
    let result: unknown
    // The configured fast model can reply with invalid JSON. One
    // Codex attempt can recover that specific failure without retrying other
    // provider errors or extending the overall request budget.
    const attempts = [
      { provider: deps.provider, model: deps.model },
      { provider: "codex", model: "gpt-6-luna" },
    ] as const
    for (const [attemptIndex, attempt] of attempts.entries()) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        return yield* new OcrRequestFailed({
          cause: `Timed out waiting for the OCR job after ${Math.round(deps.timeoutMs / 1000)}s.`,
        })
      }
      const form = new FormData()
      form.append("instruction", ocrPrompt(sentWidth, sentHeight))
      form.append("provider", attempt.provider)
      form.append("model", attempt.model)
      if (deps.reasoningEffort) {
        form.append("reasoning_effort", deps.reasoningEffort)
      }
      form.append(
        "image",
        new File([new Uint8Array(encoded)], "receipt.jpg", {
          type: "image/jpeg",
        }),
        "receipt.jpg"
      )

      const submitted = yield* Effect.tryPromise({
        try: () =>
          doFetch(`${base}/v1/jobs`, {
            method: "POST",
            headers: auth,
            body: form,
            signal: AbortSignal.timeout(remaining),
          }),
        catch: (cause) => new OcrRequestFailed({ cause }),
      })
      if (!submitted.ok) {
        return yield* new OcrRequestFailed({
          cause: `vision-api job submission responded with HTTP ${submitted.status}`,
        })
      }
      const job = (yield* Effect.promise(() =>
        submitted.json().catch(() => null)
      )) as JobPayload | null
      if (typeof job?.id !== "string") {
        return yield* new OcrRequestFailed({
          cause: "vision-api job submission returned no job id.",
        })
      }

      for (;;) {
        const pollRemaining = deadline - Date.now()
        if (pollRemaining <= 0) {
          return yield* new OcrRequestFailed({
            cause: `Timed out waiting for the OCR job after ${Math.round(deps.timeoutMs / 1000)}s.`,
          })
        }
        const poll = yield* Effect.tryPromise({
          try: () =>
            doFetch(`${base}/v1/jobs/${job.id}`, {
              headers: auth,
              signal: AbortSignal.timeout(pollRemaining),
            }),
          catch: (cause) => new OcrRequestFailed({ cause }),
        })
        if (!poll.ok) {
          return yield* new OcrRequestFailed({
            cause: `vision-api job polling responded with HTTP ${poll.status}`,
          })
        }
        const payload = (yield* Effect.promise(() =>
          poll.json().catch(() => null)
        )) as JobPayload | null
        if (payload?.status === "succeeded") {
          result = payload.response?.result
          break
        }
        if (payload?.status === "failed") {
          if (
            attemptIndex === 0 &&
            payload.error?.code === "invalid_model_json"
          ) {
            break
          }
          return yield* new OcrRequestFailed({
            cause: `vision-api job failed: ${payload.error?.code ?? "unknown"} (${payload.error?.message ?? "no message"})`,
          })
        }
        yield* Effect.sleep(pollIntervalMs)
      }
      if (result !== undefined) break
    }

    if (
      result === null ||
      typeof result !== "object" ||
      Array.isArray(result)
    ) {
      return yield* new OcrParseFailed({
        reason: "The OCR service returned no result object.",
      })
    }

    const parsed = receiptOcrSchema.safeParse(result)
    if (!parsed.success) {
      return yield* new OcrParseFailed({
        reason: `The OCR reply did not match the receipt shape: ${parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.map(String).join(".") || "value"}: ${issue.message}`
          )
          .join("; ")}`,
      })
    }
    return {
      receipt: parsed.data,
      redactions: readRedactions(
        (result as { redactions?: unknown }).redactions,
        sentWidth,
        sentHeight
      ),
    }
  })
}
