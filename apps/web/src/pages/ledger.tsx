import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  RefreshCw,
  Scale,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/layout";
import { Reveal } from "../components/motion";
import { IdText, SourceBadge } from "../components/status";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Spinner,
} from "../components/ui";
import { api } from "../lib/api";
import { cn, formatCurrency, formatDate, relativeTime } from "../lib/utils";

export function LedgerPage() {
  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: api.accounts,
    refetchInterval: 5000,
  });

  const journalsQuery = useInfiniteQuery({
    queryKey: ["journals"],
    queryFn: ({ pageParam }) => api.journals({ limit: 15, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    refetchInterval: 8000,
  });

  const journals = useMemo(
    () => journalsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [journalsQuery.data],
  );

  const trial = accountsQuery.data?.trial_balance;
  const balanced = trial?.balanced ?? true;

  return (
    <div>
      <PageHeader
        eyebrow="Chapter 04 · The book"
        title="Ledger"
        description="Every capture and settled refund posts a balanced journal. Once written, the entry is sealed: no edits, no deletions."
        actions={
          <>
            <Badge variant="outline" className="gap-1">
              <Scale className="size-3" />
              Double entry
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void accountsQuery.refetch();
                void journalsQuery.refetch();
              }}
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  (accountsQuery.isFetching || journalsQuery.isFetching) &&
                    "animate-spin",
                )}
              />
              Refresh
            </Button>
          </>
        }
      />

      <Reveal>
        <Card
          className={cn(
            "relative overflow-hidden",
            balanced ? "border-emerald-500/25" : "border-rose-500/25",
          )}
        >
          <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full border border-dashed border-emerald-500/15" />
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-20 [mask-image:linear-gradient(to_left,black,transparent_65%)]" />
          <CardContent className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "relative flex size-14 shrink-0 items-center justify-center rounded-full border-2",
                  balanced
                    ? "border-emerald-500/35 bg-emerald-500/8 text-emerald-600 dark:text-emerald-300"
                    : "border-rose-500/35 bg-rose-500/8 text-rose-600 dark:text-rose-300",
                )}
              >
                <span className="absolute inset-1 rounded-full border border-current opacity-15" />
                {balanced ? (
                  <CheckCircle2 className="size-5" />
                ) : (
                  <TriangleAlert className="size-5" />
                )}
              </div>
              <div>
                <span className="label-craft">Trial balance</span>
                <p className="display mt-1.5 text-[30px] leading-none">
                  {balanced ? "In balance." : "Out of balance."}
                </p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {formatCurrency(trial?.debits_minor ?? 0)} debits ={" "}
                  {formatCurrency(trial?.credits_minor ?? 0)} credits
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 sm:text-right">
              <div>
                <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-muted-foreground/70">
                  Posted equally
                </p>
                <p className="display mt-1 text-[22px] leading-none">
                  {formatCurrency(trial?.debits_minor ?? 0)}
                </p>
              </div>
              <Badge variant={balanced ? "success" : "danger"}>
                {balanced ? "Invariant holds" : "Investigate"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </Reveal>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {accountsQuery.isLoading
          ? Array.from({ length: 2 }, (_, index) => (
              <Skeleton key={index} className="h-44 w-full rounded-2xl" />
            ))
          : accountsQuery.data?.data.map((account, index) => (
              <Reveal key={account.id} delay={index * 70}>
                <Card className="hover-lift relative h-full overflow-hidden">
                  <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full border border-primary/10" />
                  <CardContent className="relative p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="label-craft">Folio {index + 1}</p>
                        <p className="display mt-2 text-[21px] leading-none">
                          {account.name}
                        </p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
                          {account.code}
                        </p>
                      </div>
                      <Badge
                        variant={account.kind === "asset" ? "info" : "violet"}
                        className="capitalize"
                      >
                        {account.kind}
                      </Badge>
                    </div>
                    <p className="display mt-6 text-[34px] leading-none">
                      {formatCurrency(account.balance_minor)}
                    </p>
                    <div className="mt-4 flex gap-6 border-t border-border/60 pt-3 text-[10px] text-muted-foreground">
                      <span>
                        Debits{" "}
                        <span className="tabular text-foreground">
                          {formatCurrency(account.debits_minor)}
                        </span>
                      </span>
                      <span>
                        Credits{" "}
                        <span className="tabular text-foreground">
                          {formatCurrency(account.credits_minor)}
                        </span>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
      </div>

      <Reveal>
        <Card className="mt-3 overflow-hidden">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <span className="label-craft">Posted entries</span>
              <CardTitle className="mt-2 text-[22px]">The journals</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                One journal per capture or settled refund, in chronological
                order.
              </p>
            </div>
            <Badge variant="outline">{journals.length} loaded</Badge>
          </CardHeader>

          {journalsQuery.isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-28 w-full" />
              ))}
            </div>
          ) : journals.length === 0 ? (
            <EmptyState
              className="m-5 border-0"
              icon={<BookOpen className="size-4" />}
              title="The first blank folio"
              description="Create and settle a payment to post the first journal."
              action={
                <Button size="sm" asChild>
                  <Link to="/payments">Go to payments</Link>
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-border/60">
              {journals.map((journal, index) => (
                <div key={journal.id} className="row-craft px-5 py-5 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="row-index font-mono text-[9px] text-muted-foreground/35">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <SourceBadge type={journal.source_type} />
                      <IdText id={journal.source_id} />
                    </div>
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/70"
                      title={formatDate(journal.created_at)}
                    >
                      {relativeTime(journal.created_at)}
                    </span>
                  </div>

                  <div className="mt-3 overflow-hidden rounded-xl border border-border/70">
                    <div className="grid grid-cols-[1fr_92px_92px] border-b border-border/70 bg-muted/25 px-3.5 py-2 font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground/80">
                      <span>Account</span>
                      <span className="text-right">Debit</span>
                      <span className="text-right">Credit</span>
                    </div>
                    {journal.entries.map((entry) => (
                      <div
                        key={entry.id}
                        className="grid grid-cols-[1fr_92px_92px] border-t border-border/50 px-3.5 py-2 text-[11px] first:border-t-0"
                      >
                        <div className="min-w-0">
                          <span className="truncate">{entry.account_name}</span>
                          <span className="ml-2 font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground/60">
                            {entry.account_code}
                          </span>
                        </div>
                        <span
                          className={cn(
                            "tabular text-right",
                            entry.direction !== "debit" &&
                              "text-muted-foreground/30",
                          )}
                        >
                          {entry.direction === "debit"
                            ? formatCurrency(entry.amount_minor)
                            : "—"}
                        </span>
                        <span
                          className={cn(
                            "tabular text-right",
                            entry.direction !== "credit" &&
                              "text-muted-foreground/30",
                          )}
                        >
                          {entry.direction === "credit"
                            ? formatCurrency(entry.amount_minor)
                            : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {journalsQuery.hasNextPage ? (
            <div className="flex justify-center border-t border-border/70 p-4">
              <Button
                variant="outline"
                size="sm"
                disabled={journalsQuery.isFetchingNextPage}
                onClick={() => void journalsQuery.fetchNextPage()}
              >
                {journalsQuery.isFetchingNextPage ? <Spinner /> : null}
                Load more
              </Button>
            </div>
          ) : null}
        </Card>
      </Reveal>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-background/20 px-4 py-3 text-[10px] text-muted-foreground">
        <p>
          Debits and credits are stored per entry. Database triggers reject
          updates or deletes on posted entries.
        </p>
        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/60">
          Immutable by construction
        </p>
      </div>
    </div>
  );
}
