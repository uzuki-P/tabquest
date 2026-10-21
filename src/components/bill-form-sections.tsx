import { useForm } from "@tanstack/react-form"
import { CheckIcon, PlusIcon, XIcon } from "@phosphor-icons/react"
import { useMemo, useState } from "react"

import { PersonAvatar } from "@/components/person-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  formatAmountInput,
  formatRupiah,
  parseAmountInput,
} from "@/domain/money"
import { ADJUSTMENT_TYPES } from "@/lib/bill-schema"
import type { AdjustmentType } from "@/lib/bill-schema"
import { describeSplitIssue, previewSplit } from "@/lib/bill-form"
import type { AllocationMatrix, BillFormValue } from "@/lib/bill-form"

/**
 * Shared sections for the bill form used by both the create page and the
 * draft editor: items, order adjustments, billPlayers, allocations, and the
 * live split review. Line totals are derived from qty x unit price and are
 * never entered by hand.
 */

export function useBillForm(defaultValues: BillFormValue) {
  return useForm({ defaultValues })
}

export type BillFormApi = ReturnType<typeof useBillForm>

export function defaultAdjustmentLabel(type: AdjustmentType): string {
  switch (type) {
    case "discount":
      return "Voucher discount"
    case "delivery":
      return "Delivery fee"
    case "service":
      return "Service fee"
    case "tax":
      return "Tax"
    case "other":
      return "Other fee"
  }
}

/** Short chip label and tint per adjustment type, shared by form and summary.
 * Discount tints with the success token (a discount is money saved); the
 * other types use categorical hues that carry no success or celebration
 * meaning, which is why service is teal rather than amber. */
export const ADJUSTMENT_TYPE_META: Record<
  AdjustmentType,
  { label: string; chip: string; accent: string }
> = {
  discount: {
    label: "Discount",
    chip: "border-success/30 bg-success/10 text-success",
    accent: "text-success",
  },
  delivery: {
    label: "Delivery",
    chip: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
    accent: "text-sky-700 dark:text-sky-300",
  },
  service: {
    label: "Service",
    chip: "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300",
    accent: "text-teal-700 dark:text-teal-300",
  },
  tax: {
    label: "Tax",
    chip: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
    accent: "text-violet-700 dark:text-violet-300",
  },
  other: {
    label: "Other",
    chip: "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
    accent: "text-zinc-700 dark:text-zinc-300",
  },
}

export function newFormItem(): BillFormValue["items"][number] {
  return {
    key: crypto.randomUUID(),
    name: "",
    variantNotes: "",
    quantity: "1",
    bundleSize: "1",
    unitPrice: "",
  }
}

/** The four steps of the bill wizard, shared by create and edit. */
export const BILL_STEPS = [
  { title: "Receipt", description: "Where the numbers come from" },
  { title: "Items & fees", description: "Lines and order-wide adjustments" },
  { title: "People", description: "Who is in this order" },
  { title: "Split & review", description: "Allocate and check the math" },
] as const

/**
 * Wizard step pills. Forward navigation stays locked until the merchant is
 * named, mirroring the guard the Next button enforces.
 */
