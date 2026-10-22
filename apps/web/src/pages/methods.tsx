import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CreditCard, Plus, RefreshCw, Wallet } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "../components/layout";
import { IdText } from "../components/status";
import {
  Badge,
  Button,
  Card,
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
} from "../components/ui";
import { api, type PaymentMethod, type PaymentMethodType } from "../lib/api";
import { cn, relativeTime } from "../lib/utils";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "card", label: "Cards" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank" },
  { value: "wallet", label: "Wallet" },
];

const TYPE_LABELS: Record<PaymentMethodType, string> = {
  card: "Card",
  upi: "UPI",
  bank: "Bank",
  wallet: "Wallet",
};

function expiryOf(method: PaymentMethod): string {
  if (!method.expiry_month || !method.expiry_year) return "—";
  const month = String(method.expiry_month).padStart(2, "0");
  return `${month}/${String(method.expiry_year).slice(-2)}`;
}

export function MethodsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [type, setType] = useState<PaymentMethodType>("card");
  const [label, setLabel] = useState("");
  const [last4, setLast4] = useState("");
  const [network, setNetwork] = useState("");
  const [expiryMonth, setExpiryMonth] = useState("");
  const [expiryYear, setExpiryYear] = useState("");
  const [error, setError] = useState<string | null>(null);

  const methodsQuery = useQuery({
    queryKey: ["methods"],
    queryFn: () => api.paymentMethods({ limit: 50 }),
  });

  const methods = useMemo(
    () => methodsQuery.data?.data ?? [],
    [methodsQuery.data],
  );

  const visible = useMemo(
    () =>
      filter === "all"
        ? methods
        : methods.filter((method) => method.type === filter),
    [filter, methods],
  );

  const activeCount = useMemo(
    () => methods.filter((method) => method.status === "active").length,
    [methods],
  );

  const cardCount = useMemo(
    () => methods.filter((method) => method.type === "card").length,
    [methods],
  );

  const activeCardCount = useMemo(
    () =>
      methods.filter(
        (method) => method.type === "card" && method.status === "active",
      ).length,
    [methods],
  );

  const createMutation = useMutation({
    mutationFn: (input: {
      type: PaymentMethodType;
      label: string;
      last4: string | null;
      network: string | null;
      expiry_month: number | null;
      expiry_year: number | null;
    }) => api.createPaymentMethod(input),
    onSuccess: async (method) => {
      toast.success("Instrument registered", {
        description: `${method.label} · ${TYPE_LABELS[method.type]}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["methods"] });
    },
    onError: (caught) => {
      const message =
        caught instanceof Error
          ? caught.message
          : "Could not register the instrument.";
      setError(message);
      toast.error("Registration failed", { description: message });
    },
  });

  const disableMutation = useMutation({
    mutationFn: (id: string) => api.disablePaymentMethod(id),
    onSuccess: async (method) => {
      toast.success("Instrument disabled", { description: method.label });
      await queryClient.invalidateQueries({ queryKey: ["methods"] });
    },
    onError: (caught) => {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "Could not disable the instrument.",
      );
    },
  });

  useEffect(() => {
    if (!createOpen) return;
    setType("card");
    setLabel("");
    setLast4("");
    setNetwork("");
    setExpiryMonth("");
    setExpiryYear("");
    setError(null);
  }, [createOpen]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!label.trim()) {
      setError("Give the instrument a label.");
      return;
    }
    if (last4 && !/^\d{4}$/.test(last4)) {
      setError("The last four digits must be exactly four numbers.");
      return;
    }
    const month = expiryMonth ? Number.parseInt(expiryMonth, 10) : null;
    const year = expiryYear ? Number.parseInt(expiryYear, 10) : null;
    if (month !== null && (Number.isNaN(month) || month < 1 || month > 12)) {
      setError("The expiry month must sit between 1 and 12.");
      return;
    }
    if (year !== null && (Number.isNaN(year) || year < 2000)) {
      setError("The expiry year must be a real year.");
      return;
    }

    setError(null);
    try {
      await createMutation.mutateAsync({
        type,
        label: label.trim(),
        last4: last4.trim() || null,
        network: network.trim() || null,
        expiry_month: month,
        expiry_year: year,
      });
      setCreateOpen(false);
    } catch {
      return;
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Chapter 07 · The instruments"
        title="Payment methods"
        description="Tokenized instruments. Only display metadata is kept — never a card number, never a CVV, never a secret worth stealing."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void methodsQuery.refetch()}
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  methodsQuery.isFetching && "animate-spin",
                )}
              />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New method
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={filter} onChange={setFilter} items={FILTERS} />
          <span className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground md:flex">
            <span className="h-3 w-px bg-border" />
            {methods.length} registered · {activeCount} active
          </span>
        </div>
        <p className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60 sm:block">
          {cardCount} cards · {activeCardCount} live
        </p>
      </div>

      <Card className="overflow-hidden">
        {methodsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : methodsQuery.isError ? (
          <div className="m-4 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
            <p className="font-medium">The instruments could not be loaded.</p>
            <p className="mt-1 opacity-80">
              {methodsQuery.error instanceof Error
                ? methodsQuery.error.message
                : "Unknown error."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void methodsQuery.refetch()}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            className="m-4 border-0"
            icon={<CreditCard className="size-4" />}
            title={
              filter === "all" ? "No instruments yet" : "Nothing of that kind"
            }
            description={
              filter === "all"
                ? "Register a card, UPI handle, bank account or wallet to start charging."
                : "Try another kind, or register a new instrument."
            }
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                New method
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow className="hover:bg-transparent">
                <TableHead>Instrument</TableHead>
                <TableHead className="hidden sm:table-cell">Type</TableHead>
                <TableHead className="hidden md:table-cell">Details</TableHead>
                <TableHead className="hidden sm:table-cell">Expiry</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Created
                </TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((method, index) => (
                <TableRow key={method.id}>
                  <TableCell>
                    <div className="flex items-start gap-3">
                      <span className="row-index mt-0.5 w-5 shrink-0 font-mono text-[9px] text-muted-foreground/30">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="max-w-[220px] truncate text-[12px] font-medium">
                          {method.label}
                        </p>
                        <IdText id={method.id} />
                        <div className="mt-1.5 sm:hidden">
                          <Badge
                            variant={
                              method.status === "active" ? "success" : "outline"
                            }
                          >
                            {method.status === "active" ? "Active" : "Disabled"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline">{TYPE_LABELS[method.type]}</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p className="font-mono text-[11px] tracking-[0.04em]">
                      {method.last4
                        ? `•••• ${method.last4}`
                        : (method.network ?? "—")}
                    </p>
                    {method.network && method.last4 ? (
                      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60">
                        {method.network}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden font-mono text-[10px] text-muted-foreground sm:table-cell">
                    {expiryOf(method)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge
                      variant={
                        method.status === "active" ? "success" : "outline"
                      }
                    >
                      {method.status === "active" ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
                      {relativeTime(method.created_at)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {method.status === "active" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="opacity-70 transition-opacity hover:opacity-100"
                        disabled={disableMutation.isPending}
                        onClick={() => void disableMutation.mutate(method.id)}
                        title="Disable this instrument"
                      >
                        <Ban className="size-3.5" />
                        <span className="hidden lg:inline">Disable</span>
                      </Button>
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-background/20 px-4 py-3 text-[10px] text-muted-foreground">
        <p className="inline-flex items-center gap-2">
          <Wallet className="size-3 text-primary" />
          Disabling an instrument keeps past payments intact.
        </p>
        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/60">
          Metadata only · no card data
        </p>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New payment method</DialogTitle>
            <DialogDescription>
              Registers a simulated instrument. The API stores only the label,
              the last four digits and the display network.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="method-type">Type</Label>
                <Select
                  id="method-type"
                  value={type}
                  onChange={(event) =>
                    setType(event.target.value as PaymentMethodType)
                  }
                >
                  <option value="card">Card</option>
                  <option value="upi">UPI</option>
                  <option value="bank">Bank</option>
                  <option value="wallet">Wallet</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="method-label">Label</Label>
                <Input
                  id="method-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Acme corporate card"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="method-last4">
                  Last four{type === "card" ? "" : " (optional)"}
                </Label>
                <Input
                  id="method-last4"
                  inputMode="numeric"
                  maxLength={4}
                  value={last4}
                  onChange={(event) =>
                    setLast4(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="4242"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="method-network">Network (optional)</Label>
                <Input
                  id="method-network"
                  value={network}
                  onChange={(event) => setNetwork(event.target.value)}
                  placeholder="visa"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="method-expiry-month">Expiry month</Label>
                <Input
                  id="method-expiry-month"
                  inputMode="numeric"
                  maxLength={2}
                  value={expiryMonth}
                  onChange={(event) =>
                    setExpiryMonth(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="09"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="method-expiry-year">Expiry year</Label>
                <Input
                  id="method-expiry-year"
                  inputMode="numeric"
                  maxLength={4}
                  value={expiryYear}
                  onChange={(event) =>
                    setExpiryYear(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="2031"
                  className="font-mono text-xs"
                />
              </div>
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
                onClick={() => setCreateOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <Spinner />
                ) : (
                  <Plus className="size-4" />
                )}
                Register instrument
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
