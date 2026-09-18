-- Act One :: the library
--
-- Every image an organisation gives us, and every useful one our research
-- keeps, is one row in `assets` with `library` set — one file, however many
-- projects use it. The association lives in `asset_projects`, so a still can
-- be attached to three launches without being copied three times, and a
-- project's "Assets" section is a view over the workspace's library rather
-- than a second store.
--
-- Lineage: an asset made from another (a generated shot anchored to a
-- still, an edited version of an upload) points at its parent, so a customer
-- can trace what a film's frame was made from.

ALTER TABLE assets
  ADD COLUMN library            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN name               TEXT NOT NULL DEFAULT '',
  ADD COLUMN category           TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN category_source    TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN description        TEXT NOT NULL DEFAULT '',
  ADD COLUMN tags               JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN favorite           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN approved            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN parent_asset_id    TEXT REFERENCES assets(id) ON DELETE SET NULL,
  ADD COLUMN uploaded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN source             TEXT NOT NULL DEFAULT 'pipeline';

CREATE INDEX assets_library_idx ON assets (organization_id, created_at DESC) WHERE library;
CREATE INDEX assets_parent_idx ON assets (parent_asset_id) WHERE parent_asset_id IS NOT NULL;

CREATE TABLE asset_projects (
  asset_id         TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  attached_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, project_id)
);
CREATE INDEX asset_projects_project_idx ON asset_projects (organization_id, project_id, attached_at DESC);

ALTER TABLE asset_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_projects FORCE ROW LEVEL SECURITY;
CREATE POLICY asset_projects_tenant_isolation ON asset_projects
  USING (organization_id = app_current_organization() OR app_is_platform())
  WITH CHECK (organization_id = app_current_organization() OR app_is_platform());
