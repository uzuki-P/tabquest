import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { ImageTooLarge, InvalidImage, MAX_UPLOAD_BYTES } from "./images"
import {
  OcrParseFailed,
  OcrRequestFailed,
  parseReceiptImage,
  receiptOcrSchema,
} from "./ocr"

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

function pngFile(): File {
  const buffer = Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0))
  return new File([buffer], "receipt.png", { type: "image/png" })
}

const GOOD_REPLY = {
  merchant: "Kopi Kedai",
  orderDate: "2026-08-28",
  items: [
    {
      name: "Matcha Latte",
      variantNotes: "Cold - Normal Ice, Normal Sugar",
      quantity: 1,
      unitPrice: 26000,
    },
    { name: "Cold Tonic", variantNotes: "", quantity: 3, unitPrice: 30000 },
  ],
  adjustments: [
    { type: "discount", label: "Voucher Diskon", amount: -110250 },
    { type: "service", label: "Biaya Layanan", amount: 3000 },
  ],
  sourceSubtotal: 116000,
  finalTotal: 8750,
}

interface CapturedRequest {
  method: string
  url: string
  instruction?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  imageName?: string
  imageType?: string
}

interface MockService {
  submitStatus?: number
  submitBody?: unknown
  pollStatus?: number
  pollBody?: unknown
}

function depsWith(
  mock: MockService = {},
  captured?: CapturedRequest[]
): Parameters<typeof parseReceiptImage>[0] {
  const pollBody = mock.pollBody ?? {
    status: "succeeded",
    response: { _metadata: { request_id: "r1" }, result: GOOD_REPLY },
  }
  return {
    token: "test-token",
    model: "zai-coding-plan/glm-5.3-flash",
    reasoningEffort: "low",
    baseUrl: "https://vision.test/",
    timeoutMs: 5_000,
    pollIntervalMs: 1,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      const capturedRequest: CapturedRequest = {
        method,
        url: String(url),
      }
      if (method === "POST") {
        const form = init?.body as FormData
        const image = form.get("image") as File
        Object.assign(capturedRequest, {
          instruction: String(form.get("instruction")),
          provider: String(form.get("provider")),
          model: String(form.get("model")),
          reasoningEffort: String(form.get("reasoning_effort")),
          imageName: image.name,
          imageType: image.type,
        })
      }
      captured?.push(capturedRequest)

      if (method === "POST") {
        return new Response(
          JSON.stringify(mock.submitBody ?? { id: "job-1", status: "queued" }),
          { status: mock.submitStatus ?? 202 }
        )
      }
      return new Response(JSON.stringify(pollBody), {
        status: mock.pollStatus ?? 200,
      })
    }) as unknown as typeof fetch,
  }
}

async function run<T, TError>(effect: Effect.Effect<T, TError>): Promise<T> {
  return Effect.runPromise(effect)
}

