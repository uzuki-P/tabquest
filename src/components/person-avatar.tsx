import { cn } from "@/lib/utils"

/**
 * Tinted initial avatar shared by the billPlayer picker, allocation board,
 * and split review. Color is derived from a stable key so the same person
 * keeps the same tint across sections.
 */

// Identity tints only: gold (celebration) and emerald (success) are
// reserved roles, so a person's color never doubles as a status. The old
// rose/pink slots are the two token pairs (secondary, muted) so those
// identities re-tint with the brand instead of holding onto the old pink
// theme; the fixed Tailwind hues are variety that never collides with a
// reserved role.
export const AVATAR_TINTS = [
  "bg-secondary text-secondary-foreground",
  "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  "bg-muted text-muted-foreground",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
]

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  return parts
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("")
}

export function avatarTintFor(key: string): string {
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  }
  return AVATAR_TINTS[hash % AVATAR_TINTS.length]
}

export function PersonAvatar({
  name,
  size = "md",
  className,
}: {
  name: string
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-medium select-none",
        avatarTintFor(name),
        size === "sm" && "size-6 text-xs",
        size === "md" && "size-8 text-xs",
        size === "lg" && "size-10 text-sm",
        className
      )}
    >
      {initialsFor(name)}
    </span>
  )
}
