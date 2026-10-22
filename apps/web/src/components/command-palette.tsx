import {
  BookOpen,
  CreditCard,
  Landmark,
  LayoutDashboard,
  Layers,
  LogOut,
  Moon,
  RefreshCw,
  RotateCcw,
  Search,
  Sun,
  Terminal,
  Wallet,
  Webhook,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";

interface Command {
  id: string;
  label: string;
  hint: string;
  group: string;
  icon: typeof Search;
  run: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, toggle } = useTheme();
  const { logout } = useAuth();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        setQuery("");
        setCursor(0);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      navigate(path);
      setOpen(false);
    };

    const pages: Command[] = [
      {
        id: "overview",
        label: "Overview",
        hint: "Volume, mix, ledger health",
        group: "Navigate",
        icon: LayoutDashboard,
        run: go("/"),
      },
      {
        id: "payments",
        label: "Payments",
        hint: "Search and inspect payments",
        group: "Navigate",
        icon: CreditCard,
        run: go("/payments"),
      },
      {
        id: "refunds",
        label: "Refunds",
        hint: "Refunds and their reservations",
        group: "Navigate",
        icon: RotateCcw,
        run: go("/refunds"),
      },
      {
        id: "ledger",
        label: "Ledger",
        hint: "Accounts, journals, trial balance",
        group: "Navigate",
        icon: BookOpen,
        run: go("/ledger"),
      },
      {
        id: "methods",
        label: "Payment methods",
        hint: "Tokenized instruments",
        group: "Navigate",
        icon: Wallet,
        run: go("/methods"),
      },
      {
        id: "webhooks",
        label: "Webhooks",
        hint: "Endpoints, events, deliveries",
        group: "Navigate",
        icon: Webhook,
        run: go("/webhooks"),
      },
      {
        id: "treasury",
        label: "Treasury",
        hint: "Payouts and disputes",
        group: "Navigate",
        icon: Landmark,
        run: go("/treasury"),
      },
      {
        id: "playground",
        label: "Playground",
        hint: "Send raw API requests",
        group: "Navigate",
        icon: Terminal,
        run: go("/playground"),
      },
      {
        id: "guide",
        label: "Architecture",
        hint: "How the machine works",
        group: "Navigate",
        icon: Layers,
        run: go("/guide"),
      },
    ];

    const actions: Command[] = [
      {
        id: "refresh",
        label: "Refresh all data",
        hint: "Invalidate every cached query",
        group: "Actions",
        icon: RefreshCw,
        run: () => {
          void queryClient.invalidateQueries();
          setOpen(false);
        },
      },
      {
        id: "theme",
        label: theme === "dark" ? "Switch to light" : "Switch to dark",
        hint: "Toggle the colour scheme",
        group: "Actions",
        icon: theme === "dark" ? Sun : Moon,
        run: () => {
          toggle();
          setOpen(false);
        },
      },
      {
        id: "signout",
        label: "Sign out",
        hint: "Forget the API key on this device",
        group: "Actions",
        icon: LogOut,
        run: () => {
          logout();
          setOpen(false);
        },
      },
    ];

    return [...pages, ...actions];
  }, [navigate, queryClient, theme, toggle, logout]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.hint} ${command.group}`
        .toLowerCase()
        .includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((c) => Math.min(c + 1, results.length - 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      }
      if (event.key === "Enter") {
        event.preventDefault();
        results[cursor]?.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, cursor]);

  if (!open) return null;

  let lastGroup = "";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-[#0b0906]/70 px-4 pt-[14vh] backdrop-blur-[3px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover/95 shadow-2xl backdrop-blur-xl animate-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a page or run an action…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            results.map((command, index) => {
              const showGroup = command.group !== lastGroup;
              lastGroup = command.group;
              const Icon = command.icon;
              return (
                <div key={command.id}>
                  {showGroup ? (
                    <p className="label-craft px-3 pb-1 pt-3">
                      {command.group}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={command.run}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                      index === cursor
                        ? "bg-primary/12 text-foreground"
                        : "text-muted-foreground hover:bg-foreground/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-lg border",
                        index === cursor
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-muted/30",
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">
                        {command.label}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {command.hint}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/70">
          <span>↑↓ move · ↵ select</span>
          <span>⌘K toggles</span>
        </div>
      </div>
    </div>
  );
}
