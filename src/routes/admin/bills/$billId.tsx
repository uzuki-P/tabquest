import { createFileRoute, notFound, useRouter } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { useMemo, useRef, useState } from "react"
import { Effect } from "effect"

import {
  BILL_STEPS,
  AdjustmentSummary,
  AdjustmentsSection,
  BillStepNav,
  BillStepTabs,
  ItemsSection,
  ReviewSection,
  useBillForm,
} from "@/components/bill-form-sections"
import { AllocationBoardSection } from "@/components/allocation-board"
import { PlayersPickerSection } from "@/components/player-picker"
import { BillFormSkeleton } from "@/components/page-skeletons"
import { PageBreadcrumb } from "@/components/page-breadcrumb"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DatePicker } from "@/components/date-picker"
import { ThemeToggle } from "@/components/theme-toggle"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  formatAmountInput,
  formatRupiah,
  parseAmountInput,
} from "@/domain/money"
import { describeSplitIssue, buildStructure } from "@/lib/bill-form"
import type { AllocationMatrix, BillFormValue } from "@/lib/bill-form"
import type { PaymentState } from "@/lib/bill-schema"
import { publicBillUrl } from "@/lib/urls"
import { formatDisplayDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { getServerContext } from "@/server/context"
import { getBillDetail } from "@/server/services/bills"
import type { BillDetail } from "@/server/services/bills"

const fetchBillDetail = createServerFn({ method: "GET" })
  .validator((billId: string) => billId)
  .handler(async ({ data }) => {
    const ctx = await getServerContext()
    return Effect.runPromise(getBillDetail({ db: ctx.db }, data))
  })

export const Route = createFileRoute("/admin/bills/$billId")({
  loader: async ({ params }) => {
    try {
      return await fetchBillDetail({ data: params.billId })
    } catch {
      throw notFound()
    }
  },
  component: BillEditorPage,
  pendingComponent: BillFormSkeleton,
})

function BillEditorPage() {
  const detail = Route.useLoaderData()
  if (detail.bill.status === "published") {
    return <PublishedView detail={detail} />
  }
  return <DraftEditor detail={detail} />
}

/* ---------------------------------- Draft ---------------------------------- */

function detailToFormValue(detail: BillDetail): BillFormValue {
  return {
    merchant: detail.bill.merchant,
    title: detail.bill.title ?? "",
    orderDate: detail.bill.orderDate,
    sourceSubtotal: formatAmountInput(String(detail.bill.sourceSubtotal)),
    finalTotal: formatAmountInput(String(detail.bill.finalTotal)),
    items: detail.items.map((item) => ({
      key: item.id,
      name: item.name,
      variantNotes: item.variantNotes ?? "",
      quantity: String(item.quantity),
      bundleSize: String(item.bundleSize),
      unitPrice: formatAmountInput(String(item.unitPrice)),
    })),
    adjustments: detail.adjustments.map((adjustment) => ({
      key: adjustment.id,
      type: adjustment.type as BillFormValue["adjustments"][number]["type"],
      label: adjustment.label,
      amount: formatAmountInput(String(adjustment.signedAmount)),
      originalAmount:
        adjustment.originalAmount === null
          ? ""
          : formatAmountInput(String(adjustment.originalAmount)),
    })),
    billPlayers: detail.billPlayers.map((billPlayer) => ({
      key: billPlayer.id,
      alias: billPlayer.alias,
      playerId: billPlayer.playerId ?? null,
    })),
  }
}

function detailToMatrix(detail: BillDetail): AllocationMatrix {
  const matrix: AllocationMatrix = {}
  const itemIds = new Set(detail.items.map((item) => item.id))
  for (const allocation of detail.allocations) {
    if (!itemIds.has(allocation.itemId)) continue
    matrix[`${allocation.itemId}::${allocation.billPlayerId}`] = String(
      allocation.quantity
    )
  }
  return matrix
}

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/avif"

function DraftEditor({ detail }: { detail: BillDetail }) {
  const router = useRouter()
  const initial = useMemo(() => detailToFormValue(detail), [detail])
  const [matrix, setMatrix] = useState<AllocationMatrix>(() =>
    detailToMatrix(detail)
  )
  const [step, setStep] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [busy, setBusy] = useState<"save" | "publish" | null>(null)
  const [imageVersion, setImageVersion] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const form = useBillForm(initial)

  function goToStep(next: number) {
    setStep(next)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function saveDraft(value: BillFormValue): Promise<boolean> {
    const built = buildStructure(value, matrix)
    if (!built.ok || !built.structure) {
      setIssues(built.issues)
      setMessage(null)
      return false
    }
    setIssues([])
    const response = await fetch(`/api/admin/bills/${detail.bill.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(built.structure),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        message?: string
        issues?: string[]
      }
      setIssues(body.issues ?? [body.message ?? "Saving the draft failed."])
      return false
    }
    setMessage("Draft saved")
    return true
  }

  async function publish(value: BillFormValue) {
    setBusy("publish")
    try {
      const saved = await saveDraft(value)
      if (!saved) return
      const response = await fetch(
        `/api/admin/bills/${detail.bill.id}/publish`,
        { method: "POST" }
      )
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string
          issues?: unknown[]
        }
        if (body.issues)
          setIssues(
            body.issues.map((issue) => describeSplitIssue(issue as never))
          )
        else setIssues([body.message ?? "Publishing failed."])
        setMessage(null)
        return
      }
      await router.invalidate()
    } finally {
      setBusy(null)
    }
  }

  async function uploadImage(file: File) {
    const body = new FormData()
    body.set("image", file)
    const response = await fetch(`/api/admin/bills/${detail.bill.id}/image`, {
      method: "POST",
      body,
    })
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        message?: string
      }
      setIssues([errorBody.message ?? "Uploading the image failed."])
      return
    }
    setIssues([])
    setImageVersion((version) => version + 1)
  }

  return (
    <main className="container mx-auto max-w-5xl px-4 py-10">
      <PageBreadcrumb
        items={[
          { label: "Home", to: "/" },
          { label: "Bills", to: "/admin" },
          { label: detail.bill.merchant },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-medium">
            {detail.bill.merchant}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Draft · order date {formatDisplayDate(detail.bill.orderDate)} ·
            final total {formatRupiah(detail.bill.finalTotal)}
          </p>
        </div>
        <ThemeToggle />
      </div>

      {message && <p className="mt-4 text-sm text-success">{message}</p>}
      {issues.length > 0 && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-4"
        >
          <p className="font-medium text-destructive">
            Fix these before publishing
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-destructive">
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="mt-6 space-y-6"
        onSubmit={(event) => {
          event.preventDefault()
          void saveDraft(form.state.values)
        }}
      >
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
            {/* The image replacement input is uncontrolled, so this step
                stays mounted; unmounting it would drop a chosen-but-not-yet-
                uploaded file whenever the merchant steps away. */}
            <div className={step === 0 ? "space-y-6" : "hidden"}>
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
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
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
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
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
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(
                              formatAmountInput(event.target.value)
                            )
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
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(
                              formatAmountInput(event.target.value)
                            )
                          }
                        />
                      </div>
                    )}
                  </form.Field>
                </div>
              </div>

              <div className="space-y-3 rounded-md border border-dashed p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="grow space-y-1">
                    <Label htmlFor="image-upload">Bill image</Label>
                    <input
                      id="image-upload"
                      ref={fileInputRef}
                      type="file"
                      accept={IMAGE_ACCEPT}
                      className="text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      PNG, JPEG, WebP, or AVIF up to 15 MiB and 40 MP.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const file = fileInputRef.current?.files?.[0]
                      if (file) void uploadImage(file)
                    }}
                  >
                    Upload
                  </Button>
                </div>
                {detail.bill.imageObjectKey ? (
                  <figure className="space-y-1">
                    <img
                      src={`/api/admin/bills/${detail.bill.id}/image?v=${imageVersion}`}
                      alt="Uploaded bill"
                      className="max-h-60 rounded-md border object-contain"
                    />
                    <figcaption className="text-xs text-muted-foreground">
                      Current image — uploading replaces it.
                    </figcaption>
                  </figure>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No image yet. Publishing needs one.
                  </p>
                )}
              </div>
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

            {step === 2 && (
              <div>
                <PlayersPickerSection form={form} />
                <p className="mt-3 text-xs text-muted-foreground">
                  Relinking only works while the bill is a draft; publishing
                  freezes the billPlayer rows.
                </p>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-8">
                <AdjustmentSummary form={form} />
                <AllocationBoardSection
                  form={form}
                  matrix={matrix}
                  setMatrix={(update) =>
                    setMatrix((current) => update(current))
                  }
                  onContinue={() => void saveDraft(form.state.values)}
                  continueLabel="Save draft"
                />
                <p className="text-xs text-muted-foreground">
                  Drag receipt items from the counter onto a person. Every item
                  must reach zero remaining; steppers fine-tune without
                  dragging.
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
                onClick={() => void saveDraft(form.state.values)}
              >
                {busy === "save" ? "Saving..." : "Save draft"}
              </Button>
              <Button
                type="button"
                disabled={busy !== null}
                onClick={() => void publish(form.state.values)}
              >
                {busy === "publish" ? "Publishing..." : "Review and publish"}
              </Button>
            </>
          }
        />
      </form>
    </main>
  )
}

/* -------------------------------- Published -------------------------------- */

function PublishedView({ detail }: { detail: BillDetail }) {
  const router = useRouter()
  const [busyBillPlayer, setBusyBillPlayer] = useState<string | null>(null)
  const [unpublishing, setUnpublishing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function unpublish() {
    setUnpublishing(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/bills/${detail.bill.id}/unpublish`,
        { method: "POST" }
      )
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string
        }
        setError(body.message ?? "Unpublishing failed.")
        return
      }
      await router.invalidate()
    } finally {
      setUnpublishing(false)
    }
  }

  async function recordPaidAmount(
    billPlayerId: string,
    paidAmount: number | null
  ) {
    setBusyBillPlayer(billPlayerId)
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/bill-players/${billPlayerId}/payment`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paidAmount }),
        }
      )
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string
        }
        setError(body.message ?? "Recording the paid amount failed.")
        return
      }
      await router.invalidate()
    } finally {
      setBusyBillPlayer(null)
    }
  }

  async function togglePayment(billPlayerId: string, next: PaymentState) {
    setBusyBillPlayer(billPlayerId)
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/bill-players/${billPlayerId}/payment`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state: next }),
        }
      )
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string
        }
        setError(body.message ?? "Changing the payment state failed.")
        return
      }
      await router.invalidate()
    } finally {
      setBusyBillPlayer(null)
    }
  }

  async function copyPublicLink() {
    try {
      await navigator.clipboard.writeText(publicBillUrl(detail.bill.publicId))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <PageBreadcrumb
        items={[
          { label: "Home", to: "/" },
          { label: "Bills", to: "/admin" },
          { label: detail.bill.merchant },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-medium">
            {detail.bill.merchant}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Published · {detail.bill.orderDate} · final total{" "}
            {formatRupiah(detail.bill.finalTotal)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <Button
            variant="destructive"
            disabled={unpublishing}
            onClick={() => setConfirmOpen(true)}
          >
            {unpublishing ? "Unpublishing..." : "Unpublish"}
          </Button>
          <Button variant="outline" onClick={() => void copyPublicLink()}>
            {copied ? "Copied" : "Copy public link"}
          </Button>
          <a
            href={publicBillUrl(detail.bill.publicId)}
            target="_blank"
            rel="noreferrer"
          >
            <Button variant="outline">Open public page</Button>
          </a>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>BillPlayer</TableHead>
                <TableHead className="text-right">Owes</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.billPlayers.map((billPlayer) => {
                const share = detail.split?.shares.find(
                  (s) => s.billPlayerId === billPlayer.id
                )
                const status = detail.paymentStatuses.find(
                  (s) => s.billPlayerId === billPlayer.id
                )
                const paid = status?.status === "paid"
                return (
                  <TableRow key={billPlayer.id}>
                    <TableCell>{billPlayer.alias}</TableCell>
                    <TableCell className="text-right">
                      {formatRupiah(share?.total ?? 0)}
                    </TableCell>
                    <TableCell>
                      <PaidAmountCell
                        billPlayerId={billPlayer.id}
                        share={share?.total ?? 0}
                        recorded={status?.paidAmount ?? null}
                        disabled={busyBillPlayer !== null}
                        onSave={(amount) =>
                          void recordPaidAmount(billPlayer.id, amount)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant={paid ? "default" : "secondary"}>
                        {paid ? "Paid" : "Unpaid"}
                      </Badge>
                      {status?.lastChangedBy ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          by {status.lastChangedBy}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={paid ? "outline" : "default"}
                        disabled={busyBillPlayer !== null}
                        onClick={() =>
                          void togglePayment(
                            billPlayer.id,
                            paid ? "unpaid" : "paid"
                          )
                        }
                      >
                        {busyBillPlayer === billPlayer.id
                          ? "..."
                          : paid
                            ? "Mark unpaid"
                            : "Mark paid"}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Paid is what the person actually handed over. Saving an amount also
            marks them paid; leave it empty for an exact QRIS transfer.
          </p>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Unpublish this bill?"
        description="Its public page stops working and the bill returns to the draft editor."
        confirmLabel="Unpublish"
        destructive
        onConfirm={() => void unpublish()}
      />
    </main>
  )
}

/**
 * Inline input for what the billPlayer actually handed over. Saves on blur
 * or Enter when the value differs from the recorded one; empty text clears
 * the recording. The diff against the split shows under the input so the
 * admin sees the tip at a glance.
 */
function PaidAmountCell({
  billPlayerId,
  share,
  recorded,
  disabled,
  onSave,
}: {
  billPlayerId: string
  share: number
  recorded: number | null
  disabled: boolean
  onSave: (amount: number | null) => void
}) {
  const [text, setText] = useState(() =>
    recorded === null ? "" : formatAmountInput(String(recorded))
  )
  const parsed = parseAmountInput(text)
  const differs = parsed === null ? recorded !== null : parsed !== recorded

  function save() {
    if (!differs || disabled) return
    // parseAmountInput allows a minus; a negative handover is not a thing.
    onSave(parsed !== null && parsed < 0 ? null : parsed)
  }

  const diff = parsed === null ? null : parsed - share
  return (
    <div>
      <Input
        aria-label={`Amount actually paid by player ${billPlayerId}`}
        inputMode="numeric"
        placeholder="—"
        className="h-8 w-28 text-right tabular-nums"
        value={text}
        disabled={disabled}
        onChange={(event) => setText(formatAmountInput(event.target.value))}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            save()
          }
        }}
      />
      {diff !== null && diff !== 0 && (
        <p
          className={cn(
            "mt-0.5 text-xs tabular-nums",
            diff > 0 ? "text-success" : "text-destructive"
          )}
        >
          {diff > 0 ? "+" : ""}
          {formatRupiah(diff)} vs split
        </p>
      )}
      {diff === 0 && (
        <p className="mt-0.5 text-xs text-muted-foreground">exact</p>
      )}
    </div>
  )
}
