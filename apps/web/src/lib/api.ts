export type PaymentStatus =
  | "created"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "unknown"
  | "partially_refunded"
  | "refunded";

export type RefundStatus =
  | "reserved"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "unknown";

export type Scenario = "auto" | "approve" | "decline" | "timeout" | "transient";

export interface Payment {
  object: "payment";
  id: string;
  status: PaymentStatus;
  amount_minor: number;
  amount: string;
  currency: string;
  customer_id: string | null;
  description: string | null;
  payment_method_id: string | null;
  failure_code: string | null;
  refunded_minor: number;
  refund_reserved_minor: number;
  refundable_minor: number;
  created_at: string;
  updated_at: string;
}

export type PaymentMethodType = "card" | "upi" | "bank" | "wallet";

export interface PaymentMethod {
  object: "payment_method";
  id: string;
  type: PaymentMethodType;
  label: string;
  last4: string | null;
  network: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  status: "active" | "disabled";
  created_at: string;
}

export interface Payout {
  object: "payout";
  id: string;
  status: "pending" | "processing" | "paid" | "failed" | "unknown";
  amount_minor: number;
  amount: string;
  currency: string;
  destination: string;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface Dispute {
  object: "dispute";
  id: string;
  payment_id: string;
  status: "open" | "won" | "lost";
  amount_minor: number;
  amount: string;
  reason: string;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface WebhookEndpoint {
  object: "webhook_endpoint";
  id: string;
  url: string;
  description: string | null;
  status: "active" | "disabled";
  created_at: string;
}

export interface WebhookEvent {
  object: "webhook_event";
  id: string;
  type: string;
  status: "pending" | "delivered" | "failed" | "dead";
  attempts: number;
  last_error: string | null;
  payload: unknown;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  object: "webhook_delivery";
  id: string;
  event_id: string;
  endpoint_id: string;
  attempt: number;
  status: "delivered" | "failed";
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  created_at: string;
}

export interface ApiKey {
  object: "api_key";
  id: string;
  prefix: string;
  name: string | null;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  status: "active" | "revoked";
}

export interface PaymentReport {
  from: string;
  to: string;
  payments: number;
  succeeded: number;
  failed: number;
  gross_minor: number;
  refunded_minor: number;
  net_minor: number;
  rows: {
    id: string;
    created_at: string;
    status: string;
    amount_minor: number;
    amount: string;
    currency: string;
    customer_id: string | null;
    description: string | null;
    refunded_minor: number;
    failure_code: string | null;
  }[];
}

export interface Capabilities {
  object: "capabilities";
  api_version: string;
  environment: string;
  merchant: { id: string; name: string };
  resources: {
    name: string;
    summary: string;
    endpoints: string[];
  }[];
  simulator: {
    scenarios: string[];
    outcome_distributions: Record<string, unknown>;
    payment_method_types: string[];
  };
  webhooks: {
    event_types: string[];
    signature_header: string;
    signature_scheme: string;
  };
  limits: {
    max_amount_minor: number;
    default_page_size: number;
    max_page_size: number;
    rate_limit_per_minute: number;
    idempotency_ttl_hours: number;
    max_job_attempts: number;
  };
  error_codes: string[];
}

export interface SettlementReport {
  date: string;
  captured_minor: number;
  refunded_minor: number;
  dispute_loss_minor: number;
  paid_out_minor: number;
  net_minor: number;
  payments: number;
  refunds: number;
  disputes: number;
  payouts: number;
}

export interface PaymentAttempt {
  id: string;
  attempt_number: number;
  status: string;
  processor_reference: string;
  failure_code: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface PaymentEvent {
  id: string;
  type: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  created_at: string;
}

export interface PaymentDetail extends Payment {
  attempts: PaymentAttempt[];
  events: PaymentEvent[];
}

export interface Refund {
  object: "refund";
  id: string;
  payment_id: string;
  status: RefundStatus;
  amount_minor: number;
  amount: string;
  currency: string;
  reason: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  kind: "asset" | "liability" | string;
  currency: string;
  debits_minor: number;
  credits_minor: number;
  balance_minor: number;
}

export interface Overview {
  merchant: { id: string; name: string };
  payments: {
    total: number;
    succeeded: number;
    failed: number;
    processing: number;
    by_status: Record<string, number>;
    success_rate: number;
  };
  volume: {
    gross_minor: number;
    refunded_minor: number;
    net_minor: number;
  };
  refunds: {
    total: number;
    succeeded: number;
    by_status: Record<string, number>;
  };
  ledger: {
    balanced: boolean;
    debits_minor: number;
    credits_minor: number;
    accounts: Account[];
  };
  jobs: Record<string, number>;
  recent_payments: Payment[];
}

export interface Job {
  id: string;
  kind: string;
  aggregate_id: string | null;
  status:
    | "pending"
    | "retrying"
    | "running"
    | "succeeded"
    | "dead"
    | "canceled";
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobsResponse {
  data: Job[];
  summary: {
    by_status: Record<string, number>;
    oldest_active_at: string | null;
    oldest_active_age_seconds: number | null;
  };
}

export interface TimeseriesPoint {
  date: string;
  payments: number;
  succeeded: number;
  failed: number;
  volume_minor: number;
}

export interface TimeseriesResponse {
  days: number;
  data: TimeseriesPoint[];
}

export interface JournalEntry {
  id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  direction: "debit" | "credit";
  amount_minor: number;
}

export interface Journal {
  id: string;
  source_type: string;
  source_id: string;
  status: string;
  currency: string;
  created_at: string;
  entries: JournalEntry[];
}

export interface AccountsResponse {
  data: Account[];
  trial_balance: {
    debits_minor: number;
    credits_minor: number;
    balanced: boolean;
  };
}

export interface Merchant {
  object: "merchant";
  id: string;
  name: string;
  environment: string;
}

export interface DemoSession {
  api_key: string;
  merchant: { id: string; name: string };
  environment: string;
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

let apiKey: string | null = null;

export function setApiKey(key: string | null): void {
  apiKey = key;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function queryString(
  params: Record<string, string | number | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "Could not reach the PayFlow API. Is it running on port 4000?",
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const envelope = payload as {
      error?: {
        code?: string;
        message?: string;
        request_id?: string;
        details?: unknown;
      };
    } | null;
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? "request_failed",
      envelope?.error?.message ??
        `Request failed with status ${response.status}.`,
      envelope?.error?.request_id,
      envelope?.error?.details,
    );
  }

  return payload as T;
}

export interface CreatePaymentInput {
  amount_minor: number;
  customer_id?: string | null;
  description?: string | null;
  simulator_scenario?: Scenario;
}

export interface CreateRefundInput {
  payment_id: string;
  amount_minor?: number | null;
  reason?: string | null;
  simulator_scenario?: Scenario;
}

export interface RawResponse {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  body: unknown;
  raw: string;
}

export const api = {
  demoSession: () => request<DemoSession>("/v1/demo/session"),
  me: () => request<Merchant>("/v1/merchants/me"),
  overview: () => request<Overview>("/v1/stats/overview"),
  timeseries: (days = 14) =>
    request<TimeseriesResponse>(`/v1/stats/timeseries${queryString({ days })}`),

  payments: (params: {
    limit?: number;
    cursor?: string | null;
    status?: string | null;
  }) =>
    request<Page<Payment>>(
      `/v1/payments${queryString({
        limit: params.limit,
        cursor: params.cursor,
        status: params.status,
      })}`,
    ),
  payment: (id: string) => request<PaymentDetail>(`/v1/payments/${id}`),
  createPayment: (input: CreatePaymentInput, idempotencyKey?: string) =>
    request<Payment>("/v1/payments", {
      method: "POST",
      body: JSON.stringify(input),
      headers: idempotencyKey
        ? { "Idempotency-Key": idempotencyKey }
        : undefined,
    }),
  cancelPayment: (id: string) =>
    request<Payment>(`/v1/payments/${id}/cancel`, { method: "POST" }),

  refunds: (params: {
    limit?: number;
    cursor?: string | null;
    status?: string | null;
    payment_id?: string | null;
  }) =>
    request<Page<Refund>>(
      `/v1/refunds${queryString({
        limit: params.limit,
        cursor: params.cursor,
        status: params.status,
        payment_id: params.payment_id,
      })}`,
    ),
  createRefund: (input: CreateRefundInput, idempotencyKey?: string) =>
    request<Refund>("/v1/refunds", {
      method: "POST",
      body: JSON.stringify(input),
      headers: idempotencyKey
        ? { "Idempotency-Key": idempotencyKey }
        : undefined,
    }),
  cancelRefund: (id: string) =>
    request<Refund>(`/v1/refunds/${id}/cancel`, { method: "POST" }),

  accounts: () => request<AccountsResponse>("/v1/accounts"),
  journals: (params: { limit?: number; cursor?: string | null }) =>
    request<Page<Journal>>(
      `/v1/ledger/journals${queryString({
        limit: params.limit,
        cursor: params.cursor,
      })}`,
    ),

  paymentMethods: (params?: { limit?: number; cursor?: string | null }) =>
    request<Page<PaymentMethod>>(
      `/v1/payment_methods${queryString({
        limit: params?.limit,
        cursor: params?.cursor,
      })}`,
    ),
  createPaymentMethod: (input: {
    type: PaymentMethodType;
    label: string;
    last4?: string | null;
    network?: string | null;
    expiry_month?: number | null;
    expiry_year?: number | null;
  }) =>
    request<PaymentMethod>("/v1/payment_methods", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  disablePaymentMethod: (id: string) =>
    request<PaymentMethod>(`/v1/payment_methods/${id}/disable`, {
      method: "POST",
    }),

  payouts: (params?: {
    limit?: number;
    cursor?: string | null;
    status?: string | null;
  }) =>
    request<Page<Payout>>(
      `/v1/payouts${queryString({
        limit: params?.limit,
        cursor: params?.cursor,
        status: params?.status,
      })}`,
    ),
  createPayout: (input: {
    amount_minor: number;
    destination: string;
    simulator_scenario?: Scenario;
  }) =>
    request<Payout>("/v1/payouts", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  disputes: (params?: {
    limit?: number;
    cursor?: string | null;
    status?: string | null;
  }) =>
    request<Page<Dispute>>(
      `/v1/disputes${queryString({
        limit: params?.limit,
        cursor: params?.cursor,
        status: params?.status,
      })}`,
    ),
  createDispute: (input: {
    payment_id: string;
    amount_minor?: number | null;
    reason: string;
    note?: string | null;
  }) =>
    request<Dispute>("/v1/disputes", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  resolveDispute: (id: string, outcome: "won" | "lost", note?: string | null) =>
    request<Dispute>(`/v1/disputes/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ outcome, note }),
    }),

  webhookEndpoints: () =>
    request<{ data: WebhookEndpoint[] }>("/v1/webhook_endpoints"),
  createWebhookEndpoint: (input: {
    url: string;
    description?: string | null;
  }) =>
    request<WebhookEndpoint & { secret: string }>("/v1/webhook_endpoints", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  disableWebhookEndpoint: (id: string) =>
    request<WebhookEndpoint>(`/v1/webhook_endpoints/${id}/disable`, {
      method: "POST",
    }),
  webhookEvents: (params?: { limit?: number; cursor?: string | null }) =>
    request<Page<WebhookEvent>>(
      `/v1/webhook_events${queryString({
        limit: params?.limit,
        cursor: params?.cursor,
      })}`,
    ),
  webhookDeliveries: (params?: { limit?: number; cursor?: string | null }) =>
    request<Page<WebhookDelivery>>(
      `/v1/webhook_deliveries${queryString({
        limit: params?.limit,
        cursor: params?.cursor,
      })}`,
    ),

  capabilities: () => request<Capabilities>("/v1"),

  jobs: (params?: { limit?: number; status?: Job["status"] }) =>
    request<JobsResponse>(`/v1/jobs${queryString(params ?? {})}`),
  retryJob: (id: string) =>
    request<Job>(`/v1/jobs/${id}/retry`, { method: "POST" }),

  apiKeys: () => request<{ data: ApiKey[] }>("/v1/api_keys"),
  createApiKey: (name?: string | null) =>
    request<ApiKey & { secret: string }>("/v1/api_keys", {
      method: "POST",
      body: JSON.stringify({ name: name ?? null }),
    }),
  revokeApiKey: (id: string) =>
    request<ApiKey>(`/v1/api_keys/${id}/revoke`, { method: "POST" }),

  paymentReport: (from: string, to: string) =>
    request<PaymentReport>(`/v1/reports/payments${queryString({ from, to })}`),
  settlementReport: (date: string) =>
    request<SettlementReport>(`/v1/reports/settlement${queryString({ date })}`),
};

export async function rawRequest(input: {
  method: string;
  path: string;
  body?: string | null;
  extraHeaders?: Record<string, string>;
}): Promise<RawResponse> {
  const headers: Record<string, string> = { ...(input.extraHeaders ?? {}) };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (input.body?.trim()) headers["Content-Type"] = "application/json";

  const started = performance.now();
  const response = await fetch(`${BASE}${input.path}`, {
    method: input.method,
    headers,
    body: input.body?.trim() ? input.body : undefined,
  });
  const raw = await response.text();
  const durationMs = Math.round(performance.now() - started);

  let body: unknown = raw;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {}

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    status: response.status,
    statusText: response.statusText,
    durationMs,
    headers: responseHeaders,
    body,
    raw,
  };
}