export function BillStepTabs({
  form,
  step,
  onStepChange,
}: {
  form: BillFormApi
  step: number
  onStepChange: (next: number) => void
}) {
  return (
    <form.Subscribe selector={(state) => state.values.merchant}>
      {(merchant) => {
        const merchantMissing = merchant.trim() === ""
        return (
          <ol className="flex flex-wrap items-center gap-2" aria-label="Steps">
            {BILL_STEPS.map((entry, index) => {
              const state =
                index < step ? "done" : index === step ? "current" : "todo"
              const blocked = merchantMissing && index > 0
              return (
                <li key={entry.title} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onStepChange(index)}
                    disabled={blocked}
                    aria-current={state === "current" ? "step" : undefined}
                    title={blocked ? "Add the merchant name first" : undefined}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                      state === "current"
                        ? "border-primary bg-primary text-primary-foreground"
                        : state === "done"
                          ? "border-primary/40 bg-primary/5"
                          : "text-muted-foreground"
                    } ${blocked ? "cursor-not-allowed opacity-40" : ""}`}
                  >
                    <span
                      className={`flex size-5 items-center justify-center rounded-full text-xs ${
                        state === "current"
                          ? "bg-primary-foreground text-primary"
                          : state === "done"
                            ? "bg-primary text-primary-foreground"
                            : "border"
                      }`}
                    >
                      {state === "done" ? (
                        <CheckIcon weight="bold" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    {entry.title}
                  </button>
                  {index < BILL_STEPS.length - 1 && (
                    <span aria-hidden className="text-muted-foreground">
                      →
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        )
      }}
    </form.Subscribe>
  )
}

/**
 * Wizard footer: Back on the left; on non-final steps a merchant-gated Next,
 * on the final step whatever actions the page provides.
 */
export function BillStepNav({
  form,
  step,
  onBack,
  onNext,
  finalActions,
}: {
  form: BillFormApi
  step: number
  onBack: () => void
  onNext: () => void
  finalActions: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={step === 0}
        onClick={onBack}
      >
        Back
      </Button>
      {step < BILL_STEPS.length - 1 ? (
        <form.Subscribe selector={(state) => state.values.merchant}>
          {(merchant) => {
            const merchantMissing = merchant.trim() === ""
            return (
              <div className="flex items-center gap-3">
                {merchantMissing && (
                  <p className="text-sm text-muted-foreground">
                    Add the merchant name to continue.
                  </p>
                )}
                <Button
                  type="button"
                  disabled={merchantMissing}
                  onClick={onNext}
                >
                  Next
                </Button>
              </div>
            )
          }}
        </form.Subscribe>
      ) : (
        <div className="flex items-center gap-2">{finalActions}</div>
      )}
    </div>
  )
}

function ComputedLineTotal({
  quantity,
  unitPrice,
  bundleSize,
}: {
  bundleSize?: string
  quantity: string
  unitPrice: string
}) {
  const qty = parseAmountInput(quantity)
  const price = parseAmountInput(unitPrice)
  const perQty = Math.max(
    1,
    (bundleSize?.trim() ? parseAmountInput(bundleSize) : 1) ?? 1
  )
  if (qty === null || price === null) {
    return (
      <span className="text-xs text-muted-foreground">
        Line total: qty x unit price
      </span>
    )
  }
  const total = qty * price
  const items = qty * perQty
  return (
    <div className="text-xs text-muted-foreground">
      <p>
        {qty} x {formatRupiah(price)} = {formatRupiah(total)}
      </p>
      {perQty > 1 && items > 0 && (
        <p>
          {items} items to split, {Number.isInteger(total / items) ? "" : "≈"}
          {formatRupiah(Math.round(total / items))} per item
        </p>
      )}
    </div>
  )
}

export function ItemsSection({ form }: { form: BillFormApi }) {
  return (
    <form.Field name="items" mode="array">
      {(field) => (
        <div className="space-y-3">
          {field.state.value.map((item, index) => (
            <div key={item.key} className="rounded-md border p-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <form.Field name={`items[${index}].name`}>
                  {(sub) => (
                    <div className="space-y-1">
                      <Label htmlFor={sub.name}>Name</Label>
                      <Input
                        id={sub.name}
                        name={sub.name}
                        value={sub.state.value}
                        onChange={(event) =>
                          sub.handleChange(event.target.value)
                        }
                      />
                    </div>
                  )}
                </form.Field>
                <form.Field name={`items[${index}].variantNotes`}>
                  {(sub) => (
                    <div className="space-y-1">
                      <Label htmlFor={sub.name}>Variant / notes</Label>
                      <Input
                        id={sub.name}
                        name={sub.name}
                        value={sub.state.value}
                        onChange={(event) =>
                          sub.handleChange(event.target.value)
                        }
                      />
                    </div>
                  )}
                </form.Field>
                <form.Field name={`items[${index}].quantity`}>
                  {(sub) => (
                    <div className="space-y-1">
                      <Label htmlFor={sub.name}>Qty</Label>
                      <Input
                        id={sub.name}
                        name={sub.name}
                        inputMode="numeric"
                        className="w-24"
                        value={sub.state.value}
                        onChange={(event) =>
                          sub.handleChange(event.target.value)
                        }
                      />
                    </div>
                  )}
                </form.Field>
                <form.Field name={`items[${index}].unitPrice`}>
                  {(sub) => (
                    <div className="space-y-1">
                      <Label htmlFor={sub.name}>Unit price</Label>
                      <Input
                        id={sub.name}
                        name={sub.name}
                        inputMode="numeric"
                        value={sub.state.value}
                        onChange={(event) =>
                          sub.handleChange(
                            formatAmountInput(event.target.value)
                          )
                        }
                      />
                    </div>
                  )}
                </form.Field>
              </div>
              <form.Field name={`items[${index}].bundleSize`}>
                {(sub) => (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label htmlFor={sub.name}>Items per qty</Label>
                      <Input
                        id={sub.name}
                        name={sub.name}
                        inputMode="numeric"
                        className="w-24"
                        value={sub.state.value ?? "1"}
                        onChange={(event) =>
                          sub.handleChange(event.target.value)
                        }
                      />
                    </div>
                    <p className="pb-2 text-xs text-muted-foreground">
                      Items you get for each qty on the receipt. 2 for buy 1 get
                      1, 5 for a 5-item package.
                    </p>
                  </div>
                )}
              </form.Field>
              <div className="mt-2 flex items-center justify-between">
                <form.Subscribe
                  selector={(state) => state.values.items.at(index)}
                >
                  {(current) =>
                    current && (
                      <ComputedLineTotal
                        quantity={current.quantity}
                        unitPrice={current.unitPrice}
                        bundleSize={current.bundleSize}
                      />
                    )
                  }
                </form.Subscribe>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => field.removeValue(index)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => field.pushValue(newFormItem())}
          >
            Add item
          </Button>
        </div>
      )}
    </form.Field>
  )
}

export function AdjustmentsSection({ form }: { form: BillFormApi }) {
  const [newType, setNewType] = useState<AdjustmentType>("discount")

  return (
    <form.Field name="adjustments" mode="array">
      {(field) => (
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-2">
            <Select
              value={newType}
              onValueChange={(value) => setNewType(value as AdjustmentType)}
            >
              <SelectTrigger aria-label="New adjustment type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADJUSTMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {ADJUSTMENT_TYPE_META[type].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                field.pushValue({
                  key: crypto.randomUUID(),
                  type: newType,
                  label: defaultAdjustmentLabel(newType),
                  amount: "",
                  originalAmount: "",
                })
              }
            >
              <PlusIcon weight="bold" />
              Add
            </Button>
          </div>

          {field.state.value.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No fees or discounts on this order.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {field.state.value.map((adjustment, index) => (
                <li key={adjustment.key} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <form.Field name={`adjustments[${index}].type`}>
                      {(sub) => (
                        <Select
                          value={sub.state.value}
                          onValueChange={(value) =>
                            sub.handleChange(value as AdjustmentType)
                          }
                        >
                          <SelectTrigger
                            className={`h-9 w-28 border-transparent text-xs ${ADJUSTMENT_TYPE_META[sub.state.value].chip}`}
                            aria-label="Adjustment type"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ADJUSTMENT_TYPES.map((type) => (
                              <SelectItem key={type} value={type}>
                                {ADJUSTMENT_TYPE_META[type].label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </form.Field>
                    <form.Field name={`adjustments[${index}].label`}>
                      {(sub) => (
                        <Input
                          id={sub.name}
                          aria-label="Adjustment label"
                          placeholder="Label"
                          className="h-9 min-w-0 grow basis-full border-0 bg-transparent px-2 text-sm font-medium shadow-none focus-visible:ring-1 sm:basis-auto"
                          value={sub.state.value}
                          onChange={(event) =>
                            sub.handleChange(event.target.value)
                          }
                        />
                      )}
                    </form.Field>
                    <form.Field name={`adjustments[${index}].amount`}>
                      {(sub) => (
                        <div className="relative">
                          <span
                            aria-hidden
                            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground"
                          >
                            Rp
                          </span>
                          <Input
                            id={sub.name}
                            aria-label="Amount, discounts negative"
                            inputMode="numeric"
                            placeholder="0"
                            className="h-9 w-24 border-0 bg-transparent pl-8 text-right text-sm tabular-nums shadow-none focus-visible:ring-1 sm:w-32"
                            value={sub.state.value}
                            onChange={(event) =>
                              sub.handleChange(
                                formatAmountInput(event.target.value)
                              )
                            }
                          />
                        </div>
                      )}
                    </form.Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${adjustment.label || "adjustment"}`}
                      onClick={() => field.removeValue(index)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                  {/* mode="array" skips deep value changes, so subscribe to
                      this row's type to react to switches. */}
                  <form.Subscribe
                    selector={(state) => state.values.adjustments[index]?.type}
                  >
                    {(type) =>
                      type === "discount" && (
                        <form.Field
                          name={`adjustments[${index}].originalAmount`}
                        >
                          {(sub) => (
                            <div className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                              Printed on receipt, before the discount
                              <div className="relative">
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground"
                                >
                                  Rp
                                </span>
                                <Input
                                  id={sub.name}
                                  aria-label="Printed amount before the discount"
                                  inputMode="numeric"
                                  placeholder="0"
                                  className="h-7 w-28 border-0 bg-transparent pl-8 text-right tabular-nums shadow-none focus-visible:ring-1"
                                  value={sub.state.value}
                                  onChange={(event) =>
                                    sub.handleChange(
                                      formatAmountInput(event.target.value)
                                    )
                                  }
                                />
                              </div>
                            </div>
                          )}
                        </form.Field>
                      )
                    }
                  </form.Subscribe>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Amounts are signed — discounts negative. They split proportionally
            by each person&apos;s item share.
          </p>
        </div>
      )}
    </form.Field>
  )
}

function ReviewBody({
  value,
  matrix,
}: {
  value: BillFormValue
  matrix: AllocationMatrix
}) {
  const preview = useMemo(() => previewSplit(value, matrix), [value, matrix])

  if (preview.formIssues.length > 0) {
    return (
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
        {preview.formIssues.map((issue, index) => (
          <li key={index}>{issue}</li>
        ))}
      </ul>
    )
  }
  if (preview.split === null) {
    return (
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
        {preview.issues.map((issue, index) => (
          <li key={index}>{describeSplitIssue(issue)}</li>
        ))}
      </ul>
    )
  }

  const split = preview.split
  const billPlayerByKey = new Map(
    value.billPlayers.map((billPlayer) => [billPlayer.key, billPlayer])
  )

  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {split.shares.map((share) => {
          const alias =
            billPlayerByKey.get(share.billPlayerId)?.alias ?? share.billPlayerId
          return (
            <div key={share.billPlayerId} className="rounded-md border p-3">
              <div className="flex items-center gap-2">
                <PersonAvatar name={alias} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{alias}</p>
                  <p className="text-xs text-muted-foreground">
                    {(share.percentage * 100).toFixed(1)}% of items
                  </p>
                </div>
              </div>
              <ul className="mt-3 space-y-1 text-sm">
                <li className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Items</span>
                  <span className="tabular-nums">
                    {formatRupiah(share.itemSubtotal)}
                  </span>
                </li>
                {value.adjustments.map((adjustment) => {
                  const amount =
                    share.adjustmentShares.find(
                      (a) => a.adjustmentId === adjustment.key
                    )?.amount ?? 0
                  return (
                    <li
                      key={adjustment.key}
                      className="flex justify-between gap-4"
                    >
                      <span
                        className={`truncate text-xs ${ADJUSTMENT_TYPE_META[adjustment.type].accent}`}
                      >
                        {adjustment.label}
                      </span>
                      <span className="tabular-nums">
                        {formatRupiah(amount)}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <div className="mt-3 flex justify-between border-t pt-2 text-sm font-medium">
                <span>Total</span>
                <span className="tabular-nums">
                  {formatRupiah(share.total)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3 text-sm">
        <span className="font-medium">Bill</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
          <span className="text-muted-foreground">
            Items {formatRupiah(split.itemSubtotal)}
          </span>
          <span className="font-medium">
            Total {formatRupiah(split.grandTotal)}
          </span>
        </div>
      </div>
      <p className="text-sm text-success">
        Reconciles: player totals sum exactly to the final charged total of{" "}
        {formatRupiah(split.grandTotal)}.
      </p>
    </div>
  )
}

export function ReviewSection({
  form,
  matrix,
}: {
  form: BillFormApi
  matrix: AllocationMatrix
}) {
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(value) => <ReviewBody value={value} matrix={matrix} />}
    </form.Subscribe>
  )
}

/** Read-only strip of the order-wide adjustments shown above the split board. */
export function AdjustmentSummary({ form }: { form: BillFormApi }) {
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(value) => (
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Order adjustments</h3>
            <p className="text-xs text-muted-foreground">
              Split proportionally by each person&apos;s item share.
            </p>
          </div>
          {value.adjustments.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              None — each person pays their items only.
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {value.adjustments.map((adjustment) => {
                const amount = parseAmountInput(adjustment.amount)
                return (
                  <li
                    key={adjustment.key}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${ADJUSTMENT_TYPE_META[adjustment.type].chip}`}
                  >
                    <span className="font-medium">{adjustment.label}</span>
                    <span className="tabular-nums">
                      {amount !== null ? formatRupiah(amount) : "—"}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </form.Subscribe>
  )
}
