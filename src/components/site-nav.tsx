import { CaretDownIcon, PaletteIcon } from "@phosphor-icons/react"
import { Link, useRouterState } from "@tanstack/react-router"

import { BrandPicker } from "@/components/brand-picker"
import { PublishCommand } from "@/components/publish-command"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ADMIN_ORIGIN, PUBLIC_ORIGIN } from "@/lib/urls"

const navLink =
  "inline-flex min-h-9 shrink-0 items-center border-b-2 border-transparent px-1 font-mono text-xs font-bold tracking-[0.08em] uppercase text-muted-foreground transition-[color,border-color] hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground motion-reduce:transition-none"

const menuTrigger =
  "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 border border-arena-line bg-card px-2.5 font-mono text-xs font-bold tracking-[0.06em] uppercase text-foreground transition-colors hover:bg-accent data-[popup-open]:bg-accent motion-reduce:transition-none"

function AppearanceMenu() {
  return (
    <Popover>
      <PopoverTrigger className={menuTrigger} aria-label="Appearance settings">
        <PaletteIcon className="size-4" aria-hidden />
        <span className="hidden sm:inline">Appearance</span>
        <CaretDownIcon className="size-3" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(20rem,calc(100vw-2rem))] rounded-sm border border-arena-line bg-card p-4 shadow-[4px_4px_0_0_var(--arena-shadow)] ring-0"
      >
        <PopoverTitle className="font-heading text-base font-black tracking-tight uppercase">
          Appearance
        </PopoverTitle>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="font-mono text-xs font-bold tracking-wider text-muted-foreground uppercase">
              Color
            </p>
            <BrandPicker expanded />
          </div>
          <div className="space-y-2 border-t border-arena-line pt-4">
            <p className="font-mono text-xs font-bold tracking-wider text-muted-foreground uppercase">
              Theme
            </p>
            <ThemeToggle expanded />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function AdminMoreMenu() {
  return (
    <Popover>
      <PopoverTrigger className={menuTrigger}>
        More <CaretDownIcon className="size-3" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-56 gap-1 rounded-sm border border-arena-line bg-card p-2 shadow-[4px_4px_0_0_var(--arena-shadow)] ring-0"
      >
        <a href={`${PUBLIC_ORIGIN}/players`} className={`${navLink} px-2`}>
          Player stats
        </a>
        <a href={`${PUBLIC_ORIGIN}/`} className={`${navLink} px-2`}>
          Public
        </a>
        <a href={`${ADMIN_ORIGIN}/admin`} className={`${navLink} px-2`}>
          Admin home
        </a>
        <div className="border-t border-arena-line px-2 pt-2">
          <PublishCommand />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Shared header for the public and admin runtimes. Cross-origin links stay
 * plain anchors so they always make a full navigation. */
export function SiteNav() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isAdmin = pathname.startsWith("/admin")

  return (
    <header className="border-b border-arena-line bg-card">
      <nav className="container mx-auto grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-6">
        <Link
          to="/"
          className="font-heading text-base font-black tracking-tight text-foreground uppercase transition-colors hover:text-arena-accent"
        >
          Tabquest
        </Link>
        <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-4 overflow-x-auto whitespace-nowrap lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:justify-end lg:gap-5">
          {isAdmin ? (
            <>
              <Link
                to="/admin"
                search={{ filter: "active" }}
                className={navLink}
              >
                Bills
              </Link>
              <Link
                to="/admin/players"
                search={(previous) => ({
                  archived: previous.archived,
                  from: previous.from,
                  to: previous.to,
                })}
                className={navLink}
              >
                Players
              </Link>
              <AdminMoreMenu />
            </>
          ) : (
            <>
              <Link
                to="/tips"
                search={{ month: undefined }}
                className={navLink}
              >
                Tip jar
              </Link>
              <Link to="/players" className={navLink}>
                Players
              </Link>
            </>
          )}
        </div>
        <div className="col-start-2 row-start-1 lg:col-start-3">
          <AppearanceMenu />
        </div>
      </nav>
    </header>
  )
}
