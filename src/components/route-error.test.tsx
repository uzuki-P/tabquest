// Component test for the route error screen under bun:test with happy-dom
// and Testing Library. The router dependency is satisfied with a minimal
// memory-history router so the real route tree (which pulls in server
// modules) stays out of the DOM test environment.
import { cleanup, render, screen } from "@testing-library/react"
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { RouteError } from "./route-error"

afterEach(cleanup)

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => value,
  })
}

async function renderError(error: unknown) {
  const rootRoute = createRootRoute({
    component: () => <RouteError error={error} />,
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
  await router.load()
  return render(<RouterProvider router={router} />)
}

describe("RouteError", () => {
  beforeEach(() => {
    setOnline(true)
  })

  test("fetch failures read as a server problem, not a crash", async () => {
    await renderError(new TypeError("Failed to fetch"))
    expect(screen.getByText("Can't reach the server")).toBeTruthy()
    expect(screen.queryByText("Something went wrong")).toBeNull()
  })

  test("other errors keep the generic message", async () => {
    await renderError(new Error("boom"))
    expect(screen.getByText("Something went wrong")).toBeTruthy()
    expect(screen.queryByText("Can't reach the server")).toBeNull()
  })

  test("a browser that is offline reads as a network problem", async () => {
    setOnline(false)
    await renderError(new Error("boom"))
    expect(screen.getByText("Can't reach the server")).toBeTruthy()
  })

  test("offers Try again and a way home", async () => {
    await renderError(new TypeError("Failed to fetch"))
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Go home" })).toBeTruthy()
  })
})
