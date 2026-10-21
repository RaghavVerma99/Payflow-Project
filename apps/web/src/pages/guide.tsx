import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  GitBranch,
  KeyRound,
  Layers,
  Monitor,
  RotateCcw,
  Scale,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
} from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/layout";
import { Reveal } from "../components/motion";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui";
import { cn } from "../lib/utils";

const INVARIANTS = [
  {
    icon: KeyRound,
    title: "Idempotent writes",
    body: "The idempotency record, payment and job are written in one transaction. Replays return the resource with Idempotency-Replayed; changed bodies return 409.",
  },
  {
    icon: GitBranch,
    title: "Legal transitions only",
    body: "created → processing → succeeded | failed | unknown. Refund states are separate. Every transition is guarded and emits an event.",
  },
  {
    icon: RotateCcw,
    title: "Bounded refunds",
    body: "Capacity is reserved with one conditional UPDATE. Concurrent refunds cannot exceed the payment amount, even across processes.",
  },
  {
    icon: Scale,
    title: "Balanced books",
    body: "Each capture debits processor clearing and credits merchant payable. Refunds reverse the entry. Debits always equal credits.",
  },
  {
    icon: Clock3,
    title: "Timeouts are unknown",
    body: "A processor timeout is never treated as a decline. A reconciliation job calls lookup() and settles the real outcome.",
  },
  {
    icon: ShieldCheck,
    title: "Immutable ledger",
    body: "SQLite triggers reject UPDATE and DELETE on posted entries and posted transactions. Corrections require new journals.",
  },
];

const ENDPOINTS = [
  ["POST", "/v1/payments", "Create a payment and enqueue processing"],
  ["GET", "/v1/payments", "Cursor-paginated list with status filter"],
  ["GET", "/v1/payments/:id", "Payment, attempts and event timeline"],
  ["POST", "/v1/payments/:id/cancel", "Cancel before the worker claims it"],
  ["POST", "/v1/refunds", "Reserve capacity and enqueue a refund"],
  ["GET", "/v1/refunds", "List refunds by status or payment"],
  ["GET", "/v1/accounts", "Account balances and trial balance"],
  ["GET", "/v1/ledger/journals", "Posted double-entry journals"],
  ["GET", "/v1/stats/overview", "Dashboard aggregates"],
  ["GET", "/v1/stats/timeseries", "Daily volume for charts"],
];

const SCENARIOS = [
  [
    "approve",
    "Succeeds on the first attempt",
    "Payment settles, journal posts",
  ],
  ["decline", "Terminal card_declined", "Payment fails, no journal"],
  ["timeout", "Outcome unknown", "Reconcile job resolves via lookup()"],
  [
    "transient",
    "First attempt errors",
    "Retry succeeds, two attempts recorded",
  ],
  ["auto", "Deterministic hash", "Mixed outcomes for realistic demos"],
];

