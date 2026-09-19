-- Act One :: payments
--
-- Every time money moves, a row. Until now none of it was written down: a
-- credit purchase adjusted a balance and vanished, a renewal was not handled
-- at all, and a failed card set a subscription to past_due and left no record
-- of the attempt. The balance said what a workspace has; nothing said what
-- anybody ever paid, or when, or for what — so the console could not show a
-- customer their receipts and the operator could not see a month's takings.
--
-- One row per Stripe event that moved money, keyed by that event id, so a
-- webhook retry writes nothing twice. `credits` is what the payment bought
-- where it bought credits, and null where it bought a month of a plan.
--
-- Tenant-isolated rather than platform-only: this is the workspace's own
-- receipt, and a customer is entitled to read what they paid.

CREATE TABLE payments (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  status            TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'usd',
  credits           INTEGER,
  plan_id           TEXT,
  description       TEXT NOT NULL DEFAULT '',
  stripe_event_id   TEXT UNIQUE,
  stripe_object_id  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payments_org_idx ON payments (organization_id, created_at DESC);
CREATE INDEX payments_created_idx ON payments (created_at DESC);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant_isolation ON payments
  USING (organization_id = app_current_organization() OR app_is_platform())
  WITH CHECK (organization_id = app_current_organization() OR app_is_platform());
