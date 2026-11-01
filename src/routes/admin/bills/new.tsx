import {
  createFileRoute,
  useBlocker,
  useNavigate,
} from "@tanstack/react-router"
import { useRef, useState } from "react"

import {
  BILL_STEPS,
  AdjustmentsSection,
  AdjustmentSummary,
  BillStepNav,
  BillStepTabs,
  ItemsSection,
  ReviewSection,
  useBillForm,
  newFormItem,
} from "@/components/bill-form-sections"
import { AllocationBoardSection } from "@/components/allocation-board"
import { DatePicker } from "@/components/date-picker"
import { PlayersPickerSection } from "@/components/player-picker"
import { BillFormSkeleton } from "@/components/page-skeletons"
import { PageBreadcrumb } from "@/components/page-breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ThemeToggle } from "@/components/theme-toggle"
import { formatAmountInput } from "@/domain/money"
import { describeSplitIssue, buildStructure } from "@/lib/bill-form"
import type { BillFormValue } from "@/lib/bill-form"
import type { BillStructureInput } from "@/lib/bill-schema"
import type { ReceiptOcr } from "@/server/services/ocr"
import { redactFile } from "@/lib/redact-image"
import type { RedactedImage } from "@/lib/redact-image"
import type { RedactionBox } from "@/lib/redaction"
import { showToast } from "@/components/ui/toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ReceiptImagePicker } from "@/components/receipt-image-picker"
import type { ReceiptImagePickerProps } from "@/components/receipt-image-picker"
import { todayJakarta } from "@/lib/time"

export const Route = createFileRoute("/admin/bills/new")({
  component: NewBillPage,
  pendingComponent: BillFormSkeleton,
})

function emptyBillForm(): BillFormValue {
  return {
    merchant: "",
    title: "",
    orderDate: todayJakarta(),
    sourceSubtotal: "",
    finalTotal: "",
    items: [newFormItem()],
    adjustments: [],
    billPlayers: [],
  }
}

