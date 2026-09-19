-- Storyboard lineage, and the record of why a beat was rewritten.
--
-- A creative replan produces a new storyboard rather than editing the one the
-- customer approved: the previous accepted creative state is never destroyed,
-- and an operator can see which beat changed, why, what it cost and what QA
-- said on either side of it.

ALTER TABLE storyboards
  ADD COLUMN parent_storyboard_id TEXT REFERENCES storyboards(id) ON DELETE SET NULL,
  ADD COLUMN revision_reason      TEXT NOT NULL DEFAULT '';

CREATE INDEX storyboards_parent_idx ON storyboards (parent_storyboard_id);

CREATE TABLE creative_replans (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The render whose QA escalated, and the storyboard it was made from.
  render_id            TEXT REFERENCES renders(id) ON DELETE SET NULL,
  from_storyboard_id   TEXT REFERENCES storyboards(id) ON DELETE SET NULL,
  to_storyboard_id     TEXT REFERENCES storyboards(id) ON DELETE SET NULL,
  scene_ids            JSONB NOT NULL DEFAULT '[]'::jsonb,
  check_name           TEXT NOT NULL DEFAULT '',
  diagnosis            TEXT NOT NULL DEFAULT '',
  strategy             TEXT NOT NULL DEFAULT '',
  reasoning            TEXT NOT NULL DEFAULT '',
  -- Every option the director gave, including the ones not taken.
  options              JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejected             JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempt              INTEGER NOT NULL DEFAULT 0,
  -- What it cost to think, and what the shots it asked for will cost to make.
  direction_cost_usd   NUMERIC(12, 6) NOT NULL DEFAULT 0,
  estimated_cost_usd   NUMERIC(12, 6) NOT NULL DEFAULT 0,
  model                TEXT NOT NULL DEFAULT '',
  scenes_reused        INTEGER NOT NULL DEFAULT 0,
  scenes_recomposed    INTEGER NOT NULL DEFAULT 0,
  scenes_regenerated   INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX creative_replans_project_idx ON creative_replans (project_id, created_at DESC);
CREATE INDEX creative_replans_org_idx ON creative_replans (organization_id, created_at DESC);

ALTER TABLE creative_replans ENABLE ROW LEVEL SECURITY;

CREATE POLICY creative_replans_tenant ON creative_replans
  USING (organization_id = app_current_organization() OR app_is_platform())
  WITH CHECK (organization_id = app_current_organization() OR app_is_platform());
