import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { ImageTooLarge, InvalidImage, MAX_UPLOAD_BYTES } from "./images"
import {
  OcrParseFailed,
  OcrRequestFailed,
  parseReceiptImage,
  readRedactions,
  receiptOcrSchema,
} from "./ocr"

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

function pngFile(): File {
  const buffer = Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0))
  return new File([buffer], "receipt.png", { type: "image/png" })
}

async function sizedPngFile(width: number, height: number): Promise<File> {
  const bytes = await new Bun.Image(await pngFile().bytes())
    .resize(width, height)
    .png()
    .bytes()
  return new File([new Uint8Array(bytes)], "receipt.png", {
    type: "image/png",
  })
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
    const { receipt } = await run(
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
    const { receipt } = await run(
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

    const { receipt } = await run(
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

  test("returns suggested redactions as fractions of the sent image", async () => {
    const captured: CapturedRequest[] = []
    const { redactions } = await run(
      parseReceiptImage(
        depsWith(
          {
            pollBody: {
              status: "succeeded",
              response: {
                result: {
                  ...GOOD_REPLY,
                  redactions: [
                    { label: "order number", box: [10, 40, 110, 60] },
                    { label: "broken", box: "nope" },
                  ],
                },
              },
            },
          },
          captured
        ),
        await sizedPngFile(200, 100)
      )
    )
    // The prompt names the pixel size the box coordinates refer to.
    expect(captured[0].instruction).toContain("200x100 image")
    expect(redactions).toHaveLength(1)
    expect(redactions[0].label).toBe("order number")
    expect(redactions[0].x).toBeCloseTo(0.04)
    expect(redactions[0].x + redactions[0].width).toBeCloseTo(0.56)
  })

  test("a reply without redactions still parses", async () => {
    const { redactions } = await run(parseReceiptImage(depsWith(), pngFile()))
    expect(redactions).toEqual([])
  })
})

describe("readRedactions", () => {
  test("pads pixel boxes and converts them to fractions", () => {
    const [box] = readRedactions(
      [{ label: "order number", box: [359, 1469, 619, 1494] }],
      739,
      1600
    )
    expect(box.label).toBe("order number")
    // Padding grows the box past the raw coordinates on every side.
    expect(box.x).toBeLessThan(359 / 739)
    expect(box.y).toBeLessThan(1469 / 1600)
    expect(box.x + box.width).toBeGreaterThan(619 / 739)
    expect(box.y + box.height).toBeGreaterThan(1494 / 1600)
  })

  test("drops malformed, empty, and image-sized boxes", () => {
    expect(
      readRedactions(
        [
          { label: "short", box: [1, 2, 3] },
          { label: "nan", box: [0, 0, Number.NaN, 5] },
          { label: "outside", box: [900, 900, 950, 950] },
          { label: "everything", box: [0, 0, 100, 100] },
          "not an object",
        ],
        100,
        100
      )
    ).toEqual([])
    expect(readRedactions(null, 100, 100)).toEqual([])
  })
})
