import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db";
import { apiKeys, merchants } from "../schema";
import { newId, nowIso } from "../domain";

export const KEY_PREFIX = "sk_test_";
const DISPLAY_PREFIX_LENGTH = KEY_PREFIX.length + 8;

export interface GeneratedKey {
  raw: string;
  keyPrefix: string;
  hash: string;
}

export function generateApiKey(pepper: string): GeneratedKey {
  const raw = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return {
    raw,
    keyPrefix: raw.slice(0, DISPLAY_PREFIX_LENGTH),
    hash: hashApiKey(raw, pepper),
  };
}

export function hashApiKey(raw: string, pepper: string): string {
  return createHmac("sha256", pepper).update(raw).digest("hex");
}

export function keyDisplayPrefix(raw: string): string {
  return raw.slice(0, DISPLAY_PREFIX_LENGTH);
}

export function createMerchant(
  db: Db,
  name: string,
  pepper: string,
): { merchantId: string; rawKey: string; keyPrefix: string } {
  const merchantId = newId("mer");
  const key = generateApiKey(pepper);
  const now = nowIso();

  db.transaction((tx) => {
    tx.insert(merchants)
      .values({ id: merchantId, name, status: "active", createdAt: now })
      .run();
    tx.insert(apiKeys)
      .values({
        id: newId("key"),
        merchantId,
        keyPrefix: key.keyPrefix,
        keyHash: key.hash,
        createdAt: now,
      })
      .run();
  });

  return { merchantId, rawKey: key.raw, keyPrefix: key.keyPrefix };
}

export function createApiKeyForMerchant(
  db: Db,
  merchantId: string,
  pepper: string,
): { rawKey: string; keyPrefix: string } {
  const key = generateApiKey(pepper);
  db.insert(apiKeys)
    .values({
      id: newId("key"),
      merchantId,
      keyPrefix: key.keyPrefix,
      keyHash: key.hash,
      createdAt: nowIso(),
    })
    .run();
  return { rawKey: key.raw, keyPrefix: key.keyPrefix };
}

export function resolveApiKey(
  db: Db,
  rawKey: string,
  pepper: string,
): MerchantContextRow | null {
  if (!rawKey.startsWith(KEY_PREFIX) || rawKey.length < 24) return null;

  const prefix = keyDisplayPrefix(rawKey);
  const row = db
    .select({
      keyHash: apiKeys.keyHash,
      keyId: apiKeys.id,
      merchantId: merchants.id,
      merchantName: merchants.name,
      merchantStatus: merchants.status,
    })
    .from(apiKeys)
    .innerJoin(merchants, eq(apiKeys.merchantId, merchants.id))
    .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)))
    .get();

  if (!row || row.merchantStatus !== "active") return null;

  const expected = Buffer.from(row.keyHash, "hex");
  const actual = Buffer.from(hashApiKey(rawKey, pepper), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  return { id: row.merchantId, name: row.merchantName, keyId: row.keyId };
}

export interface MerchantContextRow {
  id: string;
  name: string;
  keyId: string;
}
