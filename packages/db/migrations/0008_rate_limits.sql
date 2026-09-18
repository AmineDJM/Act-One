-- Act One :: rate limits
--
-- Attempt counters for the doors: sign-in and sign-up, per address and per
-- account, in fixed windows. One row per (key, window); the count is bumped
-- atomically with an upsert, so two web instances behind one load balancer
-- share one count rather than each allowing the full limit.
--
-- Platform-only by policy: an address is not a tenant, and the sign-in form
-- has no organisation yet.
CREATE TABLE rate_limits (
  key          TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY rate_limits_platform_only ON rate_limits
  USING (app_is_platform()) WITH CHECK (app_is_platform());
