import type { ZodType } from "zod"

import { formatRupiah } from "@/domain/money"
import { getServerContext } from "./context"
import { notFound } from "./gate"
import { isCrossSiteMutation } from "./identity"
import type { ImageTooLarge, InvalidImage } from "./services/images"
import type { OcrParseFailed } from "./services/ocr"
import type { SplitReconciliationFailed } from "./services/bills"
import type { InsufficientPayment } from "./services/payments"

/**
 * HTTP boundary helpers shared by the API route handlers. Admin handlers
 * deny the public runtime again (defense in depth behind the server-entry
 * gate) and reject cross-site mutations.
 */

export async function requireAdminRequest(
  request: Request
): Promise<Response | null> {
  const { env } = await getServerContext()
  if (env.TABQUEST_RUNTIME === "public") return notFound()
  if (isCrossSiteMutation(request)) {
    return json(
      {
        error: "cross-site",
        message: "Cross-site mutations are not accepted.",
      },
      403
    )
  }
  return null
}

export function json(
  body: unknown,
  status = 200,
  headers: HeadersInit = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  })
}

export function zodIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>
}): Array<string> {
  return error.issues.map(
    (issue) =>
      `${issue.path.map(String).join(".") || "value"}: ${issue.message}`
  )
}

export async function readJsonBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return {
      ok: false,
      response: json(
        { error: "invalid-json", message: "Request body must be JSON." },
        400
      ),
    }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      response: json(
        { error: "invalid-request", issues: zodIssues(parsed.error) },
        400
      ),
    }
  }
  return { ok: true, value: parsed.data }
}

/** Maps a tagged service error to an HTTP response. */
export function errorResponse(error: unknown): Response {
  const tag =
    typeof error === "object" && error !== null && "_tag" in error
      ? String(error._tag)
      : ""
  switch (tag) {
    case "BillNotFound":
    case "PublicBillNotFound":
    case "BillPlayerNotFound":
    case "PlayerNotFound":
      return json({ error: tag, message: "Not found." }, 404)
    case "BillAlreadyPublished":
      return json(
        {
          error: tag,
          message:
            "This bill is already published and can no longer be edited.",
        },
        409
      )
    case "BillNotPublished":
      return json(
        { error: tag, message: "This bill has not been published yet." },
        409
      )
    case "BillStillPublished":
      return json(
        {
          error: tag,
          message:
            "Unpublish this bill before deleting it; its payment history stays intact.",
        },
        409
      )
    case "PlayerInUse":
      return json(
        {
          error: tag,
          message:
            "This player still has bills linked to them; archive instead of deleting.",
        },
        409
      )
    case "UnknownPlayer":
      return json(
        {
          error: tag,
          message:
            "A billPlayer links to a player that no longer exists; reload the players list.",
        },
        400
      )
    case "MissingBillImage":
      return json(
        {
          error: tag,
          message: "Upload the original bill image before publishing.",
        },
        409
      )
    case "InvalidPaymentTransition":
      return json(
        {
          error: tag,
          message: "Payment state can only move between unpaid and paid.",
        },
        409
      )
    case "NothingToCollect":
      return json(
        {
          error: tag,
          message: "This player has no unpaid shares to collect.",
        },
        409
      )
    case "InsufficientPayment": {
      const payment = error as InsufficientPayment
      return json(
        {
          error: tag,
          message: `They handed over ${formatRupiah(payment.totalPaid)} but owe ${formatRupiah(payment.totalOwed)}; collect the full amount or record per-bill payments.`,
        },
        422
      )
    }
    case "SplitReconciliationFailed":
      return json(
        {
          error: tag,
          message:
            "The bill does not reconcile; fix the allocation errors and try again.",
          issues: (error as SplitReconciliationFailed).issues,
        },
        422
      )
    case "InvalidImage":
      return json({ error: tag, message: (error as InvalidImage).reason }, 422)
    case "ImageTooLarge":
      return json({ error: tag, message: (error as ImageTooLarge).reason }, 413)
    case "OcrNotConfigured":
      return json(
        {
          error: tag,
          message:
            "Receipt OCR is not configured on this server (set VISION_API_URL and VISION_API_TOKEN).",
        },
        503
      )
    case "OcrRequestFailed":
      return json(
        {
          error: tag,
          message: "The OCR provider request failed. Try again later.",
        },
        502
      )
    case "OcrParseFailed":
      return json(
        { error: tag, message: (error as OcrParseFailed).reason },
        422
      )
    default:
      console.error("[tabquest] unhandled service error", error)
      return json({ error: "internal", message: "Internal server error." }, 500)
  }
}
