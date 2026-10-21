import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { useAnimatedNumber, Reveal } from "../components/motion";
import { NewPaymentDialog } from "../components/payment-dialog";
import { PaymentDetailDialog } from "../components/payment-detail";
import { IdText, StatusBadge } from "../components/status";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "../components/ui";
import { VolumeChart } from "../components/volume-chart";
import { api, type Payment, type TimeseriesPoint } from "../lib/api";
import {
  cn,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  relativeTime,
} from "../lib/utils";

const STATUS_COLORS: Record<string, string> = {
  succeeded: "bg-emerald-500",
  failed: "bg-rose-500",
  processing: "bg-sky-500",
  created: "bg-zinc-400",
  unknown: "bg-amber-500",
  partially_refunded: "bg-violet-400",
  refunded: "bg-violet-500",
  canceled: "bg-zinc-500",
};

const TODAY = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "long",
  year: "numeric",
}).format(new Date());

function Sparkline({
  points,
  className,
}: {
  points: TimeseriesPoint[];
  className?: string;
}) {
  const gradientId = useId().replace(/:/g, "");

  if (points.length < 2) {
    return <div className={cn("h-12", className)} />;
  }

  const width = 280;
  const height = 52;
  const max = Math.max(1, ...points.map((point) => point.volume_minor));
  const step = width / Math.max(1, points.length - 1);
  const coordinates = points.map((point, index) => {
    const x = index * step;
    const y = height - 4 - (point.volume_minor / max) * (height - 10);
    return [x, y] as const;
  });
  const line = coordinates
    .map(
      ([x, y], index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-12 w-full", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
      />
      <circle
        cx={coordinates.at(-1)?.[0]}
        cy={coordinates.at(-1)?.[1]}
        r="2.4"
        fill="var(--primary)"
      />
    </svg>
  );
}

function RateRing({ rate }: { rate: number }) {
  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(1, rate)) * circumference;

  return (
    <svg viewBox="0 0 64 64" className="size-16 -rotate-90" aria-hidden>
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke="var(--border)"
        strokeWidth="3"
      />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference - filled}`}
      />
    </svg>
  );
}

function LivePulse({
  payments,
  jobs,
}: {
  payments: Payment[];
  jobs: Record<string, number>;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (payments.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % payments.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [payments.length]);

  const payment = payments[index % Math.max(1, payments.length)];
  const queue = Object.values(jobs).reduce((sum, count) => sum + count, 0);

  return (
    <div className="relative w-full max-w-[19rem] overflow-hidden rounded-2xl border border-border/80 bg-background/35 p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="label-craft">Live pulse</span>
        <span className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-300">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
          Streaming
        </span>
      </div>

      {payment ? (
        <div key={payment.id} className="animate-ticker mt-4">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge status={payment.status} />
            <span className="font-mono text-[9px] text-muted-foreground">
              {relativeTime(payment.created_at)}
            </span>
          </div>
          <p className="mt-3 line-clamp-1 text-[13px] font-medium">
            {payment.description ?? "Unnamed payment"}
          </p>
          <p className="display mt-1 text-[28px] leading-none">
            {formatCurrency(payment.amount_minor)}
          </p>
          <div className="mt-3 flex items-center justify-between">
            <IdText id={payment.id} />
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/70">
              {payment.customer_id ?? "anonymous"}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-5 text-xs text-muted-foreground">
          The first charge will appear here.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border/70 pt-3">
        <div>
          <p className="font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Queue
          </p>
          <p className="display mt-0.5 text-lg">{queue} jobs</p>
        </div>
        <div>
          <p className="font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Processor
          </p>
          <p className="display mt-0.5 text-lg">Nominal</p>
        </div>
      </div>
    </div>
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
  const series = timeseriesQuery.data?.data ?? [];
  const gross = useAnimatedNumber(overview?.volume.gross_minor ?? 0);
  const refunded = useAnimatedNumber(overview?.volume.refunded_minor ?? 0);
  const rate = useAnimatedNumber(overview?.payments.success_rate ?? 0);
  const windowVolume = series.reduce(
    (sum, point) => sum + point.volume_minor,
    0,
  );
  const byStatus = Object.entries(overview?.payments.by_status ?? {}).sort(
    (left, right) => right[1] - left[1],
  );
  const totalPayments = Math.max(1, overview?.payments.total ?? 1);

  return (
    <div>
      <Reveal>
        <Card className="art-card-glow relative overflow-hidden rounded-[30px]">
          <div className="pointer-events-none absolute -right-24 -top-28 size-[28rem] rounded-full border border-primary/15" />
          <div className="pointer-events-none absolute -right-10 -top-14 size-[22rem] animate-spin-slow rounded-full border border-dashed border-primary/12" />
          <div className="pointer-events-none absolute right-40 top-10 size-2 rounded-full bg-primary/70 animate-pulse-soft" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-grid opacity-30 [mask-image:linear-gradient(to_left,black,transparent)]" />

          <div className="relative flex flex-col gap-9 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between lg:p-10">
            <div className="min-w-0 max-w-2xl flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <Sparkles className="size-3.5 text-primary" />
                <span className="label-craft">Live operations</span>
                <span className="h-px w-8 bg-border" />
                <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground/60">
                  {TODAY}
                </span>
              </div>
              <h1 className="display mt-5 text-[52px] leading-[0.88] sm:text-[72px]">
                Money,
                <br />
                <span className="italic text-primary">in motion.</span>
              </h1>
              <p className="mt-5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                Idempotent by design. Deterministic at the processor. Balanced
                in the ledger. This is the quiet choreography behind every
                charge.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => setNewOpen(true)}>
                  <Plus className="size-3.5" />
                  Compose a payment
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/ledger">
                    Read the ledger
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void queryClient.invalidateQueries()}
                >
                  <RefreshCw
                    className={cn(
                      "size-3.5",
                      overviewQuery.isFetching && "animate-spin",
                    )}
                  />
                  Refresh
                </Button>
              </div>
            </div>

            <div className="flex w-full justify-start lg:w-auto lg:shrink-0 lg:justify-end">
              <LivePulse
                payments={overview?.recent_payments ?? []}
                jobs={overview?.jobs ?? {}}
              />
            </div>
          </div>
        </Card>
      </Reveal>

      {overviewQuery.isError ? (
        <Card className="mt-4 border-rose-500/30 bg-rose-500/5">
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="text-sm font-medium">
                The dashboard lost its thread.
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

      <div className="mt-4 grid gap-3 md:grid-cols-12">
        {overviewQuery.isLoading || !overview ? (
          Array.from({ length: 4 }, (_, index) => (
            <Skeleton
              key={index}
              className={cn(
                "h-36 rounded-2xl",
                index === 0 ? "md:col-span-5" : "md:col-span-7 xl:col-span-2",
              )}
            />
          ))
        ) : (
          <>
            <Reveal className="md:col-span-5" delay={40}>
              <Card className="hover-lift h-full p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="size-4 text-primary" />
                    <span className="label-craft">Gross volume</span>
                  </div>
                  <Badge variant="outline">INR</Badge>
                </div>
                <p className="display mt-4 text-[38px] leading-none">
                  {formatCompactCurrency(gross)}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {formatNumber(overview.payments.total)} payments ·{" "}
                  {formatCurrency(overview.volume.net_minor)} net of refunds
                </p>
                <Sparkline points={series} className="mt-3" />
              </Card>
            </Reveal>

            <Reveal className="md:col-span-3 xl:col-span-2" delay={90}>
              <Card className="hover-lift flex h-full flex-col justify-between p-5">
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="size-4 text-emerald-500" />
                  <span className="label-craft">Success</span>
                </div>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="display mt-4 text-[34px] leading-none">
                      {formatPercent(rate)}
                    </p>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {overview.payments.succeeded} of {overview.payments.total}{" "}
                      settled
                    </p>
                  </div>
                  <RateRing rate={overview.payments.success_rate} />
                </div>
              </Card>
            </Reveal>

            <Reveal className="md:col-span-4 xl:col-span-2" delay={140}>
              <Card className="hover-lift flex h-full flex-col justify-between p-5">
                <div className="flex items-center gap-2">
                  <RotateCcw className="size-4 text-violet-500" />
                  <span className="label-craft">Returned</span>
                </div>
                <div>
                  <p className="display mt-4 text-[34px] leading-none">
                    {formatCompactCurrency(refunded)}
                  </p>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {overview.refunds.total} refunds ·{" "}
                    {overview.refunds.succeeded} settled
                  </p>
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-violet-500"
                      style={{
                        width: `${Math.min(
                          100,
                          overview.volume.gross_minor > 0
                            ? (overview.volume.refunded_minor /
                                overview.volume.gross_minor) *
                                100
                            : 0,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </Card>
            </Reveal>

            <Reveal className="md:col-span-12 xl:col-span-3" delay={190}>
              <Card className="hover-lift flex h-full flex-col justify-between p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Scale className="size-4 text-primary" />
                    <span className="label-craft">The book</span>
                  </div>
                  <Badge
                    variant={overview.ledger.balanced ? "success" : "danger"}
                  >
                    {overview.ledger.balanced ? "Balanced" : "Review"}
                  </Badge>
                </div>
                <div>
                  <p className="display mt-4 text-[28px] leading-none">
                    {formatCompactCurrency(overview.ledger.debits_minor)}
                  </p>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    debits = credits · {overview.ledger.accounts.length}{" "}
                    accounts
                  </p>
                  <div className="mt-3 space-y-1.5">
                    {overview.ledger.accounts.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center justify-between text-[10px]"
                      >
                        <span className="truncate text-muted-foreground">
                          {account.name}
                        </span>
                        <span className="tabular ml-2 font-medium">
                          {formatCurrency(account.balance_minor)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </Reveal>
          </>
        )}
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Reveal className="xl:col-span-2">
          <Card className="h-full">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <span className="label-craft">Fourteen days</span>
                <CardTitle className="mt-2 text-[22px]">
                  The daily flow
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Settled volume, drawn like a pulse.
                </p>
              </div>
              <div className="text-right">
                <p className="display text-2xl leading-none">
                  {formatCompactCurrency(windowVolume)}
                </p>
                <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground/70">
                  window total
                </p>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              {timeseriesQuery.isLoading ? (
                <Skeleton className="h-[268px] w-full" />
              ) : (
                <VolumeChart data={series} />
              )}
            </CardContent>
          </Card>
        </Reveal>

        <Reveal delay={80}>
          <Card className="flex h-full flex-col">
            <CardHeader>
              <span className="label-craft">Composition</span>
              <CardTitle className="mt-2 text-[22px]">Payment mix</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                The character of every charge.
              </p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col pt-5">
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                {byStatus.map(([status, count]) => (
                  <div
                    key={status}
                    className={cn(
                      "h-full transition-all duration-700",
                      STATUS_COLORS[status] ?? "bg-zinc-400",
                    )}
                    style={{ width: `${(count / totalPayments) * 100}%` }}
                    title={`${status}: ${count}`}
                  />
                ))}
              </div>

              <div className="mt-5 flex-1 space-y-3">
                {byStatus.length > 0 ? (
                  byStatus.map(([status, count]) => (
                    <div
                      key={status}
                      className="flex items-center gap-2.5 text-[11px]"
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          STATUS_COLORS[status] ?? "bg-zinc-400",
                        )}
                      />
                      <span className="flex-1 capitalize text-muted-foreground">
                        {status.replace(/_/g, " ")}
                      </span>
                      <span className="tabular font-medium">{count}</span>
                      <span className="tabular w-9 text-right text-[9px] text-muted-foreground/60">
                        {formatPercent(count / totalPayments, 0)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No payments yet.
                  </p>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
                <span className="text-[10px] text-muted-foreground">
                  Worker queue
                </span>
                <span className="font-mono text-[10px]">
                  {Object.values(overview?.jobs ?? {}).reduce(
                    (sum, count) => sum + count,
                    0,
                  )}{" "}
                  jobs
                </span>
              </div>
            </CardContent>
          </Card>
        </Reveal>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Reveal className="xl:col-span-2">
          <Card className="h-full overflow-hidden">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <span className="label-craft">The feed</span>
                <CardTitle className="mt-2 text-[22px]">
                  Recent payments
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click a line to open its full story.
                </p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/payments">
                  View all
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>

            <div className="mt-4 divide-y divide-border/60">
              {overview?.recent_payments.map((payment, index) => (
                <button
                  key={payment.id}
                  type="button"
                  onClick={() => setDetailId(payment.id)}
                  className="row-craft flex w-full items-center gap-3 px-5 py-3.5 text-left"
                >
                  <span className="row-index w-6 shrink-0 font-mono text-[9px] text-muted-foreground/30">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">
                      {payment.description ?? "Payment"}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <IdText id={payment.id} />
                      <span className="font-mono text-[8px] text-muted-foreground/50">
                        {payment.customer_id ?? "anonymous"}
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={payment.status} />
                  <div className="hidden text-right sm:block">
                    <p className="display text-[16px] leading-none">
                      {formatCurrency(payment.amount_minor)}
                    </p>
                    <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground/60">
                      {relativeTime(payment.created_at)}
                    </p>
                  </div>
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/40" />
                </button>
              ))}
            </div>

            {overview && overview.recent_payments.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="display-soft text-lg">An empty ledger awaits.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Create the first payment to begin the story.
                </p>
                <Button
                  className="mt-4"
                  size="sm"
                  onClick={() => setNewOpen(true)}
                >
                  <Plus className="size-3.5" />
                  Compose a payment
                </Button>
              </div>
            ) : null}
          </Card>
        </Reveal>

        <Reveal delay={80}>
          <Card className="flex h-full flex-col">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <span className="label-craft">Double entry</span>
                <CardTitle className="mt-2 text-[22px]">
                  Ledger health
                </CardTitle>
              </div>
              <Badge variant={overview?.ledger.balanced ? "success" : "danger"}>
                {overview?.ledger.balanced ? "Balanced" : "Review"}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col space-y-2.5 pt-4">
              {overview?.ledger.accounts.map((account) => (
                <div
                  key={account.id}
                  className="rounded-xl border border-border/70 bg-background/20 p-3.5 transition-colors hover:border-primary/25"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-medium">{account.name}</p>
                      <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/60">
                        {account.code}
                      </p>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {account.kind}
                    </Badge>
                  </div>
                  <p className="display mt-2 text-[24px] leading-none">
                    {formatCurrency(account.balance_minor)}
                  </p>
                  <div className="mt-2 flex gap-4 font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                    <span>Dr {formatCurrency(account.debits_minor)}</span>
                    <span>Cr {formatCurrency(account.credits_minor)}</span>
                  </div>
                </div>
              ))}

              <div className="mt-auto rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  <p className="text-[11px] font-medium">Trial balance holds</p>
                </div>
                <p className="tabular mt-1.5 font-mono text-[9px] text-muted-foreground">
                  {formatCurrency(overview?.ledger.debits_minor ?? 0)} ={" "}
                  {formatCurrency(overview?.ledger.credits_minor ?? 0)}
                </p>
              </div>

              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link to="/ledger">
                  Inspect the journals
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </Reveal>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-background/20 px-4 py-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Sparkles className="size-3 text-primary" />A simulation, faithfully
          kept — no card data, no real money.
        </span>
        <span className="inline-flex items-center gap-3 font-mono text-[8px] uppercase tracking-[0.14em]">
          <span>Processor: nominal</span>
          <span className="h-3 w-px bg-border" />
          <span>Currency: INR</span>
        </span>
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
