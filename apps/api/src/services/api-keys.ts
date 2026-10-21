import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { apiKeys } from "../schema";
import { errors, newId, nowIso } from "../domain";
import { generateApiKey } from "./auth";

export interface ApiKeyView {
  id: string;
  prefix: string;
  name: string | null;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  status: "active" | "revoked";
}

export function listApiKeys(db: Db, merchantId: string): ApiKeyView[] {
  const rows = db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.merchantId, merchantId))
    .orderBy(desc(apiKeys.createdAt))
    .all();

  return rows.map((row) => ({
    id: row.id,
    prefix: row.keyPrefix,
    name: row.name,
    created_at: row.createdAt,
    revoked_at: row.revokedAt,
    last_used_at: row.lastUsedAt,
    status: row.revokedAt ? ("revoked" as const) : ("active" as const),
  }));
}

export function createApiKey(
  db: Db,
  merchantId: string,
  pepper: string,
  name?: string | null,
): { key: ApiKeyView; secret: string } {
  const generated = generateApiKey(pepper);
  const id = newId("key");
  const createdAt = nowIso();

  db.insert(apiKeys)
    .values({
      id,
      merchantId,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.hash,
      name: name ?? null,
      createdAt,
    })
    .run();

  return {
    key: {
      id,
      prefix: generated.keyPrefix,
      name: name ?? null,
      created_at: createdAt,
      revoked_at: null,
      last_used_at: null,
      status: "active",
    },
    secret: generated.raw,
  };
}

export function revokeApiKey(
  db: Db,
  merchantId: string,
  keyId: string,
): ApiKeyView {
  const key = db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.merchantId, merchantId)))
    .get();

  if (!key) throw errors.notFound("API key");

  const revokedAt = key.revokedAt ?? nowIso();
  if (!key.revokedAt) {
    db.update(apiKeys)
      .set({ revokedAt })
      .where(eq(apiKeys.id, key.id))
      .run();
  }

  return {
    id: key.id,
    prefix: key.keyPrefix,
    name: key.name,
    created_at: key.createdAt,
    revoked_at: revokedAt,
    last_used_at: key.lastUsedAt,
    status: "revoked",
  };
}

export function touchApiKey(db: Db, keyId: string): void {
  const now = nowIso();
  db.update(apiKeys)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiKeys.id, keyId),
        sql`(${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < ${now})`,
      ),
    )
    .run();
}
