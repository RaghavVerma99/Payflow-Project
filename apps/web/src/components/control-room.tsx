import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Landmark,
  Radio,
  Scale,
  Wallet,
  Webhook,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatCurrency, relativeTime } from "../lib/utils";
import { StatusBadge } from "./status";
import {
  Badge,
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
          <span className="label-craft">The control room</span>
          <CardTitle className="mt-2 text-[22px]">Every subsystem</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Instruments, delivery, treasury, and claims — in one place.
          </p>
        </div>
        <Badge variant="outline">live</Badge>
      </CardHeader>

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
