import { writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { loadConfig, repoRoot } from "./config";
import { createDb, type Db } from "./db";
import { newId, nowIso } from "./domain";
import {
  merchants,
  paymentAttempts,
  paymentEvents,
  payments,
  refunds,
} from "./schema";
import { createApiKeyForMerchant, createMerchant } from "./services/auth";
import { enqueue } from "./services/jobs";
import {
  paymentJournalLines,
  postJournal,
  refundJournalLines,
} from "./services/ledger";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DESCRIPTIONS = [
  "Order #1042",
  "Pro plan renewal",
  "Coffee subscription",
  "Invoice 2041",
  "Marketplace payout",
  "Annual licence",
  "Hardware deposit",
  "Consulting retainer",
];

interface DemoStats {
  payments: number;
  refunds: number;
}

function seedDemo(db: Db, merchantId: string): DemoStats {
  const existing = db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.merchantId, merchantId))
    .limit(1)
    .get();

  if (existing) {
    return { payments: 0, refunds: 0 };
  }

  const rng = mulberry32(20261020);
  let paymentCount = 0;
  let refundCount = 0;

  db.transaction(
    (tx) => {
      const t = tx as unknown as Db;

      for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
        const perDay = 2 + Math.floor(rng() * 4);

        for (let index = 0; index < perDay; index += 1) {
          const id = newId("pay");
          const amount = (10 + Math.floor(rng() * 400)) * 100;
          const created = new Date(
            Date.now() -
              daysAgo * 86_400_000 -
              Math.floor(rng() * 20 * 3_600_000) -
              Math.floor(rng() * 60_000),
          ).toISOString();

          const roll = rng();
          const outcome =
            roll < 0.74
              ? "succeeded"
              : roll < 0.86
                ? "failed"
                : roll < 0.93
                  ? "partially_refunded"
                  : "refunded";

          const failed = outcome === "failed";
          const refunded =
            outcome === "refunded"
              ? amount
              : outcome === "partially_refunded"
                ? Math.max(100, Math.floor((amount * 0.4) / 100) * 100)
                : 0;

          t.insert(payments)
            .values({
              id,
              merchantId,
              amountMinor: amount,
              currency: "INR",
              status: outcome,
              customerId: `cus_demo_${String(paymentCount + 1).padStart(3, "0")}`,
              description: DESCRIPTIONS[Math.floor(rng() * DESCRIPTIONS.length)],
              failureCode: failed ? "card_declined" : null,
              refundedMinor: refunded,
              refundReservedMinor: 0,
              createdAt: created,
              updatedAt: created,
            })
            .run();

          t.insert(paymentAttempts)
            .values({
              id: newId("att"),
              paymentId: id,
              attemptNumber: 1,
              status: failed ? "declined" : "succeeded",
              processorReference: newId("proc"),
              failureCode: failed ? "card_declined" : null,
              startedAt: created,
              finishedAt: new Date(
                new Date(created).getTime() + 1200,
              ).toISOString(),
            })
            .run();

          insertEvent(t, id, "payment.created", null, "created", null, created);
          insertEvent(
            t,
            id,
            "payment.processing",
            "created",
            "processing",
            "Submitted to processor.",
            created,
          );
          insertEvent(
            t,
            id,
            failed ? "payment.failed" : "payment.succeeded",
            "processing",
            failed ? "failed" : "succeeded",
            failed ? "Processor declined the charge." : "Processor approved.",
            created,
          );

          if (!failed) {
            postJournal(t, {
              merchantId,
              sourceType: "payment",
              sourceId: id,
              lines: paymentJournalLines(amount),
              createdAt: created,
            });
          }

          if (refunded > 0) {
            const refundId = newId("ref");
            const refundedAt = new Date(
              new Date(created).getTime() + 30_000,
            ).toISOString();

            t.insert(refunds)
              .values({
                id: refundId,
                paymentId: id,
                merchantId,
                amountMinor: refunded,
                currency: "INR",
                status: "succeeded",
                reason: "Customer request",
                failureCode: null,
                processorReference: newId("proc"),
                createdAt: refundedAt,
                updatedAt: refundedAt,
              })
              .run();

            insertEvent(
              t,
              id,
              "refund.created",
              outcome,
              outcome,
              `Refund ${refundId} reserved.`,
              refundedAt,
            );
            insertEvent(
              t,
              id,
              "refund.succeeded",
              outcome,
              outcome,
              `Refund ${refundId} settled.`,
              refundedAt,
            );

            postJournal(t, {
              merchantId,
              sourceType: "refund",
              sourceId: refundId,
              lines: refundJournalLines(refunded),
              createdAt: refundedAt,
            });
            refundCount += 1;
          }

          paymentCount += 1;
        }
      }

      // Two live payments for the worker to pick up as soon as the API starts.
      for (const scenario of ["approve", "decline"] as const) {
        const id = newId("pay");
        const amount = (25 + Math.floor(rng() * 200)) * 100;
        const createdAt = new Date(Date.now() - 45_000).toISOString();

        t.insert(payments)
          .values({
            id,
            merchantId,
            amountMinor: amount,
            currency: "INR",
            status: "created",
            customerId: `cus_demo_live_${scenario}`,
            description: `Live demo (${scenario})`,
            failureCode: null,
            refundedMinor: 0,
            refundReservedMinor: 0,
            createdAt,
            updatedAt: createdAt,
          })
          .run();

        insertEvent(t, id, "payment.created", null, "created", null, createdAt);
        enqueue(t, {
          kind: "process_payment",
          aggregateId: id,
          payload: { payment_id: id, scenario },
        });
        paymentCount += 1;
      }
    },
    { behavior: "immediate" },
  );

  return { payments: paymentCount, refunds: refundCount };
}

