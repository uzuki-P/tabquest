import { Link, useRouter } from "@tanstack/react-router"
import { ArrowClockwiseIcon, WifiSlashIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { arenaButtonLabel, arenaPress } from "@/components/arena"

/**
 * True when a loader error points at the network rather than the app:
 * fetch() rejects with a TypeError when the request cannot leave the
 * browser (offline, server unreachable), while server and app errors come
 * back as regular Errors.
 */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError
}

/**
 * Route-level error screen and the router's defaultErrorComponent. Before
 * this existed, one failed loader RPC (server down, offline, or a real
 * crash) replaced the whole document with TanStack's unstyled "Something
 * went wrong!" — nav, banner, and all. This renders inside the shell so
 * the site nav stays up, and says what actually happened: pages do not
 * work offline, so the honest message is "check the connection and try
 * again", with a Try again button that re-runs the active loaders.
 */
export function RouteError({ error }: { error: unknown }) {
  const router = useRouter()
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV) console.error(error)
    setOffline(!navigator.onLine)
    const onOnline = () => setOffline(false)
    const onOffline = () => setOffline(true)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [error])

  const network = offline || isNetworkError(error)

  return (
    <main className="mx-auto max-w-lg px-4 pt-20 pb-20">
      <div className="arena-rise border-2 border-arena-line bg-card p-8 text-center shadow-[7px_7px_0_0_var(--arena-shadow)]">
        {network ? (
          <WifiSlashIcon className="mx-auto size-10 text-arena-accent" />
        ) : (
          <p className="font-heading text-6xl font-black text-arena-accent">
            Oops
          </p>
        )}
        <h1 className="mt-3 font-heading text-xl font-black uppercase">
          {network ? "Can't reach the server" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {network
            ? "The request never reached the server. Check your connection and try again."
            : "This page hit an unexpected error."}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void router.invalidate()}
            className={`inline-flex items-center gap-1.5 bg-primary px-4 py-2 text-foreground ${arenaButtonLabel} ${arenaPress}`}
          >
            <ArrowClockwiseIcon className="size-4" weight="bold" />
            Try again
          </button>
          <Link
            to="/"
            className={`inline-flex items-center bg-primary px-4 py-2 text-foreground ${arenaButtonLabel} ${arenaPress}`}
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  )
}
