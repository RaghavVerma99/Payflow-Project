import { useQueryClient } from "@tanstack/react-query";
import {
  Braces,
  CheckCircle2,
  Copy,
  RefreshCw,
  Send,
  Terminal,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/layout";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  Label,
  Select,
  Textarea,
} from "../components/ui";
import { rawRequest, type RawResponse } from "../lib/api";
import { cn, jsonPretty, makeIdempotencyKey } from "../lib/utils";

interface Preset {
  id: string;
  label: string;
  method: "GET" | "POST";
  path: string;
  body: string;
  idempotent?: boolean;
}

const PRESETS: Preset[] = [
  {
    id: "create-payment",
    label: "Create payment",
    method: "POST",
    path: "/v1/payments",
    body: jsonPretty({
      amount_minor: 24900,
      currency: "INR",
      customer_id: "cus_playground",
      description: "Playground payment",
      simulator_scenario: "approve",
    }),
    idempotent: true,
  },
  {
    id: "list-payments",
    label: "List payments",
    method: "GET",
    path: "/v1/payments?limit=5",
    body: "",
  },
  {
    id: "overview",
    label: "Overview",
    method: "GET",
    path: "/v1/stats/overview",
    body: "",
  },
  {
    id: "create-refund",
    label: "Create refund",
    method: "POST",
    path: "/v1/refunds",
    body: jsonPretty({
      payment_id: "pay_replace_with_a_succeeded_payment",
      amount_minor: 5000,
      reason: "Playground refund",
      simulator_scenario: "approve",
    }),
    idempotent: true,
  },
  {
    id: "accounts",
    label: "Accounts",
    method: "GET",
    path: "/v1/accounts",
    body: "",
  },
  {
    id: "journals",
    label: "Journals",
    method: "GET",
    path: "/v1/ledger/journals?limit=5",
    body: "",
  },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightJson(value: unknown): string {
  const json = escapeHtml(JSON.stringify(value, null, 2) ?? "null");
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let className = "text-amber-400";
      if (match.startsWith('"')) {
        className = match.endsWith(":") ? "text-sky-400" : "text-emerald-400";
      } else if (/true|false/.test(match)) {
        className = "text-violet-400";
      } else if (/null/.test(match)) {
        className = "text-zinc-500";
      }
      return `<span class="${className}">${match}</span>`;
    },
  );
}

