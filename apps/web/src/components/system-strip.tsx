import { useQuery } from "@tanstack/react-query";
import { Activity, Radio, ServerCog } from "lucide-react";
import { api } from "../lib/api";
import { relativeTime } from "../lib/utils";

export function SystemStrip() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await fetch("/health");
      if (!response.ok) throw new Error("health unavailable");
      return (await response.json()) as {
        status: string;
        version: string;
        environment: string;
        checks: { database: string; worker: string };
        queue_depth: number;
      };
    },
    refetchInterval: 5000,
    staleTime: 4000,
  });

  const eventsQuery = useQuery({
    queryKey: ["webhook_events", "strip"],
    queryFn: () => api.webhookEvents({ limit: 1 }),
    refetchInterval: 5000,
    staleTime: 4000,
  });

  const health = healthQuery.data;
  const lastEvent = eventsQuery.data?.data?.[0];

  return (
    <div className="relative z-10 border-b border-border/50 bg-background/25 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-[1480px] items-center gap-4 overflow-x-auto px-4 py-1.5 sm:px-6 lg:px-9">
        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">
          <ServerCog className="size-3" />
          system
        </span>

        <span className="h-3 w-px bg-border" />

        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          <span
            className={`size-1.5 rounded-full ${
              health?.checks.worker === "enabled"
                ? "bg-emerald-500"
                : "bg-amber-500"
            }`}
          />
          worker {health?.checks.worker ?? "…"}
        </span>

        <span className="hidden items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground sm:flex">
          <Activity className="size-3" />
          queue {health?.queue_depth ?? "…"}
        </span>

        <span className="hidden items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground md:flex">
          <Radio className="size-3" />
          {lastEvent ? (
            <>
              {lastEvent.type.replace(/[._]/g, " ")}{" "}
              <span className="text-muted-foreground/60">
                {relativeTime(lastEvent.created_at)}
              </span>
            </>
          ) : (
            "no events"
          )}
        </span>

        <span className="ml-auto hidden font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60 lg:block">
          api v{health?.version ?? "…"} · {health?.environment ?? "…"}
        </span>
      </div>
    </div>
  );
}
