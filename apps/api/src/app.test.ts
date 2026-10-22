import type { FastifyInstance } from "fastify";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createMerchant } from "./services/auth";
import { runDrain } from "./worker";

const PEPPER = "test-pepper";

let app: FastifyInstance;
let key: string;
let merchantId: string;

function auth(keyValue = key) {
  return { authorization: `Bearer ${keyValue}` };
}

async function drain(): Promise<number> {
  return runDrain({
    db: app.db,
    config: app.config,
    workerId: "test-worker",
  });
}

async function createPayment(
  payload: Record<string, unknown> = {},
  idempotencyKey?: string,
) {
  return app.inject({
    method: "POST",
    url: "/v1/payments",
    headers: {
      ...auth(),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    payload: { amount_minor: 24_900, ...payload },
  });
}

async function getPayment(id: string) {
  return app.inject({
    method: "GET",
    url: `/v1/payments/${id}`,
    headers: auth(),
  });
}

function jobCount(kind: string, status?: string): number {
  const row = app.sqlite
    .prepare(
      status
        ? "select count(*) as value from jobs where kind = ? and status = ?"
        : "select count(*) as value from jobs where kind = ?",
    )
    .get(...(status ? [kind, status] : [kind])) as { value: number };
  return Number(row.value);
}

interface Sink {
  url: string;
  received: { body: string; signature?: string }[];
  close: () => void;
}

async function startSink(): Promise<Sink> {
  const received: { body: string; signature?: string }[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({
        body,
        signature: request.headers["x-payflow-signature"] as string | undefined,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/hook`,
    received,
    close: () => server.close(),
  };
}

async function createRefund(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/refunds",
    headers: auth(),
    payload,
  });
}

beforeEach(async () => {
  app = createApp({
    dbPath: ":memory:",
    config: {
      env: "test",
      workerEnabled: false,
      allowSimulatorControls: true,
      apiKeyPepper: PEPPER,
      rateLimitMax: 100_000,
      logLevel: "silent",
    },
  });
  const merchant = createMerchant(app.db, "Test Merchant", PEPPER);
  key = merchant.rawKey;
  merchantId = merchant.merchantId;
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("auth", () => {
  it("requires a bearer key", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/payments" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("unauthorized");
  });

  it("rejects an unknown key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/merchants/me",
      headers: auth("sk_test_not_a_real_key_000000"),
    });
    expect(response.statusCode).toBe(401);
  });

  it("returns the authenticated merchant", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/merchants/me",
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "merchant",
      id: merchantId,
      name: "Test Merchant",
      environment: "test",
    });
  });
});

describe("payments", () => {
  it("creates a payment, replays idempotently and rejects a changed body", async () => {
    const body = { amount_minor: 12_500, simulator_scenario: "approve" };
    const first = await createPayment(body, "idem-1");
    expect(first.statusCode).toBe(202);
    const created = first.json();

    const replay = await createPayment(body, "idem-1");
    expect(replay.statusCode).toBe(202);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json().id).toBe(created.id);

    const conflict = await createPayment(
      { amount_minor: 13_000, simulator_scenario: "approve" },
      "idem-1",
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("idempotency_key_reused");
  });

  it("validates the request body", async () => {
    const response = await createPayment({ amount_minor: 0 });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
  });

  it("approves, settles and posts a balanced journal", async () => {
    const created = (
      await createPayment({ simulator_scenario: "approve" })
    ).json();
    await drain();

    const detail = (await getPayment(created.id)).json();
    expect(detail.status).toBe("succeeded");
    expect(detail.failure_code).toBeNull();
    expect(detail.attempts).toHaveLength(1);
    expect(detail.events.map((event: { type: string }) => event.type)).toEqual([
      "payment.created",
      "payment.processing",
      "payment.succeeded",
    ]);

    const accounts = (
      await app.inject({
        method: "GET",
        url: "/v1/accounts",
        headers: auth(),
      })
    ).json();
    expect(accounts.trial_balance.balanced).toBe(true);
    expect(
      accounts.data.find(
        (account: { code: string }) => account.code === "processor_clearing",
      ).balance_minor,
    ).toBe(24_900);

    const journals = (
      await app.inject({
        method: "GET",
        url: "/v1/ledger/journals",
        headers: auth(),
      })
    ).json();
    expect(journals.data).toHaveLength(1);
    expect(journals.data[0].entries).toHaveLength(2);
  });

  it("declines without posting a journal", async () => {
    const created = (
      await createPayment({ simulator_scenario: "decline" })
    ).json();
    await drain();

    const detail = (await getPayment(created.id)).json();
    expect(detail.status).toBe("failed");
    expect(detail.failure_code).toBe("card_declined");

    const journals = (
      await app.inject({
        method: "GET",
        url: "/v1/ledger/journals",
        headers: auth(),
      })
    ).json();
    expect(journals.data).toHaveLength(0);
  });

  it("cancels before processing and skips the queued job", async () => {
    const created = (await createPayment()).json();
    const canceled = await app.inject({
      method: "POST",
      url: `/v1/payments/${created.id}/cancel`,
      headers: auth(),
    });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().status).toBe("canceled");

    await drain();
    const detail = (await getPayment(created.id)).json();
    expect(detail.status).toBe("canceled");
    expect(detail.attempts).toHaveLength(0);
    expect(jobCount("process_payment", "pending")).toBe(0);
  });

  it("retries transient errors and records both attempts", async () => {
    const created = (
      await createPayment({ simulator_scenario: "transient" })
    ).json();
    await drain();

    const pending = (await getPayment(created.id)).json();
    expect(pending.status).toBe("processing");
    expect(pending.attempts).toHaveLength(1);

    app.sqlite
      .prepare("update jobs set next_run_at = ? where kind = 'process_payment'")
      .run("2000-01-01T00:00:00.000Z");
    await drain();

    const settled = (await getPayment(created.id)).json();
    expect(settled.status).toBe("succeeded");
    expect(settled.attempts).toHaveLength(2);
  });

  it("marks a timeout unknown, then reconciles it", async () => {
    const created = (
      await createPayment({ simulator_scenario: "timeout" })
    ).json();
    await drain();

    const pending = (await getPayment(created.id)).json();
    expect(pending.status).toBe("unknown");

    app.sqlite
      .prepare(
        "update jobs set next_run_at = ? where kind = 'reconcile_payment'",
      )
      .run("2000-01-01T00:00:00.000Z");
    await drain();

    const resolved = (await getPayment(created.id)).json();
    expect(["succeeded", "failed"]).toContain(resolved.status);
  });

  it("paginates with an opaque cursor", async () => {
    await createPayment({ amount_minor: 100 });
    await createPayment({ amount_minor: 200 });
    await createPayment({ amount_minor: 300 });

    const first = (
      await app.inject({
        method: "GET",
        url: "/v1/payments?limit=2",
        headers: auth(),
      })
    ).json();
    expect(first.data).toHaveLength(2);
    expect(first.has_more).toBe(true);
    expect(first.next_cursor).toBeTruthy();

    const second = (
      await app.inject({
        method: "GET",
        url: `/v1/payments?limit=2&cursor=${encodeURIComponent(first.next_cursor)}`,
        headers: auth(),
      })
    ).json();
    expect(second.data).toHaveLength(1);
    expect(second.has_more).toBe(false);
  });

  it("does not expose payments across merchants", async () => {
    const created = (await createPayment()).json();
    const other = createMerchant(app.db, "Another Merchant", PEPPER);

    const response = await app.inject({
      method: "GET",
      url: `/v1/payments/${created.id}`,
      headers: auth(other.rawKey),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("refunds", () => {
  it("partially refunds, reserves capacity and posts the reversing entry", async () => {
    const created = (
      await createPayment({ simulator_scenario: "approve" })
    ).json();
    await drain();

    const refund = await createRefund({
      payment_id: created.id,
      amount_minor: 5_000,
      reason: "damaged item",
      simulator_scenario: "approve",
    });
    expect(refund.statusCode).toBe(202);
    expect(refund.json().status).toBe("reserved");

    await drain();

    const detail = (await getPayment(created.id)).json();
    expect(detail.status).toBe("partially_refunded");
    expect(detail.refunded_minor).toBe(5_000);
    expect(detail.refundable_minor).toBe(19_900);

    const accounts = (
      await app.inject({
        method: "GET",
        url: "/v1/accounts",
        headers: auth(),
      })
    ).json();
    expect(accounts.trial_balance.balanced).toBe(true);
    expect(
      accounts.data.find(
        (account: { code: string }) => account.code === "processor_clearing",
      ).balance_minor,
    ).toBe(19_900);

    const journals = (
      await app.inject({
        method: "GET",
        url: "/v1/ledger/journals",
        headers: auth(),
      })
    ).json();
    expect(journals.data).toHaveLength(2);
  });

  it("rejects refunds above the remaining capacity", async () => {
    const created = (
      await createPayment({ simulator_scenario: "approve" })
    ).json();
    await drain();

    const response = await createRefund({
      payment_id: created.id,
      amount_minor: 30_000,
      simulator_scenario: "approve",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("refund_exceeds_remaining");
  });

  it("releases the reservation when the processor declines", async () => {
    const created = (
      await createPayment({ simulator_scenario: "approve" })
    ).json();
    await drain();

    await createRefund({
      payment_id: created.id,
      amount_minor: 5_000,
      simulator_scenario: "decline",
    });
    await drain();

    const detail = (await getPayment(created.id)).json();
    expect(detail.status).toBe("succeeded");
    expect(detail.refund_reserved_minor).toBe(0);
    expect(detail.refunded_minor).toBe(0);
    expect(detail.refundable_minor).toBe(24_900);
  });

  it("marks a timed-out refund unknown, then reconciles it", async () => {
    const created = (
      await createPayment({ simulator_scenario: "approve" })
    ).json();
    await drain();

    const refund = await createRefund({
      payment_id: created.id,
      amount_minor: 5_000,
      simulator_scenario: "timeout",
    });
    expect(refund.statusCode).toBe(202);
    await drain();

    const pending = (
      await app.inject({
        method: "GET",
        url: `/v1/refunds/${refund.json().id}`,
        headers: auth(),
      })
    ).json();
    expect(pending.status).toBe("unknown");

    app.sqlite
      .prepare(
        "update jobs set next_run_at = ? where kind = 'reconcile_refund'",
      )
      .run("2000-01-01T00:00:00.000Z");
    await drain();

    const resolved = (
      await app.inject({
        method: "GET",
        url: `/v1/refunds/${refund.json().id}`,
        headers: auth(),
      })
    ).json();
    expect(["succeeded", "failed"]).toContain(resolved.status);
  });

  it("cancels a reserved refund and releases its capacity", async () => {
    const created = (
      await createPayment({ simulator_scenario: "approve" })
    ).json();
    await drain();

    const refund = await createRefund({
      payment_id: created.id,
      amount_minor: 5_000,
      simulator_scenario: "approve",
    });
    expect(refund.statusCode).toBe(202);

    const reserved = (await getPayment(created.id)).json();
    expect(reserved.refund_reserved_minor).toBe(5_000);
    expect(reserved.refundable_minor).toBe(19_900);

    const canceled = await app.inject({
      method: "POST",
      url: `/v1/refunds/${refund.json().id}/cancel`,
      headers: auth(),
    });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().status).toBe("canceled");

    const after = (await getPayment(created.id)).json();
    expect(after.refund_reserved_minor).toBe(0);
    expect(after.refunded_minor).toBe(0);
    expect(after.refundable_minor).toBe(24_900);
    expect(after.status).toBe("succeeded");
    expect(after.events.at(-1).type).toBe("refund.canceled");

    await drain();
    expect(jobCount("process_refund", "pending")).toBe(0);

    const again = await app.inject({
      method: "POST",
      url: `/v1/refunds/${refund.json().id}/cancel`,
      headers: auth(),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("refund_not_cancelable");
  });

  it("paginates the refunds of a single payment", async () => {
    const created = (
      await createPayment({ simulator_scenario: "approve" })
    ).json();
    await drain();

    for (const key of ["refund-page-1", "refund-page-2"]) {
      await app.inject({
        method: "POST",
        url: "/v1/refunds",
        headers: { ...auth(), "idempotency-key": key },
        payload: {
          payment_id: created.id,
          amount_minor: 5_000,
          simulator_scenario: "approve",
        },
      });
    }
    await drain();

    const page = (
      await app.inject({
        method: "GET",
        url: `/v1/payments/${created.id}/refunds?limit=1`,
        headers: auth(),
      })
    ).json();

    expect(page.data).toHaveLength(1);
    expect(page.has_more).toBe(true);
    expect(page.next_cursor).toBeTruthy();
  });
});

describe("ledger", () => {
  it("starts balanced with both accounts", async () => {
    const accounts = (
      await app.inject({
        method: "GET",
        url: "/v1/accounts",
        headers: auth(),
      })
    ).json();
    expect(accounts.data).toHaveLength(2);
    expect(accounts.trial_balance.balanced).toBe(true);
  });

  it("rejects updates to posted entries", async () => {
    await createPayment({ simulator_scenario: "approve" });
    await drain();

    expect(() =>
      app.sqlite
        .prepare("update ledger_entries set amount_minor = amount_minor + 1")
        .run(),
    ).toThrow(/immutable/);
  });
});

describe("analytics", () => {
  it("aggregates volume, refunds and ledger health", async () => {
    const created = (
      await createPayment({ simulator_scenario: "approve" })
    ).json();
    await drain();
    await createRefund({
      payment_id: created.id,
      amount_minor: 5_000,
      simulator_scenario: "approve",
    });
    await drain();

    const overview = (
      await app.inject({
        method: "GET",
        url: "/v1/stats/overview",
        headers: auth(),
      })
    ).json();

    expect(overview.payments.total).toBe(1);
    expect(overview.payments.succeeded).toBe(1);
    expect(overview.volume.gross_minor).toBe(24_900);
    expect(overview.volume.refunded_minor).toBe(5_000);
    expect(overview.volume.net_minor).toBe(19_900);
    expect(overview.refunds.succeeded).toBe(1);
    expect(overview.ledger.balanced).toBe(true);

    const series = (
      await app.inject({
        method: "GET",
        url: "/v1/stats/timeseries?days=7",
        headers: auth(),
      })
    ).json();
    expect(series.days).toBe(7);
    expect(series.data).toHaveLength(7);
    expect(series.data.at(-1).volume_minor).toBe(24_900);
  });

  it("exposes health and queue depth", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: "ok",
      checks: { database: "ok", worker: "disabled" },
    });
  });
});

describe("configuration", () => {
  async function customApp(
    overrides: Record<string, unknown>,
  ): Promise<{ instance: FastifyInstance; headers: Record<string, string> }> {
    const instance = createApp({
      dbPath: ":memory:",
      config: {
        env: "test",
        workerEnabled: false,
        allowSimulatorControls: true,
        apiKeyPepper: PEPPER,
        rateLimitMax: 100_000,
        logLevel: "silent",
        ...overrides,
      },
    });
    const merchant = createMerchant(instance.db, "Custom Merchant", PEPPER);
    await instance.ready();
    return {
      instance,
      headers: { authorization: `Bearer ${merchant.rawKey}` },
    };
  }

  it("applies the configured page size", async () => {
    const { instance, headers } = await customApp({
      defaultPageSize: 1,
      maxPageSize: 2,
    });

    for (const amount of [100, 200]) {
      await instance.inject({
        method: "POST",
        url: "/v1/payments",
        headers,
        payload: { amount_minor: amount },
      });
    }

    const page = (
      await instance.inject({
        method: "GET",
        url: "/v1/payments",
        headers,
      })
    ).json();
    expect(page.data).toHaveLength(1);
    expect(page.has_more).toBe(true);

    const tooLarge = await instance.inject({
      method: "GET",
      url: "/v1/payments?limit=3",
      headers,
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json().error.code).toBe("validation_error");

    await instance.close();
  });

  it("expires idempotency keys once the ttl passes", async () => {
    const { instance, headers } = await customApp({
      idempotencyTtlHours: 0,
    });

    const request = {
      method: "POST",
      url: "/v1/payments",
      headers: { ...headers, "idempotency-key": "ttl-1" },
      payload: { amount_minor: 100 },
    };

    const first = await instance.inject(request);
    expect(first.statusCode).toBe(202);

    const second = await instance.inject(request);
    expect(second.statusCode).toBe(202);
    expect(second.headers["idempotency-replayed"]).toBeUndefined();
    expect(second.json().id).not.toBe(first.json().id);

    await instance.close();
  });
});

describe("payment methods", () => {
  it("creates, lists and disables a tokenized instrument", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/payment_methods",
      headers: auth(),
      payload: {
        type: "card",
        label: "Acme corporate card",
        last4: "4242",
        network: "visa",
        expiry_month: 11,
        expiry_year: 2030,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      object: "payment_method",
      type: "card",
      last4: "4242",
      status: "active",
    });

    const list = (
      await app.inject({
        method: "GET",
        url: "/v1/payment_methods",
        headers: auth(),
      })
    ).json();
    expect(list.data).toHaveLength(1);

    const disabled = await app.inject({
      method: "POST",
      url: `/v1/payment_methods/${created.json().id}/disable`,
      headers: auth(),
    });
    expect(disabled.json().status).toBe("disabled");
  });

  it("rejects a card without a last four", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/payment_methods",
      headers: auth(),
      payload: { type: "card", label: "No digits" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_payment_method");
  });

  it("refuses a disabled method and hides other merchants' methods", async () => {
    const method = (
      await app.inject({
        method: "POST",
        url: "/v1/payment_methods",
        headers: auth(),
        payload: { type: "upi", label: "upi handle" },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/v1/payment_methods/${method.id}/disable`,
      headers: auth(),
    });

    const rejected = await createPayment({ payment_method_id: method.id });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe("payment_method_not_active");

    const other = createMerchant(app.db, "Other Merchant", PEPPER);
    const hidden = await app.inject({
      method: "GET",
      url: `/v1/payment_methods/${method.id}`,
      headers: auth(other.rawKey),
    });
    expect(hidden.statusCode).toBe(404);
  });

  it("attaches an active method to a payment", async () => {
    const method = (
      await app.inject({
        method: "POST",
        url: "/v1/payment_methods",
        headers: auth(),
        payload: { type: "wallet", label: "Acme wallet" },
      })
    ).json();

    const payment = await createPayment({
      payment_method_id: method.id,
      simulator_scenario: "approve",
    });
    expect(payment.statusCode).toBe(202);
    expect(payment.json().payment_method_id).toBe(method.id);
  });
});

