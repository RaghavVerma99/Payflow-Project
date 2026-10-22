import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CheckCircle2,
  Landmark,
  Plus,
  RefreshCw,
  Scale,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "../components/layout";
import { Amount, IdText, StatusBadge } from "../components/status";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  Textarea,
} from "../components/ui";
import { api, type Scenario } from "../lib/api";
import { cn, formatCurrency, relativeTime, shortId } from "../lib/utils";

const PANELS = [
  { value: "payouts", label: "Payouts" },
  { value: "disputes", label: "Disputes" },
];

const SCENARIOS: Array<{ value: Scenario; label: string }> = [
  { value: "approve", label: "Approve" },
  { value: "decline", label: "Decline" },
  { value: "timeout", label: "Timeout" },
  { value: "transient", label: "Transient error" },
  { value: "auto", label: "Automatic" },
];

function PayoutsPanel() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("1000.00");
  const [destination, setDestination] = useState("");
  const [scenario, setScenario] = useState<Scenario>("approve");
  const [error, setError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: api.accounts,
    refetchInterval: 8000,
  });

  const payoutsQuery = useQuery({
    queryKey: ["payouts"],
    queryFn: () => api.payouts({ limit: 25 }),
    refetchInterval: 5000,
  });

  const payableMinor = useMemo(
    () =>
      (accountsQuery.data?.data ?? [])
        .filter((account) => account.code === "merchant_payable")
        .reduce((sum, account) => sum + account.balance_minor, 0),
    [accountsQuery.data],
  );

  const payouts = payoutsQuery.data?.data ?? [];
  const amountMinor = Math.round(Number.parseFloat(amount) * 100);
  const validAmount = Number.isFinite(amountMinor) && amountMinor > 0;
  const withinBalance = validAmount && amountMinor <= payableMinor;

  const createMutation = useMutation({
    mutationFn: (input: {
      amount_minor: number;
      destination: string;
      simulator_scenario: Scenario;
    }) => api.createPayout(input),
    onSuccess: async (payout) => {
      toast.success("Payout queued", {
        description: `${formatCurrency(payout.amount_minor)} · ${payout.destination}`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payouts"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
    },
    onError: (caught) => {
      const message =
        caught instanceof Error
          ? caught.message
          : "Could not queue the payout.";
      setError(message);
      toast.error("Payout rejected", { description: message });
    },
  });

  useEffect(() => {
    if (!open) return;
    setAmount("1000.00");
    setDestination("");
    setScenario("approve");
    setError(null);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!validAmount) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!destination.trim()) {
      setError("A payout needs a destination.");
      return;
    }
    if (amountMinor > payableMinor) {
      setError("The payout exceeds the merchant payable balance.");
      return;
    }

    setError(null);
    try {
      await createMutation.mutateAsync({
        amount_minor: amountMinor,
        destination: destination.trim(),
        simulator_scenario: scenario,
      });
      setOpen(false);
    } catch {
      return;
    }
  };

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative flex size-12 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/8 text-primary">
              <span className="absolute inset-1 rounded-full border border-current opacity-15" />
              <Landmark className="size-5" />
            </div>
            <div>
              <span className="label-craft">Merchant payable</span>
              {accountsQuery.isLoading ? (
                <Skeleton className="mt-2 h-7 w-40" />
              ) : (
                <p className="display mt-1.5 text-[28px] leading-none">
                  {formatCurrency(payableMinor)}
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Money we owe you. A payout may never exceed it.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">merchant_payable</Badge>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              New payout
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <span className="label-craft">Outbound</span>
            <CardTitle className="mt-2 text-[22px]">Payouts</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Money leaving the payable balance, settled by the worker.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void payoutsQuery.refetch()}
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                payoutsQuery.isFetching && "animate-spin",
              )}
            />
            Refresh
          </Button>
        </CardHeader>

        {payoutsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : payoutsQuery.isError ? (
          <div className="m-5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
            <p className="font-medium">The payouts could not be loaded.</p>
            <p className="mt-1 opacity-80">
              {payoutsQuery.error instanceof Error
                ? payoutsQuery.error.message
                : "Unknown error."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void payoutsQuery.refetch()}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : payouts.length === 0 ? (
          <EmptyState
            className="m-5 border-0"
            icon={<Banknote className="size-4" />}
            title="No payouts yet"
            description="Move money out of the payable balance and the worker will settle it."
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="size-4" />
                New payout
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow className="hover:bg-transparent">
                <TableHead>Payout</TableHead>
                <TableHead className="hidden md:table-cell">
                  Destination
                </TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.map((payout, index) => (
                <TableRow key={payout.id}>
                  <TableCell>
                    <div className="flex items-start gap-3">
                      <span className="row-index mt-0.5 w-5 shrink-0 font-mono text-[9px] text-muted-foreground/30">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <IdText id={payout.id} />
                        <div className="mt-1.5 sm:hidden">
                          <StatusBadge
                            status={payout.status}
                            kind="payout"
                            className="scale-90"
                          />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-[240px] truncate text-[11px] text-muted-foreground md:table-cell">
                    {payout.destination}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={payout.status} kind="payout" />
                      {payout.failure_code ? (
                        <Badge variant="danger">{payout.failure_code}</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="display whitespace-nowrap text-[16px] leading-none">
                      {formatCurrency(payout.amount_minor)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
                      {relativeTime(payout.created_at)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New payout</DialogTitle>
            <DialogDescription>
              Debits the merchant payable balance and queues the transfer for
              the worker. The API answers with 202.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="payout-amount">Amount</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    ₹
                  </span>
                  <Input
                    id="payout-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="pl-7 tabular text-base font-medium"
                    placeholder="1000.00"
                  />
                </div>
                <p
                  className={cn(
                    "text-[10px]",
                    validAmount && !withinBalance
                      ? "text-rose-600 dark:text-rose-300"
                      : "text-muted-foreground",
                  )}
                >
                  {accountsQuery.isLoading
                    ? "Reading the merchant payable balance…"
                    : validAmount && !withinBalance
                      ? `The payable balance is only ${formatCurrency(payableMinor)}.`
                      : `Available ${formatCurrency(payableMinor)} · sent as ${
                          validAmount ? amountMinor : "—"
                        } minor units`}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="payout-scenario">Scenario</Label>
                <Select
                  id="payout-scenario"
                  value={scenario}
                  onChange={(event) =>
                    setScenario(event.target.value as Scenario)
                  }
                >
                  {SCENARIOS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payout-destination">Destination</Label>
              <Input
                id="payout-destination"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="HDFC bank •••• 4421"
              />
            </div>

            {error ? (
              <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {error}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || !withinBalance}
              >
                {createMutation.isPending ? (
                  <Spinner />
                ) : (
                  <Banknote className="size-4" />
                )}
                Queue payout
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DisputesPanel() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [paymentId, setPaymentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const disputesQuery = useQuery({
    queryKey: ["disputes"],
    queryFn: () => api.disputes({ limit: 25 }),
    refetchInterval: 5000,
  });

  const paymentsQuery = useQuery({
    queryKey: ["disputes", "payments"],
    queryFn: () => api.payments({ limit: 20, status: "succeeded" }),
    enabled: open,
  });

  const disputes = disputesQuery.data?.data ?? [];
  const payments = paymentsQuery.data?.data ?? [];

  const amountMinor = amount.trim()
    ? Math.round(Number.parseFloat(amount) * 100)
    : null;
  const validAmount = amountMinor === null || Number.isFinite(amountMinor);

  const createMutation = useMutation({
    mutationFn: (input: {
      payment_id: string;
      amount_minor: number | null;
      reason: string;
      note: string | null;
    }) => api.createDispute(input),
    onSuccess: async (dispute) => {
      toast.success("Dispute opened", {
        description: `${formatCurrency(dispute.amount_minor)} · ${shortId(dispute.id)}`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["disputes"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
    },
    onError: (caught) => {
      const message =
        caught instanceof Error
          ? caught.message
          : "Could not open the dispute.";
      setError(message);
      toast.error("Dispute rejected", { description: message });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (input: { id: string; outcome: "won" | "lost" }) =>
      api.resolveDispute(input.id, input.outcome),
    onSuccess: async (dispute) => {
      toast.success(dispute.status === "won" ? "Dispute won" : "Dispute lost", {
        description: `${formatCurrency(dispute.amount_minor)} · ${shortId(dispute.id)}`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["disputes"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
      ]);
    },
    onError: (caught) => {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "Could not resolve the dispute.",
      );
    },
  });

  useEffect(() => {
    if (!open) return;
    setPaymentId("");
    setAmount("");
    setReason("");
    setNote("");
    setError(null);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!paymentId) {
      setError("Choose the payment under dispute.");
      return;
    }
    if (!reason.trim()) {
      setError("Give the dispute a reason.");
      return;
    }
    if (!validAmount) {
      setError("The disputed amount must be a number.");
      return;
    }
    if (amountMinor !== null && amountMinor <= 0) {
      setError("The disputed amount must be greater than zero.");
      return;
    }

    setError(null);
    try {
      await createMutation.mutateAsync({
        payment_id: paymentId,
        amount_minor: amountMinor,
        reason: reason.trim(),
        note: note.trim() || null,
      });
      setOpen(false);
    } catch {
      return;
    }
  };

  const resolve = async (id: string, outcome: "won" | "lost") => {
    setResolving(id);
    try {
      await resolveMutation.mutateAsync({ id, outcome });
    } catch {
      return;
    } finally {
      setResolving(null);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <span className="label-craft">Contested</span>
            <CardTitle className="mt-2 text-[22px]">Disputes</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              A lost dispute debits the payable balance; a won one posts
              nothing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void disputesQuery.refetch()}
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  disputesQuery.isFetching && "animate-spin",
                )}
              />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              Open dispute
            </Button>
          </div>
        </CardHeader>

        {disputesQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : disputesQuery.isError ? (
          <div className="m-5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
            <p className="font-medium">The disputes could not be loaded.</p>
            <p className="mt-1 opacity-80">
              {disputesQuery.error instanceof Error
                ? disputesQuery.error.message
                : "Unknown error."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void disputesQuery.refetch()}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : disputes.length === 0 ? (
          <EmptyState
            className="m-5 border-0"
            icon={<Scale className="size-4" />}
            title="Nothing contested"
            description="Open a dispute against a settled payment to see how the book reacts."
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="size-4" />
                Open dispute
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow className="hover:bg-transparent">
                <TableHead>Dispute</TableHead>
                <TableHead className="hidden md:table-cell">Payment</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden lg:table-cell">Reason</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Created
                </TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {disputes.map((dispute, index) => (
                <TableRow key={dispute.id}>
                  <TableCell>
                    <div className="flex items-start gap-3">
                      <span className="row-index mt-0.5 w-5 shrink-0 font-mono text-[9px] text-muted-foreground/30">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <IdText id={dispute.id} />
                        <div className="mt-1.5 sm:hidden">
                          <StatusBadge
                            status={dispute.status}
                            kind="dispute"
                            className="scale-90"
                          />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <IdText id={dispute.payment_id} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount
                      minor={dispute.amount_minor}
                      className="whitespace-nowrap text-[15px]"
                    />
                  </TableCell>
                  <TableCell className="hidden max-w-[220px] truncate text-[11px] text-muted-foreground lg:table-cell">
                    {dispute.reason}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <StatusBadge status={dispute.status} kind="dispute" />
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
                      {relativeTime(dispute.created_at)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {dispute.status === "open" ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resolving === dispute.id}
                          onClick={() => void resolve(dispute.id, "won")}
                          title="Win this dispute"
                        >
                          {resolving === dispute.id ? (
                            <Spinner />
                          ) : (
                            <CheckCircle2 className="size-3.5" />
                          )}
                          Won
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={resolving === dispute.id}
                          onClick={() => void resolve(dispute.id, "lost")}
                          title="Lose this dispute"
                        >
                          <XCircle className="size-3.5" />
                          Lost
                        </Button>
                      </div>
                    ) : (
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/40">
                        —
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Open a dispute</DialogTitle>
            <DialogDescription>
              Only succeeded payments can be contested. Leave the amount empty
              to dispute the full capture.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dispute-payment">Payment</Label>
              <Select
                id="dispute-payment"
                value={paymentId}
                onChange={(event) => setPaymentId(event.target.value)}
              >
                <option value="">Choose a succeeded payment</option>
                {payments.map((payment) => (
                  <option key={payment.id} value={payment.id}>
                    {shortId(payment.id)} ·{" "}
                    {formatCurrency(payment.amount_minor)}
                  </option>
                ))}
              </Select>
              {paymentsQuery.isLoading ? (
                <p className="text-[10px] text-muted-foreground">
                  Loading succeeded payments…
                </p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dispute-amount">Amount (optional)</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    ₹
                  </span>
                  <Input
                    id="dispute-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="pl-7 tabular"
                    placeholder="Full amount"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dispute-reason">Reason</Label>
                <Input
                  id="dispute-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Customer claims the order never arrived"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dispute-note">Note (optional)</Label>
              <Textarea
                id="dispute-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Awaiting carrier evidence"
              />
            </div>

            {error ? (
              <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {error}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <Spinner />
                ) : (
                  <Scale className="size-4" />
                )}
                Open dispute
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TreasuryPage() {
  const [panel, setPanel] = useState("payouts");

  return (
    <div>
      <PageHeader
        eyebrow="Chapter 09 · The treasury"
        title="Treasury"
        description="Money moving out and money moving back. Payouts draw down the payable balance; disputes push against it."
        actions={
          <Badge variant="outline" className="gap-1">
            <Scale className="size-3" />
            Payouts &amp; disputes
          </Badge>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={panel} onChange={setPanel} items={PANELS} />
        <span className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground md:flex">
          <span className="h-3 w-px bg-border" />
          live · 5s refresh
        </span>
      </div>

      {panel === "payouts" ? <PayoutsPanel /> : <DisputesPanel />}
    </div>
  );
}
