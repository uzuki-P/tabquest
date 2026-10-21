import { formatRupiah } from "@/domain/money"

export interface BillSummaryAdjustment {
  id: string
  label: string
  amount: number
  /** Amount as printed on the receipt when the net differs; else null. */
  originalAmount: number | null
}

/**
 * Billing breakdown for the public bill page, mirroring the source app's
 * order summary: subtotal, then each discount and fee row, then the final
 * total, set in the arena money-table style (mono figures, one ink rule
 * under the last row before the bold final total). A row whose printed
 * amount differs from its net (a fee waived by a voucher) shows the
 * printed price struck through ahead of the net.
 */
export function BillSummary({
  sourceSubtotal,
  finalTotal,
  adjustments,
}: {
  sourceSubtotal: number
  finalTotal: number
  adjustments: BillSummaryAdjustment[]
}) {
  return (
    <div className="font-mono text-xs">
      <Row label="Subtotal" amount={formatRupiah(sourceSubtotal)} muted />
      {adjustments.map((adjustment) => (
        <Row
          key={adjustment.id}
          label={adjustment.label}
          muted
          amount={
            adjustment.originalAmount !== null &&
            adjustment.originalAmount !== adjustment.amount ? (
              <span>
                <span className="line-through" data-testid="printed-amount">
                  {formatRupiah(adjustment.originalAmount)}
                </span>{" "}
                {formatRupiah(adjustment.amount)}
              </span>
            ) : (
              formatRupiah(adjustment.amount)
            )
          }
        />
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t-2 border-arena-line pt-2.5 font-bold">
        <span>Final total</span>
        <span className="tabular-nums">{formatRupiah(finalTotal)}</span>
      </div>
    </div>
  )
}

function Row({
  label,
  amount,
  muted = false,
}: {
  label: string
  amount: React.ReactNode
  muted?: boolean
}) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className={muted ? "text-foreground/70" : undefined}>{label}</span>
      <span
        className={
          muted
            ? "shrink-0 text-foreground/70 tabular-nums"
            : "shrink-0 tabular-nums"
        }
      >
        {amount}
      </span>
    </div>
  )
}
