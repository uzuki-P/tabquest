import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  formatAmountInput,
  formatRupiah,
  parseAmountInput,
} from "@/domain/money"
import { formatDisplayDate } from "@/lib/time"
import type { OutstandingPayments } from "@/server/services/payments"
import { cn } from "@/lib/utils"

interface CollectPaymentDialogProps {
  player: { id: string; name: string }
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Server function returning the player's unpaid shares. */
  load: (playerId: string) => Promise<OutstandingPayments>
  /** Called after a successful collection; the parent invalidates. */
  onCollected: (message: string) => void
}

/**
 * One handover settling every unpaid share of a player, laid out as a
 * worksheet: what they owe bill by bill on the left, the live money
 * breakdown on the right. Older bills record their exact split; a
 * round-up is recorded as a tip on the most recent bill.
 */
export function CollectPaymentDialog({
  player,
  open,
  onOpenChange,
  load,
  onCollected,
}: CollectPaymentDialogProps) {
  const [data, setData] = useState<OutstandingPayments | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setData(null)
    setText("")
    setError(null)
    setLoadError(null)
    setLoading(true)
    load(player.id)
      .then((result) => {
        if (cancelled) return
        setData(result)
        setText(
          result.totalOwed > 0
            ? formatAmountInput(String(result.totalOwed))
            : ""
        )
      })
      .catch(() => {
        if (!cancelled) setLoadError("Loading the outstanding bills failed.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, player.id, load])

  const parsed = parseAmountInput(text)
  const tip = data !== null && parsed !== null ? parsed - data.totalOwed : null
  // Outstanding items are oldest first, so the newest one absorbs the tip.
  const tipBill = data?.items[data.items.length - 1] ?? null
  const payable =
    data !== null &&
    data.items.length > 0 &&
    parsed !== null &&
    parsed >= data.totalOwed

  async function submit() {
    if (!payable || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/admin/players/${player.id}/collect-payment`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ totalPaid: parsed }),
        }
      )
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string
        }
        setError(body.message ?? "Recording the payment failed.")
        return
      }
      const recordedTip = parsed - data.totalOwed
      const bills = data.items.length
      onCollected(
        recordedTip > 0 && tipBill
          ? `Collected ${formatRupiah(parsed)} for ${bills} ${bills === 1 ? "bill" : "bills"}; ${formatRupiah(recordedTip)} tip on ${tipBill.merchant}.`
          : `Collected ${formatRupiah(parsed)} for ${bills} ${bills === 1 ? "bill" : "bills"}.`
      )
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Collect payment — {player.name}</DialogTitle>
          <DialogDescription>
            One handover settles every unpaid share. Older bills record their
            exact split; a round-up is recorded as a tip on the most recent
            bill.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {data && data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing outstanding; every share is marked paid.
          </p>
        )}

        {data && data.items.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-2">
              <p className="font-mono text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">
                Unpaid bills
              </p>
              <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {data.items.map((item) => (
                  <li
                    key={item.billPlayerId}
                    className="border-b border-border/60 pb-1.5"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="line-clamp-2 min-w-0 text-sm font-medium">
                        {item.merchant}
                        {item.title && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {item.title}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-sm tabular-nums">
                        {formatRupiah(item.share)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDisplayDate(item.orderDate)}
                    </p>
                    {item.items.length > 0 && (
                      <ul className="mt-0.5 space-y-0.5 pl-3">
                        {item.items.map((line, index) => (
                          <li
                            key={index}
                            className="line-clamp-2 text-xs text-muted-foreground"
                          >
                            {line.quantity}× {line.name}
                            {line.variantNotes && (
                              <span> · {line.variantNotes}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex items-baseline justify-between border-t-2 pt-2 text-sm font-bold">
                <span>Total owed</span>
                <span className="font-mono tabular-nums">
                  {formatRupiah(data.totalOwed)}
                </span>
              </div>
            </div>

            <div className="flex flex-col space-y-3 border bg-muted/40 p-4">
              <Label className="block space-y-1">
                <span className="block font-mono text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">
                  They hand over
                </span>
                <Input
                  id="collect-amount"
                  inputMode="numeric"
                  className="bg-background text-right font-mono text-lg tabular-nums"
                  value={text}
                  disabled={busy}
                  onChange={(event) =>
                    setText(formatAmountInput(event.target.value))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      void submit()
                    }
                  }}
                />
              </Label>

              <dl className="space-y-1.5 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Settles</dt>
                  <dd className="shrink-0 font-mono tabular-nums">
                    {data.items.length}{" "}
                    {data.items.length === 1 ? "bill" : "bills"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Covers shares</dt>
                  <dd className="shrink-0 font-mono tabular-nums">
                    {formatRupiah(Math.min(parsed ?? 0, data.totalOwed))}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Tip</dt>
                  <dd
                    className={cn(
                      "shrink-0 font-mono font-bold tabular-nums",
                      tip !== null && tip > 0 && "text-success",
                      tip !== null && tip < 0 && "text-destructive"
                    )}
                  >
                    {tip === null
                      ? "—"
                      : `${tip > 0 ? "+" : ""}${formatRupiah(tip)}`}
                  </dd>
                </div>
              </dl>

              <p className="min-h-8 text-xs leading-snug text-muted-foreground">
                {tip === null && "Type the amount they handed over."}
                {tip === 0 && "Exact; no tip."}
                {tip !== null &&
                  tip < 0 &&
                  `${formatRupiah(-tip)} short of what they owe.`}
                {tip !== null && tip > 0 && tipBill && (
                  <span className="line-clamp-2">
                    Tip lands on {tipBill.merchant}
                    {tipBill.title ? ` · ${tipBill.title}` : ""} (
                    {formatDisplayDate(tipBill.orderDate)}).
                  </span>
                )}
              </p>

              <DialogFooter className="mt-auto gap-2 sm:justify-between">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={!payable || busy}
                  onClick={() => void submit()}
                >
                  {busy ? "Recording…" : "Record"}
                </Button>
              </DialogFooter>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
