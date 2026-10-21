import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { useState } from "react"
import { Effect } from "effect"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ThemeToggle } from "@/components/theme-toggle"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { AdminBillsSkeleton } from "@/components/page-skeletons"
import { PageBreadcrumb } from "@/components/page-breadcrumb"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatRupiah } from "@/domain/money"
import { formatDisplayDate } from "@/lib/time"
import { getServerContext } from "@/server/context"
import { listBillsAdmin } from "@/server/services/bills"
import type { AdminBillFilter } from "@/server/services/bills"

const fetchAdminBills = createServerFn({ method: "GET" })
  .validator((filter: AdminBillFilter) => filter)
  .handler(async ({ data }) => {
    const ctx = await getServerContext()
    return Effect.runPromise(listBillsAdmin({ db: ctx.db }, data))
  })

const filterLabels: Record<AdminBillFilter, string> = {
  active: "Active",
  archived: "Archived",
  all: "All",
}

export const Route = createFileRoute("/admin/")({
  validateSearch: (search: Record<string, unknown>) => ({
    filter: (["active", "archived", "all"] as const).includes(
      search.filter as AdminBillFilter
    )
      ? (search.filter as AdminBillFilter)
      : ("active" as AdminBillFilter),
  }),
  loaderDeps: ({ search: { filter } }) => ({ filter }),
  loader: async ({ deps }) => {
    return await fetchAdminBills({ data: deps.filter })
  },
  component: AdminBillListPage,
  pendingComponent: AdminBillsSkeleton,
})

function AdminBillListPage() {
  const bills = Route.useLoaderData()
  const { filter } = Route.useSearch()
  const router = useRouter()
  const [busyBillId, setBusyBillId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<
    | { kind: "unpublish"; billId: string }
    | { kind: "destroy"; billId: string; merchant: string }
    | null
  >(null)

  async function call(url: string, init: RequestInit) {
    setError(null)
    try {
      const response = await fetch(url, init)
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string
        }
        setError(body.message ?? "The action failed.")
        return false
      }
      await router.invalidate()
      return true
    } finally {
      setBusyBillId(null)
    }
  }

  function archive(billId: string) {
    setBusyBillId(billId)
    void call(`/api/admin/bills/${billId}/archive`, { method: "POST" })
  }

  function unarchive(billId: string) {
    setBusyBillId(billId)
    void call(`/api/admin/bills/${billId}/unarchive`, { method: "POST" })
  }

  function unpublish(billId: string) {
    setPendingConfirm({ kind: "unpublish", billId })
  }

  function destroy(billId: string, merchant: string) {
    setPendingConfirm({ kind: "destroy", billId, merchant })
  }

  /** Runs the action the user just confirmed in the dialog. */
  function runConfirmed() {
    if (!pendingConfirm) return
    const action = pendingConfirm
    setPendingConfirm(null)
    if (action.kind === "unpublish") {
      setBusyBillId(action.billId)
      void call(`/api/admin/bills/${action.billId}/unpublish`, {
        method: "POST",
      })
    } else {
      setBusyBillId(action.billId)
      void call(`/api/admin/bills/${action.billId}`, { method: "DELETE" })
    }
  }

  return (
    <main className="container mx-auto max-w-6xl px-4 py-10">
      <PageBreadcrumb
        items={[{ label: "Home", to: "/" }, { label: "Bills" }]}
      />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-medium">Bills</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drafts and published bills. Admin access stays inside the tailnet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button render={<Link to="/admin/bills/new" />}>New bill</Button>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-1" role="tablist">
        {(["active", "archived", "all"] as AdminBillFilter[]).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? "default" : "ghost"}
            render={<Link to="/admin" search={{ filter: value }} />}
          >
            {filterLabels[value]}
          </Button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card className="mt-4">
        <CardContent className="pt-6">
          {bills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {filter === "archived"
                ? "Nothing archived yet."
                : "No bills yet. Create the first one."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order date</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead className="text-right">Final total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((bill) => {
                  const unpaidCount = bill.billPlayerCount - bill.paidCount
                  const allPaid = bill.billPlayerCount > 0 && unpaidCount === 0
                  return (
                    <TableRow key={bill.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDisplayDate(bill.orderDate)}
                      </TableCell>
                      <TableCell>
                        <Link
                          to="/admin/bills/$billId"
                          params={{ billId: bill.id }}
                          className="hover:underline"
                        >
                          {bill.merchant}
                          {bill.title ? ` · ${bill.title}` : ""}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            bill.status === "published"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {bill.status}
                        </Badge>
                        {bill.archived && (
                          <Badge variant="outline" className="ml-1">
                            archived
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={allPaid ? "default" : "outline"}>
                          {bill.paidCount} paid · {unpaidCount} unpaid
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatRupiah(bill.finalTotal)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {bill.status === "published" ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busyBillId !== null}
                              onClick={() => unpublish(bill.id)}
                            >
                              {busyBillId === bill.id ? "..." : "Unpublish"}
                            </Button>
                          ) : (
                            <Link
                              to="/admin/bills/$billId"
                              params={{ billId: bill.id }}
                              className="self-center text-sm hover:underline"
                            >
                              Edit
                            </Link>
                          )}
                          {bill.archived ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyBillId !== null}
                              onClick={() => unarchive(bill.id)}
                            >
                              Restore
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyBillId !== null}
                              onClick={() => archive(bill.id)}
                            >
                              Archive
                            </Button>
                          )}
                          {bill.status !== "published" && (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busyBillId !== null}
                              onClick={() => destroy(bill.id, bill.merchant)}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null)
        }}
        title={
          pendingConfirm?.kind === "destroy"
            ? `Delete "${pendingConfirm.merchant}"?`
            : "Unpublish this bill?"
        }
        description={
          pendingConfirm?.kind === "destroy"
            ? "The bill, its item allocations, and its payment marks are removed for good. This cannot be undone."
            : "Its public page stops working until you publish it again."
        }
        confirmLabel={
          pendingConfirm?.kind === "destroy" ? "Delete" : "Unpublish"
        }
        destructive
        onConfirm={runConfirmed}
      />
    </main>
  )
}
