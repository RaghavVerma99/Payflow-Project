import {
  ArrowRight,
  CheckCircle2,
  Code2,
  KeyRound,
  Loader2,
  LockKeyhole,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { AmbientCanvas } from "../components/ambient";
import { Logo } from "../components/layout";
import { Button, Input, Label, Separator } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";

const FEATURES = [
  {
    icon: KeyRound,
    title: "Idempotent by design",
    description:
      "Retries replay the original resource; conflicting bodies are rejected.",
  },
  {
    icon: ShieldCheck,
    title: "Explicit state machine",
    description: "Every status change is guarded and written to an event log.",
  },
  {
    icon: Code2,
    title: "Double-entry ledger",
    description: "Payments and refunds post balanced, immutable journals.",
  },
];

const MARQUEE = [
  "Idempotent APIs",
  "Durable workers",
  "Double-entry books",
  "Deterministic simulator",
  "Immutable journals",
  "Cursor pagination",
];

export function LoginPage() {
  const { login, demoLogin } = useAuth();
  const { theme, toggle } = useTheme();
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
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <AmbientCanvas />

      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <div className="flex items-center gap-1.5">
          <span className="mr-2 hidden -rotate-2 rounded-md border border-dashed border-amber-500/40 bg-amber-500/[0.06] px-2.5 py-1 font-mono text-[8px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300 sm:inline-block">
            Simulation
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Terminal className="size-3.5" />
            API reference
          </a>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[1.12fr_0.88fr] lg:gap-16 lg:py-12">
        <section className="animate-fade-up min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5">
            <Sparkles className="size-3 text-primary" />
            <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.2em] text-primary">
              A payment atelier · est. 2026
            </span>
          </div>

          <h1 className="display mt-6 max-w-2xl text-[46px] leading-[0.9] sm:text-[64px] lg:text-[72px]">
            The quiet craft
            <br />
            of <span className="italic text-primary">moving money.</span>
          </h1>

          <p className="mt-6 max-w-lg text-[13px] leading-relaxed text-muted-foreground sm:text-[14px]">
            A production-shaped payment processor you can hold in your head.
            Idempotent APIs, durable retries, refunds under contention, and a
            ledger that always balances.
          </p>

          <div className="mt-8 hidden max-w-lg sm:block">
            {FEATURES.map((feature, index) => (
              <div
                key={feature.title}
                className="group flex items-start gap-3.5 border-t border-border/60 py-3.5 first:border-t-0 first:pt-0"
              >
                <span className="mt-0.5 font-mono text-[9px] text-muted-foreground/40">
                  0{index + 1}
                </span>
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background/30 text-primary transition-colors group-hover:border-primary/30">
                  <feature.icon className="size-3.5" />
                </div>
                <div>
                  <p className="text-[12px] font-medium">{feature.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="relative mt-8 hidden min-w-0 overflow-hidden border-y border-border/60 py-2.5 sm:block">
            <div className="flex w-max animate-[marquee_30s_linear_infinite] items-center gap-7 whitespace-nowrap font-mono text-[8px] uppercase tracking-[0.2em] text-muted-foreground/65">
              {[...MARQUEE, ...MARQUEE].map((item, index) => (
                <span
                  key={`${item}-${index}`}
                  className="inline-flex items-center gap-7"
                >
                  {item}
                  <span className="size-1 rounded-full bg-primary/50" />
                </span>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Code2 className="size-3 text-primary" />
              Fastify + TypeScript
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3 text-primary" />
              React + Tailwind
            </span>
            <span className="inline-flex items-center gap-1.5">
              <LockKeyhole className="size-3 text-primary" />
              Local SQLite
            </span>
          </div>
        </section>

        <section
          className="animate-fade-up mx-auto w-full min-w-0 max-w-md"
          style={{ animationDelay: "120ms" }}
        >
          <div className="art-card relative overflow-hidden rounded-[28px] p-6 sm:p-8">
            <div className="pointer-events-none absolute -right-16 -top-20 size-48 rounded-full border border-dashed border-primary/15" />
            <div className="pointer-events-none absolute right-5 top-5 font-mono text-[8px] uppercase tracking-[0.2em] text-muted-foreground/35">
              No. 001
            </div>

            <div className="relative">
              <div className="mb-6">
                <div className="mb-4 flex size-11 items-center justify-center rounded-full border border-primary/25 bg-primary/[0.08] text-primary">
                  <Sparkles className="size-5" />
                </div>
                <h2 className="display text-[30px] leading-none">
                  Open the console.
                </h2>
                <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
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
                <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground">
                  or use an API key
                </span>
                <Separator className="flex-1" />
              </div>

              <form onSubmit={submit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="api-key">Merchant API key</Label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
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
                <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
                  <p>{error}</p>
                  {hint ? (
                    <code className="mt-1.5 inline-block rounded bg-black/20 px-2 py-1 font-mono text-[11px]">
                      {hint}
                    </code>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-6 rounded-2xl border border-border/70 bg-background/25 p-3.5">
                <div className="flex items-center gap-2">
                  <Terminal className="size-3.5 text-primary" />
                  <p className="label-craft">First run?</p>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  Seed a merchant, demo history and credentials:
                </p>
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/40 px-2.5 py-2">
                  <code className="font-mono text-[10px]">npm run seed</code>
                  <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground/60">
                    prints sk_test_
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[10px] text-muted-foreground">
            <CheckCircle2 className="size-3 text-emerald-500" />
            Simulation only — no card data, no real money movement.
          </p>
        </section>
      </main>

      <footer className="relative z-10 flex flex-col items-center justify-between gap-2 border-t border-border/60 px-5 py-4 text-[9px] text-muted-foreground sm:flex-row sm:px-8">
        <span className="font-mono uppercase tracking-[0.12em]">
          PayFlow · payment processing simulator
        </span>
        <span className="font-mono uppercase tracking-[0.12em]">
          Fastify · React · SQLite
        </span>
      </footer>
    </div>
  );
}
