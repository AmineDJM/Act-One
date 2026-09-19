-- Act One :: the credit ledger
--
-- The balance on the organisation row was the whole story: a number that went
-- up and down with nothing saying why. "Where did my credits go" and "were we
-- given this month's allowance twice" were both unanswerable, and every path
-- that moved credits — a purchase, an allowance, an operator's grant, a
-- referral, a generated shot — could run twice and nobody would know.
--
-- One row per movement, append-only. `source_key` is what makes an allocation
-- idempotent: a movement that could arrive more than once (a Stripe webhook
-- retried, the hourly accrual racing the invoice that triggers it) carries a
-- key derived from what it is rather than from when it ran, and the unique
-- index refuses the second one. A movement that is meant to repeat — an
-- operator adding credits twice on purpose — carries a unique key instead.
--
-- Tenant-isolated: this is the workspace's own statement.

CREATE TABLE credit_ledger (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  delta            INTEGER NOT NULL,
  balance_after    INTEGER NOT NULL,
  source_key       TEXT UNIQUE,
  description      TEXT NOT NULL DEFAULT '',
  plan_id          TEXT,
  subscription_id  TEXT,
  period_key       TEXT,
  payment_id       TEXT,
  project_id       TEXT,
  render_id        TEXT,
  actor_user_id    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX credit_ledger_org_idx ON credit_ledger (organization_id, created_at DESC);
CREATE INDEX credit_ledger_kind_idx ON credit_ledger (kind, created_at DESC);

ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_ledger_tenant_isolation ON credit_ledger
  USING (organization_id = app_current_organization() OR app_is_platform())
  WITH CHECK (organization_id = app_current_organization() OR app_is_platform());

-- How a subscription is collected, and how far its allowance has been paid.
--
-- The interval is recorded because it is not the same question as how often
-- the plan's allowance lands: an annual subscription pays once and is still
-- owed its monthly credits, and conflating the two gave a customer one month
-- of credits for the year.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_interval           TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS allowance_granted_through  TEXT;
