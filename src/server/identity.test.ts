import { describe, expect, test } from "bun:test"

import { isCrossSiteMutation, resolveActor } from "./identity"

function request(
  url: string,
  headers: Record<string, string> = {},
  method = "POST"
): Request {
  return new Request(url, { method, headers })
}

describe("resolveActor", () => {
  test("uses local actor without trusted headers", () => {
    expect(resolveActor(request("http://x/"), false)).toBe("local")
  })

  test("prefers login over name and falls back to anonymous", () => {
    const trust = true
    const withLogin = request("http://x/", {
      "tailscale-user-login": "raka@tailnet",
      "tailscale-user-name": "Raka",
    })
    expect(resolveActor(withLogin, trust)).toBe("raka@tailnet")
    const nameOnly = request("http://x/", { "tailscale-user-name": "Raka" })
    expect(resolveActor(nameOnly, trust)).toBe("Raka")
    expect(resolveActor(request("http://x/"), trust)).toBe("tailnet-anonymous")
  })
})

describe("isCrossSiteMutation", () => {
  test("allows same-origin requests", () => {
    const same = request("http://127.0.0.1:54096/api/admin/bills", {
      origin: "http://127.0.0.1:54096",
      "sec-fetch-site": "same-origin",
    })
    expect(isCrossSiteMutation(same)).toBe(false)
  })

  test("allows proxied HTTPS origins through forwarded headers", () => {
    // Browser hits https://tabquest-admin... through Caddy/Tailscale Serve;
    // Bun sees http://127.0.0.1:54096. This exact shape failed before.
    const proxied = request("http://127.0.0.1:54096/api/admin/bills", {
      origin: "https://tabquest-admin.example.ts.net",
      host: "tabquest-admin.example.ts.net",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "tabquest-admin.example.ts.net",
      "sec-fetch-site": "same-origin",
    })
    expect(isCrossSiteMutation(proxied)).toBe(false)
  })

  test("ignores multiple forwarded hops beyond the first entry", () => {
    const chained = request("http://127.0.0.1:54096/api/admin/bills", {
      origin: "https://admin.example",
      "x-forwarded-proto": "https, http",
      "x-forwarded-host": "admin.example, internal",
      "sec-fetch-site": "none",
    })
    expect(isCrossSiteMutation(chained)).toBe(false)
  })

  test("blocks foreign origins", () => {
    const evil = request("http://127.0.0.1:54096/api/admin/bills", {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    })
    expect(isCrossSiteMutation(evil)).toBe(true)

    const noFetchHeaderEvil = request(
      "http://127.0.0.1:54096/api/admin/bills",
      {
        origin: "https://evil.example",
      }
    )
    expect(isCrossSiteMutation(noFetchHeaderEvil)).toBe(true)

    // Foreign origin does not become acceptable by spoofing forwarded host;
    // proto missing means only the real URL candidate counts.
    const spoofedForward = request("http://127.0.0.1:54096/api/admin/bills", {
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
    })
    expect(isCrossSiteMutation(spoofedForward)).toBe(true)
  })

  test("skips safe methods regardless of headers", () => {
    const get = request(
      "http://a.dev/",
      { origin: "https://evil.example" },
      "GET"
    )
    expect(isCrossSiteMutation(get)).toBe(false)
  })

  test("treats unparseable origins as untrusted", () => {
    const bad = request("http://127.0.0.1:54096/api/admin/bills", {
      origin: "::garbage::",
    })
    expect(isCrossSiteMutation(bad)).toBe(true)
  })
})
