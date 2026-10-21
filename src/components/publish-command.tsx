import { CheckIcon, CopyIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The publish command, click-to-copy. Deploys run from a terminal: the
 * old in-browser button spawned Vercel from the admin server and needed
 * a logged-in Vercel CLI there, which made it unreliable. The nav now
 * hands you the command instead of running it.
 *
 * The clipboard gets a `cd` into this checkout first, so the command
 * works from a freshly opened terminal. The chip stays green with a
 * check for a few seconds so a paste-ready copy is obvious at a glance.
 */

/** This checkout, per deploy/README.md: the admin host service runs here. */
const PROJECT_ROOT = "/srv/tabquest"

/** What the chip displays (the nav has no room for the full command). */
const LABEL = "just publish"

/** What lands in the clipboard. */
const COMMAND = `cd ${PROJECT_ROOT} && just publish`

/** How long the green copied state stays on. */
const COPIED_MS = 3000

export function PublishCommand({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false)
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (reset.current) clearTimeout(reset.current)
    },
    []
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND)
      setCopied(true)
      if (reset.current) clearTimeout(reset.current)
      reset.current = setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={copy}
      title={copied ? "Copied to clipboard" : `Copy: ${COMMAND}`}
      aria-label="Copy the publish command"
      className={cn(
        "h-7 gap-1.5 rounded-none border-2 border-foreground bg-card px-2.5 font-mono text-xs font-bold tracking-[0.12em] shadow-[3px_3px_0_0] shadow-foreground hover:translate-x-[-1px] hover:translate-y-[-1px] hover:bg-card hover:shadow-[4px_4px_0_0] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0]",
        copied && "border-success text-success shadow-success",
        className
      )}
    >
      {LABEL}
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}
