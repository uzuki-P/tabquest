import { Link } from "@tanstack/react-router"
import { CaretRightIcon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

/**
 * Breadcrumb trail shown above the page heading on every page but the root,
 * set in the arena micro-label style (mono, uppercase, wide tracking). The
 * last item is the current page and renders as plain text; earlier items
 * with a `to` path render as router links so navigation stays client-side.
 */
export function PageBreadcrumb({
  items,
  className,
}: {
  items: Array<{ label: string; to?: string }>
  className?: string
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "mb-3 font-mono text-xs font-bold tracking-[0.16em] text-foreground/45 uppercase",
        className
      )}
    >
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, index) => {
          const current = index === items.length - 1
          return (
            <li
              key={`${index}-${item.label}`}
              className="flex min-w-0 items-center gap-1.5"
            >
              {index > 0 && (
                <CaretRightIcon
                  aria-hidden
                  className="size-3 shrink-0 opacity-60"
                />
              )}
              {current || !item.to ? (
                <span
                  aria-current={current ? "page" : undefined}
                  className="truncate text-foreground"
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className="truncate transition-colors hover:text-arena-accent"
                >
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
