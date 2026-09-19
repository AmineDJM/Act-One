-- What an operator has granted one workspace, beyond what its plan sells.
--
-- A plan is a product and a customer is a person. A deal, a pilot, an apology,
-- a friend of the company: every one of those is a limit lifted for exactly
-- one workspace, and doing it by inventing a plan per customer is how a price
-- list becomes unreadable.
--
-- `limit_overrides` is a partial set of PlanLimits, so a grant of "films up to
-- five minutes" does not silently also grant unlimited seats. `is_internal`
-- marks a workspace the operator runs rather than sells to: not billed, not
-- limited, not counted as revenue — and the reason the person who owns the
-- platform is no longer told their film may not exceed thirty seconds.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS limit_overrides    JSONB   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS extra_entitlements JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_internal        BOOLEAN NOT NULL DEFAULT FALSE;
