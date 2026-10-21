import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

import { RouteError } from "@/components/route-error"

/**
 * Shown inside the prerendered SPA shell and while a client-side
 * navigation waits for its loader RPC. Route-agnostic on purpose: the
 * shell is the same document for every path.
 */
function RoutePending() {
  return (
    <main className="container mx-auto w-full max-w-3xl px-4 py-10">
      <div className="animate-pulse space-y-3" aria-hidden>
        <div className="h-7 w-44 rounded-md bg-muted" />
        <div className="h-4 w-64 rounded-md bg-muted" />
        <div className="mt-8 h-64 rounded-xl border bg-card" />
      </div>
      <span className="sr-only">Loading…</span>
    </main>
  )
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,

    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Local RPCs finish quickly; delay keeps fast navigations from
    // flashing the skeleton.
    defaultPendingMs: 300,
    defaultPendingComponent: RoutePending,
    // Loader RPC failures (offline, server unreachable) render inside the
    // shell with honest copy instead of the unstyled default error screen.
    defaultErrorComponent: RouteError,
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
