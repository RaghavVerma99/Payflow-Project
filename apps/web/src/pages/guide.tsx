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
  Terminal,
  Workflow,
} from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/layout";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui";

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
}: {
  icon: typeof Server;
  title: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3"
          : "rounded-xl border border-border bg-muted/20 p-3"
      }
    >
      <div className="flex items-center gap-2">
        <Icon
          className={
            accent ? "size-4 text-emerald-500" : "size-4 text-muted-foreground"
          }
        />
        <p className="text-xs font-semibold">{title}</p>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
      {children}
    </pre>
  );
}

export function GuidePage() {
  return (
    <div>
      <PageHeader
        eyebrow="Under the hood"
        title="Architecture"
        description="How a request becomes a settled payment, a refund, and a balanced journal — including the failure paths."
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

      <Card>
        <CardHeader>
          <CardTitle>System map</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            One process serves the console and API; the worker loop shares the
            same database and can also run separately.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 pt-4">
          <div className="grid items-center gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <Box
              icon={Monitor}
              title="Operations console"
              detail="React · TanStack Query · Recharts"
            />
            <ArrowRight className="mx-auto hidden size-4 text-muted-foreground lg:block" />
            <Box
              icon={Server}
              title="Fastify API"
              detail="Zod contracts · bearer auth · OpenAPI"
              accent
            />
            <ArrowRight className="mx-auto hidden size-4 text-muted-foreground lg:block" />
            <Box
              icon={Database}
              title="SQLite WAL"
              detail="Payments · jobs · ledger · idempotency"
            />
          </div>

          <div className="flex justify-center">
            <ArrowRight className="size-4 rotate-90 text-muted-foreground" />
          </div>

          <div className="grid items-center gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <Box
              icon={Workflow}
              title="Job queue"
              detail="Leases · backoff · dead-letter"
              accent
            />
            <ArrowRight className="mx-auto hidden size-4 text-muted-foreground lg:block" />
            <Box
              icon={Terminal}
              title="Worker loop"
              detail="Claims jobs · executes · retries"
            />
            <ArrowRight className="mx-auto hidden size-4 text-muted-foreground lg:block" />
            <Box
              icon={BookOpen}
              title="Ledger"
              detail="Balanced journals · immutable entries"
            />
          </div>
        </CardContent>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
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
              <div key={step} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/10 font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {step}
                </span>
                <div>
                  <p className="text-xs font-medium">{title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invariants</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              The properties the demo is built to preserve
            </p>
          </CardHeader>
          <CardContent className="grid gap-2 pt-4 sm:grid-cols-2">
            {INVARIANTS.map((invariant) => (
              <div
                key={invariant.title}
                className="rounded-lg border border-border bg-muted/20 p-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <invariant.icon className="size-3.5 text-emerald-500" />
                  <p className="text-[11px] font-medium">{invariant.title}</p>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  {invariant.body}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>API surface</CardTitle>
          </CardHeader>
          <div className="mt-3 divide-y divide-border">
            {ENDPOINTS.map(([method, path, purpose]) => (
              <div
                key={`${method}-${path}`}
                className="grid grid-cols-[44px_1fr] gap-2 px-5 py-2 sm:grid-cols-[44px_190px_1fr]"
              >
                <span className="font-mono text-[10px] font-semibold text-emerald-500">
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
          <div className="border-t border-border p-3">
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 hover:underline dark:text-emerald-400"
            >
              Open the full OpenAPI reference
              <ExternalLink className="size-3" />
            </a>
          </div>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Simulator scenarios</CardTitle>
            </CardHeader>
            <div className="mt-3 divide-y divide-border">
              {SCENARIOS.map(([name, behaviour, result]) => (
                <div key={name} className="px-5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-foreground">
                      {name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {behaviour}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                    {result}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Run locally</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <Code>{`npm install
npm run seed
npm run dev`}</Code>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                <CheckCircle2 className="size-3 text-emerald-500" />
                API on :4000 · console on :5173 · docs at /docs
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-4 py-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-emerald-500" />
          Simulation only. No card data is accepted and no money moves.
        </span>
        <div className="flex items-center gap-4">
          <Link to="/playground" className="hover:text-foreground">
            Try the playground
          </Link>
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            API reference
          </a>
        </div>
      </div>
    </div>
  );
}
