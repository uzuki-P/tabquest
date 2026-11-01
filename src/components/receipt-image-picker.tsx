import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode, RefObject } from "react"
import { createPortal } from "react-dom"
import {
  ArrowSquareOutIcon,
  EyeSlashIcon,
  ImageSquareIcon,
  MagicWandIcon,
  MagnifyingGlassPlusIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"

import { RedactionEditor } from "@/components/redaction-editor"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { RedactedImage } from "@/lib/redact-image"
import type { RedactionBox } from "@/lib/redaction"
import { cn } from "@/lib/utils"

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/avif"

export type ReceiptImagePickerProps = {
  ocrInputRef: RefObject<HTMLInputElement | null>
  billInputRef: RefObject<HTMLInputElement | null>
  separateBillImage: boolean
  setSeparateBillImage: (next: boolean) => void
  ocrBusy: boolean
  ocrError: string | null
  ocrMessage: string | null
  onOcrParse: () => void
  receiptRedaction: RedactedImage | null
  billRedaction: RedactedImage | null
  /** Flattens the boxes into a censored copy of `source` (none clears it). */
  onRedact: (
    target: "receipt" | "bill",
    source: File,
    boxes: RedactionBox[]
  ) => Promise<void>
}

type RedactTarget = "receipt" | "bill"

function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDateTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function relTime(ms: number) {
  const minutes = Math.floor((Date.now() - ms) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

function useObjectUrl(blob: Blob | null) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url]
  )
  return url
}

/**
 * Mirrors a file input into preview state. `shownUrl` is the censored copy
 * when `redaction` belongs to the current file, otherwise the original.
 */
function useFilePreview(
  inputRef: RefObject<HTMLInputElement | null>,
  redaction: RedactedImage | null
) {
  const [file, setFile] = useState<File | null>(
    () => inputRef.current?.files?.[0] ?? null
  )
  const url = useObjectUrl(file)
  const active = file && redaction?.source === file ? redaction : null
  const censoredUrl = useObjectUrl(active?.file ?? null)
  return { file, setFile, url, active, shownUrl: censoredUrl ?? url }
}

function CensorNote({
  redaction,
  onReview,
}: {
  redaction: RedactedImage
  onReview: () => void
}) {
  const count = redaction.boxes.length
  const areas = `${count} ${count === 1 ? "area" : "areas"}`
  const labels = [
    ...new Set(redaction.boxes.flatMap((box) => box.label ?? [])),
  ].join(", ")
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-2 rounded-md border px-2.5 py-2 text-xs",
        redaction.suggested
          ? "border-amber-500/50 bg-amber-500/10"
          : "bg-muted/40 text-muted-foreground"
      )}
    >
      <p>
        {redaction.suggested
          ? `Parse blacked out ${areas} that ${count === 1 ? "looks" : "look"} personal${labels ? ` (${labels})` : ""}. Review them before saving.`
          : `${areas} censored. The saved image hides them.`}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onReview}>
        {redaction.suggested ? "Review" : "Edit"}
      </Button>
    </div>
  )
}

function StatusChip({
  busy,
  message,
  error,
  hasFile,
}: {
  busy: boolean
  message: string | null
  error: string | null
  hasFile: boolean
}) {
  const label = busy
    ? "Parsing…"
    : error
      ? "Parse failed"
      : message
        ? "Parsed"
        : hasFile
          ? "Ready to parse"
          : "No photo"
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        error
          ? "bg-destructive/10 text-destructive"
          : message
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground"
      )}
    >
      {label}
    </span>
  )
}

function MetaRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="shrink-0">{term}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  )
}

/**
 * Fullscreen preview overlay for a picked image, mirroring the bill detail
 * page lightbox. Portaled to the body: ancestors with transforms would
 * otherwise become the containing block for this fixed overlay. Closes on
 * backdrop click, Escape, or the close button.
 */
