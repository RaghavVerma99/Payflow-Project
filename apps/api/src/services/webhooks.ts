import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
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

  if (parsed.username || parsed.password) {
    throw errors.invalidWebhookUrl("Webhook url must not include credentials.");
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
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const family = isIP(host);
  if (family === 4) {
    const octets = host.split(".").map(Number);
    const [a, b, c] = octets;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          (b === 0 && (c === 0 || c === 2)) ||
          (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family !== 6) return false;

  const expanded = expandIpv6(host);
  if (!expanded) return true;
  const first = Number.parseInt(expanded.slice(0, 4), 16);
  const address = BigInt(`0x${expanded}`);
  const inRange = (prefix: bigint, bits: number) =>
    address >> BigInt(128 - bits) ===
    prefix >> BigInt(128 - bits);
  if (address === 0n || address === 1n) return true;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (!inRange(0x2000n << 112n, 3)) return true;
  if (
    inRange(0x20010db8n << 96n, 32) ||
    inRange(0x20010000n << 96n, 23)
  ) return true;
  return false;
}

function expandIpv6(host: string): string | null {
  let value = host;
  if (value.includes(".")) {
    const split = value.lastIndexOf(":");
    const octets = value.slice(split + 1).split(".").map(Number);
    if (
      octets.length !== 4 ||
      octets.some((part) => part < 0 || part > 255)
    ) {
      return null;
    }
    const upper = ((octets[0] << 8) | octets[1]).toString(16);
    const lower = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${value.slice(0, split)}:${upper}:${lower}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const zeros = 8 - left.length - right.length;
  if (zeros < 0 || (halves.length === 1 && zeros !== 0)) return null;
  const groups = [...left, ...Array(zeros).fill("0"), ...right];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[\da-f]{1,4}$/i.test(group))
  ) {
    return null;
  }
  return groups.map((group) => group.padStart(4, "0")).join("");
}

async function destinationAddress(hostname: string, allowPrivateHosts: boolean) {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(normalized, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Webhook host did not resolve.");
  if (!allowPrivateHosts && addresses.some(({ address }) => isPrivateHost(address))) {
    throw new Error("Webhook host resolved to a private or reserved address.");
  }
  return addresses[0];
}

async function postPinned(
  target: URL,
  address: { address: string; family: number },
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(target, {
      method: "POST",
      headers,
      servername:
        target.protocol === "https:" && isIP(target.hostname) === 0
          ? target.hostname
          : undefined,
      lookup: (_hostname, _options, callback) =>
        callback(null, address.address, address.family),
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (size + buffer.length > 4096) {
          response.destroy(new Error("Webhook response exceeded 4 KB."));
          return;
        }
        chunks.push(buffer);
        size += buffer.length;
      });
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
      response.on("error", reject);
    });
    const timer = setTimeout(
      () => request.destroy(new Error("Webhook request timed out.")),
      timeoutMs,
    );
    timer.unref();
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end(body);
  });
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
  allowPrivateHosts = true,
): Promise<DeliveryResult> {
  const body = event.payload;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(endpoint.secret, timestamp, body);

  try {
    const target = new URL(endpoint.url);
    if (target.username || target.password) {
      throw new Error("Webhook url must not include credentials.");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("Webhook url must use http or https.");
    }
    const address = await destinationAddress(target.hostname, allowPrivateHosts);
    const response = await postPinned(
      target,
      address,
      {
        "content-type": "application/json",
        "user-agent": "PayFlow-Webhooks/1.0",
        "x-payflow-event": event.type,
        "x-payflow-event-id": event.id,
        "x-payflow-delivery": `${event.id}.${attempt}`,
        "x-payflow-signature": signature,
      },
      body,
      timeoutMs,
    );
    const text = response.body;

    if (response.status < 200 || response.status >= 300) {
      return {
        endpointId: endpoint.id,
        status: "failed",
        responseStatus: response.status,
        responseBody: text.slice(0, 500),
        error: `Endpoint responded with ${response.status}; redirects are not followed.`,
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
