export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  key_prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL,
  name TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_api_keys_merchant ON api_keys(merchant_id);

CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  type TEXT NOT NULL CHECK (type IN ('card','upi','bank','wallet')),
  label TEXT NOT NULL,
  last4 TEXT,
  network TEXT,
  expiry_month INTEGER,
  expiry_year INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_methods_merchant ON payment_methods(merchant_id, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN
    ('created','processing','succeeded','failed','canceled','unknown','partially_refunded','refunded')),
  customer_id TEXT,
  description TEXT,
  payment_method_id TEXT REFERENCES payment_methods(id),
  failure_code TEXT,
  refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  refund_reserved_minor INTEGER NOT NULL DEFAULT 0 CHECK (refund_reserved_minor >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (refunded_minor + refund_reserved_minor <= amount_minor)
);
CREATE INDEX IF NOT EXISTS ix_payments_merchant_created ON payments(merchant_id, created_at, id);
CREATE INDEX IF NOT EXISTS ix_payments_merchant_status ON payments(merchant_id, status, created_at);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','succeeded','declined','timed_out','errored')),
  processor_reference TEXT NOT NULL,
  failure_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (payment_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS ix_attempts_payment ON payment_attempts(payment_id);

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_payment ON payment_events(payment_id, created_at);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  aggregate_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','retrying','running','succeeded','dead','canceled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_run_at TEXT NOT NULL,
  claimed_by TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jobs_claim ON jobs(status, next_run_at, created_at);
CREATE INDEX IF NOT EXISTS ix_jobs_aggregate ON jobs(aggregate_id);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  resource_id TEXT,
  response_status INTEGER,
  response_body TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (merchant_id, operation, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_idempotency_merchant ON idempotency_records(merchant_id);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  merchant_id TEXT REFERENCES merchants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('asset','liability')),
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TEXT NOT NULL,
  UNIQUE (merchant_id, code)
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted')),
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TEXT NOT NULL,
  posted_at TEXT,
  UNIQUE (source_type, source_id)
);
CREATE INDEX IF NOT EXISTS ix_journals_created ON ledger_transactions(created_at, id);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_entries_account ON ledger_entries(account_id, created_at, id);
CREATE INDEX IF NOT EXISTS ix_entries_journal ON ledger_entries(transaction_id);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','processing','succeeded','failed','canceled','unknown')),
  reason TEXT,
  failure_code TEXT,
  processor_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_refunds_payment_status ON refunds(payment_id, status);
CREATE INDEX IF NOT EXISTS ix_refunds_merchant ON refunds(merchant_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_endpoints_merchant ON webhook_endpoints(merchant_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivered','failed','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_dispatch ON webhook_events(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS ix_events_merchant ON webhook_events(merchant_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES webhook_events(id),
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('delivered','failed')),
  response_status INTEGER,
  response_body TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_deliveries_event ON webhook_deliveries(event_id, created_at);
CREATE INDEX IF NOT EXISTS ix_deliveries_merchant ON webhook_deliveries(merchant_id, created_at);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','paid','failed','unknown')),
  failure_code TEXT,
  processor_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_payouts_merchant ON payouts(merchant_id, created_at);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  note TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_disputes_merchant ON disputes(merchant_id, created_at);
CREATE INDEX IF NOT EXISTS ix_disputes_payment ON disputes(payment_id);

CREATE TABLE IF NOT EXISTS dev_sink (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  event_id TEXT,
  event_type TEXT,
  body TEXT NOT NULL,
  signature TEXT,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sink_token ON dev_sink(token, received_at);

CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_update
BEFORE UPDATE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger entries are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_delete
BEFORE DELETE ON ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger entries are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_tx_no_delete
BEFORE DELETE ON ledger_transactions
WHEN OLD.status = 'posted'
BEGIN
  SELECT RAISE(ABORT, 'posted journals are immutable');
END;
`;