const METHOD_TONES: Record<string, string> = {
  GET: "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  POST: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

export function PlaygroundPage() {
  const queryClient = useQueryClient();
  const first = PRESETS[0];

  const [presetId, setPresetId] = useState(first.id);
  const [method, setMethod] = useState<"GET" | "POST">(first.method);
  const [path, setPath] = useState(first.path);
  const [body, setBody] = useState(first.body);
  const [idempotencyKey, setIdempotencyKey] = useState(makeIdempotencyKey);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<RawResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (preset: Preset) => {
    setPresetId(preset.id);
    setMethod(preset.method);
    setPath(preset.path);
    setBody(preset.body);
    setIdempotencyKey(preset.idempotent ? makeIdempotencyKey() : "");
    setResponse(null);
    setError(null);
  };

  const send = async () => {
    setError(null);

    if (!path.trim().startsWith("/")) {
      setError("Path must start with /.");
      return;
    }

    if (method === "POST" && body.trim()) {
      try {
        JSON.parse(body);
      } catch {
        setError("Request body is not valid JSON.");
        return;
      }
    }

    setSending(true);
    try {
      const result = await rawRequest({
        method,
        path: path.trim(),
        body: method === "GET" ? null : body,
        extraHeaders:
          idempotencyKey.trim().length > 0
            ? { "Idempotency-Key": idempotencyKey.trim() }
            : undefined,
      });
      setResponse(result);
      if (result.status < 300 && method === "POST") {
        await queryClient.invalidateQueries();
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Request failed to send.",
      );
    } finally {
      setSending(false);
    }
  };

  const origin =
    window.location.port === "5173"
      ? "http://localhost:4000"
      : window.location.origin;

  const curl = [
    `curl -X ${method} '${origin}${path}'`,
    `  -H 'Authorization: Bearer $PAYFLOW_API_KEY'`,
    method === "POST" ? `  -H 'Content-Type: application/json'` : "",
    idempotencyKey ? `  -H 'Idempotency-Key: ${idempotencyKey}'` : "",
    method === "POST" && body ? `  -d '${body.replace(/'/g, "'\\''")}'` : "",
  ]
    .filter(Boolean)
    .join(" \\\n");

  return (
    <div>
      <PageHeader
        eyebrow="Developer tools"
        title="API Playground"
        description="Send real requests to this API with the current merchant key. Non-2xx responses are shown, not thrown."
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href="/docs" target="_blank" rel="noreferrer">
              Open Swagger UI
            </a>
          </Button>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => applyPreset(preset)}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              presetId === preset.id
                ? "border-emerald-500/40 bg-emerald-500/[0.06]"
                : "border-border bg-card hover:bg-muted/40",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold",
                  METHOD_TONES[preset.method],
                )}
              >
                {preset.method}
              </span>
              <span className="text-xs font-medium">{preset.label}</span>
            </div>
            <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground">
              {preset.path}
            </p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Request</CardTitle>
            <Badge variant="outline" className="font-mono">
              {method}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 pt-4">
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="method">Method</Label>
                <Select
                  id="method"
                  value={method}
                  onChange={(event) =>
                    setMethod(event.target.value as "GET" | "POST")
                  }
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="path">Path</Label>
                <Input
                  id="path"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="body">JSON body</Label>
                <span className="text-[10px] text-muted-foreground">
                  {method === "GET" ? "ignored for GET" : "application/json"}
                </span>
              </div>
              <Textarea
                id="body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={method === "GET"}
                className="min-h-40 disabled:opacity-40"
                spellCheck={false}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="idempotency">Idempotency-Key</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setIdempotencyKey(makeIdempotencyKey())}
                >
                  <RefreshCw className="size-3" />
                  Regenerate
                </Button>
              </div>
              <Input
                id="idempotency"
                value={idempotencyKey}
                onChange={(event) => setIdempotencyKey(event.target.value)}
                className="font-mono text-[11px]"
                placeholder="optional"
                spellCheck={false}
              />
            </div>

            {error ? (
              <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {error}
              </div>
            ) : null}

            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-[10px] text-muted-foreground">
                Authorization header is added automatically.
              </p>
              <Button size="sm" onClick={() => void send()} disabled={sending}>
                {sending ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                Send request
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Response</CardTitle>
            {response ? (
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    response.status < 300
                      ? "success"
                      : response.status < 500
                        ? "warning"
                        : "danger"
                  }
                >
                  {response.status} {response.statusText}
                </Badge>
                <span className="tabular text-[10px] text-muted-foreground">
                  {response.durationMs} ms
                </span>
              </div>
            ) : null}
          </CardHeader>

          <CardContent className="flex flex-1 flex-col pt-4">
            {response ? (
              <>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <CheckCircle2 className="size-3 text-emerald-500" />
                    request_id{" "}
                    <span className="font-mono">
                      {response.headers["x-request-id"] ?? "—"}
                    </span>
                  </span>
                  <CopyButton
                    value={response.headers["x-request-id"] ?? ""}
                    label="request id"
                  />
                </div>

                <div className="max-h-[430px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <pre
                    className="font-mono text-[11px] leading-relaxed text-zinc-100"
                    dangerouslySetInnerHTML={{
                      __html: highlightJson(response.body),
                    }}
                  />
                </div>

                <details className="mt-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <summary className="cursor-pointer text-[11px] font-medium">
                    Response headers ({Object.keys(response.headers).length})
                  </summary>
                  <div className="mt-2 space-y-1">
                    {Object.entries(response.headers).map(([key, value]) => (
                      <div
                        key={key}
                        className="grid grid-cols-[140px_1fr] gap-2 font-mono text-[10px]"
                      >
                        <span className="truncate text-muted-foreground">
                          {key}
                        </span>
                        <span className="break-all">{value}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Terminal className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">No response yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pick a preset, edit the request, and send it.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Braces className="size-4 text-muted-foreground" />
            <CardTitle>Equivalent cURL</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(curl);
              }}
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {curl}
          </pre>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Export a key with <span className="font-mono">npm run seed</span>{" "}
            and set <span className="font-mono">PAYFLOW_API_KEY</span> in your
            shell.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
