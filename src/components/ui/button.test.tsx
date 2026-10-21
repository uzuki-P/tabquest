import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, test } from "bun:test"

import { Button } from "./button"

afterEach(cleanup)

test("a button rendered as a link keeps link semantics without a Base UI warning", () => {
  const messages: string[] = []
  const originalError = console.error
  console.error = (...args) => {
    messages.push(args.map(String).join(" "))
  }
  try {
    render(<Button render={<a href="/admin">Bills</a>}>Bills</Button>)
    const link = document.querySelector('[data-slot="button"]')
    expect(link?.tagName).toBe("A")
    expect(link?.getAttribute("href")).toBe("/admin")
    expect(messages.join("\n")).not.toContain("nativeButton")
  } finally {
    console.error = originalError
  }
})