describe("receipt ocr service", () => {
  test("accepts an unreadable item price as zero", async () => {
    const receipt = await run(
      parseReceiptImage(
        depsWith({
          pollBody: {
            status: "succeeded",
            response: {
              result: {
                merchant: "Kopi Kedai",
                orderDate: "",
                items: [
                  {
                    name: "Kakao",
                    variantNotes: "",
                    quantity: 1,
                    unitPrice: null,
                  },
                ],
                adjustments: [],
                sourceSubtotal: 0,
                finalTotal: 0,
              },
            },
          },
        }),
        pngFile()
      )
    )
    expect(receipt.items[0].unitPrice).toBe(0)
  })

  test("fills other missing receipt values without inventing them", () => {
    const parsed = receiptOcrSchema.parse({
      items: [{ name: "Kakao", quantity: null }],
      adjustments: [{ type: null, amount: null }],
    })
    expect(parsed).toEqual({
      merchant: "",
      orderDate: "",
      items: [{ name: "Kakao", variantNotes: "", quantity: 0, unitPrice: 0 }],
      adjustments: [{ type: "other", label: "", amount: 0 }],
      sourceSubtotal: 0,
      finalTotal: 0,
    })
  })

  test("submits a job, polls it, and parses the result", async () => {
    const captured: CapturedRequest[] = []
    const receipt = await run(
      parseReceiptImage(depsWith({}, captured), pngFile())
    )

    expect(captured).toHaveLength(2)
    expect(captured[0].method).toBe("POST")
    expect(captured[0].url).toBe("https://vision.test/v1/jobs")
    expect(captured[0].provider).toBe("opencode")
    expect(captured[0].model).toBe("zai-coding-plan/glm-5.3-flash")
    expect(captured[0].reasoningEffort).toBe("low")
    expect(captured[0].instruction).toContain("sourceSubtotal")
    expect(captured[0].imageName).toBe("receipt.jpg")
    expect(captured[0].imageType).toBe("image/jpeg")
    expect(captured[1].method).toBe("GET")
    expect(captured[1].url).toBe("https://vision.test/v1/jobs/job-1")

    expect(receipt.merchant).toBe("Kopi Kedai")
    expect(receipt.items).toHaveLength(2)
    expect(receipt.items[1]).toMatchObject({
      name: "Cold Tonic",
      quantity: 3,
      unitPrice: 30000,
    })
    expect(receipt.adjustments[0].amount).toBe(-110250)
    expect(receipt.sourceSubtotal).toBe(116000)
    expect(receipt.finalTotal).toBe(8750)
  })

  test("rejects a reply without a result object", async () => {
    const error = await run(
      parseReceiptImage(
        depsWith({
          pollBody: {
            status: "succeeded",
            response: { result: "I cannot read this image." },
          },
        }),
        pngFile()
      )
    ).catch((e) => e)
    expect(error).toBeInstanceOf(OcrParseFailed)
  })

  test("rejects a reply with an unknown adjustment type", async () => {
    const bad = {
      ...GOOD_REPLY,
      adjustments: [{ type: "voucher", label: "Voucher", amount: -1000 }],
    }
    const error = await run(
      parseReceiptImage(
        depsWith({
          pollBody: { status: "succeeded", response: { result: bad } },
        }),
        pngFile()
      )
    ).catch((e) => e)
    expect(error).toBeInstanceOf(OcrParseFailed)
    expect((error as OcrParseFailed).reason).toContain("type")
  })

  test("maps a failed job to OcrRequestFailed", async () => {
    const error = await run(
      parseReceiptImage(
        depsWith({
          pollBody: {
            status: "failed",
            error: {
              code: "provider_timeout",
              message: "Model request timed out",
            },
          },
        }),
        pngFile()
      )
    ).catch((e) => e)
    expect(error).toBeInstanceOf(OcrRequestFailed)
    expect(String((error as OcrRequestFailed).cause)).toContain(
      "provider_timeout"
    )
  })

  test("retries invalid model JSON with the Codex image model", async () => {
    const attempts: Array<{ provider: string; model: string }> = []
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      if (init?.method === "POST") {
        const form = init.body as FormData
        attempts.push({
          provider: String(form.get("provider")),
          model: String(form.get("model")),
        })
        return Response.json({ id: `job-${attempts.length}` }, { status: 202 })
      }
      return attempts.length === 1
        ? Response.json({
            status: "failed",
            error: { code: "invalid_model_json", message: "Invalid JSON" },
          })
        : Response.json({
            status: "succeeded",
            response: { result: GOOD_REPLY },
          })
    }) as typeof fetch

    const receipt = await run(
      parseReceiptImage({ ...depsWith(), fetchImpl }, pngFile())
    )
    expect(receipt.merchant).toBe("Kopi Kedai")
    expect(attempts).toEqual([
      { provider: "opencode", model: "zai-coding-plan/glm-5.3-flash" },
      { provider: "codex", model: "gpt-6-luna" },
    ])
  })

  test("gives up when the job never finishes in time", async () => {
    const error = await run(
      parseReceiptImage(
        {
          ...depsWith({ pollBody: { status: "running" } }),
          timeoutMs: 50,
          pollIntervalMs: 5,
        },
        pngFile()
      )
    ).catch((e) => e)
    expect(error).toBeInstanceOf(OcrRequestFailed)
    expect(String((error as OcrRequestFailed).cause)).toContain("Timed out")
  })

  test("maps provider errors to OcrRequestFailed", async () => {
    const httpError = await run(
      parseReceiptImage(depsWith({ submitStatus: 429 }), pngFile())
    ).catch((e) => e)
    expect(httpError).toBeInstanceOf(OcrRequestFailed)

    const network = await run(
      parseReceiptImage(
        {
          token: "t",
          model: "m",
          reasoningEffort: "low",
          baseUrl: "https://vision.test",
          timeoutMs: 5_000,
          fetchImpl: (async () => {
            throw new Error("offline")
          }) as unknown as typeof fetch,
        },
        pngFile()
      )
    ).catch((e) => e)
    expect(network).toBeInstanceOf(OcrRequestFailed)
  })

  test("rejects empty, non-image, and oversized files before any request", async () => {
    const deps = depsWith()

    await expect(
      run(
        parseReceiptImage(
          deps,
          new File([], "empty.png", { type: "image/png" })
        )
      )
    ).rejects.toBeInstanceOf(InvalidImage)

    await expect(
      run(
        parseReceiptImage(
          deps,
          new File([new TextEncoder().encode("not an image")], "x.png")
        )
      )
    ).rejects.toBeInstanceOf(InvalidImage)

    await expect(
      run(
        parseReceiptImage(
          deps,
          new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "huge.png")
        )
      )
    ).rejects.toBeInstanceOf(ImageTooLarge)
  })

  test("schema rejects stringified numbers instead of coercing silently", () => {
    const parsed = receiptOcrSchema.safeParse({
      merchant: "",
      orderDate: "",
      items: [
        {
          name: "Kakao",
          variantNotes: "Cold",
          quantity: "1",
          unitPrice: "24000",
        },
      ],
      adjustments: [],
      sourceSubtotal: "24000",
      finalTotal: 24000,
    })
    expect(parsed.success).toBe(false)
  })
})
