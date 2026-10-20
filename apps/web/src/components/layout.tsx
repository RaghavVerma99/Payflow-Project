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
  Zap,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { Button } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/payments", label: "Payments", icon: CreditCard },
  { to: "/refunds", label: "Refunds", icon: RotateCcw },
  { to: "/ledger", label: "Ledger", icon: BookOpen },
  { to: "/playground", label: "API Playground", icon: Terminal },
  { to: "/guide", label: "Architecture", icon: Layers },
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
    <div className="flex items-center gap-2.5">
      <div className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-300 via-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25">
        <Zap
          className="size-[18px] text-emerald-950"
          strokeWidth={2.5}
          fill="currentColor"
        />
      </div>
      {compact ? null : (
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">PayFlow</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Operations
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
  onClick,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "absolute left-0 h-4 w-0.5 rounded-full bg-emerald-500 transition-opacity",
              isActive ? "opacity-100" : "opacity-0",
            )}
          />
          <Icon className="size-4" />
          {label}
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
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card/60 backdrop-blur-xl transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
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

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            Workspace
          </p>
          <nav className="space-y-1">
            {NAV.slice(0, 4).map((item) => (
              <NavItem key={item.to} {...item} onClick={onClose} />
            ))}
          </nav>

          <p className="px-3 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            Developers
          </p>
          <nav className="space-y-1">
            {NAV.slice(4).map((item) => (
              <NavItem key={item.to} {...item} onClick={onClose} />
            ))}
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <ExternalLink className="size-4" />
              API Reference
              <span className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/70">
                /docs
              </span>
            </a>
          </nav>

          <div className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3.5">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Simulation mode
              </p>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Deterministic processor. No card data is accepted and no real
              money moves.
            </p>
          </div>
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-lg px-2 py-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">
                {merchant?.name ?? "Merchant"}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {merchant?.environment ?? "dev"} · {merchant?.id ?? ""}
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
    <div className="min-h-dvh bg-background">
      <Sidebar open={open} onClose={() => setOpen(false)} />

      <div className="lg:pl-64">
        <header className="glass sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border px-4 sm:px-6 lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </Button>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Console
            </span>
            <span className="hidden text-muted-foreground/40 sm:inline">/</span>
            <span className="truncate text-sm font-medium">{title}</span>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 sm:flex">
            <span className="size-1.5 rounded-full bg-amber-500" />
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

        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>

        <footer className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 border-t border-border px-4 py-5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>PayFlow · payment processing simulator · no real money moves</p>
          <div className="flex items-center gap-4">
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground"
            >
              OpenAPI 3.1
            </a>
            <a
              href="/health"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground"
            >
              Health
            </a>
            <span className="font-mono">v1.0.0</span>
          </div>
        </footer>
      </div>
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{
          className:
            "border border-border bg-popover text-popover-foreground shadow-xl",
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
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        {eyebrow ? (
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
