import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/layout";
import { PaymentDetailDialog } from "../components/payment-detail";
import { Amount, IdText, StatusBadge } from "../components/status";
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
import { relativeTime } from "../lib/utils";

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

  return (
    <div>
      <PageHeader
        eyebrow="Refunds"
        title="Refunds"
        description="Refunds reserve capacity atomically before the worker settles them against the ledger."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/payments">
              Refund a payment
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      />

      <div className="mb-3">
        <Tabs value={status} onChange={setStatus} items={FILTERS} />
      </div>

      <Card>
        {refundsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : refunds.length === 0 ? (
          <EmptyState
            className="border-0"
            icon={<RotateCcw className="size-4" />}
            title="No refunds yet"
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
            <TableHeader>
              <TableRow>
                <TableHead>Refund</TableHead>
                <TableHead className="hidden md:table-cell">Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden lg:table-cell">Reason</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refunds.map((refund) => (
                <TableRow
                  key={refund.id}
                  className="cursor-pointer"
                  onClick={() => setPaymentId(refund.payment_id)}
                >
                  <TableCell>
                    <IdText id={refund.id} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <IdText id={refund.payment_id} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={refund.status} kind="refund" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount minor={refund.amount_minor} />
                  </TableCell>
                  <TableCell className="hidden max-w-[200px] truncate text-xs text-muted-foreground lg:table-cell">
                    {refund.reason ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                    {relativeTime(refund.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {refundsQuery.hasNextPage ? (
          <div className="flex justify-center border-t border-border p-3">
            <Button
              variant="outline"
              size="sm"
              disabled={refundsQuery.isFetchingNextPage}
              onClick={() => void refundsQuery.fetchNextPage()}
            >
              {refundsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </Card>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Click a refund to open its payment. A reservation is released if the
        processor declines.
      </p>

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
