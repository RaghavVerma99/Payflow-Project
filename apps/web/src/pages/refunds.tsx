import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/layout";
import { PaymentDetailDialog } from "../components/payment-detail";
import { IdText, StatusBadge } from "../components/status";
import {
  Button,
  Card,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from "../components/ui";
import { api } from "../lib/api";
import { formatCurrency, relativeTime } from "../lib/utils";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
  { value: "unknown", label: "Unknown" },
];

export function RefundsPage() {
  const [status, setStatus] = useState("all");
  const [paymentId, setPaymentId] = useState<string | null>(null);

  const refundsQuery = useInfiniteQuery({
    queryKey: ["refunds", status],
    queryFn: ({ pageParam }) =>
      api.refunds({
        limit: 20,
        cursor: pageParam,
        status: status === "all" ? null : status,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    refetchInterval: 5000,
  });

  const refunds = useMemo(
    () => refundsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [refundsQuery.data],
  );

  const loadedVolume = useMemo(
    () => refunds.reduce((sum, refund) => sum + refund.amount_minor, 0),
    [refunds],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Chapter 03 · The returns"
        title="Refunds"
        description="A refund is a promise kept. Capacity is reserved atomically, then settled by the worker against the book."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/payments">
              Choose a payment
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={status} onChange={setStatus} items={FILTERS} />
          <span className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground md:flex">
            <span className="h-3 w-px bg-border" />
            {refunds.length} lines · {formatCurrency(loadedVolume)} returned
          </span>
        </div>
        <p className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60 sm:block">
          Reservations release on decline
        </p>
      </div>

      <Card className="overflow-hidden">
        {refundsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : refunds.length === 0 ? (
          <EmptyState
            className="m-4 border-0"
            icon={<RotateCcw className="size-4" />}
            title="Nothing returned, yet"
            description="Open a succeeded payment and choose Refund to reserve capacity."
            action={
              <Button size="sm" asChild>
                <Link to="/payments">
                  Go to payments
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow className="hover:bg-transparent">
                <TableHead>Refund</TableHead>
                <TableHead className="hidden md:table-cell">Payment</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden lg:table-cell">Reason</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refunds.map((refund, index) => (
                <TableRow
                  key={refund.id}
                  className="group cursor-pointer"
                  onClick={() => setPaymentId(refund.payment_id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="row-index w-5 shrink-0 font-mono text-[9px] text-muted-foreground/30">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <IdText id={refund.id} />
                        <div className="mt-1.5 sm:hidden">
                          <StatusBadge status={refund.status} kind="refund" />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <IdText id={refund.payment_id} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <StatusBadge status={refund.status} kind="refund" />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="display whitespace-nowrap text-[16px] leading-none">
                      {formatCurrency(refund.amount_minor)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-[220px] truncate text-[11px] text-muted-foreground lg:table-cell">
                    {refund.reason ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
                      {relativeTime(refund.created_at)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {refundsQuery.hasNextPage ? (
          <div className="flex justify-center border-t border-border/70 p-4">
            <Button
              variant="outline"
              size="sm"
              disabled={refundsQuery.isFetchingNextPage}
              onClick={() => void refundsQuery.fetchNextPage()}
            >
              {refundsQuery.isFetchingNextPage
                ? "Turning the page…"
                : "Load more"}
            </Button>
          </div>
        ) : null}
      </Card>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-background/20 px-4 py-3 text-[10px] text-muted-foreground">
        <p className="inline-flex items-center gap-2">
          <RotateCcw className="size-3 text-primary" />
          Click a line to open its payment story.
        </p>
        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/60">
          Reserved → processing → settled
        </p>
      </div>

      <PaymentDetailDialog
        paymentId={paymentId}
        open={Boolean(paymentId)}
        onOpenChange={(open) => {
          if (!open) setPaymentId(null);
        }}
      />
    </div>
  );
}
