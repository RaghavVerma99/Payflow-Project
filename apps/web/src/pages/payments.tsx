import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  CreditCard,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { NewPaymentDialog } from "../components/payment-dialog";
import { PaymentDetailDialog } from "../components/payment-detail";
import { PageHeader } from "../components/layout";
import { Amount, IdText, StatusBadge } from "../components/status";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
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
import { cn, relativeTime } from "../lib/utils";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
  { value: "partially_refunded", label: "Partial" },
];

export function PaymentsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const paymentsQuery = useInfiniteQuery({
    queryKey: ["payments", status],
    queryFn: ({ pageParam }) =>
      api.payments({
        limit: 20,
        cursor: pageParam,
        status: status === "all" ? null : status,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    refetchInterval: 5000,
  });

  const payments = useMemo(
    () => paymentsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [paymentsQuery.data],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return payments;
    return payments.filter((payment) =>
      [payment.id, payment.customer_id, payment.description, payment.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [payments, search]);

  return (
    <div>
      <PageHeader
        eyebrow="Payments"
        title="Payments"
        description="Create charges, follow processor attempts and drill into the immutable event timeline."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void queryClient.invalidateQueries()}
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  paymentsQuery.isFetching && "animate-spin",
                )}
              />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="size-4" />
              New payment
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={status}
          onChange={(value) => setStatus(value)}
          items={FILTERS}
        />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search loaded payments"
            className="h-8 pl-9 text-xs"
          />
        </div>
      </div>

      <Card>
        {paymentsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            className="border-0"
            icon={<CreditCard className="size-4" />}
            title={search ? "No matching payments" : "No payments yet"}
            description={
              search
                ? "Try a different search term or clear the filter."
                : "Create a payment to watch the worker process it."
            }
            action={
              search ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearch("")}
                >
                  Clear search
                </Button>
              ) : (
                <Button size="sm" onClick={() => setNewOpen(true)}>
                  <Plus className="size-4" />
                  New payment
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment</TableHead>
                <TableHead className="hidden sm:table-cell">Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  Refunded
                </TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Created
                </TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((payment) => (
                <TableRow
                  key={payment.id}
                  className="cursor-pointer"
                  onClick={() => setDetailId(payment.id)}
                >
                  <TableCell>
                    <p className="max-w-[220px] truncate text-xs font-medium">
                      {payment.description ?? "Payment"}
                    </p>
                    <IdText id={payment.id} />
                  </TableCell>
                  <TableCell className="hidden font-mono text-[11px] text-muted-foreground sm:table-cell">
                    {payment.customer_id ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={payment.status} />
                      {payment.failure_code ? (
                        <Badge variant="danger" className="font-mono">
                          {payment.failure_code}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount minor={payment.amount_minor} />
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Amount
                      minor={payment.refunded_minor}
                      muted={payment.refunded_minor === 0}
                    />
                  </TableCell>
                  <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                    {relativeTime(payment.created_at)}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="size-4 text-muted-foreground/50" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {paymentsQuery.hasNextPage ? (
          <div className="flex justify-center border-t border-border p-3">
            <Button
              variant="outline"
              size="sm"
              disabled={paymentsQuery.isFetchingNextPage}
              onClick={() => void paymentsQuery.fetchNextPage()}
            >
              {paymentsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </Card>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Showing {visible.length} loaded payment{visible.length === 1 ? "" : "s"}
        . Rows refresh every 5 seconds.
      </p>

      <NewPaymentDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(payment) => setDetailId(payment.id)}
      />
      <PaymentDetailDialog
        paymentId={detailId}
        open={Boolean(detailId)}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      />
    </div>
  );
}
