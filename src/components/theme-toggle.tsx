import { MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

const STORAGE_KEY = "tabquest-theme"

type Theme = "light" | "dark" | "system"

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
}

/**
 * Three-state color mode control. The server renders it without an active
 * mark; the stored preference is only read after mount, matching the
 * pre-hydration script in the root document.
 */
export function ThemeToggle({
  className,
  expanded = false,
}: {
  className?: string
  expanded?: boolean
}) {
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(STORAGE_KEY)
    } catch {}
    setTheme(stored === "light" || stored === "dark" ? stored : "system")

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    function onSystemChange() {
      try {
        if ((localStorage.getItem(STORAGE_KEY) ?? "system") === "system") {
          applyTheme("system")
        }
      } catch {
        applyTheme("system")
      }
    }
    media.addEventListener("change", onSystemChange)
    return () => media.removeEventListener("change", onSystemChange)
  }, [])

  function select(next: Theme) {
    setTheme(next)
    applyTheme(next)
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, next)
    } catch {}
  }

  const options = [
    { value: "light", label: "Light", Icon: SunIcon },
    { value: "system", label: "System", Icon: MonitorIcon },
    { value: "dark", label: "Dark", Icon: MoonIcon },
  ] as const

  return (
    <div
      role="group"
      aria-label="Color theme"
      className={cn(
        expanded
          ? "grid grid-cols-3 gap-1.5"
          : "inline-flex items-center border-2 border-arena-line bg-card p-0.5",
        className
      )}
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={`${label} theme`}
          aria-pressed={theme === value}
          title={label}
          onClick={() => select(value)}
          className={cn(
            "text-muted-foreground transition-[background-color,color,translate] duration-150 hover:text-foreground active:translate-y-px motion-reduce:transition-none",
            expanded
              ? "flex min-h-10 items-center justify-center gap-1.5 border border-arena-line px-2 font-mono text-xs font-semibold hover:bg-accent"
              : "p-1.5",
            theme === value && "bg-primary text-primary-foreground"
          )}
        >
          <Icon
            className="size-3.5"
            weight={theme === value ? "fill" : "regular"}
          />
          {expanded && <span>{label}</span>}
        </button>
      ))}
    </div>
  )
}
