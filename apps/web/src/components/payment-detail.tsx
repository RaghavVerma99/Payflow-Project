import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Clock3,
  KeyRound,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api, type PaymentEvent, type Scenario } from "../lib/api";
import {
  cn,
  formatCurrency,
  formatDate,
  formatTime,
  humanize,
  shortId,
} from "../lib/utils";
import { Amount, IdText, StatusBadge } from "./status";
import {
  Button,
  CopyButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Separator,
  Select,
  Skeleton,
  Spinner,
} from "./ui";

const ACTIVE_STATUSES = new Set(["created", "processing", "unknown"]);

function dotClass(status: string): string {
  if (status === "succeeded") return "bg-emerald-500";
  if (status === "failed" || status === "canceled") return "bg-rose-500";
  if (status === "unknown") return "bg-amber-500";
  if (status === "processing" || status === "created") return "bg-sky-500";
  if (status.includes("refund")) return "bg-violet-500";
  return "bg-zinc-400";
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/25 px-3 py-2.5">
      <p className="label-craft">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-[12px] font-medium",
          mono && "font-mono",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Timeline({ events }: { events: PaymentEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No events recorded yet.</p>
    );
  }

  return (
    <div className="relative space-y-4 pl-5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
      {events.map((event) => (
        <div key={event.id} className="relative">
          <span
            className={cn(
              "absolute -left-5 top-1 size-2.5 rounded-full border-2 border-card",
              dotClass(event.to_status),
            )}
          />
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium">{humanize(event.type)}</p>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {formatTime(event.created_at)}
            </span>
          </div>
          {event.reason ? (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {event.reason}
            </p>
          ) : null}
          {event.from_status && event.from_status !== event.to_status ? (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
              {event.from_status} → {event.to_status}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function PaymentDetailDialog({
  paymentId,
  open,
  onOpenChange,
}: {
  paymentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundScenario, setRefundScenario] = useState<Scenario>("approve");
  const [pending, setPending] = useState<
    "cancel" | "refund" | "refund-cancel" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["payment", paymentId],
    queryFn: () => api.payment(paymentId as string),
    enabled: open && Boolean(paymentId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE_STATUSES.has(status) ? 1200 : false;
    },
  });

  const refundsQuery = useQuery({
    queryKey: ["refunds", "payment", paymentId],
    queryFn: () => api.refunds({ payment_id: paymentId as string, limit: 20 }),
    enabled: open && Boolean(paymentId),
    refetchInterval: 2500,
  });

  useEffect(() => {
    if (!open) return;
    setRefundOpen(false);
    setRefundReason("");
    setRefundScenario("approve");
    setError(null);
    setPending(null);
  }, [open, paymentId]);

  const payment = detailQuery.data;
  const refunds = refundsQuery.data?.data ?? [];

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["payment", paymentId] }),
      queryClient.invalidateQueries({ queryKey: ["refunds"] }),
      queryClient.invalidateQueries({ queryKey: ["payments"] }),
      queryClient.invalidateQueries({ queryKey: ["overview"] }),
      queryClient.invalidateQueries({ queryKey: ["timeseries"] }),
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["journals"] }),
    ]);
  };

  const cancelPayment = async () => {
    if (!payment) return;
    setPending("cancel");
    setError(null);
    try {
      await api.cancelPayment(payment.id);
      toast.success("Payment canceled");
      await invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cancel failed.");
    } finally {
      setPending(null);
    }
  };

  const openRefundForm = () => {
    if (!payment) return;
    setRefundAmount((payment.refundable_minor / 100).toFixed(2));
    setError(null);
    setRefundOpen(true);
  };

  const cancelRefund = async (refundId: string) => {
    setPending("refund-cancel");
    setError(null);
    try {
      await api.cancelRefund(refundId);
      toast.success("Refund canceled, capacity released");
      await invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cancel failed.");
    } finally {
      setPending(null);
    }
  };

  const submitRefund = async (event: FormEvent) => {
    event.preventDefault();
    if (!payment) return;

    const amountMinor = Math.round(Number.parseFloat(refundAmount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setError("Enter a refund amount greater than zero.");
      return;
    }
    if (amountMinor > payment.refundable_minor) {
      setError("Refund exceeds the remaining refundable balance.");
      return;
    }

    setPending("refund");
    setError(null);
    try {
      await api.createRefund({
        payment_id: payment.id,
        amount_minor: amountMinor,
        reason: refundReason.trim() || null,
        simulator_scenario: refundScenario,
      });
      toast.success("Refund queued", {
        description: `${formatCurrency(amountMinor)} on ${shortId(payment.id)}`,
      });
      setRefundOpen(false);
      await invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Refund failed.");
    } finally {
      setPending(null);
    }
  };

  const canRefund =
    payment &&
    ["succeeded", "partially_refunded"].includes(payment.status) &&
    payment.refundable_minor > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <span>Payment detail</span>
            {payment ? (
              <>
                <span className="font-mono normal-case tracking-normal opacity-60">
                  {payment.id}
                </span>
                <CopyButton value={payment.id} label="payment id" />
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DialogTitle className="tabular text-[30px] leading-none">
              {payment ? formatCurrency(payment.amount_minor) : "Loading…"}
            </DialogTitle>
            {payment ? <StatusBadge status={payment.status} /> : null}
          </div>
          <DialogDescription>
            {payment?.description ?? "No description provided."}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : null}

        {detailQuery.isError ? (
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
            <p className="font-medium">Could not load this payment.</p>
            <p className="mt-1 opacity-80">
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "Unknown error."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void detailQuery.refetch()}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : null}

        {payment ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Meta
                label="Customer"
                value={payment.customer_id ?? "—"}
                mono={Boolean(payment.customer_id)}
              />
              <Meta label="Created" value={formatDate(payment.created_at)} />
              <Meta
                label="Refunded"
                value={formatCurrency(payment.refunded_minor)}
              />
              <Meta
                label="Refundable"
                value={formatCurrency(payment.refundable_minor)}
              />
            </div>

            {payment.failure_code ? (
              <div className="flex items-center gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                <AlertTriangle className="size-3.5" />
                Failure code:{" "}
                <span className="font-mono">{payment.failure_code}</span>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void detailQuery.refetch()}
              >
                <RefreshCw
                  className={cn(
                    "size-3.5",
                    detailQuery.isFetching && "animate-spin",
                  )}
                />
                Refresh
              </Button>

              {payment.status === "created" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void cancelPayment()}
                  disabled={pending !== null}
                >
                  {pending === "cancel" ? (
                    <Spinner />
                  ) : (
                    <Ban className="size-3.5" />
                  )}
                  Cancel payment
                </Button>
              ) : null}

              {canRefund ? (
                <Button
                  size="sm"
                  onClick={openRefundForm}
                  disabled={pending !== null}
                >
                  <RotateCcw className="size-3.5" />
                  Refund
                </Button>
              ) : null}

              {payment.refund_reserved_minor > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                  <Clock3 className="size-3" />
                  {formatCurrency(payment.refund_reserved_minor)} reserved
                </span>
              ) : null}
            </div>

            {refundOpen ? (
              <form
                onSubmit={submitRefund}
                className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-4"
              >
                <div className="mb-3 flex items-center gap-2">
                  <RotateCcw className="size-4 text-violet-500" />
                  <p className="display-soft text-[17px]">Refund payment</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="refund-amount">Amount</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        ₹
                      </span>
                      <Input
                        id="refund-amount"
                        inputMode="decimal"
                        value={refundAmount}
                        onChange={(event) =>
                          setRefundAmount(event.target.value)
                        }
                        className="pl-7 tabular"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Up to {formatCurrency(payment.refundable_minor)}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="refund-scenario">Scenario</Label>
                    <Select
                      id="refund-scenario"
                      value={refundScenario}
                      onChange={(event) =>
                        setRefundScenario(event.target.value as Scenario)
                      }
                    >
                      <option value="approve">Approve</option>
                      <option value="decline">Decline</option>
                      <option value="timeout">Timeout</option>
                      <option value="transient">Transient error</option>
                      <option value="auto">Automatic</option>
                    </Select>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="refund-reason">Reason (optional)</Label>
                  <Input
                    id="refund-reason"
                    value={refundReason}
                    onChange={(event) => setRefundReason(event.target.value)}
                    placeholder="Customer request"
                  />
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRefundOpen(false)}
                    disabled={pending !== null}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={pending !== null}>
                    {pending === "refund" ? (
                      <Spinner />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                    Queue refund
                  </Button>
                </div>
              </form>
            ) : null}

            <Separator />

            <div className="grid gap-6 sm:grid-cols-2">
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="display-soft text-[17px]">Timeline</h4>
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">
                    {payment.events.length} events
                  </span>
                </div>
                <Timeline events={payment.events} />
              </section>

              <section className="space-y-5">
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="display-soft text-[17px]">
                      Processor attempts
                    </h4>
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">
                      {payment.attempts.length}
                    </span>
                  </div>
                  {payment.attempts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No attempts yet. The worker will claim this shortly.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {payment.attempts.map((attempt) => (
                        <div
                          key={attempt.id}
                          className="rounded-lg border border-border bg-muted/20 p-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium">
                              Attempt {attempt.attempt_number}
                            </span>
                            <span
                              className={cn(
                                "text-[10px] font-medium capitalize",
                                attempt.status === "succeeded"
                                  ? "text-emerald-500"
                                  : attempt.status === "started"
                                    ? "text-sky-500"
                                    : "text-rose-500",
                              )}
                            >
                              {attempt.status.replace("_", " ")}
                            </span>
                          </div>
                          <p
                            className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
                            title={attempt.processor_reference}
                          >
                            {attempt.processor_reference}
                          </p>
                          {attempt.failure_code ? (
                            <p className="mt-0.5 font-mono text-[10px] text-rose-500">
                              {attempt.failure_code}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="display-soft text-[17px]">Refunds</h4>
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60">
                      {refunds.length}
                    </span>
                  </div>
                  {refunds.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No refunds on this payment.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {refunds.map((refund) => (
                        <div
                          key={refund.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Amount
                                minor={refund.amount_minor}
                                className="text-xs"
                              />
                              <StatusBadge
                                status={refund.status}
                                kind="refund"
                                className="scale-90"
                              />
                            </div>
                            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                              {refund.reason ?? "No reason"} ·{" "}
                              {formatTime(refund.created_at)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {refund.status === "reserved" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={pending !== null}
                                onClick={() => void cancelRefund(refund.id)}
                                title="Cancel this refund and release its capacity"
                              >
                                {pending === "refund-cancel" ? (
                                  <Spinner />
                                ) : (
                                  <Ban className="size-3" />
                                )}
                                Cancel
                              </Button>
                            ) : null}
                            <IdText id={refund.id} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
              <KeyRound className="size-3" />
              created_at {formatDate(payment.created_at)} · updated_at{" "}
              {formatDate(payment.updated_at)} · refunded{" "}
              {formatCurrency(payment.refunded_minor)} · reserved{" "}
              {formatCurrency(payment.refund_reserved_minor)}
            </div>
          </>
        ) : null}

        {!payment && !detailQuery.isLoading && !detailQuery.isError ? (
          <EmptyState
            title="No payment selected"
            description="Pick a payment from the table to inspect its events and ledger impact."
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
