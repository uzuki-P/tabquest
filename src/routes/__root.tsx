// Must run before any route component renders: Safari has no native Temporal
// and several routes touch the global directly.
import "@/lib/temporal"
import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router"
import { lazy, Suspense } from "react"

import { SiteNav } from "@/components/site-nav"
import { arenaButtonLabel, arenaPress } from "@/components/arena"
import { Toaster } from "@/components/ui/toast"

import appCss from "../styles.css?url"

// Dev-only so the devtools never reach the production bundle; in dev the
// trigger is hidden and the toggle hotkey is printed to the console instead.
const DevTools = import.meta.env.DEV
  ? lazy(() => import("@/components/dev-tools"))
  : null

/**
 * Runs before first paint so the `.dark` class and the `data-brand`
 * attribute match the stored or system preference without a flash of the
 * wrong theme. Keep in sync with `src/components/theme-toggle.tsx` (same
 * storage key and fallback rules), `src/components/brand-picker.tsx`, and
 * the Brand presets section in `src/styles.css` (same preset ids).
 */
const themeInitScript = `(function(){try{var s=localStorage.getItem("tabquest-theme");var d=s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);var b=localStorage.getItem("tabquest-brand");if(b&&/^(rose|red|orange|forest|teal|azure|violet|magenta)$/.test(b))document.documentElement.dataset.brand=b}catch(e){}})()`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Tabquest",
      },
      {
        name: "description",
        content:
          "Split group orders fairly: proportional fees, exact rupiah reconciliation.",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.svg",
        type: "image/svg+xml",
      },
      {
        rel: "alternate icon",
        href: "/favicon.ico",
        type: "image/x-icon",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
})

function NotFoundPage() {
  return (
    <main className="mx-auto max-w-lg px-4 pt-20 pb-20">
      <div className="arena-rise border-2 border-arena-line bg-card p-8 text-center shadow-[7px_7px_0_0_var(--arena-shadow)]">
        <p className="font-heading text-6xl font-black text-arena-accent">
          404
        </p>
        <h1 className="mt-3 font-heading text-xl font-black uppercase">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you are looking for does not exist or has moved.
        </p>
        <Link
          to="/"
          className={`mt-6 inline-flex items-center bg-primary px-4 py-2 text-foreground ${arenaButtonLabel} ${arenaPress}`}
        >
          Go home
        </Link>
      </div>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body
        className={pathname.startsWith("/admin") ? "admin-site" : "public-site"}
      >
        <SiteNav />
        {children}
        <Toaster />
        {DevTools && (
          <Suspense fallback={null}>
            <DevTools />
          </Suspense>
        )}
        <Scripts />
      </body>
    </html>
  )
}
