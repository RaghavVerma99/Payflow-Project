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
import { SourceBadge, IdText } from "../components/status";
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
        eyebrow="Double-entry"
        title="Ledger"
        description="Every captured payment and settled refund posts a balanced journal. Posted entries are immutable."
        actions={
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
        }
      />

      <Card
        className={cn(
          "mb-3",
          balanced
            ? "border-emerald-500/25 bg-emerald-500/[0.04]"
            : "border-rose-500/25 bg-rose-500/[0.04]",
        )}
      >
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex size-9 items-center justify-center rounded-lg",
                balanced
                  ? "bg-emerald-500/15 text-emerald-500"
                  : "bg-rose-500/15 text-rose-500",
              )}
            >
              {balanced ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <TriangleAlert className="size-4" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">
                {balanced
                  ? "Trial balance is balanced"
                  : "Trial balance is out"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {formatCurrency(trial?.debits_minor ?? 0)} debits ={" "}
                {formatCurrency(trial?.credits_minor ?? 0)} credits
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Scale className="size-3" />
              INR
            </Badge>
            <Badge variant={balanced ? "success" : "danger"}>
              {balanced ? "Invariant holds" : "Investigate"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {accountsQuery.isLoading
          ? Array.from({ length: 2 }, (_, index) => (
              <Skeleton key={index} className="h-32 w-full" />
            ))
          : accountsQuery.data?.data.map((account) => (
              <Card key={account.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{account.name}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
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
                  <p className="tabular mt-4 text-2xl font-semibold">
                    {formatCurrency(account.balance_minor)}
                  </p>
                  <div className="mt-3 flex gap-6 text-[10px] text-muted-foreground">
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
            ))}
      </div>

      <Card className="mt-3">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Posted journals</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              One journal per payment capture or refund settlement
            </p>
          </div>
          <Badge variant="outline">{journals.length} loaded</Badge>
        </CardHeader>

        {journalsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
        ) : journals.length === 0 ? (
          <EmptyState
            className="m-5 border-0"
            icon={<BookOpen className="size-4" />}
            title="No journals yet"
            description="Create and settle a payment to post the first journal."
            action={
              <Button size="sm" asChild>
                <Link to="/payments">Go to payments</Link>
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {journals.map((journal) => (
              <div key={journal.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SourceBadge type={journal.source_type} />
                    <IdText id={journal.source_id} />
                  </div>
                  <span
                    className="text-[10px] text-muted-foreground"
                    title={formatDate(journal.created_at)}
                  >
                    {relativeTime(journal.created_at)}
                  </span>
                </div>

                <div className="mt-2 overflow-hidden rounded-lg border border-border">
                  <div className="grid grid-cols-[1fr_92px_92px] bg-muted/30 px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                    <span>Account</span>
                    <span className="text-right">Debit</span>
                    <span className="text-right">Credit</span>
                  </div>
                  {journal.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="grid grid-cols-[1fr_92px_92px] border-t border-border px-3 py-1.5 text-[11px]"
                    >
                      <div className="min-w-0">
                        <span className="truncate">{entry.account_name}</span>
                        <span className="ml-2 font-mono text-[9px] text-muted-foreground">
                          {entry.account_code}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "tabular text-right",
                          entry.direction !== "debit" &&
                            "text-muted-foreground/40",
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
                            "text-muted-foreground/40",
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
          <div className="flex justify-center border-t border-border p-3">
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

      <p className="mt-2 text-[11px] text-muted-foreground">
        Debits and credits are stored per entry. Database triggers reject
        updates or deletes on posted entries.
      </p>
    </div>
  );
}
