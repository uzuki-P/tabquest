import { describe, expect, test } from "bun:test"

import {
  isAdminPath,
  isAdminServerFnId,
  normalizePath,
  publicRuntimeGate,
  serverFnIdFromPath,
} from "./gate"

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

describe("normalizePath", () => {
  test("collapses duplicate slashes and dot segments", () => {
    expect(normalizePath("//admin///bills")).toBe("/admin/bills")
    expect(normalizePath("/foo/../admin")).toBe("/admin")
    expect(normalizePath("/admin/./x")).toBe("/admin/x")
  })

  test("decodes percent-encoded characters", () => {
    expect(normalizePath("/%61dmin")).toBe("/admin")
    expect(normalizePath("/adm%69n")).toBe("/admin")
    expect(normalizePath("/%2f%2fadmin")).toBe("/admin")
    expect(normalizePath("/api%2Fadmin%2Fbills")).toBe("/api/admin/bills")
  })

  test("leaves public paths alone", () => {
    expect(normalizePath("/b/abc-123")).toBe("/b/abc-123")
    expect(normalizePath("/")).toBe("/")
  })
})

describe("isAdminPath", () => {
  test("matches the admin tree, including encoded and alternate forms", () => {
    expect(isAdminPath("/admin")).toBe(true)
    expect(isAdminPath("/admin/")).toBe(true)
    expect(isAdminPath("/admin/bills/new")).toBe(true)
    expect(isAdminPath("//admin")).toBe(true)
    expect(isAdminPath("/%61dmin")).toBe(true)
    expect(isAdminPath("/foo/..%2Fadmin")).toBe(true)
    expect(isAdminPath("/api/admin/bills")).toBe(true)
    expect(isAdminPath("/api%2fadmin/bills")).toBe(true)
  })

  test("does not match public or lookalike paths", () => {
    expect(isAdminPath("/")).toBe(false)
    expect(isAdminPath("/b/xyz")).toBe(false)
    expect(isAdminPath("/api/public/bills/xyz")).toBe(false)
    expect(isAdminPath("/administrator")).toBe(false)
  })
})

describe("server function gating", () => {
  test("extracts the function id from the RPC path", () => {
    expect(serverFnIdFromPath("/_serverFn/abc123/x")).toBe("abc123")
    expect(serverFnIdFromPath("/_serverFn/abc123")).toBe("abc123")
    expect(serverFnIdFromPath("/b/xyz")).toBeNull()
  })

  test("flags admin functions from build-style and dev-style ids", () => {
    const buildStyle = b64url("src/routes/admin/bills/$billId.tsx#loader")
    expect(isAdminServerFnId(buildStyle)).toBe(true)

    const devStyle = b64url(
      JSON.stringify({
        file: "/app/src/routes/admin/index.tsx",
        export: "loader",
      })
    )
    expect(isAdminServerFnId(devStyle)).toBe(true)

    const adminApi = b64url("src/server/admin/payments.ts#setPaymentState")
    expect(isAdminServerFnId(adminApi)).toBe(true)
  })

  test("allows public functions and fails closed on garbage", () => {
    expect(isAdminServerFnId(b64url("src/routes/index.tsx#loader"))).toBe(false)
    expect(isAdminServerFnId(b64url("src/routes/b.$publicId.tsx#loader"))).toBe(
      false
    )
    expect(isAdminServerFnId("!!!not-base64!!!")).toBe(true)
  })
})

describe("publicRuntimeGate", () => {
  test("serves the styled 404 page for admin page paths", () => {
    for (const pathname of [
      "/admin",
      "/admin/bills/new",
      "//admin",
      "/%61dmin",
    ]) {
      const response = publicRuntimeGate(
        new Request(`http://public.test${pathname}`)
      )
      expect(response?.status).toBe(404)
      expect(response?.headers.get("content-type")).toBe(
        "text/html; charset=utf-8"
      )
    }
  })

  test("keeps plain 404s for admin API paths and mutations", () => {
    for (const pathname of [
      "/api/admin/bills",
      "/api/admin/bill-players/x/payment",
      "/api/admin/bills/x/archive",
      "/api/admin/bills/x/unarchive",
      "/api/admin/players",
      "/api/admin/players/x",
      "/api/admin/players/x/archive",
      "/api/admin/players/x/restore",
      "/api/admin/insights/players",
    ]) {
      const response = publicRuntimeGate(
        new Request(`http://public.test${pathname}`)
      )
      expect(response?.status).toBe(404)
      expect(response?.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8"
      )
    }
  })

  test("404s admin server-function RPC calls", () => {
    const id = b64url("src/routes/admin/index.tsx#loader")
    const response = publicRuntimeGate(
      new Request(`http://public.test/_serverFn/${id}/x`)
    )
    expect(response?.status).toBe(404)
    expect(response?.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    )
  })

  test("lets public traffic through", () => {
    expect(publicRuntimeGate(new Request("http://public.test/"))).toBeNull()
    expect(
      publicRuntimeGate(new Request("http://public.test/b/abc?date=2026-08-27"))
    ).toBeNull()
    const id = b64url("src/routes/index.tsx#loader")
    expect(
      publicRuntimeGate(new Request(`http://public.test/_serverFn/${id}/x`))
    ).toBeNull()
  })
})