function insertEvent(
  tx: Db,
  paymentId: string,
  type: string,
  from: string | null,
  to: string,
  reason: string | null,
  createdAt: string,
): void {
  tx.insert(paymentEvents)
    .values({
      id: newId("evt"),
      paymentId,
      type,
      fromStatus: from,
      toStatus: to,
      reason,
      createdAt,
    })
    .run();
}

function main(): void {
  const config = loadConfig({ workerEnabled: false });
  const handle = createDb(config.dbPath);
  const db = handle.db;

  try {
    const existing = db.select().from(merchants).all();
    const credentials: Array<{
      name: string;
      merchant_id: string;
      api_key: string;
      seeded: boolean;
    }> = [];

    let acmeId: string;
    let acmeName: string;
    let acmeKey: string;

    if (existing.length === 0) {
      const acme = createMerchant(db, "Acme Store", config.apiKeyPepper);
      const beta = createMerchant(db, "Beta Labs", config.apiKeyPepper);

      acmeId = acme.merchantId;
      acmeName = "Acme Store";
      acmeKey = acme.rawKey;

      credentials.push({
        name: "Acme Store",
        merchant_id: acme.merchantId,
        api_key: acme.rawKey,
        seeded: false,
      });
      credentials.push({
        name: "Beta Labs",
        merchant_id: beta.merchantId,
        api_key: beta.rawKey,
        seeded: false,
      });
    } else {
      const acme =
        existing.find((merchant) => merchant.name === "Acme Store") ??
        existing[0];
      const key = createApiKeyForMerchant(db, acme.id, config.apiKeyPepper);
      acmeId = acme.id;
      acmeName = acme.name;
      acmeKey = key.rawKey;
      credentials.push({
        name: acme.name,
        merchant_id: acme.id,
        api_key: key.rawKey,
        seeded: false,
      });
    }

    const demo = seedDemo(db, acmeId);

    for (const credential of credentials) {
      credential.seeded = credential.merchant_id === acmeId;
    }

    const keyFile = path.resolve(repoRoot, "data", "demo-key.json");
    writeFileSync(
      keyFile,
      JSON.stringify(
        { api_key: acmeKey, merchant_id: acmeId, name: acmeName },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    console.log(
      JSON.stringify(
        {
          environment: config.env,
          database: config.dbPath,
          demo_key_file: keyFile,
          merchants: credentials,
          demo,
          note:
            "Store the API key now. Only a hash is kept in the database. Re-run seed for a fresh key.",
        },
        null,
        2,
      ),
    );
  } finally {
    handle.close();
  }
}

main();
