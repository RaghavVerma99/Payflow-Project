import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db";
import {
  accounts,
  ledgerEntries,
  ledgerTransactions,
  type AccountRow,
  type LedgerEntryRow,
} from "../schema";
import { errors, newId, nowIso } from "../domain";

export const ACCOUNT_SPECS = [
  {
    code: "merchant_payable",
    name: "Merchant payable",
    kind: "liability" as const,
  },
  {
    code: "processor_clearing",
    name: "Processor clearing",
    kind: "asset" as const,
  },
];

export type Direction = "debit" | "credit";

export interface JournalLine {
  code: string;
  direction: Direction;
  amountMinor: number;
}

export interface JournalWithEntries {
  id: string;
  source_type: string;
  source_id: string;
  status: string;
  currency: string;
  created_at: string;
  entries: Array<{
    id: string;
    account_id: string;
    account_code: string;
    account_name: string;
    direction: Direction;
    amount_minor: number;
  }>;
}

export function ensureAccounts(
  db: Db,
  merchantId: string,
): Record<string, AccountRow> {
  const existing = db
    .select()
    .from(accounts)
    .where(eq(accounts.merchantId, merchantId))
    .all();

  const byCode = Object.fromEntries(existing.map((a) => [a.code, a]));

  for (const spec of ACCOUNT_SPECS) {
    if (byCode[spec.code]) continue;
    const row: AccountRow = {
      id: newId("acct"),
      merchantId,
      code: spec.code,
      name: spec.name,
      kind: spec.kind,
      currency: "INR",
      createdAt: nowIso(),
    };
    db.insert(accounts).values(row).run();
    byCode[spec.code] = row;
  }

  return byCode;
}

export function paymentJournalLines(amountMinor: number): JournalLine[] {
  return [
    { code: "processor_clearing", direction: "debit", amountMinor },
    { code: "merchant_payable", direction: "credit", amountMinor },
  ];
}

export function refundJournalLines(amountMinor: number): JournalLine[] {
  return [
    { code: "merchant_payable", direction: "debit", amountMinor },
    { code: "processor_clearing", direction: "credit", amountMinor },
  ];
}

export interface PostJournalInput {
  merchantId: string;
  sourceType: string;
  sourceId: string;
  lines: JournalLine[];
  createdAt?: string;
}

/**
 * Posts a balanced double-entry journal exactly once per (sourceType, sourceId).
 * Re-posting the same source is a no-op, which makes worker retries safe.
 */
export function postJournal(
  db: Db,
  input: PostJournalInput,
): JournalWithEntries {
  const existing = db
    .select()
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.sourceType, input.sourceType),
        eq(ledgerTransactions.sourceId, input.sourceId),
      ),
    )
    .get();

  if (existing) {
    return getJournal(db, existing.id, input.merchantId) as JournalWithEntries;
  }

  if (input.lines.length < 2) {
    throw errors.invalid("A journal needs at least two lines.");
  }

  const debits = input.lines
    .filter((l) => l.direction === "debit")
    .reduce((sum, l) => sum + l.amountMinor, 0);
  const credits = input.lines
    .filter((l) => l.direction === "credit")
    .reduce((sum, l) => sum + l.amountMinor, 0);

  if (debits !== credits) {
    throw errors.invalid("Journal is not balanced.");
  }
  if (input.lines.some((l) => !Number.isInteger(l.amountMinor) || l.amountMinor <= 0)) {
    throw errors.invalid("Every journal line must be a positive integer.");
  }

  const accountMap = ensureAccounts(db, input.merchantId);
  const journalId = newId("jrnl");
  const createdAt = input.createdAt ?? nowIso();

  db.insert(ledgerTransactions)
    .values({
      id: journalId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: "posted",
      currency: "INR",
      createdAt,
      postedAt: createdAt,
    })
    .run();

  for (const line of input.lines) {
    const account = accountMap[line.code];
    if (!account) {
      throw errors.invalid(`Unknown ledger account: ${line.code}.`);
    }
    db.insert(ledgerEntries)
      .values({
        id: newId("entry"),
        transactionId: journalId,
        accountId: account.id,
        direction: line.direction,
        amountMinor: line.amountMinor,
        currency: "INR",
        createdAt,
      })
      .run();
  }

  return getJournal(db, journalId, input.merchantId) as JournalWithEntries;
}

export function getJournal(
  db: Db,
  journalId: string,
  merchantId?: string,
): JournalWithEntries | null {
  const journal = db
    .select()
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.id, journalId))
    .get();

  if (!journal) return null;

  const entries = db
    .select({
      id: ledgerEntries.id,
      account_id: ledgerEntries.accountId,
      account_code: accounts.code,
      account_name: accounts.name,
      merchant_id: accounts.merchantId,
      direction: ledgerEntries.direction,
      amount_minor: ledgerEntries.amountMinor,
    })
    .from(ledgerEntries)
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(eq(ledgerEntries.transactionId, journalId))
    .all();

  if (merchantId && entries.every((e) => e.merchant_id !== merchantId)) {
    return null;
  }

  return {
    id: journal.id,
    source_type: journal.sourceType,
    source_id: journal.sourceId,
    status: journal.status,
    currency: journal.currency,
    created_at: journal.createdAt,
    entries: entries.map((e) => ({
      id: e.id,
      account_id: e.account_id,
      account_code: e.account_code,
      account_name: e.account_name,
      direction: e.direction as Direction,
      amount_minor: e.amount_minor,
    })),
  };
}

