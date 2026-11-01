import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowsOutLineHorizontalIcon,
  CheckIcon,
  CornersInIcon,
  CropIcon,
  EyeIcon,
  HandIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  RectangleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  commitHistory,
  initHistory,
  previewHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "@/lib/edit-history"
import type { History } from "@/lib/edit-history"
import { cleanEdits } from "@/lib/image-edits"
import type { ImageEdits } from "@/lib/image-edits"
import {
  CORNERS,
  boxFromPoints,
  isUsableBox,
  moveBox,
  resizeFromCorner,
} from "@/lib/redaction"
import type { Corner, RedactionBox } from "@/lib/redaction"
import { cn } from "@/lib/utils"
import { MAX_ZOOM, MIN_ZOOM, clampZoom, stepZoom } from "@/lib/zoom"

type Tool = "censor" | "crop" | "pan"

type Drag =
  | { kind: "draw"; target: "box" | "crop"; startX: number; startY: number }
  | {
      kind: "move"
      target: "box" | "crop"
      index: number
      startX: number
      startY: number
      origin: RedactionBox
      base: ImageEdits
    }
  | {
      kind: "resize"
      target: "box" | "crop"
      index: number
      corner: Corner
      base: ImageEdits
    }
  | {
      kind: "pan"
      clientX: number
      clientY: number
      scrollLeft: number
      scrollTop: number
    }

/** Space around the image inside the scroll area, in CSS pixels. */
const GUTTER = 24
/** Arrow-key nudge, as a fraction of the image; Shift moves 5x further. */
const NUDGE = 0.002

const TOOL_HINTS: Record<Tool, string> = {
  censor:
    "Drag to black out an area. Drag a box to move it, or a corner to resize. Arrow keys nudge.",
  crop: "Drag to choose the area to keep. Drag inside it to move, or a corner to resize.",
  pan: "Drag to move around. Hold Space in any tool to pan.",
}

const pct = (value: number) => `${value * 100}%`

function boxStyle(box: RedactionBox) {
  return {
    left: pct(box.x),
    top: pct(box.y),
    width: pct(box.width),
    height: pct(box.height),
  }
}

const CORNER_CLASS: Record<Corner, string> = {
  nw: "-top-1.5 -left-1.5 cursor-nwse-resize",
  ne: "-top-1.5 -right-1.5 cursor-nesw-resize",
  sw: "-bottom-1.5 -left-1.5 cursor-nesw-resize",
  se: "-right-1.5 -bottom-1.5 cursor-nwse-resize",
}

function CornerHandles({
  onDown,
  label,
}: {
  onDown: (event: ReactPointerEvent, corner: Corner) => void
  label: string
}) {
  return CORNERS.map((corner) => (
    <span
      key={corner}
      data-testid={`${label}-handle-${corner}`}
      aria-hidden
      className={cn(
        "absolute z-10 size-3 border-2 border-primary bg-white",
        CORNER_CLASS[corner]
      )}
      onPointerDown={(event) => onDown(event, corner)}
    />
  ))
}

function ToolbarButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      className={cn(
        "border-white/30 bg-transparent text-white hover:bg-white/15 disabled:opacity-40",
        active && "border-primary bg-primary text-primary-foreground"
      )}
      onClick={onClick}
    >
      {children}
      <span className="max-sm:sr-only">{label}</span>
    </Button>
  )
}

export type ImageEditorProps = {
  src: string
  initialEdits: ImageEdits
  /** Shown in the toolbar, e.g. "Edit receipt". */
  title: string
  applyLabel?: string
  onCancel: () => void
  /** May be async; the editor stays open and shows the error if it throws. */
  onApply: (edits: ImageEdits) => void | Promise<void>
}

/**
 * Fullscreen editor to crop an image and black out parts of it. All boxes
 * are fractions of the original image. Edits go through an undo history;
 * a drag is one undo step. Applying hands the cleaned edits back; turning
 * them into pixels is the caller's job.
 *
 * Shortcuts: Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo and redo; C, R, H pick
 * the censor, crop, and pan tools; Space pans while held; + / - / 0 zoom;
 * P previews; Delete removes the selected box; arrows nudge it.
 */