// Exported for the wizard-step regression test.
export function NewBillPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [issues, setIssues] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null)
  // Set once the first save succeeds; later saves update that draft instead
  // of creating a new bill every time the button is pressed.
  const [savedBillId, setSavedBillId] = useState<string | null>(null)
  // The File sent with the last image upload, so a re-picked image can be
  // told apart from the stored one.
  const uploadedImageRef = useRef<File | null>(null)
  const [matrix, setMatrix] = useState<Record<string, string>>({})
  const form = useBillForm(emptyBillForm())

  const ocrInputRef = useRef<HTMLInputElement>(null)
  const billInputRef = useRef<HTMLInputElement>(null)
  const [separateBillImage, setSeparateBillImage] = useState(false)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrMessage, setOcrMessage] = useState<string | null>(null)
  const [receiptRedaction, setReceiptRedaction] =
    useState<RedactedImage | null>(null)
  const [billRedaction, setBillRedaction] = useState<RedactedImage | null>(null)

  async function onRedact(
    target: "receipt" | "bill",
    source: File,
    boxes: RedactionBox[]
  ) {
    const redaction = await redactFile(source, boxes, false)
    if (target === "receipt") setReceiptRedaction(redaction)
    else setBillRedaction(redaction)
  }

  /**
   * Blacks out the areas Parse flagged as personal, marked for review.
   * Skipped when the photo was replaced meanwhile or the admin already
   * censored it by hand. Failing here must not hide the parsed values.
   */
  async function applySuggestedRedactions(file: File, boxes: RedactionBox[]) {
    if (boxes.length === 0 || ocrInputRef.current?.files?.[0] !== file) return
    try {
      const suggested = await redactFile(file, boxes, true)
      setReceiptRedaction((current) =>
        current?.source === file && !current.suggested ? current : suggested
      )
    } catch {
      // The admin can still censor by hand.
    }
  }

  // Leaving with unsaved work must ask first. "Unsaved" means the values
  // drifted from the empty form (or from the values as of the last
  // successful save), or an image is picked that has not been uploaded.
  // Read live at navigation time; no reactive tracking needed.
  const initialValuesJson = useRef(JSON.stringify(form.state.values))
  const savedValuesJson = useRef<string | null>(null)
  function hasUnsavedChanges(): boolean {
    const valuesDirty =
      JSON.stringify(form.state.values) !==
      (savedValuesJson.current ?? initialValuesJson.current)
    const file = resolveImageFile()
    return valuesDirty || (file !== null && file !== uploadedImageRef.current)
  }
  const blocker = useBlocker({
    shouldBlockFn: hasUnsavedChanges,
    withResolver: true,
    enableBeforeUnload: true,
  })

  function goToStep(next: number) {
    setStep(next)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function applyReceipt(receipt: ReceiptOcr) {
    if (receipt.merchant) form.setFieldValue("merchant", receipt.merchant)
    if (/^\d{4}-\d{2}-\d{2}$/.test(receipt.orderDate)) {
      form.setFieldValue("orderDate", receipt.orderDate)
    }
    form.setFieldValue(
      "items",
      receipt.items.map((item) => ({
        key: crypto.randomUUID(),
        name: item.name,
        variantNotes: item.variantNotes,
        quantity: String(item.quantity),
        unitPrice: formatAmountInput(String(item.unitPrice)),
      }))
    )
    form.setFieldValue(
      "adjustments",
      receipt.adjustments.map((adjustment) => ({
        key: crypto.randomUUID(),
        type: adjustment.type,
        label: adjustment.label,
        amount: formatAmountInput(String(adjustment.amount)),
        originalAmount: "",
      }))
    )
    form.setFieldValue(
      "sourceSubtotal",
      formatAmountInput(String(receipt.sourceSubtotal))
    )
    form.setFieldValue(
      "finalTotal",
      formatAmountInput(String(receipt.finalTotal))
    )
    setMatrix({})
  }

  async function onOcrParse() {
    const file = ocrInputRef.current?.files?.[0]
    if (!file || file.size === 0) {
      setOcrError("Choose a receipt image first.")
      return
    }
    setOcrError(null)
    setOcrMessage(null)
    setOcrBusy(true)
    try {
      const body = new FormData()
      body.set("image", file)
      const response = await fetch("/api/admin/ocr/receipt", {
        method: "POST",
        body,
      })
      const responseBody = (await response.json()) as {
        ok?: boolean
        receipt?: ReceiptOcr
        redactions?: RedactionBox[]
        message?: string
      }
      if (!response.ok || !responseBody.receipt) {
        setOcrError(responseBody.message ?? "Parsing the receipt failed.")
        return
      }
      applyReceipt(responseBody.receipt)
      const { items, adjustments } = responseBody.receipt
      setOcrMessage(
        `Filled ${items.length} items and ${adjustments.length} adjustments. Check every value against the receipt.`
      )
      await applySuggestedRedactions(file, responseBody.redactions ?? [])
    } catch {
      setOcrError("Parsing the receipt failed.")
    } finally {
      setOcrBusy(false)
    }
  }

  /** The parsed receipt photo doubles as the bill image unless a
      separate one was chosen. A censored copy replaces the picked file
      when its boxes belong to that file. */
  function resolveImageFile(): File | null {
    const imageFile = separateBillImage
      ? billInputRef.current?.files?.[0]
      : ocrInputRef.current?.files?.[0]
    if (!imageFile || imageFile.size === 0) return null
    const redaction = separateBillImage ? billRedaction : receiptRedaction
    return redaction?.source === imageFile ? redaction.file : imageFile
  }

  async function createDraft(
    structure: BillStructureInput
  ): Promise<string | null> {
    const body = new FormData()
    body.set("merchant", structure.header.merchant)
    body.set("title", structure.header.title)
    body.set("orderDate", structure.header.orderDate)
    body.set("sourceSubtotal", String(structure.header.sourceSubtotal))
    body.set("finalTotal", String(structure.header.finalTotal))
    body.set(
      "structure",
      JSON.stringify({
        items: structure.items,
        adjustments: structure.adjustments,
        billPlayers: structure.billPlayers,
        allocations: structure.allocations,
      })
    )
    const imageFile = resolveImageFile()
    if (imageFile) {
      body.set("image", imageFile)
      uploadedImageRef.current = imageFile
    }

    const response = await fetch("/api/admin/bills", {
      method: "POST",
      body,
    })
    const responseBody = (await response.json().catch(() => ({}))) as {
      billId?: string
      issues?: string[]
      message?: string
    }
    if (!response.ok || !responseBody.billId) {
      setIssues(responseBody.issues ?? [])
      setError(responseBody.message ?? "Saving the draft failed.")
      return null
    }
    savedValuesJson.current = JSON.stringify(form.state.values)
    return responseBody.billId
  }

  async function updateDraft(
    billId: string,
    structure: BillStructureInput
  ): Promise<boolean> {
    const imageFile = resolveImageFile()
    if (imageFile && imageFile !== uploadedImageRef.current) {
      const body = new FormData()
      body.set("image", imageFile)
      const imageResponse = await fetch(`/api/admin/bills/${billId}/image`, {
        method: "POST",
        body,
      })
      if (!imageResponse.ok) {
        const imageBody = (await imageResponse.json().catch(() => ({}))) as {
          message?: string
        }
        setError(imageBody.message ?? "Uploading the image failed.")
        return false
      }
      uploadedImageRef.current = imageFile
    }

    const response = await fetch(`/api/admin/bills/${billId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(structure),
    })
    if (!response.ok) {
      const responseBody = (await response.json().catch(() => ({}))) as {
        issues?: string[]
        message?: string
      }
      setIssues(responseBody.issues ?? [])
      setError(responseBody.message ?? "Saving the draft failed.")
      return false
    }
    savedValuesJson.current = JSON.stringify(form.state.values)
    return true
  }

  async function publishDraft(billId: string): Promise<boolean> {
    const response = await fetch(`/api/admin/bills/${billId}/publish`, {
      method: "POST",
    })
    if (!response.ok) {
      const responseBody = (await response.json().catch(() => ({}))) as {
        issues?: unknown[]
        message?: string
      }
      if (responseBody.issues)
        setIssues(
          responseBody.issues.map((issue) => describeSplitIssue(issue as never))
        )
      setError(responseBody.message ?? "Draft saved, but publishing failed.")
      return false
    }
    return true
  }

  async function submit(mode: "draft" | "publish") {
    setIssues([])
    setError(null)
    const built = buildStructure(form.state.values, matrix)
    if (!built.ok || !built.structure) {
      setIssues(built.issues)
      return
    }
    const structure = built.structure
    setBusy(mode)
    try {
      const billId = savedBillId ?? (await createDraft(structure))
      if (!billId) return
      if (savedBillId) {
        const updated = await updateDraft(billId, structure)
        if (!updated) return
      }
      setSavedBillId(billId)

      if (mode === "publish") {
        const published = await publishDraft(billId)
        if (!published) return
        await navigate({
          to: "/admin/bills/$billId",
          params: { billId },
        })
        return
      }
      showToast({ message: "Draft saved", variant: "success" })
    } catch {
      setError("The request failed.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <PageBreadcrumb
        items={[
          { label: "Home", to: "/" },
          { label: "Bills", to: "/admin" },
          { label: "New bill" },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-medium">New bill</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Four short steps: receipt, items and fees, people, then the split.
            Line totals follow from qty and unit price.
          </p>
        </div>
        <ThemeToggle />
      </div>

      {issues.length > 0 && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-4"
        >
          <p className="font-medium text-destructive">
            Fix these and try again
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-destructive">
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <form
        className="mt-6 space-y-6"
        onSubmit={(event) => {
          event.preventDefault()
          void submit("draft")
        }}
      >
        {/* Forward navigation is locked until the merchant is named. */}
        <BillStepTabs
          form={form}
          step={step}
          onStepChange={(next) => goToStep(next)}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {BILL_STEPS[step].title}
            </CardTitle>
            <CardDescription>{BILL_STEPS[step].description}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* The chosen receipt images live in uncontrolled file inputs,
                so this step stays mounted; unmounting it on step changes
                would silently drop the files (and the previews with them). */}
            <div className={step === 0 ? undefined : "hidden"}>
              <ReceiptStep
                form={form}
                ocrInputRef={ocrInputRef}
                billInputRef={billInputRef}
                separateBillImage={separateBillImage}
                setSeparateBillImage={setSeparateBillImage}
                ocrBusy={ocrBusy}
                ocrError={ocrError}
                ocrMessage={ocrMessage}
                onOcrParse={() => void onOcrParse()}
                receiptRedaction={receiptRedaction}
                billRedaction={billRedaction}
                onRedact={onRedact}
              />
            </div>

            {step === 1 && (
              <div className="space-y-8">
                <ItemsSection form={form} />
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Order adjustments</h3>
                  <AdjustmentsSection form={form} />
                </div>
              </div>
            )}

            {step === 2 && <PlayersPickerSection form={form} />}

            {step === 3 && (
              <div className="space-y-8">
                <AdjustmentSummary form={form} />
                <AllocationBoardSection
                  form={form}
                  matrix={matrix}
                  setMatrix={(update) =>
                    setMatrix((current) => update(current))
                  }
                  onContinue={() => void submit("draft")}
                  continueLabel="Save draft"
                />
                <p className="text-xs text-muted-foreground">
                  Drag items from the counter onto a person, or use the
                  steppers. Every item must reach zero remaining.
                </p>
                <div>
                  <h3 className="mb-3 text-sm font-medium">Split preview</h3>
                  <ReviewSection form={form} matrix={matrix} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <BillStepNav
          form={form}
          step={step}
          onBack={() => goToStep(Math.max(0, step - 1))}
          onNext={() => goToStep(step + 1)}
          finalActions={
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void submit("draft")}
              >
                {busy === "draft" ? "Saving..." : "Save draft"}
              </Button>
              <Button
                type="button"
                disabled={busy !== null}
                onClick={() => void submit("publish")}
              >
                {busy === "publish" ? "Publishing..." : "Publish"}
              </Button>
            </>
          }
        />
      </form>

      {/* Not ConfirmDialog: the confirm path must call blocker.proceed()
          directly — closing the dialog first would reset the blocker and
          discard the pending navigation. */}
      {blocker.status === "blocked" && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) blocker.reset()
          }}
        >
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Leave with unsaved changes?</DialogTitle>
              <DialogDescription>
                The merchant, receipt, items, and split you filled in will be
                lost.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => blocker.reset()}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => blocker.proceed()}>
                Leave
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </main>
  )
}

function ReceiptStep({
  form,
  ...picker
}: {
  form: ReturnType<typeof useBillForm>
} & ReceiptImagePickerProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="merchant">
          {(field) => (
            <div className="space-y-1">
              <Label htmlFor={field.name}>Merchant</Label>
              <Input
                id={field.name}
                name={field.name}
                required
                maxLength={200}
                placeholder="Kopi Sudirman"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="title">
          {(field) => (
            <div className="space-y-1">
              <Label htmlFor={field.name}>Title (optional)</Label>
              <Input
                id={field.name}
                name={field.name}
                maxLength={200}
                placeholder="Friday drinks"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="orderDate">
          {(field) => (
            <div className="space-y-1">
              <Label htmlFor={field.name}>Order date</Label>
              <DatePicker
                id={field.name}
                value={field.state.value}
                onChange={(value) => field.handleChange(value)}
              />
            </div>
          )}
        </form.Field>
        <div className="grid grid-cols-2 gap-4">
          <form.Field name="sourceSubtotal">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name}>Source subtotal</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  inputMode="numeric"
                  className="tabular-nums"
                  placeholder="230,000"
                  value={field.state.value}
                  onChange={(event) =>
                    field.handleChange(formatAmountInput(event.target.value))
                  }
                />
              </div>
            )}
          </form.Field>
          <form.Field name="finalTotal">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor={field.name}>Final charged total</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  inputMode="numeric"
                  className="tabular-nums"
                  placeholder="131,000"
                  value={field.state.value}
                  onChange={(event) =>
                    field.handleChange(formatAmountInput(event.target.value))
                  }
                />
              </div>
            )}
          </form.Field>
        </div>
      </div>

      <ReceiptImagePicker {...picker} />
    </div>
  )
}
