import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

/**
 * Minimal toast, no dependency: any code calls `showToast` and the single
 * <Toaster /> in the root document renders the stack. Module state keeps the
 * API context-free; toasts only ever fire from client event handlers.
 */

export type ToastVariant = "success" | "error"

export type ToastInput = {
  message: string
  variant?: ToastVariant
  /** Auto-dismiss delay in ms; defaults to 4.5s. */
  duration?: number
}

type ToastItem = ToastInput & { id: number }

const DEFAULT_DURATION = 4500

let nextId = 0
let items: ToastItem[] = []
const listeners = new Set<(items: ToastItem[]) => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function publish() {
  for (const listener of listeners) listener(items)
}

export function dismissToast(id: number) {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  items = items.filter((item) => item.id !== id)
  publish()
}

export function showToast(input: ToastInput) {
  const id = ++nextId
  items = [...items, { ...input, id }]
  publish()
  timers.set(
    id,
    setTimeout(() => dismissToast(id), input.duration ?? DEFAULT_DURATION)
  )
}

export function Toaster() {
  const [current, setCurrent] = useState<ToastItem[]>(items)
  useEffect(() => {
    const listener = (next: ToastItem[]) => setCurrent(next)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  if (current.length === 0) return null
  return (
    <div
      aria-live="polite"
      className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {current.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => dismissToast(item.id)}
          className="flex max-w-sm animate-in items-center gap-2 rounded-md border bg-background px-3 py-2.5 text-left text-sm shadow-lg fade-in slide-in-from-bottom-2"
        >
          {item.variant === "error" ? (
            <WarningCircleIcon
              className="size-4 shrink-0 text-destructive"
              weight="fill"
            />
          ) : (
            <CheckCircleIcon
              className="size-4 shrink-0 text-success"
              weight="fill"
            />
          )}
          <span>{item.message}</span>
        </button>
      ))}
    </div>
  )
}
