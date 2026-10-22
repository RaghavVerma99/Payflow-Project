import { createHmac, randomBytes } from "node:crypto";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "../db";
import {
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
  type WebhookDeliveryRow,
  type WebhookEndpointRow,
  type WebhookEventRow,
} from "../schema";
import {
  decodeCursor,
  encodeCursor,
  errors,
  newId,
  nowIso,
  type Page,
  type WebhookEventType,
} from "../domain";
import { enqueue } from "./jobs";

export function emitWebhookEvent(
  tx: Db,
  merchantId: string,
  type: WebhookEventType,
  data: unknown,
): string {
  const id = newId("evt");
  const now = nowIso();

  tx.insert(webhookEvents)
    .values({
      id,
      merchantId,
      type,
      payload: JSON.stringify({ id, type, created_at: now, data }),
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  enqueue(tx, {
    kind: "deliver_webhooks",
    aggregateId: id,
    payload: { event_id: id },
  });

  return id;
}

export function createEndpoint(
  db: Db,
  input: {
    merchantId: string;
    url: string;
    description?: string | null;
    allowPrivateHosts?: boolean;
  },
): { endpoint: WebhookEndpointRow; secret: string } {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw errors.invalidWebhookUrl("Webhook url must be a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw errors.invalidWebhookUrl("Webhook url must use http or https.");
  }

  if (input.allowPrivateHosts === false && isPrivateHost(parsed.hostname)) {
    throw errors.invalidWebhookUrl(
      "Webhook url must not target a private or loopback address.",
    );
  }

  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const endpoint: WebhookEndpointRow = {
    id: newId("whe"),
    merchantId: input.merchantId,
    url: parsed.toString(),
    secret,
    description: input.description ?? null,
    status: "active",
    createdAt: nowIso(),
  };

  db.insert(webhookEndpoints).values(endpoint).run();
  return { endpoint, secret };
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;

  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;

  return false;
}

export function getEndpoint(
  db: Db,
  merchantId: string,
  endpointId: string,
): WebhookEndpointRow {
  const endpoint = db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.merchantId, merchantId),
      ),
    )
    .get();

  if (!endpoint) throw errors.notFound("Webhook endpoint");
  return endpoint;
}

export function disableEndpoint(
  db: Db,
  merchantId: string,
  endpointId: string,
): WebhookEndpointRow {
  const endpoint = getEndpoint(db, merchantId, endpointId);
  db.update(webhookEndpoints)
    .set({ status: "disabled" })
    .where(eq(webhookEndpoints.id, endpoint.id))
    .run();
  return { ...endpoint, status: "disabled" };
}

export function listEndpoints(
  db: Db,
  merchantId: string,
): WebhookEndpointRow[] {
  return db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.merchantId, merchantId))
    .orderBy(desc(webhookEndpoints.createdAt))
    .all();
}

export function listEvents(
  db: Db,
  merchantId: string,
  limit: number,
  cursor?: string | null,
  status?: string | null,
): Page<WebhookEventRow> {
  const anchor = cursor ? decodeCursor(cursor) : null;

  const rows = db
    .select()
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.merchantId, merchantId),
        status ? eq(webhookEvents.status, status) : undefined,
        anchor
          ? or(
              lt(webhookEvents.createdAt, anchor.createdAt),
              and(
                eq(webhookEvents.createdAt, anchor.createdAt),
                lt(webhookEvents.id, anchor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(webhookEvents.createdAt), desc(webhookEvents.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  return {
    data: page,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(last) : null,
  };
}

export function listDeliveries(
  db: Db,
  merchantId: string,
  limit: number,
  cursor?: string | null,
): Page<WebhookDeliveryRow> {
  const anchor = cursor ? decodeCursor(cursor) : null;

  const rows = db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.merchantId, merchantId),
        anchor
          ? or(
              lt(webhookDeliveries.createdAt, anchor.createdAt),
              and(
                eq(webhookDeliveries.createdAt, anchor.createdAt),
                lt(webhookDeliveries.id, anchor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  return {
    data: page,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(last) : null,
  };
}

export function getEvent(
  db: Db,
  merchantId: string,
  eventId: string,
): WebhookEventRow {
  const event = db
    .select()
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.id, eventId),
        eq(webhookEvents.merchantId, merchantId),
      ),
    )
    .get();

  if (!event) throw errors.notFound("Webhook event");
  return event;
}

export function signPayload(
  secret: string,
  timestamp: number,
  body: string,
): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export interface DeliveryResult {
  endpointId: string;
  status: "delivered" | "failed";
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
}

export async function deliverToEndpoint(
  endpoint: WebhookEndpointRow,
  event: WebhookEventRow,
  attempt: number,
  timeoutMs = 4000,
): Promise<DeliveryResult> {
  const body = event.payload;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(endpoint.secret, timestamp, body);

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "PayFlow-Webhooks/1.0",
        "x-payflow-event": event.type,
        "x-payflow-event-id": event.id,
        "x-payflow-delivery": `${event.id}.${attempt}`,
        "x-payflow-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();

    if (!response.ok) {
      return {
        endpointId: endpoint.id,
        status: "failed",
        responseStatus: response.status,
        responseBody: text.slice(0, 500),
        error: `Endpoint responded with ${response.status}.`,
      };
    }

    return {
      endpointId: endpoint.id,
      status: "delivered",
      responseStatus: response.status,
      responseBody: text.slice(0, 500),
      error: null,
    };
  } catch (error) {
    return {
      endpointId: endpoint.id,
      status: "failed",
      responseStatus: null,
      responseBody: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function recordDelivery(
  db: Db,
  input: {
    event: WebhookEventRow;
    attempt: number;
    result: DeliveryResult;
  },
): WebhookDeliveryRow {
  const delivery: WebhookDeliveryRow = {
    id: newId("whd"),
    eventId: input.event.id,
    endpointId: input.result.endpointId,
    merchantId: input.event.merchantId,
    attempt: input.attempt,
    status: input.result.status,
    responseStatus: input.result.responseStatus,
    responseBody: input.result.responseBody,
    error: input.result.error,
    createdAt: nowIso(),
  };

  db.insert(webhookDeliveries).values(delivery).run();
  return delivery;
}
