import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Landmark,
  Radio,
  RotateCcw,
  Scale,
  Wallet,
  Webhook,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { formatCurrency, relativeTime } from "../lib/utils";
import { StatusBadge } from "./status";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "./ui";

interface Tile {
  key: string;
  label: string;
  value: string;
  detail: string;
  icon: typeof Wallet;
  to: string;
  tone: string;
}

export function ControlRoom() {
  const queryClient = useQueryClient();
  const jobsQuery = useQuery({
    queryKey: ["jobs", "dead"],
    queryFn: () => api.jobs({ limit: 8, status: "dead" }),
    refetchInterval: 5000,
  });
  const retryJobMutation = useMutation({
    mutationFn: api.retryJob,
    onSuccess: () => {
      toast.success("Job queued for retry.");
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Retry failed."),
  });
  const query = useQuery({
    queryKey: ["control-room"],
    queryFn: async () => {
      const [methods, endpoints, events, payouts, disputes] = await Promise.all(
        [
          api.paymentMethods({ limit: 50 }),
          api.webhookEndpoints(),
          api.webhookEvents({ limit: 6 }),
          api.payouts({ limit: 50 }),
          api.disputes({ limit: 50 }),
        ],
      );
      return { methods, endpoints, events, payouts, disputes };
    },
    refetchInterval: 8000,
  });

  const data = query.data;

  const activeMethods =
    data?.methods.data.filter((method) => method.status === "active").length ??
    0;
  const activeEndpoints =
    data?.endpoints.data.filter((endpoint) => endpoint.status === "active")
      .length ?? 0;
  const events = data?.events.data ?? [];
  const delivered = events.filter(
    (event) => event.status === "delivered",
  ).length;
  const paidOut = (data?.payouts.data ?? [])
    .filter((payout) => payout.status === "paid")
    .reduce((sum, payout) => sum + payout.amount_minor, 0);
  const openDisputes =
    data?.disputes.data.filter((dispute) => dispute.status === "open").length ??
    0;

  const tiles: Tile[] = [
    {
      key: "methods",
      label: "Instruments",
      value: String(activeMethods),
      detail: "active payment methods",
      icon: Wallet,
      to: "/methods",
      tone: "text-primary",
    },
    {
      key: "endpoints",
      label: "Endpoints",
      value: String(activeEndpoints),
      detail: "webhook targets",
      icon: Webhook,
      to: "/webhooks",
      tone: "text-sky-500",
    },
    {
      key: "deliveries",
      label: "Deliveries",
      value: `${delivered}/${events.length}`,
      detail: "recent events delivered",
      icon: Radio,
      to: "/webhooks",
      tone: "text-emerald-500",
    },
    {
      key: "payouts",
      label: "Paid out",
      value: formatCurrency(paidOut),
      detail: "settled to the bank",
      icon: Landmark,
      to: "/treasury",
      tone: "text-violet-500",
    },
    {
      key: "disputes",
      label: "Disputes",
      value: String(openDisputes),
      detail: "open claims",
      icon: Scale,
      to: "/treasury",
      tone: "text-amber-500",
    },
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <span className="label-craft">Operations</span>
          <CardTitle className="mt-2 text-[22px]">System activity</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Instruments, delivery, treasury, and claims — in one place.
          </p>
        </div>
        <Badge variant="outline">live</Badge>
      </CardHeader>

      {jobsQuery.data ? (
        <div className="grid grid-cols-2 gap-2 px-5 pt-4 sm:grid-cols-4">
          {([
            ["Queued", jobsQuery.data.summary.by_status.pending ?? 0],
            ["Retrying", jobsQuery.data.summary.by_status.retrying ?? 0],
            ["Running", jobsQuery.data.summary.by_status.running ?? 0],
            ["Dead letters", jobsQuery.data.summary.by_status.dead ?? 0],
          ] as const).map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-background/50 px-3 py-2.5"
            >
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p
                className={`mt-1 text-lg font-semibold tabular-nums ${
                  label === "Dead letters" && value > 0
                    ? "text-destructive"
                    : ""
                }`}
              >
                {value}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {jobsQuery.data ? (
        <div className="px-5 pt-3">
          <p className="text-[10px] text-muted-foreground">
            Oldest active job:{" "}
            {ageLabel(jobsQuery.data.summary.oldest_active_age_seconds)}
          </p>
          {jobsQuery.data.data.length > 0 ? (
            <div className="mt-3 divide-y divide-border rounded-lg border border-border">
              {jobsQuery.data.data.map((job) => (
                <div
                  key={job.id}
                  className="flex flex-wrap items-center gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium">
                      {job.kind.replaceAll("_", " ")}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {job.last_error ?? "Retry budget exhausted"}
                    </p>
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {job.attempts}/{job.max_attempts} attempts
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retryJobMutation.isPending}
                    onClick={() => retryJobMutation.mutate(job.id)}
                  >
                    <RotateCcw className="size-3" />
                    Retry
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <CardContent className="pt-5">
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-7">
            {query.isLoading ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-[104px] rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {tiles.map((tile) => {
                  const Icon = tile.icon;
                  return (
                    <Link
                      key={tile.key}
                      to={tile.to}
                      className="group relative overflow-hidden rounded-xl border border-border/70 bg-background/25 p-3.5 transition-colors hover:border-primary/30 hover:bg-primary/[0.04]"
                    >
                      <div className="flex items-center justify-between">
                        <Icon className={`size-3.5 ${tile.tone}`} />
                        <ArrowUpRight className="size-3 text-muted-foreground/30 transition-colors group-hover:text-primary/70" />
                      </div>
                      <p className="display mt-3 text-[24px] leading-none">
                        {tile.value}
                      </p>
                      <p className="mt-1.5 text-[10px] font-medium text-foreground">
                        {tile.label}
                      </p>
                      <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                        {tile.detail}
                      </p>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="xl:col-span-5">
            <p className="label-craft mb-2">Recent deliveries</p>
            <div className="divide-y divide-border/60 rounded-xl border border-border/70">
              {events.length === 0 ? (
                <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
                  No events yet. Every state change will be announced here.
                </p>
              ) : (
                events.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/70">
                      {event.type.replace(/[._]/g, " ")}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground/50">
                      {relativeTime(event.created_at)}
                    </span>
                    <StatusBadge
                      status={event.status}
                      kind="webhook"
                      className="scale-90"
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ageLabel(ageSeconds: number | null): string {
  if (ageSeconds === null) return "none";
  if (ageSeconds < 60) return `${ageSeconds}s`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
  const hours = Math.floor(ageSeconds / 3600);
  return `${hours}h ${Math.floor((ageSeconds % 3600) / 60)}m`;
}