function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden bg-black/80 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative z-10 mb-3 flex w-full shrink-0 items-center justify-end gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          title="Open in new tab"
          aria-label="Open in new tab"
          className="flex size-11 items-center justify-center border-2 border-white/70 bg-black/70 text-white transition-colors hover:bg-white/15"
        >
          <ArrowSquareOutIcon className="size-5" />
        </a>
        <button
          type="button"
          ref={closeRef}
          title="Close"
          aria-label="Close"
          className="flex size-11 items-center justify-center border-2 border-white/70 bg-black/70 text-white transition-colors hover:bg-white/15"
          onClick={onClose}
        >
          <XIcon className="size-5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <img
          src={src}
          alt={alt}
          className="max-h-full max-w-full object-contain"
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    </div>,
    document.body
  )
}

/**
 * Receipt (and optional separate bill) image upload for the new bill
 * wizard's first step. The chosen files live in the ref'd uncontrolled
 * inputs — `ocrInputRef` feeds OCR parsing, `resolveImageFile` picks the
 * image saved with the bill — so this component mirrors them into preview
 * state but never owns the files. The receipt photo doubles as the bill
 * image unless `separateBillImage` is set. Censoring is controlled too: the
 * parent keeps each image's `RedactedImage` and uploads its flattened copy.
 */
