-- Act One :: operational log
--
-- What the platform did, and why something failed.
--
-- Until now a failure told the customer "Something went wrong on our side."
-- and wrote its cause to a worker's stdout, where nobody operating the
-- platform could reach it. This table is the record an operator reads instead:
-- every job outcome, every provider failure, every staff action, with the
-- cause attached.
--
-- Platform-only by policy. It spans tenants by design — an operator needs to
-- see that four different customers hit the same provider outage — so it is
-- never exposed through a tenant-scoped query. `organization_id` is a label
-- for filtering, not an ownership claim, and deliberately carries no foreign
-- key: the log of why an organisation's render failed must survive that
-- organisation being deleted.

-- Levels sort by severity, not alphabetically ('error' < 'warn' as text, which
-- is the opposite of what anyone reading a log means).
CREATE OR REPLACE FUNCTION severity_of(level TEXT) RETURNS INTEGER AS $$
  SELECT CASE level
    WHEN 'debug' THEN 0
    WHEN 'info'  THEN 1
    WHEN 'warn'  THEN 2
    WHEN 'error' THEN 3
    ELSE 0
  END;
$$ LANGUAGE SQL IMMUTABLE;

CREATE TABLE operational_events (
  id              TEXT PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- debug | info | warn | error
  level           TEXT NOT NULL,
  -- web | worker | provider | billing | admin | auth
  source          TEXT NOT NULL,
  -- Stable machine name: 'job.failed', 'provider.unhealthy', 'staff.granted'.
  event           TEXT NOT NULL,
  message         TEXT NOT NULL DEFAULT '',
  organization_id TEXT,
  project_id      TEXT,
  job_id          TEXT,
  actor_user_id   TEXT,
  duration_ms     INTEGER,
  -- Cause chains, provider names, HTTP status. Never secrets: everything
  -- written here goes through redaction first.
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- The admin log view reads newest-first, optionally narrowed by level or
-- source, so the index leads with time and the filters are cheap follow-ons.
CREATE INDEX operational_events_at_idx ON operational_events (at DESC);
CREATE INDEX operational_events_level_idx ON operational_events (level, at DESC);
CREATE INDEX operational_events_source_idx ON operational_events (source, at DESC);
CREATE INDEX operational_events_org_idx ON operational_events (organization_id, at DESC)
  WHERE organization_id IS NOT NULL;
CREATE INDEX operational_events_project_idx ON operational_events (project_id, at DESC)
  WHERE project_id IS NOT NULL;

ALTER TABLE operational_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_events FORCE ROW LEVEL SECURITY;
CREATE POLICY operational_events_platform_only ON operational_events
  USING (app_is_platform()) WITH CHECK (app_is_platform());
