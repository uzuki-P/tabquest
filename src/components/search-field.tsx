import { MagnifyingGlassIcon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

/**
 * The one search field used across the public pages: ink-ruled box with a
 * magnifier, mono input. Uncontrolled on purpose, so callers can filter on
 * every keystroke without the caret fighting a router or store update.
 */
export function SearchField({
  placeholder,
  label,
  defaultValue,
  onChange,
  className,
}: {
  placeholder: string
  /** Accessible name; the field has no visible label. */
  label: string
  defaultValue?: string
  onChange: (value: string) => void
  /** Wrapper overrides, e.g. to widen past the default max-w-xs. */
  className?: string
}) {
  return (
    <div className={cn("relative w-full max-w-xs", className)}>
      <MagnifyingGlassIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground/40"
        aria-hidden
      />
      <input
        type="search"
        aria-label={label}
        defaultValue={defaultValue}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-none border-2 border-arena-line bg-card pr-3 pl-9 font-mono text-sm outline-none placeholder:text-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/60"
      />
    </div>
  )
}
