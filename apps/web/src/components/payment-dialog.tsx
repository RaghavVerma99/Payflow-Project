import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Copy, KeyRound, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api, type Payment, type Scenario } from "../lib/api";
import { formatCurrency, makeIdempotencyKey, shortId } from "../lib/utils";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Spinner,
} from "./ui";

interface NewPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (payment: Payment) => void;
}

const SCENARIOS: Array<{
  value: Scenario;
  label: string;
  description: string;
}> = [
  {
    value: "approve",
    label: "Approve",
    description: "Processor approves on the first attempt.",
  },
  {
    value: "decline",
    label: "Decline",
    description: "Processor returns a terminal card_declined.",
  },
  {
    value: "timeout",
    label: "Timeout",
    description: "Outcome is unknown; a reconciliation job resolves it.",
  },
  {
    value: "transient",
    label: "Transient error",
    description: "First attempt fails; the job retries and succeeds.",
  },
  {
    value: "auto",
    label: "Automatic",
    description: "Deterministic outcome derived from the reference.",
  },
];

export function NewPaymentDialog({
  open,
  onOpenChange,
  onCreated,
}: NewPaymentDialogProps) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("120.00");
  const [customerId, setCustomerId] = useState("");
  const [description, setDescription] = useState("");
  const [scenario, setScenario] = useState<Scenario>("approve");
  const [idempotencyKey, setIdempotencyKey] = useState(makeIdempotencyKey);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount("120.00");
    setCustomerId("");
    setDescription("");
    setScenario("approve");
    setIdempotencyKey(makeIdempotencyKey());
    setError(null);
    setPending(false);
  }, [open]);

  const amountMinor = Math.round(Number.parseFloat(amount) * 100);
  const validAmount = Number.isFinite(amountMinor) && amountMinor > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validAmount) {
      setError("Enter an amount greater than zero.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const payment = await api.createPayment(
        {
          amount_minor: amountMinor,
          customer_id: customerId.trim() || null,
          description: description.trim() || null,
          simulator_scenario: scenario,
        },
        idempotencyKey,
      );

      toast.success("Payment accepted", {
        description: `${formatCurrency(payment.amount_minor)} · ${shortId(payment.id)}`,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payments"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["timeseries"] }),
      ]);

      onOpenChange(false);
      onCreated?.(payment);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create payment.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New payment</DialogTitle>
          <DialogDescription>
            Creates a payment in <span className="font-mono">created</span>{" "}
            state and enqueues it for the worker. The API responds with 202.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  ₹
                </span>
                <Input
                  id="amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="pl-7 tabular text-base font-medium"
                  placeholder="120.00"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Sent as{" "}
                <span className="font-mono">
                  {validAmount ? amountMinor : "—"} minor units
                </span>
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency"
                value="INR"
                readOnly
                className="bg-muted/40"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="customer">Customer ID (optional)</Label>
              <Input
                id="customer"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                placeholder="cus_1042"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Order #1042"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="scenario">Simulator scenario</Label>
            <Select
              id="scenario"
              value={scenario}
              onChange={(event) => setScenario(event.target.value as Scenario)}
            >
              {SCENARIOS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
            <p className="text-[10px] text-muted-foreground">
              {SCENARIOS.find((item) => item.value === scenario)?.description}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium">
                <KeyRound className="size-3.5 text-emerald-500" />
                Idempotency-Key
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Regenerate"
                  onClick={() => setIdempotencyKey(makeIdempotencyKey())}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Copy"
                  onClick={() => {
                    void navigator.clipboard.writeText(idempotencyKey);
                    toast.success("Idempotency key copied");
                  }}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
            <Input
              value={idempotencyKey}
              onChange={(event) => setIdempotencyKey(event.target.value)}
              className="mt-2 h-8 border-0 bg-background/70 font-mono text-[11px] focus-visible:ring-1"
              spellCheck={false}
            />
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Reusing this key with the same body replays the original request.
            </p>
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
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !validAmount}>
              {pending ? <Spinner /> : <Sparkles className="size-4" />}
              Create payment
              <ArrowRight className="size-4 opacity-60" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
