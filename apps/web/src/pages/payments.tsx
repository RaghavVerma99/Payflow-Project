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
import { cn, formatCurrency, relativeTime } from "../lib/utils";

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

  const loadedVolume = useMemo(
    () => visible.reduce((sum, payment) => sum + payment.amount_minor, 0),
    [visible],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Chapter 02 · The charges"
        title="Payments"
        description="Every charge begins as an intention, becomes a processor attempt, and settles into the book. Follow each one here."
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

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          value={status}
          onChange={(value) => setStatus(value)}
          items={FILTERS}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the loaded lines"
              className="h-9 rounded-full pl-9 text-[11px]"
            />
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-background/25 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground xl:flex">
            <span>{visible.length} lines</span>
            <span className="h-2.5 w-px bg-border" />
            <span>{formatCurrency(loadedVolume)} in view</span>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden">
        {paymentsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            className="m-4 border-0"
            icon={<CreditCard className="size-4" />}
            title={search ? "No matching lines" : "The first blank page"}
            description={
              search
                ? "Try a different search term or clear the filter."
                : "Compose a payment and watch the worker carry it through."
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
                  Compose a payment
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow className="hover:bg-transparent">
                <TableHead>Payment</TableHead>
                <TableHead className="hidden sm:table-cell">Customer</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  Returned
                </TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Created
                </TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((payment, index) => (
                <TableRow
                  key={payment.id}
                  className="group cursor-pointer"
                  onClick={() => setDetailId(payment.id)}
                >
                  <TableCell>
                    <div className="flex items-start gap-3">
                      <span className="row-index mt-0.5 w-5 shrink-0 font-mono text-[9px] text-muted-foreground/30">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="max-w-[220px] truncate text-[12px] font-medium">
                          {payment.description ?? "Unnamed payment"}
                        </p>
                        <IdText id={payment.id} />
                        <div className="mt-1.5 sm:hidden">
                          <StatusBadge status={payment.status} />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden font-mono text-[10px] text-muted-foreground sm:table-cell">
                    {payment.customer_id ?? "—"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={payment.status} />
                      {payment.failure_code ? (
                        <Badge variant="danger">{payment.failure_code}</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="display whitespace-nowrap text-[16px] leading-none">
                      {formatCurrency(payment.amount_minor)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Amount
                      minor={payment.refunded_minor}
                      muted={payment.refunded_minor === 0}
                    />
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
                      {relativeTime(payment.created_at)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <ChevronRight className="size-4 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {paymentsQuery.hasNextPage ? (
          <div className="flex justify-center border-t border-border/70 p-4">
            <Button
              variant="outline"
              size="sm"
              disabled={paymentsQuery.isFetchingNextPage}
              onClick={() => void paymentsQuery.fetchNextPage()}
            >
              {paymentsQuery.isFetchingNextPage
                ? "Turning the page…"
                : "Load more"}
            </Button>
          </div>
        ) : null}
      </Card>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">
        <p>
          Showing {visible.length} loaded payment
          {visible.length === 1 ? "" : "s"} · sorted by newest
        </p>
        <p className="inline-flex items-center gap-1.5">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
          live · 5s refresh
        </p>
      </div>

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