describe("webhooks", () => {
  it("emits events and delivers them with a signature", async () => {
    const sink = await startSink();

    const endpoint = await app.inject({
      method: "POST",
      url: "/v1/webhook_endpoints",
      headers: auth(),
      payload: { url: sink.url, description: "local sink" },
    });
    expect(endpoint.statusCode).toBe(201);
    expect(endpoint.json().secret).toMatch(/^whsec_/);

    await createPayment({ simulator_scenario: "approve" });
    await drain();

    expect(sink.received.length).toBeGreaterThanOrEqual(1);
    expect(sink.received[0].signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(JSON.parse(sink.received[0].body).type).toBe("payment.created");

    const events = (
      await app.inject({
        method: "GET",
        url: "/v1/webhook_events",
        headers: auth(),
      })
    ).json();
    expect(events.data.length).toBeGreaterThanOrEqual(2);
    expect(
      events.data.some((e: { type: string }) => e.type === "payment.succeeded"),
    ).toBe(true);

    const deliveries = (
      await app.inject({
        method: "GET",
        url: "/v1/webhook_deliveries",
        headers: auth(),
      })
    ).json();
    expect(deliveries.data[0].status).toBe("delivered");
    expect(deliveries.data[0].response_status).toBe(200);

    sink.close();
  });

  it("records a failed delivery and schedules a retry", async () => {
    const endpoint = await app.inject({
      method: "POST",
      url: "/v1/webhook_endpoints",
      headers: auth(),
      payload: { url: "http://127.0.0.1:1/unreachable" },
    });
    expect(endpoint.statusCode).toBe(201);

    await createPayment({ simulator_scenario: "approve" });
    await drain();

    const events = (
      await app.inject({
        method: "GET",
        url: "/v1/webhook_events",
        headers: auth(),
      })
    ).json();

    const failed = events.data.find(
      (event: { status: string }) => event.status === "failed",
    );
    expect(failed).toBeTruthy();
    expect(failed.last_error).toBeTruthy();
    expect(jobCount("deliver_webhooks", "retrying")).toBeGreaterThan(0);
  });

  it("does not deliver to disabled endpoints", async () => {
    const sink = await startSink();
    const endpoint = await app.inject({
      method: "POST",
      url: "/v1/webhook_endpoints",
      headers: auth(),
      payload: { url: sink.url },
    });

    await app.inject({
      method: "POST",
      url: `/v1/webhook_endpoints/${endpoint.json().id}/disable`,
      headers: auth(),
    });

    await createPayment({ simulator_scenario: "approve" });
    await drain();

    expect(sink.received).toHaveLength(0);
    sink.close();
  });

  it("rejects an invalid webhook url", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhook_endpoints",
      headers: auth(),
      payload: { url: "not-a-url" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_webhook_url");
  });
});

describe("payouts", () => {
  it("rejects a payout larger than the payable balance", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/payouts",
      headers: auth(),
      payload: { amount_minor: 50_000, destination: "bank://acme" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("insufficient_balance");
  });

  it("pays out and moves money to the merchant bank account", async () => {
    await createPayment({ simulator_scenario: "approve" });
    await drain();

    const payout = await app.inject({
      method: "POST",
      url: "/v1/payouts",
      headers: auth(),
      payload: {
        amount_minor: 5_000,
        destination: "bank://acme",
        simulator_scenario: "approve",
      },
    });
    expect(payout.statusCode).toBe(202);
    expect(payout.json().status).toBe("pending");

    await drain();

    const settled = (
      await app.inject({
        method: "GET",
        url: `/v1/payouts/${payout.json().id}`,
        headers: auth(),
      })
    ).json();
    expect(settled.status).toBe("paid");

    const accounts = (
      await app.inject({ method: "GET", url: "/v1/accounts", headers: auth() })
    ).json();
    const clearing = accounts.data.find(
      (account: { code: string }) => account.code === "processor_clearing",
    );
    const payable = accounts.data.find(
      (account: { code: string }) => account.code === "merchant_payable",
    );
    expect(clearing.balance_minor).toBe(19_900);
    expect(payable.balance_minor).toBe(19_900);
    expect(accounts.trial_balance.balanced).toBe(true);
  });

  it("keeps the books balanced when a payout fails", async () => {
    await createPayment({ simulator_scenario: "approve" });
    await drain();

    await app.inject({
      method: "POST",
      url: "/v1/payouts",
      headers: auth(),
      payload: {
        amount_minor: 5_000,
        destination: "bank://acme",
        simulator_scenario: "decline",
      },
    });
    await drain();

    const accounts = (
      await app.inject({ method: "GET", url: "/v1/accounts", headers: auth() })
    ).json();
    const clearing = accounts.data.find(
      (account: { code: string }) => account.code === "processor_clearing",
    );
    expect(clearing.balance_minor).toBe(24_900);
    expect(accounts.trial_balance.balanced).toBe(true);
  });
});

describe("disputes", () => {
  it("refuses to dispute a payment that has not settled", async () => {
    const created = (await createPayment()).json();
    const response = await app.inject({
      method: "POST",
      url: "/v1/disputes",
      headers: auth(),
      payload: { payment_id: created.id, reason: "fraud" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("payment_not_disputable");
  });

  it("opens and resolves a lost dispute against the merchant", async () => {
    await createPayment({ simulator_scenario: "approve" });
    await drain();

    const payment = (
      await app.inject({ method: "GET", url: "/v1/payments", headers: auth() })
    ).json();

    const dispute = await app.inject({
      method: "POST",
      url: "/v1/disputes",
      headers: auth(),
      payload: {
        payment_id: payment.data[0].id,
        amount_minor: 2_000,
        reason: "customer claims not received",
      },
    });
    expect(dispute.statusCode).toBe(201);
    expect(dispute.json().status).toBe("open");

    const resolved = await app.inject({
      method: "POST",
      url: `/v1/disputes/${dispute.json().id}/resolve`,
      headers: auth(),
      payload: { outcome: "lost" },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().status).toBe("lost");

    const accounts = (
      await app.inject({ method: "GET", url: "/v1/accounts", headers: auth() })
    ).json();
    const payable = accounts.data.find(
      (account: { code: string }) => account.code === "merchant_payable",
    );
    expect(payable.balance_minor).toBe(22_900);
    expect(accounts.trial_balance.balanced).toBe(true);

    const again = await app.inject({
      method: "POST",
      url: `/v1/disputes/${dispute.json().id}/resolve`,
      headers: auth(),
      payload: { outcome: "won" },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("dispute_not_open");
  });

  it("posts nothing when a dispute is won", async () => {
    await createPayment({ simulator_scenario: "approve" });
    await drain();

    const payment = (
      await app.inject({ method: "GET", url: "/v1/payments", headers: auth() })
    ).json();

    const dispute = await app.inject({
      method: "POST",
      url: "/v1/disputes",
      headers: auth(),
      payload: { payment_id: payment.data[0].id, reason: "duplicate" },
    });

    await app.inject({
      method: "POST",
      url: `/v1/disputes/${dispute.json().id}/resolve`,
      headers: auth(),
      payload: { outcome: "won" },
    });

    const accounts = (
      await app.inject({ method: "GET", url: "/v1/accounts", headers: auth() })
    ).json();
    const payable = accounts.data.find(
      (account: { code: string }) => account.code === "merchant_payable",
    );
    expect(payable.balance_minor).toBe(24_900);
  });
});

describe("api keys", () => {
  it("issues a key once and rejects it after revocation", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/api_keys",
      headers: auth(),
      payload: { name: "reporting" },
    });
    expect(created.statusCode).toBe(201);
    const secret = created.json().secret as string;
    expect(secret).toMatch(/^sk_test_/);

    const list = (
      await app.inject({ method: "GET", url: "/v1/api_keys", headers: auth() })
    ).json();
    expect(list.data.length).toBeGreaterThanOrEqual(2);

    const working = await app.inject({
      method: "GET",
      url: "/v1/merchants/me",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(working.statusCode).toBe(200);

    const target = list.data.find(
      (row: { prefix: string }) => row.prefix === secret.slice(0, 16),
    );
    await app.inject({
      method: "POST",
      url: `/v1/api_keys/${target.id}/revoke`,
      headers: auth(),
    });

    const rejected = await app.inject({
      method: "GET",
      url: "/v1/merchants/me",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(rejected.statusCode).toBe(401);
  });
});

describe("reports", () => {
  it("aggregates a payment window and exports csv", async () => {
    await createPayment({
      amount_minor: 10_000,
      simulator_scenario: "approve",
    });
    await drain();

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();

    const report = (
      await app.inject({
        method: "GET",
        url: `/v1/reports/payments?from=${from}&to=${to}`,
        headers: auth(),
      })
    ).json();
    expect(report.payments).toBe(1);
    expect(report.gross_minor).toBe(10_000);
    expect(report.net_minor).toBe(10_000);

    const csv = await app.inject({
      method: "GET",
      url: `/v1/reports/payments?from=${from}&to=${to}&format=csv`,
      headers: auth(),
    });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\n")[0]).toBe(
      "id,created_at,status,amount_minor,amount,currency,customer_id,description,refunded_minor,failure_code",
    );
  });

  it("accepts a date-only window and rejects an invalid one", async () => {
    await createPayment({
      amount_minor: 10_000,
      simulator_scenario: "approve",
    });
    await drain();

    const today = new Date().toISOString().slice(0, 10);
    const report = (
      await app.inject({
        method: "GET",
        url: `/v1/reports/payments?from=${today}&to=${today}`,
        headers: auth(),
      })
    ).json();
    expect(report.payments).toBe(1);
    expect(report.from).toBe(`${today}T00:00:00.000Z`);
    expect(report.to).toBe(`${today}T23:59:59.999Z`);

    const inverted = await app.inject({
      method: "GET",
      url: `/v1/reports/payments?from=${today}T12:00:00.000Z&to=${today}T01:00:00.000Z`,
      headers: auth(),
    });
    expect(inverted.statusCode).toBe(400);
    expect(inverted.json().error.code).toBe("invalid_request");
  });

  it("summarises a settlement day", async () => {
    await createPayment({ simulator_scenario: "approve" });
    await drain();

    const today = new Date().toISOString().slice(0, 10);
    const settlement = (
      await app.inject({
        method: "GET",
        url: `/v1/reports/settlement?date=${today}`,
        headers: auth(),
      })
    ).json();
    expect(settlement.captured_minor).toBe(24_900);
    expect(settlement.net_minor).toBe(24_900);
    expect(settlement.payments).toBe(1);
  });
});