export interface AccountSummary {
  id: string;
  code: string;
  name: string;
  kind: string;
  currency: string;
  debits_minor: number;
  credits_minor: number;
  balance_minor: number;
}

export function accountSummaries(db: Db, merchantId: string): AccountSummary[] {
  ensureAccounts(db, merchantId);

  const rows = db
    .select({
      accountId: ledgerEntries.accountId,
      direction: ledgerEntries.direction,
      total: sql<number>`sum(${ledgerEntries.amountMinor})`,
    })
    .from(ledgerEntries)
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(eq(accounts.merchantId, merchantId))
    .groupBy(ledgerEntries.accountId, ledgerEntries.direction)
    .all();

  const totals = new Map<string, { debit: number; credit: number }>();
  for (const row of rows) {
    const current = totals.get(row.accountId) ?? { debit: 0, credit: 0 };
    if (row.direction === "debit") current.debit += Number(row.total);
    else current.credit += Number(row.total);
    totals.set(row.accountId, current);
  }

  const accountRows = db
    .select()
    .from(accounts)
    .where(eq(accounts.merchantId, merchantId))
    .all();

  return accountRows.map((account) => {
    const { debit, credit } = totals.get(account.id) ?? { debit: 0, credit: 0 };
    const balance = account.kind === "asset" ? debit - credit : credit - debit;
    return {
      id: account.id,
      code: account.code,
      name: account.name,
      kind: account.kind,
      currency: account.currency,
      debits_minor: debit,
      credits_minor: credit,
      balance_minor: balance,
    };
  });
}

export function trialBalance(db: Db, merchantId: string): {
  debits_minor: number;
  credits_minor: number;
  balanced: boolean;
} {
  const rows = db
    .select({
      direction: ledgerEntries.direction,
      total: sql<number>`sum(${ledgerEntries.amountMinor})`,
    })
    .from(ledgerEntries)
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(eq(accounts.merchantId, merchantId))
    .groupBy(ledgerEntries.direction)
    .all();

  let debits = 0;
  let credits = 0;
  for (const row of rows) {
    if (row.direction === "debit") debits += Number(row.total);
    else credits += Number(row.total);
  }
  return {
    debits_minor: debits,
    credits_minor: credits,
    balanced: debits === credits,
  };
}

export interface JournalPage {
  data: JournalWithEntries[];
  has_more: boolean;
  next_cursor: string | null;
}

export function listJournals(
  db: Db,
  merchantId: string,
  options: { limit: number; before?: { createdAt: string; id: string } },
): JournalPage {
  const accountIds = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.merchantId, merchantId))
    .all()
    .map((a) => a.id);

  if (accountIds.length === 0) {
    return { data: [], has_more: false, next_cursor: null };
  }

  const journalIds = db
    .selectDistinct({
      id: ledgerTransactions.id,
      createdAt: ledgerTransactions.createdAt,
    })
    .from(ledgerTransactions)
    .innerJoin(
      ledgerEntries,
      eq(ledgerEntries.transactionId, ledgerTransactions.id),
    )
    .where(
      and(
        inArray(ledgerEntries.accountId, accountIds),
        options.before
          ? sql`(${ledgerTransactions.createdAt}, ${ledgerTransactions.id}) < (${options.before.createdAt}, ${options.before.id})`
          : undefined,
      ),
    )
    .orderBy(sql`${ledgerTransactions.createdAt} desc`, sql`${ledgerTransactions.id} desc`)
    .limit(options.limit + 1)
    .all();

  const hasMore = journalIds.length > options.limit;
  const page = journalIds.slice(0, options.limit);
  const ids = page.map((j) => j.id);
  if (ids.length === 0) {
    return { data: [], has_more: false, next_cursor: null };
  }

  const journals = db
    .select()
    .from(ledgerTransactions)
    .where(inArray(ledgerTransactions.id, ids))
    .all();

  const entries = db
    .select({
      id: ledgerEntries.id,
      transaction_id: ledgerEntries.transactionId,
      account_id: ledgerEntries.accountId,
      account_code: accounts.code,
      account_name: accounts.name,
      direction: ledgerEntries.direction,
      amount_minor: ledgerEntries.amountMinor,
    })
    .from(ledgerEntries)
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(inArray(ledgerEntries.transactionId, ids))
    .all();

  const byJournal = new Map<string, JournalWithEntries>();
  for (const journal of journals) {
    byJournal.set(journal.id, {
      id: journal.id,
      source_type: journal.sourceType,
      source_id: journal.sourceId,
      status: journal.status,
      currency: journal.currency,
      created_at: journal.createdAt,
      entries: [],
    });
  }
  for (const entry of entries) {
    byJournal.get(entry.transaction_id)?.entries.push({
      id: entry.id,
      account_id: entry.account_id,
      account_code: entry.account_code,
      account_name: entry.account_name,
      direction: entry.direction as Direction,
      amount_minor: entry.amount_minor,
    });
  }

  const data = page
    .map((j) => byJournal.get(j.id))
    .filter((j): j is JournalWithEntries => Boolean(j));

  const last = page[page.length - 1];
  return {
    data,
    has_more: hasMore,
    next_cursor: hasMore && last
      ? Buffer.from(`${last.createdAt}|${last.id}`, "utf8").toString("base64url")
      : null,
  };
}

export type LedgerEntry = LedgerEntryRow;
