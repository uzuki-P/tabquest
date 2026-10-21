import type { CSSProperties, ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Shared pieces of the arena language the public pages play in. The home
 * board defines the look; this module lets the bill page, the tip
 * wall, the player pages, and the chrome reuse the same class strings
 * instead of re-deriving them per file. Every class reads the arena
 * tokens, which flip per theme in styles.css, so light and dark mode both
 * work without paired classes.
 */

/** Motion ease shared by the CSS keyframes and motion values. */
export const EASE = [0.16, 1, 0.3, 1] as const

/** Stagger helper: feeds the --anim-delay the arena-* keyframe classes read. */
export function delayStyle(seconds: number): CSSProperties {
  return { "--anim-delay": `${seconds}s` } as CSSProperties
}

/**
 * Press feedback for outlined controls: a quiet offset shadow, a small
 * hover lift, and a flat pressed state.
 * Later bg-* classes win the merge, so primary-filled buttons compose.
 */
export const arenaPress =
  "border border-arena-line bg-card shadow-[3px_3px_0_0_var(--arena-shadow)] transition-[translate,box-shadow] duration-200 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--arena-shadow)] active:translate-x-0 active:translate-y-0 active:shadow-none motion-reduce:transition-none"

/** Mono uppercase button label, sized for the slab buttons. */
export const arenaButtonLabel =
  "font-mono text-xs font-bold tracking-[0.18em] uppercase"

/**
 * Ink-outlined panel with the card-scale slab shadow. Section headers and
 * content go inside; panels are the arena replacement for shadcn Cards on
 * public pages.
 */
export function ArenaPanel({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "border border-arena-line bg-card shadow-[3px_3px_0_0_var(--arena-shadow)]",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * Panel title strip: the mono uppercase band that tops a panel, separated
 * from the body by the ink line.
 */
export function ArenaPanelTitle({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "border-b border-arena-line px-4 py-2 font-mono text-xs font-bold tracking-[0.14em] uppercase",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * Section header matching the home board: black uppercase heading on the
 * left, an optional mono uppercase annotation on the right, the ink line
 * underneath. The note accepts a node so pages can drop in counts or
 * controls.
 */
export function ArenaSectionHeader({
  title,
  note,
  noteClassName,
  className,
}: {
  title: ReactNode
  note?: ReactNode
  noteClassName?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-arena-line pb-2",
        className
      )}
    >
      <h2 className="font-heading text-lg font-black uppercase">{title}</h2>
      {note && (
        <span
          className={cn(
            "font-mono text-xs tracking-[0.2em] text-foreground/70 uppercase",
            noteClassName
          )}
        >
          {note}
        </span>
      )}
    </div>
  )
}

const CHIP_TONES = {
  /** Tinted info chip: badges, statuses that are not money states. */
  tint: "border-arena-line bg-primary/10 text-arena-accent",
  /** Filled chip: the paid/today treatment from the home board. */
  solid: "border-arena-line bg-primary text-foreground",
  /** Outline chip for inverted (ink) surfaces. Paper, not accent: every
      brand-hue text color sits too close to the ink fill in light mode
      (accent on ink measures 1.05-1.46:1), while paper stays legible in
      both modes. */
  outline: "border-arena-paper bg-transparent text-arena-paper",
  /** Neutral info on paper: phone numbers, notes, plain metadata. */
  neutral: "border-arena-line bg-transparent text-foreground/75",
  /** Waiting on money: unpaid counts. The tinted twin of solid, so
      paid-vs-unpaid reads as filled-vs-tinted. Destructive red stays
      reserved for errors and destructive actions, never statuses. */
  pending: "border-arena-line bg-primary/10 text-arena-accent",
} as const

/**
 * Square mono uppercase chip, the arena badge. One box, one label, never
 * rounded.
 */
export function ArenaChip({
  tone = "tint",
  className,
  children,
}: {
  tone?: keyof typeof CHIP_TONES
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider uppercase",
        CHIP_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
