import { useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { createPortal } from "react-dom"
import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  CheckIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { boxFromPoints, isUsableBox, moveBox } from "@/lib/redaction"
import type { RedactionBox } from "@/lib/redaction"
import { cn } from "@/lib/utils"

type Drag =
  | { kind: "draw"; startX: number; startY: number }
  | {
      kind: "move"
      index: number
      startX: number
      startY: number
      origin: RedactionBox
    }
  | { kind: "resize"; index: number; anchorX: number; anchorY: number }

export type RedactionEditorProps = {
  src: string
  initialBoxes: readonly RedactionBox[]
  /** Shown in the toolbar, e.g. "Censor receipt". */
  title: string
  applyLabel?: string
  onCancel: () => void
  /** May be async; the editor stays open and shows the error if it throws. */
  onApply: (boxes: RedactionBox[]) => void | Promise<void>
}

/**
 * Fullscreen editor for blacking out parts of an image. Boxes are stored as
 * fractions of the image size. Drag on empty space to draw a box; drag a box
 * to move it, or its corner handle to resize it. Delete or Backspace removes
 * the selected box. Applying hands the boxes back; flattening them into the
 * image is the caller's job.
 */
export function RedactionEditor({
  src,
  initialBoxes,
  title,
  applyLabel = "Apply",
  onCancel,
  onApply,
}: RedactionEditorProps) {
  const [boxes, setBoxes] = useState<RedactionBox[]>(() => [...initialBoxes])
  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState<RedactionBox | null>(null)
  const [fit, setFit] = useState<"screen" | "width">("screen")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel()
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selected !== null
      ) {
        event.preventDefault()
        setBoxes((current) => current.filter((_, i) => i !== selected))
        setSelected(null)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [busy, onCancel, selected])

  function pointAt(event: ReactPointerEvent) {
    const rect = surfaceRef.current!.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    }
  }

  function capture(event: ReactPointerEvent) {
    surfaceRef.current?.setPointerCapture(event.pointerId)
  }

  function onSurfaceDown(event: ReactPointerEvent) {
    if (event.button !== 0) return
    const { x, y } = pointAt(event)
    capture(event)
    dragRef.current = { kind: "draw", startX: x, startY: y }
    setSelected(null)
    setDraft(boxFromPoints(x, y, x, y))
  }

  function onBoxDown(event: ReactPointerEvent, index: number) {
    if (event.button !== 0) return
    event.stopPropagation()
    const { x, y } = pointAt(event)
    capture(event)
    dragRef.current = {
      kind: "move",
      index,
      startX: x,
      startY: y,
      origin: boxes[index],
    }
    setSelected(index)
  }

  function onHandleDown(event: ReactPointerEvent, index: number) {
    if (event.button !== 0) return
    event.stopPropagation()
    capture(event)
    const box = boxes[index]
    dragRef.current = {
      kind: "resize",
      index,
      anchorX: box.x,
      anchorY: box.y,
    }
    setSelected(index)
  }

  function onSurfaceMove(event: ReactPointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const { x, y } = pointAt(event)
    if (drag.kind === "draw") {
      setDraft(boxFromPoints(drag.startX, drag.startY, x, y))
      return
    }
    setBoxes((current) =>
      current.map((box, i) => {
        if (i !== drag.index) return box
        if (drag.kind === "move")
          return moveBox(drag.origin, x - drag.startX, y - drag.startY)
        return { ...box, ...boxFromPoints(drag.anchorX, drag.anchorY, x, y) }
      })
    )
  }

  function onSurfaceUp() {
    const drag = dragRef.current
    dragRef.current = null
    if (drag?.kind === "draw" && draft) {
      if (isUsableBox(draft)) {
        setBoxes((current) => [...current, draft])
        setSelected(boxes.length)
      }
      setDraft(null)
    }
    if (drag?.kind === "resize") {
      // A box shrunk to nothing is removed rather than left invisible.
      setBoxes((current) => current.filter(isUsableBox))
    }
  }

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      await onApply(boxes.filter(isUsableBox))
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Applying the censor failed."
      )
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex h-dvh flex-col bg-black/90 text-white"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/15 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="text-xs text-white/70">
            Drag on the image to black out an area. Drag a box to move it, or
            its corner to resize.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-white/40 bg-transparent text-white hover:bg-white/15"
          onClick={() => setFit((f) => (f === "screen" ? "width" : "screen"))}
        >
          {fit === "screen" ? (
            <ArrowsOutSimpleIcon data-icon="inline-start" />
          ) : (
            <ArrowsInSimpleIcon data-icon="inline-start" />
          )}
          {fit === "screen" ? "Zoom" : "Fit"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-white/40 bg-transparent text-white hover:bg-white/15"
          disabled={selected === null}
          onClick={() => {
            setBoxes((current) => current.filter((_, i) => i !== selected))
            setSelected(null)
          }}
        >
          <TrashIcon data-icon="inline-start" />
          Delete box
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-white/40 bg-transparent text-white hover:bg-white/15"
          disabled={boxes.length === 0}
          onClick={() => {
            setBoxes([])
            setSelected(null)
          }}
        >
          Clear all
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-white hover:bg-white/15"
          disabled={busy}
          onClick={onCancel}
        >
          <XIcon data-icon="inline-start" />
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void apply()}
        >
          <CheckIcon data-icon="inline-start" />
          {busy ? "Applying…" : applyLabel}
        </Button>
      </div>

      {error && (
        <p role="alert" className="shrink-0 bg-destructive px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto p-4 sm:p-6",
          fit === "screen" && "flex items-center justify-center"
        )}
      >
        <div
          ref={surfaceRef}
          data-testid="redaction-surface"
          className={cn(
            "relative mx-auto touch-none select-none",
            fit === "screen" ? "w-fit" : "w-full max-w-4xl"
          )}
          style={{ cursor: "crosshair" }}
          onPointerDown={onSurfaceDown}
          onPointerMove={onSurfaceMove}
          onPointerUp={onSurfaceUp}
          onPointerCancel={onSurfaceUp}
        >
          <img
            src={src}
            alt={title}
            draggable={false}
            className={cn(
              "pointer-events-none block",
              fit === "screen"
                ? "max-h-[calc(100dvh-9rem)] max-w-full"
                : "w-full"
            )}
          />
          {boxes.map((box, index) => (
            <div
              key={index}
              data-testid="redaction-box"
              aria-label={box.label ?? "Censored area"}
              className={cn(
                "absolute cursor-move bg-black",
                selected === index
                  ? "outline-2 outline-offset-1 outline-primary"
                  : "outline-1 outline-white/60 outline-dashed"
              )}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
              onPointerDown={(event) => onBoxDown(event, index)}
            >
              {box.label && (
                <span className="pointer-events-none absolute bottom-full left-0 mb-0.5 rounded-sm bg-primary px-1 text-[10px] whitespace-nowrap text-primary-foreground">
                  {box.label}
                </span>
              )}
              {selected === index && (
                <span
                  aria-hidden
                  className="absolute -right-2 -bottom-2 size-4 cursor-nwse-resize border-2 border-primary bg-white"
                  onPointerDown={(event) => onHandleDown(event, index)}
                />
              )}
            </div>
          ))}
          {draft && (
            <div
              className="pointer-events-none absolute bg-black/70 outline-1 outline-white outline-dashed"
              style={{
                left: `${draft.x * 100}%`,
                top: `${draft.y * 100}%`,
                width: `${draft.width * 100}%`,
                height: `${draft.height * 100}%`,
              }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