function Box({
  icon: Icon,
  title,
  detail,
  accent,
  index,
}: {
  icon: typeof Server;
  title: string;
  detail: string;
  accent?: boolean;
  index: string;
}) {
  return (
    <div
      className={cn(
        "group rounded-xl border p-3.5 transition-colors",
        accent
          ? "border-primary/30 bg-primary/[0.055]"
          : "border-border/80 bg-background/20 hover:border-primary/20",
      )}
    >
      <div className="flex items-start justify-between">
        <div
          className={cn(
            "flex size-7 items-center justify-center rounded-lg border",
            accent
              ? "border-primary/25 bg-primary/10 text-primary"
              : "border-border bg-muted/30 text-muted-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </div>
        <span className="font-mono text-[8px] tracking-[0.1em] text-muted-foreground/40">
          {index}
        </span>
      </div>
      <p className="display-soft mt-3 text-[15px] leading-none">{title}</p>
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="code-surface overflow-x-auto rounded-xl p-4 font-mono text-[11px] leading-relaxed text-[#d9cfbf]">
      {children}
    </pre>
  );
}

function Connector() {
  return (
    <div className="flex items-center justify-center py-1 lg:py-0">
      <ArrowRight className="size-3.5 rotate-90 text-muted-foreground/40 lg:rotate-0" />
    </div>
  );
}

export function GuidePage() {
  return (
    <div>
      <PageHeader
        eyebrow="Chapter 06 · The craft"
        title="Architecture"
        description="How a request becomes a settled payment, a refund, and a balanced journal — including the failure paths most systems hide."
        actions={
          <>
            <Badge variant="outline" className="gap-1">
              <Layers className="size-3" />
              TypeScript
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Database className="size-3" />
              SQLite WAL
            </Badge>
          </>
        }
      />

      <Reveal>
        <Card className="art-card-glow relative mb-3 overflow-hidden rounded-[26px]">
          <div className="pointer-events-none absolute -right-24 -top-28 size-80 animate-spin-slow rounded-full border border-dashed border-primary/15" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-grid opacity-20 [mask-image:linear-gradient(to_left,black,transparent)]" />
          <CardContent className="relative grid gap-6 p-7 sm:grid-cols-[1fr_auto] sm:items-center sm:p-9">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-primary" />
                <span className="label-craft">A design note</span>
              </div>
              <p className="display mt-4 max-w-2xl text-[30px] leading-[1.02] sm:text-[38px]">
                No real money.
                <br />
                <span className="italic text-primary">Real invariants.</span>
              </p>
              <p className="mt-4 max-w-lg text-[12px] leading-relaxed text-muted-foreground">
                A production-shaped payment processor, small enough to hold in
                your head. The simulator is nominal; the concurrency, retries
                and accounting are not.
              </p>
            </div>
            <div className="relative hidden size-28 shrink-0 items-center justify-center rounded-full border border-primary/25 sm:flex">
              <div className="absolute inset-2 rounded-full border border-dashed border-primary/20" />
              <div className="text-center">
                <p className="font-mono text-[7px] uppercase tracking-[0.22em] text-muted-foreground">
                  Edition
                </p>
                <p className="display mt-1 text-[30px] leading-none text-primary">
                  001
                </p>
                <p className="mt-1 font-mono text-[7px] uppercase tracking-[0.18em] text-muted-foreground">
                  Simulated
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </Reveal>

      <Reveal>
        <Card>
          <CardHeader>
            <span className="label-craft">The machine</span>
            <CardTitle className="mt-2 text-[22px]">System map</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              One process serves the console and API; the worker loop shares the
              same database and can also run separately.
            </p>
          </CardHeader>
          <CardContent className="space-y-1 pt-4">
            <div className="grid items-center gap-1.5 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
              <Box
                icon={Monitor}
                title="Operations console"
                detail="React · TanStack Query · Recharts"
                index="01"
              />
              <Connector />
              <Box
                icon={Server}
                title="Fastify API"
                detail="Zod contracts · bearer auth · OpenAPI"
                accent
                index="02"
              />
              <Connector />
              <Box
                icon={Database}
                title="SQLite WAL"
                detail="Payments · jobs · ledger · idempotency"
                index="03"
              />
            </div>

            <Connector />

            <div className="grid items-center gap-1.5 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
              <Box
                icon={Workflow}
                title="Job queue"
                detail="Leases · backoff · dead-letter"
                accent
                index="04"
              />
              <Connector />
              <Box
                icon={Terminal}
                title="Worker loop"
                detail="Claims jobs · executes · retries"
                index="05"
              />
              <Connector />
              <Box
                icon={BookOpen}
                title="Ledger"
                detail="Balanced journals · immutable entries"
                index="06"
              />
            </div>
          </CardContent>
        </Card>
      </Reveal>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Reveal>
          <Card className="h-full">
            <CardHeader>
              <span className="label-craft">The passage</span>
              <CardTitle className="mt-2 text-[22px]">
                Request lifecycle
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="relative space-y-5 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-border">
                {[
                  [
                    "01",
                    "Authenticate and validate",
                    "The bearer key is hashed and matched with timing-safe comparison. Zod validates the body before any write.",
                  ],
                  [
                    "02",
                    "Create and enqueue",
                    "A single IMMEDIATE transaction writes the payment, the created event, the idempotency record and the process_payment job.",
                  ],
                  [
                    "03",
                    "Claim and process",
                    "The worker leases a due job, records an attempt, calls the deterministic simulator, and applies the outcome.",
                  ],
                  [
                    "04",
                    "Settle and reconcile",
                    "Success posts a journal. Timeout schedules reconciliation. Transient errors retry with exponential backoff.",
                  ],
                ].map(([step, title, body]) => (
                  <div key={step} className="relative flex gap-3.5">
                    <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-background font-mono text-[9px] font-semibold text-primary">
                      {step}
                    </span>
                    <div>
                      <p className="text-[12px] font-medium">{title}</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                        {body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </Reveal>

        <Reveal delay={70}>
          <Card className="h-full">
            <CardHeader>
              <span className="label-craft">The promises</span>
              <CardTitle className="mt-2 text-[22px]">Invariants</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                The properties the demo is built to preserve.
              </p>
            </CardHeader>
            <CardContent className="grid gap-2 pt-4 sm:grid-cols-2">
              {INVARIANTS.map((invariant) => (
                <div
                  key={invariant.title}
                  className="group rounded-xl border border-border/70 bg-background/20 p-3 transition-colors hover:border-primary/25 hover:bg-primary/[0.025]"
                >
                  <div className="flex items-center gap-2">
                    <invariant.icon className="size-3.5 text-primary" />
                    <p className="text-[11px] font-medium">{invariant.title}</p>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                    {invariant.body}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </Reveal>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Reveal>
          <Card className="h-full overflow-hidden">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <span className="label-craft">The surface</span>
                <CardTitle className="mt-2 text-[22px]">
                  API endpoints
                </CardTitle>
              </div>
              <Badge variant="outline">{ENDPOINTS.length}</Badge>
            </CardHeader>
            <div className="mt-4 divide-y divide-border/60">
              {ENDPOINTS.map(([method, path, purpose]) => (
                <div
                  key={`${method}-${path}`}
                  className="row-craft grid grid-cols-[42px_1fr] gap-2 px-5 py-2.5 sm:grid-cols-[42px_190px_1fr]"
                >
                  <span className="font-mono text-[9px] font-semibold text-primary">
                    {method}
                  </span>
                  <span className="font-mono text-[10px] text-foreground">
                    {path}
                  </span>
                  <span className="col-span-2 text-[10px] text-muted-foreground sm:col-span-1">
                    {purpose}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-border/70 p-4">
              <a
                href="/docs"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline"
              >
                Open the full OpenAPI reference
                <ExternalLink className="size-3" />
              </a>
            </div>
          </Card>
        </Reveal>

        <div className="space-y-3">
          <Reveal delay={70}>
            <Card>
              <CardHeader>
                <span className="label-craft">The weather</span>
                <CardTitle className="mt-2 text-[22px]">
                  Simulator scenarios
                </CardTitle>
              </CardHeader>
              <div className="mt-4 divide-y divide-border/60">
                {SCENARIOS.map(([name, behaviour, result], index) => (
                  <div key={name} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[8px] text-muted-foreground/35">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="rounded-full border border-primary/20 bg-primary/[0.06] px-2 py-0.5 font-mono text-[9px] text-primary">
                          {name}
                        </span>
                      </div>
                      <span className="text-right text-[10px] text-muted-foreground">
                        {behaviour}
                      </span>
                    </div>
                    <p className="mt-1 pl-6 text-[10px] text-muted-foreground/70">
                      {result}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </Reveal>

          <Reveal delay={120}>
            <Card>
              <CardHeader>
                <span className="label-craft">The local ritual</span>
                <CardTitle className="mt-2 text-[22px]">Run locally</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <Code>{`npm install
npm run seed
npm run dev`}</Code>
                <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <CheckCircle2 className="size-3 text-emerald-500" />
                  API on :4000 · console on :5173 · docs at /docs
                </div>
              </CardContent>
            </Card>
          </Reveal>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-background/20 px-4 py-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-3.5 text-emerald-500" />
          Simulation only. No card data is accepted and no money moves.
        </span>
        <div className="flex items-center gap-4">
          <Link
            to="/playground"
            className="underline-craft transition-colors hover:text-foreground"
          >
            Try the playground
          </Link>
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            className="underline-craft transition-colors hover:text-foreground"
          >
            API reference
          </a>
        </div>
      </div>
    </div>
  );
}
