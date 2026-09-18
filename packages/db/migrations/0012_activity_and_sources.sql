-- Act One :: activity and research sources
--
-- Job events are the curated lines a worker writes as it works — a page
-- read, a step begun or finished, a scene rendered — shown live to the
-- customer and kept with the project. Research sources are the trail: every
-- page the research read, with what it gave us and the screenshot we kept,
-- so what the system used to understand a product can be inspected after
-- the film exists and reproduced later.

CREATE TABLE job_events (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id           TEXT NOT NULL,
  at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  data             JSONB NOT NULL
);
CREATE INDEX job_events_project_idx ON job_events (organization_id, project_id, at);
CREATE INDEX job_events_job_idx ON job_events (job_id, at);

CREATE TABLE research_sources (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id           TEXT,
  visited_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  data             JSONB NOT NULL
);
CREATE INDEX research_sources_project_idx ON research_sources (organization_id, project_id, visited_at);

DO $$
DECLARE tenant_table TEXT;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['job_events', 'research_sources']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = app_current_organization() OR app_is_platform())
       WITH CHECK (organization_id = app_current_organization() OR app_is_platform())',
      tenant_table || '_tenant_isolation', tenant_table
    );
  END LOOP;
END $$;
