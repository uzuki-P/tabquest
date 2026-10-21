import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

const STORAGE_KEY = "tabquest-brand"

/**
 * The eight brand presets. The id sets the `data-brand` attribute on
 * <html>; styles.css maps each id to a `--brand-hue`, and tinted tokens
 * rotate from that hue. Swatches identify the hue, while the UI uses a
 * softer accent in both modes. Keep the ids in sync
 * with the pre-hydration script in `src/routes/__root.tsx` and the Brand
 * presets section in `src/styles.css`.
 */
const BRANDS = [
  { id: "rose", label: "Rose", swatch: "#db2777" },
  { id: "red", label: "Red", swatch: "#e22c21" },
  { id: "orange", label: "Orange", swatch: "#be6100" },
  { id: "forest", label: "Forest", swatch: "#009828" },
  { id: "teal", label: "Teal", swatch: "#009186" },
  { id: "azure", label: "Azure", swatch: "#008ab6" },
  { id: "violet", label: "Violet", swatch: "#825af3" },
  { id: "magenta", label: "Magenta", swatch: "#c03bba" },
] as const

type Brand = (typeof BRANDS)[number]["id"]

const BRAND_IDS = new Set<string>(BRANDS.map((b) => b.id))

function applyBrand(brand: Brand) {
  document.documentElement.dataset.brand = brand
}

/**
 * Eight-preset brand color control. Like the theme toggle, the server
 * renders it without an active mark; the stored preference is only read
 * after mount, matching the pre-hydration script in the root document.
 * The choice is per-origin (public and admin each keep their own), same
 * as the light/dark toggle.
 */
export function BrandPicker({
  className,
  expanded = false,
}: {
  className?: string
  expanded?: boolean
}) {
  const [brand, setBrand] = useState<Brand | null>(null)

  useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(STORAGE_KEY)
    } catch {}
    setBrand(stored && BRAND_IDS.has(stored) ? (stored as Brand) : "rose")
  }, [])

  function select(next: Brand) {
    setBrand(next)
    applyBrand(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {}
  }

  return (
    <div
      role="group"
      aria-label="Brand color"
      className={cn(
        expanded
          ? "grid grid-cols-4 gap-1.5"
          : "inline-flex items-center border-2 border-arena-line bg-card p-0.5",
        className
      )}
    >
      {BRANDS.map(({ id, label, swatch }) => (
        <button
          key={id}
          type="button"
          aria-label={`${label} brand color`}
          aria-pressed={brand === id}
          title={`${label} brand color`}
          onClick={() => select(id)}
          className={cn(
            "transition-[background-color,translate] duration-150 active:translate-y-px motion-reduce:transition-none",
            expanded
              ? "flex min-h-14 flex-col items-center justify-center gap-1 border border-transparent px-1 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              : "p-1.5",
            brand === id &&
              (expanded ? "border-arena-line bg-accent" : "bg-primary")
          )}
        >
          <span
            aria-hidden
            className={cn(
              "block border border-arena-line/50",
              expanded ? "size-5" : "size-3"
            )}
            style={{ backgroundColor: swatch }}
          />
          {expanded && <span>{label}</span>}
        </button>
      ))}
    </div>
  )
}
