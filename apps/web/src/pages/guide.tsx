import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  GitBranch,
  KeyRound,
  Layers,
  Monitor,
  Radio,
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
  CopyButton,
} from "../components/ui";
import { api } from "../lib/api";
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
  {
    icon: Radio,
    title: "Transactional outbox",
    body: "Events are written with the business change, then delivered. A delivery can never be lost, and never precedes the change it describes.",
  },
  {
    icon: Layers,
    title: "Derived balances",
    body: "Balances are computed from journal entries, never stored. A payout is checked against that balance inside the writing transaction.",
  },
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

const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody: string, header: string, secret: string) {
  const parts = Object.fromEntries(
    header.split(",").map((pair) => pair.split("=") as [string, string]),
  );
  const timestamp = parts.t;
  const expected = createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest("hex");

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}`;

const QUICKSTART = `KEY=sk_test_...

curl -s -X POST localhost:4000/v1/payments \\
  -H "Authorization: Bearer $KEY" \\
  -H "Idempotency-Key: order_1042_attempt_1" \\
  -H "Content-Type: application/json" \\
  -d '{"amount_minor":24900,"currency":"INR","simulator_scenario":"approve"}'

# 202 Accepted, status "created" — poll for the settled state
curl -s localhost:4000/v1/payments/pay_... -H "Authorization: Bearer $KEY"`;

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

function Connector() {
  return (
    <div className="flex items-center justify-center py-1 lg:py-0">
      <ArrowRight className="size-3.5 rotate-90 text-muted-foreground/40 lg:rotate-0" />
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

export function GuidePage() {
  const capabilitiesQuery = useQuery({
    queryKey: ["capabilities"],
    queryFn: api.capabilities,
    staleTime: 60_000,
  });

  const capabilities = capabilitiesQuery.data;

  return (
    <div>
      <PageHeader
        eyebrow="Chapter 06 · The contract"
        title="Architecture & API"
        description="How a request becomes a settled payment, a refund, and a balanced journal — including the failure paths most systems hide."
        actions={
          <>
            <Badge variant="outline" className="gap-1">
              <Layers className="size-3" />
              TypeScript
            </Badge>
            <Badge variant="outline" className="gap-1">
              OpenAPI {capabilities?.api_version ?? "3.1"}
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
                icon={Layers}
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
                  Live contract
                </CardTitle>
              </div>
              <Badge variant="outline">
                {capabilities?.api_version ?? "—"}
              </Badge>
            </CardHeader>
            <div className="divide-y divide-border/60">
              {(capabilities?.resources ?? []).map((resource) => (
                <div key={resource.name} className="px-5 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-mono text-[10px] font-semibold text-primary">
                      {resource.name}
                    </p>
                    <p className="truncate text-right text-[10px] text-muted-foreground">
                      {resource.summary}
                    </p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {resource.endpoints.map((endpoint) => (
                      <span
                        key={endpoint}
                        className="rounded border border-border/70 bg-muted/20 px-1.5 py-0.5 font-mono text-[8.5px] text-muted-foreground"
                      >
                        {endpoint}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {capabilities ? null : (
                <p className="px-5 py-6 text-center text-[11px] text-muted-foreground">
                  Reading the capabilities document…
                </p>
              )}
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
              <CardContent className="pt-4">
                <div className="divide-y divide-border/60">
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
              </CardContent>
            </Card>
          </Reveal>

          <Reveal delay={120}>
            <Card>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <span className="label-craft">The local ritual</span>
                  <CardTitle className="mt-2 text-[22px]">
                    Run locally
                  </CardTitle>
                </div>
                <CopyButton value={`npm install\nnpm run seed\nnpm run dev`} />
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

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Reveal>
          <Card className="h-full">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <span className="label-craft">The handshake</span>
                <CardTitle className="mt-2 text-[22px]">
                  First three calls
                </CardTitle>
              </div>
              <CopyButton value={QUICKSTART} />
            </CardHeader>
            <CardContent className="pt-4">
              <Code>{QUICKSTART}</Code>
            </CardContent>
          </Card>
        </Reveal>

        <Reveal delay={70}>
          <Card className="h-full">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <span className="label-craft">The signature</span>
                <CardTitle className="mt-2 text-[22px]">
                  Verify a delivery
                </CardTitle>
              </div>
              <CopyButton value={VERIFY_SNIPPET} />
            </CardHeader>
            <CardContent className="pt-4">
              <Code>{VERIFY_SNIPPET}</Code>
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                Header format:{" "}
                <span className="font-mono text-foreground">
                  {capabilities?.webhooks.signature_header ??
                    "x-payflow-signature"}
                </span>{" "}
                —{" "}
                {capabilities?.webhooks.signature_scheme ??
                  "t=<unix-seconds>,v1=hmac_sha256(secret, `<timestamp>.<body>`)"}
                .
              </p>
            </CardContent>
          </Card>
        </Reveal>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Reveal>
          <Card className="h-full">
            <CardHeader>
              <span className="label-craft">The announcements</span>
              <CardTitle className="mt-2 text-[22px]">
                Event catalogue
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Emitted from the same transaction as the business change.
              </p>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-1.5">
                {(capabilities?.webhooks.event_types ?? []).map((event) => (
                  <span
                    key={event}
                    className="rounded-full border border-primary/20 bg-primary/[0.06] px-2.5 py-1 font-mono text-[9px] text-primary"
                  >
                    {event}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </Reveal>

        <Reveal delay={70}>
          <Card className="h-full">
            <CardHeader>
              <span className="label-craft">The refusals</span>
              <CardTitle className="mt-2 text-[22px]">
                Error catalogue
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Stable codes behind one envelope, safe to branch on.
              </p>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-1.5">
                {(capabilities?.error_codes ?? []).map((code) => (
                  <span
                    key={code}
                    className="rounded-md border border-border/70 bg-muted/20 px-2 py-1 font-mono text-[9px] text-muted-foreground"
                  >
                    {code}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </Reveal>
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
