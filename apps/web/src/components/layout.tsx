import {
  BookOpen,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  Layers,
  LogOut,
  Menu,
  Moon,
  RotateCcw,
  Sun,
  Terminal,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { AmbientCanvas } from "./ambient";
import { LiveClock } from "./motion";
import { Button } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true, index: "01" },
  { to: "/payments", label: "Payments", icon: CreditCard, index: "02" },
  { to: "/refunds", label: "Refunds", icon: RotateCcw, index: "03" },
  { to: "/ledger", label: "Ledger", icon: BookOpen, index: "04" },
  { to: "/playground", label: "Playground", icon: Terminal, index: "05" },
  { to: "/guide", label: "Architecture", icon: Layers, index: "06" },
];

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/payments": "Payments",
  "/refunds": "Refunds",
  "/ledger": "Ledger",
  "/playground": "API Playground",
  "/guide": "Architecture",
};

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="group flex items-center gap-3">
      <div className="relative flex size-10 shrink-0 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-primary/35 bg-primary/8" />
        <span className="absolute inset-[-3px] rounded-full border border-primary/10" />
        <svg
          viewBox="0 0 40 40"
          aria-hidden
          className="absolute inset-0 size-10 animate-spin-slow text-primary/55"
        >
          <path
            d="M20 2.5v35M2.5 20h35M8 8l24 24M32 8 8 32"
            stroke="currentColor"
            strokeWidth="0.7"
          />
        </svg>
        <span className="display relative text-[17px] leading-none text-primary">
          P
        </span>
      </div>
      {compact ? null : (
        <div className="leading-none">
          <p className="display text-[21px] leading-none">PayFlow</p>
          <p className="mt-1.5 font-mono text-[8px] font-medium uppercase tracking-[0.26em] text-muted-foreground/80">
            Payment atelier
          </p>
        </div>
      )}
    </div>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  index,
  onClick,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  index: string;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-300",
          isActive
            ? "bg-gradient-to-r from-primary/14 via-primary/5 to-transparent text-foreground"
            : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary transition-all duration-300",
              isActive ? "opacity-100" : "opacity-0 group-hover:opacity-40",
            )}
          />
          <Icon
            className={cn(
              "size-[15px] transition-colors",
              isActive ? "text-primary" : "text-muted-foreground/70",
            )}
          />
          <span className="flex-1">{label}</span>
          <span
            className={cn(
              "font-mono text-[9px] tracking-[0.08em] transition-opacity",
              isActive
                ? "text-primary/80"
                : "text-muted-foreground/40 opacity-0 group-hover:opacity-100",
            )}
          >
            {index}
          </span>
          {isActive ? (
            <span className="absolute right-3 size-1 rounded-full bg-primary" />
          ) : null}
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { merchant, logout } = useAuth();
  const initials =
    merchant?.name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "PF";

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-[#0b0906]/70 backdrop-blur-[4px] transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-border/80 bg-card/40 backdrop-blur-2xl transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-20 items-center justify-between px-5">
          <Logo />
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <p className="px-3 pb-2.5 font-mono text-[8px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/55">
            The workspace
          </p>
          <nav className="space-y-0.5">
            {NAV.slice(0, 4).map((item) => (
              <NavItem key={item.to} {...item} onClick={onClose} />
            ))}
          </nav>

          <p className="px-3 pb-2.5 pt-7 font-mono text-[8px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/55">
            The tools
          </p>
          <nav className="space-y-0.5">
            {NAV.slice(4).map((item) => (
              <NavItem key={item.to} {...item} onClick={onClose} />
            ))}
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.035] hover:text-foreground"
            >
              <ExternalLink className="size-[15px] text-muted-foreground/70" />
              <span className="flex-1">API Reference</span>
              <span className="font-mono text-[8px] tracking-[0.12em] text-muted-foreground/50">
                /DOCS
              </span>
            </a>
          </nav>

          <div className="relative mt-7 overflow-hidden rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.035] p-4">
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
            <div className="relative">
              <div className="flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <p className="font-mono text-[8px] font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
                  Simulation live
                </p>
              </div>
              <p className="display-soft mt-2.5 text-[15px] leading-snug">
                A safe place to move imaginary money.
              </p>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                Deterministic processor. No card data. Nothing leaves the
                building.
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-border/70 p-3">
          <div className="group flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-foreground/[0.03]">
            <div className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10">
              <span className="display text-[12px] text-primary">
                {initials}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium">
                {merchant?.name ?? "Merchant"}
              </p>
              <p className="truncate font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/70">
                {merchant?.environment ?? "dev"} / {merchant?.id ?? ""}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="size-3.5" />
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

function ScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]">
      <div
        className="h-full origin-left bg-gradient-to-r from-primary via-primary/70 to-transparent transition-transform duration-150 ease-out"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const title = TITLES[location.pathname] ?? "PayFlow";

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="relative min-h-dvh">
      <AmbientCanvas />
      <ScrollProgress />
      <Sidebar open={open} onClose={() => setOpen(false)} />

      <div className="relative z-10 lg:pl-[17rem]">
        <header className="glass sticky top-0 z-30 flex h-[72px] items-center gap-3 border-b border-border/70 px-4 sm:px-6 lg:px-9">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </Button>

          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="hidden font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60 sm:inline">
              Atelier
            </span>
            <span className="hidden h-3 w-px bg-border sm:inline" />
            <span className="truncate text-[13px] font-medium tracking-[-0.01em]">
              {title}
            </span>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            <LiveClock className="text-muted-foreground/70" />
          </div>

          <div className="hidden -rotate-2 items-center gap-1.5 rounded-md border border-dashed border-amber-500/40 bg-amber-500/8 px-2.5 py-1 font-mono text-[8px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300 sm:flex">
            Test environment
          </div>

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

          <Button
            variant="outline"
            size="sm"
            asChild
            className="hidden sm:inline-flex"
          >
            <a href="/docs" target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              API docs
            </a>
          </Button>
        </header>

        <main className="mx-auto w-full max-w-[1480px] px-4 py-7 sm:px-6 lg:px-9 lg:py-10">
          <div key={location.pathname} className="animate-page">
            <Outlet />
          </div>
        </main>

        <footer className="mx-auto flex w-full max-w-[1480px] flex-col gap-3 border-t border-border/60 px-4 py-6 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-9">
          <p className="display-soft text-[13px] italic text-muted-foreground">
            PayFlow — imaginary money, rigorously accounted for.
          </p>
          <div className="flex items-center gap-4 font-mono text-[9px] uppercase tracking-[0.12em]">
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              OpenAPI 3.1
            </a>
            <a
              href="/health"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Health
            </a>
            <span className="text-muted-foreground/50">No. 001</span>
          </div>
        </footer>
      </div>
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{
          className:
            "border border-border bg-popover text-popover-foreground shadow-2xl",
        }}
      />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-3 flex items-center gap-2.5">
              <span className="h-px w-7 bg-primary/60" />
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.24em] text-primary">
                {eyebrow}
              </p>
            </div>
          ) : null}
          <h1 className="display text-[36px] leading-[0.98] sm:text-[46px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div className="mt-5 hairline" />
    </div>
  );
}