export function ReceiptImagePicker({
  ocrInputRef,
  billInputRef,
  separateBillImage,
  setSeparateBillImage,
  ocrBusy,
  ocrError,
  ocrMessage,
  onOcrParse,
  receiptRedaction,
  billRedaction,
  onRedact,
}: ReceiptImagePickerProps) {
  const receipt = useFilePreview(ocrInputRef, receiptRedaction)
  const bill = useFilePreview(billInputRef, billRedaction)
  const [censoring, setCensoring] = useState<RedactTarget | null>(null)
  const censorTarget =
    censoring === "receipt" ? receipt : censoring === "bill" ? bill : null
  const [receiptDims, setReceiptDims] = useState<{
    width: number
    height: number
  } | null>(null)
  const [zoom, setZoom] = useState<"receipt" | "bill" | null>(null)

  return (
    <div className="space-y-3">
      <Label htmlFor="ocr-image" className="sr-only">
        Receipt image
      </Label>
      <input
        id="ocr-image"
        name="ocr-image"
        type="file"
        ref={ocrInputRef}
        accept={IMAGE_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          setReceiptDims(null)
          receipt.setFile(event.target.files?.[0] ?? null)
        }}
      />
      <Label htmlFor="bill-image" className="sr-only">
        Bill image
      </Label>
      <input
        id="bill-image"
        name="image"
        type="file"
        ref={billInputRef}
        accept={IMAGE_ACCEPT}
        className="sr-only"
        onChange={(event) => bill.setFile(event.target.files?.[0] ?? null)}
      />

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Receipt photo</h3>
            <StatusChip
              hasFile={Boolean(receipt.file)}
              busy={ocrBusy}
              message={ocrMessage}
              error={ocrError}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={() => ocrInputRef.current?.click()}>
              <PlusIcon data-icon="inline-start" />
              {receipt.file ? "Replace" : "Choose photo"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={ocrBusy || !receipt.file}
              onClick={onOcrParse}
            >
              <MagicWandIcon data-icon="inline-start" />
              Parse
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!receipt.file}
              onClick={() => setCensoring("receipt")}
            >
              <EyeSlashIcon data-icon="inline-start" />
              Censor
            </Button>
          </div>
          {receipt.active && (
            <CensorNote
              redaction={receipt.active}
              onReview={() => setCensoring("receipt")}
            />
          )}
          {receipt.file && (
            <dl className="space-y-1 text-xs text-muted-foreground">
              <MetaRow term="File">{receipt.file.name}</MetaRow>
              <MetaRow term="Size">{fmtBytes(receipt.file.size)}</MetaRow>
              <MetaRow term="Type">{receipt.file.type || "unknown"}</MetaRow>
              {receiptDims && (
                <MetaRow term="Dimensions">
                  {receiptDims.width} × {receiptDims.height}
                </MetaRow>
              )}
              <MetaRow term="Modified">
                <span title={fmtDateTime(receipt.file.lastModified)}>
                  {fmtDateTime(receipt.file.lastModified)}
                </span>{" "}
                <span className="whitespace-nowrap text-primary">
                  ({relTime(receipt.file.lastModified)})
                </span>
              </MetaRow>
            </dl>
          )}
          {ocrMessage && (
            <p className="text-xs text-muted-foreground">{ocrMessage}</p>
          )}
          {ocrError && (
            <p role="alert" className="text-sm text-destructive">
              {ocrError}
            </p>
          )}

          <div className="space-y-2 border-t pt-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-primary"
                checked={separateBillImage}
                onChange={(event) => setSeparateBillImage(event.target.checked)}
              />
              <span>
                Use a different image for the bill
                <span className="block text-xs text-muted-foreground">
                  Off by default: the receipt photo doubles as the bill image.
                </span>
              </span>
            </label>
            {separateBillImage && bill.active && (
              <div className="pl-6">
                <CensorNote
                  redaction={bill.active}
                  onReview={() => setCensoring("bill")}
                />
              </div>
            )}
            {separateBillImage && (
              <div className="flex items-center justify-between gap-2 pl-6">
                <span className="truncate text-xs text-muted-foreground">
                  {bill.file
                    ? `${bill.file.name} · ${fmtBytes(bill.file.size)}`
                    : "No bill image yet"}
                </span>
                <span className="flex gap-1">
                  {bill.file && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setZoom("bill")}
                    >
                      View
                    </Button>
                  )}
                  {bill.file && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setCensoring("bill")}
                    >
                      Censor
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => billInputRef.current?.click()}
                  >
                    {bill.file ? "Replace" : "Choose"}
                  </Button>
                  {bill.file && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Remove bill image"
                      onClick={() => {
                        if (billInputRef.current)
                          billInputRef.current.value = ""
                        bill.setFile(null)
                      }}
                    >
                      <TrashIcon />
                    </Button>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1">
          {receipt.shownUrl ? (
            <button
              type="button"
              onClick={() => setZoom("receipt")}
              title="View fullscreen"
              className="group relative block h-80 w-full overflow-hidden rounded-lg border bg-muted/30 md:h-96"
            >
              <img
                src={receipt.shownUrl}
                alt="Receipt image preview"
                className="h-full w-full object-contain"
                onLoad={(event) =>
                  setReceiptDims({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
              />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent px-2.5 pt-6 pb-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <span className="truncate">
                  {receipt.file?.name} · {fmtBytes(receipt.file?.size ?? 0)}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <MagnifyingGlassPlusIcon className="size-3.5" />
                  Fullscreen
                </span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => ocrInputRef.current?.click()}
              className="flex h-80 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 text-center transition-colors outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/30 md:h-96"
            >
              <ImageSquareIcon className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium">No photo yet</span>
              <span className="text-xs text-muted-foreground">
                Pick the receipt photo — the preview opens here. Click it to
                zoom.
              </span>
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            {receipt.url
              ? "Click the photo to view it fullscreen — portrait receipts read best there."
              : "PNG, JPEG, WebP, or AVIF up to 15 MiB and 40 MP."}
          </p>
          {separateBillImage && bill.shownUrl && (
            <button
              type="button"
              onClick={() => setZoom("bill")}
              title="View fullscreen"
              className="block h-40 w-full overflow-hidden rounded-lg border bg-muted/30"
            >
              <img
                src={bill.shownUrl}
                alt="Bill image preview"
                className="h-full w-full object-contain"
              />
            </button>
          )}
        </div>
      </div>

      {zoom === "receipt" && receipt.shownUrl && (
        <ImageLightbox
          src={receipt.shownUrl}
          alt="Receipt image preview"
          onClose={() => setZoom(null)}
        />
      )}
      {zoom === "bill" && bill.shownUrl && (
        <ImageLightbox
          src={bill.shownUrl}
          alt="Bill image preview"
          onClose={() => setZoom(null)}
        />
      )}
      {censoring && censorTarget?.file && censorTarget.url && (
        <RedactionEditor
          src={censorTarget.url}
          initialBoxes={censorTarget.active?.boxes ?? []}
          title={
            censoring === "receipt" ? "Censor receipt" : "Censor bill image"
          }
          onCancel={() => setCensoring(null)}
          onApply={async (boxes) => {
            await onRedact(censoring, censorTarget.file!, boxes)
            setCensoring(null)
          }}
        />
      )}
    </div>
  )
}
