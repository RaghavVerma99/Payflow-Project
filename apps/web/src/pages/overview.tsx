import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Wallet,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import {
  cn,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  relativeTime,
} from "../lib/utils";
import { NewPaymentDialog } from "../components/payment-dialog";
import { PaymentDetailDialog } from "../components/payment-detail";
import { PageHeader } from "../components/layout";
import { Amount, IdText, StatusBadge } from "../components/status";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui";
import { VolumeChart } from "../components/volume-chart";

const STATUS_BARS: Record<string, string> = {
  succeeded: "bg-emerald-500",
  failed: "bg-rose-500",
  processing: "bg-sky-500",
  created: "bg-zinc-400",
  unknown: "bg-amber-500",
  partially_refunded: "bg-violet-400",
  refunded: "bg-violet-500",
  canceled: "bg-zinc-500",
};

function Kpi({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint: ReactNode;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <Card className="animate-fade-up">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className="tabular mt-2 text-2xl font-semibold tracking-tight">
              {value}
            </p>
          </div>
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-lg border",
              tone,
            )}
          >
            {icon}
          </div>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-3 w-40" />
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["overview"],
    queryFn: api.overview,
    refetchInterval: 5000,
  });

  const timeseriesQuery = useQuery({
    queryKey: ["timeseries", 14],
    queryFn: () => api.timeseries(14),
    refetchInterval: 15000,
  });

  const overview = overviewQuery.data;
  const totalByStatus = Object.entries(overview?.payments.by_status ?? {}).sort(
    (left, right) => right[1] - left[1],
  );
  const maxStatus = Math.max(1, ...totalByStatus.map(([, count]) => count));
  const windowVolume = (timeseriesQuery.data?.data ?? []).reduce(
    (sum, point) => sum + point.volume_minor,
    0,
  );

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Overview"
        description="Live payment volume, processor outcomes and ledger health for this merchant."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void queryClient.invalidateQueries();
              }}
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  overviewQuery.isFetching && "animate-spin",
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

      {overviewQuery.isError ? (
        <Card className="border-rose-500/25 bg-rose-500/5">
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="text-sm font-medium">
                Could not load the dashboard.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {overviewQuery.error instanceof Error
                  ? overviewQuery.error.message
                  : "Unknown error."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void overviewQuery.refetch()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {overviewQuery.isLoading || !overview ? (
          Array.from({ length: 4 }, (_, index) => <KpiSkeleton key={index} />)
        ) : (
          <>
            <Kpi
              label="Gross volume"
              value={formatCompactCurrency(overview.volume.gross_minor)}
              hint={
                <>
                  {formatNumber(overview.payments.total)} payments · net{" "}
                  {formatCurrency(overview.volume.net_minor)}
                </>
              }
              icon={<Wallet className="size-4 text-emerald-500" />}
              tone="border-emerald-500/20 bg-emerald-500/10"
            />
            <Kpi
              label="Success rate"
              value={formatPercent(overview.payments.success_rate)}
              hint={
                <>
                  {overview.payments.succeeded} settled ·{" "}
                  {overview.payments.failed} declined
                </>
              }
              icon={<ArrowUpRight className="size-4 text-sky-500" />}
              tone="border-sky-500/20 bg-sky-500/10"
            />
            <Kpi
              label="Refunded"
              value={formatCompactCurrency(overview.volume.refunded_minor)}
              hint={
                <>
                  {overview.refunds.total} refunds ·{" "}
                  {overview.refunds.succeeded} settled
                </>
              }
              icon={<RotateCcw className="size-4 text-violet-500" />}
              tone="border-violet-500/20 bg-violet-500/10"
            />
            <Kpi
              label="Ledger"
              value={overview.ledger.balanced ? "Balanced" : "Out of balance"}
              hint={
                <>
                  {formatCompactCurrency(overview.ledger.debits_minor)} debits ·{" "}
                  {formatCompactCurrency(overview.ledger.credits_minor)} credits
                </>
              }
              icon={
                overview.ledger.balanced ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : (
                  <Scale className="size-4 text-rose-500" />
                )
              }
              tone={
                overview.ledger.balanced
                  ? "border-emerald-500/20 bg-emerald-500/10"
                  : "border-rose-500/20 bg-rose-500/10"
              }
            />
          </>
        )}
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Payment volume</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Daily settled volume, last 14 days
              </p>
            </div>
            <div className="text-right">
              <p className="tabular text-sm font-semibold">
                {formatCompactCurrency(windowVolume)}
              </p>
              <p className="text-[10px] text-muted-foreground">window total</p>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {timeseriesQuery.isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <VolumeChart data={timeseriesQuery.data?.data ?? []} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment mix</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Outcomes across all payments
            </p>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {overview && totalByStatus.length > 0 ? (
              totalByStatus.map(([status, count]) => (
                <div key={status}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="capitalize text-muted-foreground">
                      {status.replace(/_/g, " ")}
                    </span>
                    <span className="tabular font-medium">{count}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        STATUS_BARS[status] ?? "bg-zinc-400",
                      )}
                      style={{ width: `${(count / maxStatus) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No payments yet.
              </p>
            )}

            {overview ? (
              <div className="mt-5 space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Refund volume</span>
                  <span className="tabular font-medium">
                    {formatCompactCurrency(overview.volume.refunded_minor)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Worker queue</span>
                  <span className="tabular font-medium">
                    {Object.values(overview.jobs).reduce(
                      (sum, count) => sum + count,
                      0,
                    )}{" "}
                    jobs
                  </span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Recent payments</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Click a row to inspect the timeline
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/payments">
                View all
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <div className="mt-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Created
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview?.recent_payments.map((payment) => (
                  <TableRow
                    key={payment.id}
                    className="cursor-pointer"
                    onClick={() => setDetailId(payment.id)}
                  >
                    <TableCell>
                      <p className="text-xs font-medium">
                        {payment.description ?? "Payment"}
                      </p>
                      <IdText id={payment.id} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={payment.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Amount minor={payment.amount_minor} />
                    </TableCell>
                    <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                      {relativeTime(payment.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {overview && overview.recent_payments.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-muted-foreground">
                No payments yet. Create one to start the demo.
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Ledger health</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Double-entry balances
              </p>
            </div>
            <Badge variant={overview?.ledger.balanced ? "success" : "danger"}>
              {overview?.ledger.balanced ? "Balanced" : "Review"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {overview?.ledger.accounts.map((account) => (
              <div
                key={account.id}
                className="rounded-lg border border-border bg-muted/20 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">{account.name}</p>
                  <Badge variant="outline" className="capitalize">
                    {account.kind}
                  </Badge>
                </div>
                <p className="tabular mt-1.5 text-lg font-semibold">
                  {formatCurrency(account.balance_minor)}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {account.code}
                </p>
              </div>
            ))}

            <div className="rounded-lg border border-border p-3 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total debits</span>
                <span className="tabular font-medium">
                  {formatCurrency(overview?.ledger.debits_minor ?? 0)}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-muted-foreground">Total credits</span>
                <span className="tabular font-medium">
                  {formatCurrency(overview?.ledger.credits_minor ?? 0)}
                </span>
              </div>
            </div>

            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link to="/ledger">
                Inspect journals
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-2.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CreditCard className="size-3" />
          Simulator only — no real cards or money movement.
        </span>
        <Link
          to="/guide"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          How it works
          <ArrowUpRight className="size-3" />
        </Link>
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
