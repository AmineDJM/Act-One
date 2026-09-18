-- Act One :: brand voices, voice settings, audio editions
--
-- A brand voice is one narrator kept across every film, cut and audio piece
-- an organisation makes: a voice from the engine's library, or a person's
-- voice cloned under a recorded consent. Voice settings hold the words an
-- organisation insists on saying its own way. An audio edition is the film's
-- argument written again for the ear and read as one piece.
--
-- Stored as documents, like brands: the shape is the domain type's, and the
-- columns that matter for scoping and lookup are the ones pulled out.

CREATE TABLE brand_voices (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  consent_id       TEXT REFERENCES voice_consents(id) ON DELETE SET NULL,
  is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  data             JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX brand_voices_org_idx ON brand_voices (organization_id, created_at DESC);

CREATE TABLE voice_settings (
  organization_id  TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  data             JSONB NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audio_editions (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status           TEXT NOT NULL,
  data             JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audio_editions_project_idx ON audio_editions (organization_id, project_id, created_at DESC);

-- The same tenant policy every other tenant table has: a session sees its
-- own organisation's rows, the platform sees all, and nothing is visible with
-- the setting absent.
DO $$
DECLARE tenant_table TEXT;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY['brand_voices', 'voice_settings', 'audio_editions']
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
