-- Act One :: Collections
--
-- The curated public gallery. One row per film offered for selection, as
-- a document with the columns the gallery lists and orders by. A film is
-- public only while its status is 'published', and only a person makes it
-- so. The platform's alone: customers reach their own entry through the
-- product, the public through the pages, both server-side.

CREATE TABLE collection_entries (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  render_id          TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  category           TEXT NOT NULL DEFAULT 'other',
  featured           BOOLEAN NOT NULL DEFAULT false,
  launch_of_the_week BOOLEAN NOT NULL DEFAULT false,
  original           BOOLEAN NOT NULL DEFAULT false,
  position           INTEGER NOT NULL DEFAULT 0,
  published_at       TIMESTAMPTZ,
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  data               JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX collection_entries_status_idx ON collection_entries (status, position, published_at DESC);
CREATE INDEX collection_entries_project_idx ON collection_entries (organization_id, project_id, submitted_at DESC);

ALTER TABLE collection_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY collection_entries_platform_only ON collection_entries
  USING (app_is_platform()) WITH CHECK (app_is_platform());
