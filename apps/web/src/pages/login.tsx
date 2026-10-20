import {
  ArrowRight,
  CheckCircle2,
  Code2,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Logo } from "../components/layout";
import { Button, Input, Label, Separator } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

const FEATURES = [
  {
    icon: KeyRound,
    title: "Idempotent by design",
    description:
      "Retries replay the original resource; conflicts are rejected.",
  },
  {
    icon: ShieldCheck,
    title: "Explicit state machine",
    description: "Every status change is checked and written to an event log.",
  },
  {
    icon: Code2,
    title: "Double-entry ledger",
    description: "Payments and refunds post balanced, immutable journals.",
  },
];

export function LoginPage() {
  const { login, demoLogin } = useAuth();
  const [key, setKey] = useState("");
  const [pending, setPending] = useState<"demo" | "key" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const run = async (mode: "demo" | "key") => {
    setError(null);
    setHint(null);
    setPending(mode);
    try {
      if (mode === "demo") {
        await demoLogin();
      } else {
        await login(key);
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        if (caught.code === "demo_not_seeded") {
          setHint("npm run seed");
        } else if (caught.status === 0) {
          setHint("npm run dev");
        }
      } else {
        setError(caught instanceof Error ? caught.message : "Sign in failed.");
      }
    } finally {
      setPending(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run("key");
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-70" />
      <div className="pointer-events-none absolute -left-40 top-[-12rem] size-[36rem] rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 bottom-[-18rem] size-[40rem] rounded-full bg-teal-500/10 blur-3xl" />

      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Terminal className="size-3.5" />
          API reference
        </a>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-5 py-8 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <section className="animate-fade-up hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">
            <Sparkles className="size-3" />
            Payment infrastructure, simulated
          </div>

          <h1 className="mt-6 max-w-xl text-5xl font-semibold leading-[1.05] tracking-tight">
            Operate payments
            <br />
            like an <span className="text-gradient">engineer.</span>
          </h1>

          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            A production-shaped payment processor you can run locally.
            Idempotent APIs, a durable worker with retries, refund capacity
            under contention, and a ledger that always balances.
          </p>

          <div className="mt-8 space-y-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex items-start gap-3">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-emerald-500">
                  <feature.icon className="size-3.5" />
                </div>
                <div>
                  <p className="text-sm font-medium">{feature.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Zap className="size-3 text-emerald-500" />
              Fastify + TypeScript
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Code2 className="size-3 text-emerald-500" />
              React + Tailwind
            </span>
            <span className="inline-flex items-center gap-1.5">
              <LockKeyhole className="size-3 text-emerald-500" />
              Local SQLite
            </span>
          </div>
        </section>

        <section className="animate-fade-up mx-auto w-full max-w-md">
          <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-8">
            <div className="mb-6">
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-border bg-muted/50 text-emerald-500 lg:hidden">
                <Zap className="size-5" fill="currentColor" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight">
                Open the console
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in with a seeded merchant key, or start with the demo
                workspace.
              </p>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={pending !== null}
              onClick={() => void run("demo")}
            >
              {pending === "demo" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Enter demo workspace
              <ArrowRight className="ml-auto size-4 opacity-60" />
            </Button>

            <div className="my-5 flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                or use an API key
              </span>
              <Separator className="flex-1" />
            </div>

            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="api-key">Merchant API key</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="api-key"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    placeholder="sk_test_..."
                    autoComplete="off"
                    spellCheck={false}
                    className="pl-9 font-mono text-xs"
                  />
                </div>
              </div>

              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={pending !== null || key.trim().length === 0}
              >
                {pending === "key" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                Connect with key
              </Button>
            </form>

            {error ? (
              <div className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
                <p>{error}</p>
                {hint ? (
                  <code className="mt-1.5 inline-block rounded bg-black/20 px-2 py-1 font-mono text-[11px]">
                    {hint}
                  </code>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-[11px] font-medium">First run?</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Seed a merchant, demo history and credentials:
              </p>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1.5">
                <code className="font-mono text-[11px]">npm run seed</code>
                <span className="text-[10px] text-muted-foreground">
                  prints sk_test_
                </span>
              </div>
            </div>
          </div>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
            <CheckCircle2 className="size-3 text-emerald-500" />
            Simulation only — no card data, no real money movement.
          </p>
        </section>
      </main>

      <footer className="relative z-10 flex flex-col items-center justify-between gap-2 border-t border-border/60 px-5 py-4 text-[10px] text-muted-foreground sm:flex-row sm:px-8">
        <span>PayFlow · payment processing simulator</span>
        <span className="font-mono">Fastify · React · SQLite</span>
      </footer>
    </div>
  );
}
