import type { FastifyInstance } from "fastify";
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

function drain(): number {
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
    drain();

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
    drain();

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

    expect(drain()).toBe(0);
    const detail = (await getPayment(created.id)).json();
    expect(detail.status).toBe("canceled");
    expect(detail.attempts).toHaveLength(0);
  });

  it("retries transient errors and records both attempts", async () => {
    const created = (
      await createPayment({ simulator_scenario: "transient" })
    ).json();
    drain();

    const pending = (await getPayment(created.id)).json();
    expect(pending.status).toBe("processing");
    expect(pending.attempts).toHaveLength(1);

    app.sqlite
      .prepare("update jobs set next_run_at = ? where kind = 'process_payment'")
      .run("2000-01-01T00:00:00.000Z");
    drain();

    const settled = (await getPayment(created.id)).json();
    expect(settled.status).toBe("succeeded");
    expect(settled.attempts).toHaveLength(2);
  });

  it("marks a timeout unknown, then reconciles it", async () => {
    const created = (
      await createPayment({ simulator_scenario: "timeout" })
    ).json();
    drain();

    const pending = (await getPayment(created.id)).json();
    expect(pending.status).toBe("unknown");

    app.sqlite
      .prepare(
        "update jobs set next_run_at = ? where kind = 'reconcile_payment'",
      )
      .run("2000-01-01T00:00:00.000Z");
    drain();

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
    drain();

    const refund = await createRefund({
      payment_id: created.id,
      amount_minor: 5_000,
      reason: "damaged item",
      simulator_scenario: "approve",
    });
    expect(refund.statusCode).toBe(202);
    expect(refund.json().status).toBe("reserved");

    drain();

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
    drain();

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
    drain();

    await createRefund({
      payment_id: created.id,
      amount_minor: 5_000,
      simulator_scenario: "decline",
    });
    drain();

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
    drain();

    const refund = await createRefund({
      payment_id: created.id,
      amount_minor: 5_000,
      simulator_scenario: "timeout",
    });
    expect(refund.statusCode).toBe(202);
    drain();

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
    drain();

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
    drain();

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

    expect(drain()).toBe(0);

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
    drain();

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
    drain();

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
    drain();

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
    drain();
    await createRefund({
      payment_id: created.id,
      amount_minor: 5_000,
      simulator_scenario: "approve",
    });
    drain();

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