export function ImageEditor({
  src,
  initialEdits,
  title,
  applyLabel = "Apply",
  onCancel,
  onApply,
}: ImageEditorProps) {
  const [history, setHistory] = useState<History<ImageEdits>>(() =>
    initHistory(initialEdits)
  )
  const initial = useRef(history.present)
  const edits = history.present
  const [tool, setTool] = useState<Tool>("censor")
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState<RedactionBox | null>(null)
  const [preview, setPreview] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const anchorRef = useRef<{
    fx: number
    fy: number
    cx: number
    cy: number
  } | null>(null)

  const activeTool: Tool = spaceHeld ? "pan" : tool
  const interactive = !preview && activeTool !== "pan"
  const dirty = edits !== initial.current

  // Image size on screen: "fit" shows the whole image, zoom multiplies it.
  const fitWidth =
    natural && viewport.w > 0
      ? Math.min(viewport.w, (viewport.h * natural.w) / natural.h)
      : 0
  const shownWidth = fitWidth * zoom
  const shownHeight = natural ? (shownWidth * natural.h) / natural.w : 0
  const fitWidthZoom =
    fitWidth > 0 ? clampZoom(viewport.w / fitWidth) : undefined
  const scaleLabel =
    natural && shownWidth > 0
      ? `${Math.round((shownWidth / natural.w) * 100)}%`
      : "Fit"

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const measure = () =>
      setViewport({
        w: Math.max(0, element.clientWidth - GUTTER * 2),
        h: Math.max(0, element.clientHeight - GUTTER * 2),
      })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Keep the anchored point under the cursor (or the viewport centre) after
  // a zoom changes the content size.
  useLayoutEffect(() => {
    const element = scrollRef.current
    const anchor = anchorRef.current
    if (!element || !anchor) return
    anchorRef.current = null
    element.scrollLeft = anchor.fx * element.scrollWidth - anchor.cx
    element.scrollTop = anchor.fy * element.scrollHeight - anchor.cy
  }, [zoom])

  function zoomTo(next: number, clientX?: number, clientY?: number) {
    const element = scrollRef.current
    const target = clampZoom(next)
    if (element && target !== zoom) {
      const rect = element.getBoundingClientRect()
      const cx =
        clientX === undefined ? element.clientWidth / 2 : clientX - rect.left
      const cy =
        clientY === undefined ? element.clientHeight / 2 : clientY - rect.top
      anchorRef.current = {
        fx: element.scrollWidth
          ? (element.scrollLeft + cx) / element.scrollWidth
          : 0.5,
        fy: element.scrollHeight
          ? (element.scrollTop + cy) / element.scrollHeight
          : 0.5,
        cx,
        cy,
      }
    }
    setZoom(target)
  }

  // Ctrl/Cmd + wheel (and trackpad pinch) zooms at the cursor. React wheel
  // listeners are passive, so this one is attached by hand.
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const zoomToRef = useRef(zoomTo)
  zoomToRef.current = zoomTo
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomToRef.current(
        stepZoom(zoomRef.current, event.deltaY < 0 ? 1 : -1),
        event.clientX,
        event.clientY
      )
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [])

  function commit(next: ImageEdits) {
    setHistory((current) => pushHistory(current, next))
  }

  function undo() {
    setSelected(null)
    setHistory(undoHistory)
  }

  function redo() {
    setSelected(null)
    setHistory(redoHistory)
  }

  function deleteSelected() {
    if (selected === null) return
    commit({
      ...edits,
      boxes: edits.boxes.filter((_, index) => index !== selected),
    })
    setSelected(null)
  }

  function nudgeSelected(dx: number, dy: number) {
    if (selected === null) return
    commit({
      ...edits,
      boxes: edits.boxes.map((box, index) =>
        index === selected ? moveBox(box, dx, dy) : box
      ),
    })
  }

  function chooseTool(next: Tool) {
    setTool(next)
    setSelected(null)
  }

  function requestCancel() {
    if (busy) return
    if (dirty && !window.confirm("Discard your changes to this image?")) return
    onCancel()
  }

  // One document listener that always sees the latest state.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {})
  keyHandler.current = (event: KeyboardEvent) => {
    const target = event.target
    if (
      target instanceof Element &&
      target.closest("input, textarea, select, [contenteditable]")
    )
      return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    if (mod && key === "z") {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (mod && key === "y") {
      event.preventDefault()
      redo()
      return
    }
    if (mod) return

    if (event.key === " ") {
      event.preventDefault()
      if (event.type === "keydown") setSpaceHeld(true)
      return
    }
    if (event.type !== "keydown") return

    if (event.key === "Escape") {
      if (selected !== null) setSelected(null)
      else requestCancel()
      return
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      deleteSelected()
      return
    }
    if (event.key.startsWith("Arrow") && selected !== null) {
      event.preventDefault()
      const step = event.shiftKey ? NUDGE * 5 : NUDGE
      const dx =
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0
      const dy =
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
      nudgeSelected(dx, dy)
      return
    }
    if (key === "+" || key === "=") zoomTo(stepZoom(zoom, 1))
    else if (key === "-") zoomTo(stepZoom(zoom, -1))
    else if (key === "0") zoomTo(1)
    else if (key === "c") chooseTool("censor")
    else if (key === "r") chooseTool("crop")
    else if (key === "h") chooseTool("pan")
    else if (key === "p") setPreview((on) => !on)
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyHandler.current(event)
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") setSpaceHeld(false)
    }
    const onBlur = () => setSpaceHeld(false)
    document.addEventListener("keydown", onKey)
    document.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", onBlur)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
    }
  }, [])

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
    if (activeTool === "pan") {
      // Touch pans natively through touch-action; only mice need help.
      if (event.pointerType === "touch") return
      const element = scrollRef.current
      if (!element) return
      capture(event)
      dragRef.current = {
        kind: "pan",
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
      }
      setPanning(true)
      return
    }
    if (preview) return
    const { x, y } = pointAt(event)
    capture(event)
    dragRef.current = {
      kind: "draw",
      target: activeTool === "crop" ? "crop" : "box",
      startX: x,
      startY: y,
    }
    setSelected(null)
    setDraft(boxFromPoints(x, y, x, y))
  }

  function startMove(
    event: ReactPointerEvent,
    target: "box" | "crop",
    index: number,
    origin: RedactionBox
  ) {
    if (event.button !== 0 || !interactive) return
    event.stopPropagation()
    const { x, y } = pointAt(event)
    capture(event)
    dragRef.current = {
      kind: "move",
      target,
      index,
      startX: x,
      startY: y,
      origin,
      base: edits,
    }
    if (target === "box") setSelected(index)
  }

  function startResize(
    event: ReactPointerEvent,
    target: "box" | "crop",
    index: number,
    corner: Corner
  ) {
    if (event.button !== 0 || !interactive) return
    event.stopPropagation()
    capture(event)
    dragRef.current = { kind: "resize", target, index, corner, base: edits }
    if (target === "box") setSelected(index)
  }

  /** Replaces the dragged box (or the crop) without recording history. */
  function previewTarget(
    target: "box" | "crop",
    index: number,
    update: (box: RedactionBox) => RedactionBox
  ) {
    setHistory((current) => {
      const present = current.present
      if (target === "crop") {
        if (!present.crop) return current
        return previewHistory(current, {
          ...present,
          crop: update(present.crop),
        })
      }
      return previewHistory(current, {
        ...present,
        boxes: present.boxes.map((box, i) => (i === index ? update(box) : box)),
      })
    })
  }

  function onSurfaceMove(event: ReactPointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    if (drag.kind === "pan") {
      const element = scrollRef.current
      if (!element) return
      element.scrollLeft = drag.scrollLeft - (event.clientX - drag.clientX)
      element.scrollTop = drag.scrollTop - (event.clientY - drag.clientY)
      return
    }
    const { x, y } = pointAt(event)
    if (drag.kind === "draw") {
      setDraft(boxFromPoints(drag.startX, drag.startY, x, y))
    } else if (drag.kind === "move") {
      previewTarget(drag.target, drag.index, () =>
        moveBox(drag.origin, x - drag.startX, y - drag.startY)
      )
    } else {
      previewTarget(drag.target, drag.index, (box) =>
        resizeFromCorner(box, drag.corner, x, y)
      )
    }
  }

  function onSurfaceUp() {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    if (drag.kind === "pan") {
      setPanning(false)
      return
    }
    if (drag.kind === "draw") {
      if (draft && isUsableBox(draft)) {
        if (drag.target === "crop") commit({ ...edits, crop: draft })
        else {
          commit({ ...edits, boxes: [...edits.boxes, draft] })
          setSelected(edits.boxes.length)
        }
      }
      setDraft(null)
      return
    }
    // A box or crop shrunk to nothing is dropped rather than left invisible.
    setHistory((current) =>
      commitHistory(
        previewHistory(current, cleanEdits(current.present)),
        drag.base
      )
    )
    if (drag.target === "box" && drag.kind === "resize") {
      setSelected((index) =>
        index !== null && edits.boxes[index] && isUsableBox(edits.boxes[index])
          ? index
          : null
      )
    }
  }

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      await onApply(cleanEdits(edits))
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Applying the edits failed."
      )
    } finally {
      setBusy(false)
    }
  }

  const shownCrop = draft && activeTool === "crop" ? draft : edits.crop
  const boxCount = edits.boxes.length

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex h-dvh flex-col bg-neutral-950 text-white"
    >
      <div className="flex shrink-0 items-start gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="text-xs text-white/70">{TOOL_HINTS[activeTool]}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-white hover:bg-white/15"
          disabled={busy}
          onClick={requestCancel}
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

      <div
        role="toolbar"
        aria-label="Image tools"
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-y border-white/15 px-3 py-2"
      >
        <ToolbarButton
          label="Censor"
          shortcut="C"
          active={tool === "censor"}
          onClick={() => chooseTool("censor")}
        >
          <RectangleIcon weight="fill" />
        </ToolbarButton>
        <ToolbarButton
          label="Crop"
          shortcut="R"
          active={tool === "crop"}
          onClick={() => chooseTool("crop")}
        >
          <CropIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Pan"
          shortcut="H or hold Space"
          active={tool === "pan"}
          onClick={() => chooseTool("pan")}
        >
          <HandIcon />
        </ToolbarButton>

        <span className="mx-1 h-6 w-px bg-white/20" aria-hidden />
        <ToolbarButton
          label="Undo"
          shortcut="Ctrl+Z"
          disabled={history.past.length === 0}
          onClick={undo}
        >
          <ArrowCounterClockwiseIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Redo"
          shortcut="Ctrl+Shift+Z"
          disabled={history.future.length === 0}
          onClick={redo}
        >
          <ArrowClockwiseIcon />
        </ToolbarButton>

        <span className="mx-1 h-6 w-px bg-white/20" aria-hidden />
        {tool === "crop" ? (
          <ToolbarButton
            label="Reset crop"
            disabled={!edits.crop}
            onClick={() => commit({ ...edits, crop: null })}
          >
            <CornersInIcon />
          </ToolbarButton>
        ) : (
          <>
            <ToolbarButton
              label="Delete box"
              shortcut="Delete"
              disabled={selected === null}
              onClick={deleteSelected}
            >
              <TrashIcon />
            </ToolbarButton>
            <ToolbarButton
              label={`Clear boxes${boxCount ? ` (${boxCount})` : ""}`}
              disabled={boxCount === 0}
              onClick={() => {
                commit({ ...edits, boxes: [] })
                setSelected(null)
              }}
            >
              <XIcon />
            </ToolbarButton>
          </>
        )}

        <span className="ml-auto" />
        <ToolbarButton
          label="Preview"
          shortcut="P"
          active={preview}
          onClick={() => setPreview((on) => !on)}
        >
          <EyeIcon />
        </ToolbarButton>
        <span className="mx-1 h-6 w-px bg-white/20" aria-hidden />
        <ToolbarButton
          label="Zoom out"
          shortcut="-"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => zoomTo(stepZoom(zoom, -1))}
        >
          <MagnifyingGlassMinusIcon />
        </ToolbarButton>
        <button
          type="button"
          title="Fit the whole image (0)"
          className="min-w-14 rounded-md px-1.5 py-1 text-center text-xs tabular-nums hover:bg-white/15"
          onClick={() => zoomTo(1)}
        >
          {scaleLabel}
        </button>
        <ToolbarButton
          label="Zoom in"
          shortcut="+"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => zoomTo(stepZoom(zoom, 1))}
        >
          <MagnifyingGlassPlusIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Fit width"
          disabled={fitWidthZoom === undefined}
          onClick={() => fitWidthZoom && zoomTo(fitWidthZoom)}
        >
          <ArrowsOutLineHorizontalIcon />
        </ToolbarButton>
      </div>

      {error && (
        <p role="alert" className="shrink-0 bg-destructive px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <div
        ref={scrollRef}
        data-testid="image-editor-viewport"
        className="min-h-0 flex-1 overflow-auto"
        style={{ padding: GUTTER }}
      >
        <div className="grid min-h-full w-max min-w-full place-items-center">
          <div
            ref={surfaceRef}
            data-testid="image-editor-surface"
            className="relative select-none"
            style={{
              width: shownWidth || undefined,
              height: shownHeight || undefined,
              touchAction: activeTool === "pan" ? "pan-x pan-y" : "none",
              cursor:
                activeTool === "pan"
                  ? panning
                    ? "grabbing"
                    : "grab"
                  : preview
                    ? "default"
                    : "crosshair",
            }}
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
                shownWidth ? "h-full w-full" : "max-h-[60dvh] max-w-full"
              )}
              onLoad={(event) =>
                setNatural({
                  w: event.currentTarget.naturalWidth,
                  h: event.currentTarget.naturalHeight,
                })
              }
            />

            {edits.boxes.map((box, index) => (
              <div
                key={index}
                data-testid="redaction-box"
                aria-label={box.label ?? "Censored area"}
                className={cn(
                  "absolute bg-black",
                  interactive && tool === "censor"
                    ? "cursor-move"
                    : "pointer-events-none",
                  !preview &&
                    (selected === index
                      ? "outline-2 outline-offset-1 outline-primary"
                      : "outline-1 outline-white/60 outline-dashed")
                )}
                style={boxStyle(box)}
                onPointerDown={(event) =>
                  tool === "censor" && startMove(event, "box", index, box)
                }
              >
                {box.label && !preview && (
                  <span className="pointer-events-none absolute bottom-full left-0 mb-0.5 rounded-sm bg-primary px-1 text-[10px] whitespace-nowrap text-primary-foreground">
                    {box.label}
                  </span>
                )}
                {selected === index && interactive && tool === "censor" && (
                  <CornerHandles
                    label="box"
                    onDown={(event, corner) =>
                      startResize(event, "box", index, corner)
                    }
                  />
                )}
              </div>
            ))}

            {draft && activeTool === "censor" && (
              <div
                className="pointer-events-none absolute bg-black/70 outline-1 outline-white outline-dashed"
                style={boxStyle(draft)}
              />
            )}

            {shownCrop && (
              <>
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div
                    className="absolute"
                    style={{
                      ...boxStyle(shownCrop),
                      boxShadow: `0 0 0 100000px rgb(0 0 0 / ${preview ? 0.92 : 0.6})`,
                    }}
                  />
                </div>
                {!preview && (
                  <div
                    data-testid="crop-frame"
                    className={cn(
                      "absolute border-2 border-white",
                      interactive && tool === "crop"
                        ? "cursor-move"
                        : "pointer-events-none border-dashed border-white/70"
                    )}
                    style={boxStyle(shownCrop)}
                    onPointerDown={(event) =>
                      edits.crop &&
                      tool === "crop" &&
                      startMove(event, "crop", 0, edits.crop)
                    }
                  >
                    {interactive && tool === "crop" && !draft && (
                      <CornerHandles
                        label="crop"
                        onDown={(event, corner) =>
                          startResize(event, "crop", 0, corner)
                        }
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
