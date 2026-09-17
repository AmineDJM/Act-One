-- Act One :: launch copy
--
-- A film is not a launch. The day it goes out somebody needs a headline for the
-- page it sits on, posts for two networks, a subject line and a tagline short
-- enough for Product Hunt — written from the same argument the film makes.
--
-- Each line records the verified claim it rests on, so the same grounding that
-- governs what the film says governs what the launch post says. A post
-- inventing a number is quoted back at a company for years.

CREATE TABLE copy_kits (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  concept_id      TEXT NOT NULL,
  lines           JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX copy_kits_project_idx ON copy_kits (project_id, created_at DESC);

ALTER TABLE copy_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE copy_kits FORCE ROW LEVEL SECURITY;
CREATE POLICY copy_kits_tenant_isolation ON copy_kits
  USING (organization_id = app_current_organization() OR app_is_platform())
  WITH CHECK (organization_id = app_current_organization() OR app_is_platform());
