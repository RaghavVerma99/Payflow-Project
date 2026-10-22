import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  KeyRound,
  Plus,
  RefreshCw,
  Rss,
  Send,
  Webhook,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "../components/layout";
import { IdText, StatusBadge } from "../components/status";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui";
import { api } from "../lib/api";
import { cn, humanize, jsonPretty, relativeTime } from "../lib/utils";

const SINK_TOKEN = "demo";
const SINK_PATHS = [
  `/_sink/${SINK_TOKEN}`,
  `http://127.0.0.1:4000/_sink/${SINK_TOKEN}`,
];

interface SinkEntry {
  id: string;
  event_id: string | null;
  type: string | null;
  body: unknown;
  signature: string | null;
  received_at: string;
}

function SinkDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [entries, setEntries] = useState<SinkEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let message = "The sink did not answer.";
    for (const path of SINK_PATHS) {
      try {
        const response = await fetch(path);
        if (!response.ok) {
          message = `The sink answered with status ${response.status}.`;
          continue;
        }
        const payload = (await response.json()) as { data?: SinkEntry[] };
        setEntries(payload.data ?? []);
        setLoading(false);
        return;
      } catch {
        message = `Could not reach ${path}.`;
      }
    }
    setError(message);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Inspect the sink</DialogTitle>
          <DialogDescription>
            The development sink keeps the last fifty payloads delivered to{" "}
            <span className="font-mono">{SINK_PATHS[0]}</span>. Nothing leaves
            this machine.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/70">
            {entries ? `${entries.length} received` : "not loaded"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        ) : entries && entries.length > 0 ? (
          <pre className="code-surface max-h-[420px] overflow-auto rounded-xl p-4 font-mono text-[11px] leading-relaxed">
            {jsonPretty(entries)}
          </pre>
        ) : (
          <EmptyState
            className="border-0"
            icon={<Send className="size-4" />}
            title="The sink is empty"
            description="Trigger a payment or a payout and the delivered payload will land here."
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WebhooksPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [sinkOpen, setSinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    id: string;
    url: string;
    secret: string;
  } | null>(null);

  const endpointsQuery = useQuery({
    queryKey: ["webhook-endpoints"],
    queryFn: api.webhookEndpoints,
  });

  const eventsQuery = useQuery({
    queryKey: ["webhook-events"],
    queryFn: () => api.webhookEvents({ limit: 25 }),
    refetchInterval: 5000,
  });

  const deliveriesQuery = useQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: () => api.webhookDeliveries({ limit: 25 }),
    refetchInterval: 5000,
  });

  const endpoints = endpointsQuery.data?.data ?? [];
  const events = eventsQuery.data?.data ?? [];
  const deliveries = deliveriesQuery.data?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (input: { url: string; description: string | null }) =>
      api.createWebhookEndpoint(input),
    onSuccess: async (endpoint) => {
      toast.success("Endpoint registered", { description: endpoint.url });
      setCreated({
        id: endpoint.id,
        url: endpoint.url,
        secret: endpoint.secret,
      });
      await queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] });
    },
    onError: (caught) => {
      const message =
        caught instanceof Error
          ? caught.message
          : "Could not register the endpoint.";
      setError(message);
      toast.error("Registration failed", { description: message });
    },
  });

  const disableMutation = useMutation({
    mutationFn: (id: string) => api.disableWebhookEndpoint(id),
    onSuccess: async (endpoint) => {
      toast.success("Endpoint disabled", { description: endpoint.url });
      await queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] });
    },
    onError: (caught) => {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "Could not disable the endpoint.",
      );
    },
  });

  useEffect(() => {
    if (!createOpen) return;
    setUrl("");
    setDescription("");
    setError(null);
  }, [createOpen]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!url.trim()) {
      setError("An endpoint needs a URL to deliver to.");
      return;
    }

    setError(null);
    try {
      await createMutation.mutateAsync({
        url: url.trim(),
        description: description.trim() || null,
      });
      setCreateOpen(false);
    } catch {
      return;
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Chapter 08 · The messengers"
        title="Webhooks"
        description="Every state change is announced. Events queue, the worker delivers them, and the attempt trail is kept line by line."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSinkOpen(true)}
            >
              <Send className="size-3.5" />
              Inspect sink
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New endpoint
            </Button>
          </>
        }
      />

      {created ? (
        <Card className="mb-3 border-emerald-500/25 bg-emerald-500/[0.035]">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="inline-flex items-center gap-2 text-[12px] font-medium">
                  <KeyRound className="size-3.5 text-emerald-500" />
                  Signing secret for {created.url}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Shown once. PayFlow never returns it again — copy it into your
                  secret store now.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCreated(null)}
                title="Dismiss"
                aria-label="Dismiss the signing secret"
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <div className="mt-3 flex items-stretch gap-2">
              <code className="code-surface min-w-0 flex-1 overflow-x-auto rounded-xl p-3 font-mono text-[11px]">
                {created.secret}
              </code>
              <CopyButton value={created.secret} label="signing secret" />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <span className="label-craft">Where we call</span>
            <CardTitle className="mt-2 text-[22px]">Endpoints</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Each delivery is signed with the endpoint secret.
            </p>
          </div>
          <Badge variant="outline">{endpoints.length} registered</Badge>
        </CardHeader>

        {endpointsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : endpointsQuery.isError ? (
          <div className="m-5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
            <p className="font-medium">The endpoints could not be loaded.</p>
            <p className="mt-1 opacity-80">
              {endpointsQuery.error instanceof Error
                ? endpointsQuery.error.message
                : "Unknown error."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void endpointsQuery.refetch()}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : endpoints.length === 0 ? (
          <EmptyState
            className="m-5 border-0"
            icon={<Webhook className="size-4" />}
            title="No endpoints yet"
            description="Register a URL and PayFlow will announce every payment, refund, payout and dispute to it."
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                New endpoint
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow className="hover:bg-transparent">
                <TableHead>Endpoint</TableHead>
                <TableHead className="hidden md:table-cell">
                  Description
                </TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Created
                </TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {endpoints.map((endpoint, index) => (
                <TableRow key={endpoint.id}>
                  <TableCell>
                    <div className="flex items-start gap-3">
                      <span className="row-index mt-0.5 w-5 shrink-0 font-mono text-[9px] text-muted-foreground/30">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="max-w-[320px] truncate font-mono text-[11px] tracking-[0.02em]">
                          {endpoint.url}
                        </p>
                        <IdText id={endpoint.id} />
                        <div className="mt-1.5 sm:hidden">
                          <Badge
                            variant={
                              endpoint.status === "active"
                                ? "success"
                                : "outline"
                            }
                          >
                            {endpoint.status === "active"
                              ? "Active"
                              : "Disabled"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-[220px] truncate text-[11px] text-muted-foreground md:table-cell">
                    {endpoint.description ?? "—"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge
                      variant={
                        endpoint.status === "active" ? "success" : "outline"
                      }
                    >
                      {endpoint.status === "active" ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
                      {relativeTime(endpoint.created_at)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {endpoint.status === "active" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="opacity-70 transition-opacity hover:opacity-100"
                        disabled={disableMutation.isPending}
                        onClick={() => void disableMutation.mutate(endpoint.id)}
                        title="Disable this endpoint"
                      >
                        <Ban className="size-3.5" />
                        <span className="hidden lg:inline">Disable</span>
                      </Button>
                    ) : (
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/40">
                        —
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="mt-3 overflow-hidden">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <span className="label-craft">What we announce</span>
            <CardTitle className="mt-2 text-[22px]">Events</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Queued by the domain, delivered by the worker.
            </p>
          </div>
          <Badge variant="outline">{events.length} loaded</Badge>
        </CardHeader>

        {eventsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : eventsQuery.isError ? (
          <div className="m-5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
            <p className="font-medium">The events could not be loaded.</p>
            <p className="mt-1 opacity-80">
              {eventsQuery.error instanceof Error
                ? eventsQuery.error.message
                : "Unknown error."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void eventsQuery.refetch()}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            className="m-5 border-0"
            icon={<Rss className="size-4" />}
            title="No events yet"
            description="Settle a payment and the announcement is written to the queue."
          />
        ) : (
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow className="hover:bg-transparent">
                <TableHead>Event</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead className="hidden lg:table-cell">
                  Last error
                </TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event, index) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <div className="flex items-start gap-3">
                      <span className="row-index mt-0.5 w-5 shrink-0 font-mono text-[9px] text-muted-foreground/30">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium">
                          {humanize(event.type)}
                        </p>
                        <IdText id={event.id} />
                        <div className="mt-1.5 sm:hidden">
                          <StatusBadge
                            status={event.status}
                            kind="webhook"
                            className="scale-90"
                          />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <StatusBadge status={event.status} kind="webhook" />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="tabular font-mono text-[11px]">
                      {event.attempts}
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-[240px] truncate font-mono text-[10px] text-muted-foreground lg:table-cell">
                    {event.last_error ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
                      {relativeTime(event.created_at)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="mt-3 overflow-hidden">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <span className="label-craft">How it landed</span>
            <CardTitle className="mt-2 text-[22px]">Deliveries</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              One row per attempt, with the answer the endpoint gave back.
            </p>
          </div>
          <Badge variant="outline">{deliveries.length} loaded</Badge>
        </CardHeader>

        {deliveriesQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : deliveriesQuery.isError ? (
          <div className="m-5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
            <p className="font-medium">The deliveries could not be loaded.</p>
            <p className="mt-1 opacity-80">
              {deliveriesQuery.error instanceof Error
                ? deliveriesQuery.error.message
                : "Unknown error."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void deliveriesQuery.refetch()}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : deliveries.length === 0 ? (
          <EmptyState
            className="m-5 border-0"
            icon={<Send className="size-4" />}
            title="No deliveries yet"
            description="Attempts appear here the moment the worker posts to an endpoint."
          />
        ) : (
          <Table>
            <TableHeader className="bg-muted/20">
              <TableRow className="hover:bg-transparent">
                <TableHead>Event</TableHead>
                <TableHead className="hidden md:table-cell">Endpoint</TableHead>
                <TableHead className="text-right">Attempt</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Response
                </TableHead>
                <TableHead className="hidden lg:table-cell">Error</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((delivery, index) => (
                <TableRow key={delivery.id}>
                  <TableCell>
                    <div className="flex items-start gap-3">
                      <span className="row-index mt-0.5 w-5 shrink-0 font-mono text-[9px] text-muted-foreground/30">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <IdText id={delivery.event_id} />
                        <div className="mt-1.5 sm:hidden">
                          <StatusBadge
                            status={delivery.status}
                            kind="webhook"
                            className="scale-90"
                          />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <IdText id={delivery.endpoint_id} />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="tabular font-mono text-[11px]">
                      {delivery.attempt}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <StatusBadge status={delivery.status} kind="webhook" />
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <span className="tabular font-mono text-[11px] text-muted-foreground">
                      {delivery.response_status ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-[240px] truncate font-mono text-[10px] text-muted-foreground lg:table-cell">
                    {delivery.error ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
                      {relativeTime(delivery.created_at)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-background/20 px-4 py-3 text-[10px] text-muted-foreground">
        <p className="inline-flex items-center gap-2">
          <Webhook className="size-3 text-primary" />
          The development sink lives at{" "}
          <span className="font-mono">GET /_sink/:token</span> — the seed
          registers{" "}
          <span className="font-mono">http://127.0.0.1:4000/_sink/demo</span>.
        </p>
        <Button variant="outline" size="sm" onClick={() => setSinkOpen(true)}>
          <Send className="size-3.5" />
          Inspect sink
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New endpoint</DialogTitle>
            <DialogDescription>
              PayFlow posts a signed JSON payload to this URL. The signing
              secret is returned once, at creation.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="endpoint-url">URL</Label>
              <Input
                id="endpoint-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="http://127.0.0.1:4000/_sink/demo"
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="endpoint-description">
                Description (optional)
              </Label>
              <Input
                id="endpoint-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Development sink"
              />
            </div>

            {error ? (
              <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {error}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <Spinner />
                ) : (
                  <Plus className="size-4" />
                )}
                Register endpoint
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <SinkDialog open={sinkOpen} onOpenChange={setSinkOpen} />
    </div>
  );
}
