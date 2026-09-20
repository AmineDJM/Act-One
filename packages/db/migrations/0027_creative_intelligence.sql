-- The intelligence a director has that a prompt does not.
--
-- Five tables and one principle: every creative decision Act One makes is
-- written down with the evidence it was made on, and none of it is thrown
-- away when the film is delivered.
--
-- What existed before was the output — concepts, treatments, storyboards — and
-- nothing about the reasoning. So "why does this film end on silence" had no
-- answer, a direction rejected for being off-brand was rejected again on the
-- next film, and the one asset a foundation model cannot hand us — a record of
-- what good looked like, and to whom — was being discarded on every project.
--
-- Scoping is per organisation throughout. What Act One learns about one
-- customer's brand is that customer's, and the only thing that crosses is a
-- creative signature, which is a device this studio has used and carries no
-- product information at all.

-- The understanding, before anything is created. One row per version, because
-- a brief that was revised mid-production is two different assignments and the
-- work made under each has to stay attributable to the one it was made under.
CREATE TABLE creative_models (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 'brief' | 'audience' | 'genome'
  kind               TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  data               JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX creative_models_project_idx ON creative_models (project_id, kind, version DESC);
CREATE UNIQUE INDEX creative_models_version_idx ON creative_models (project_id, kind, version);

-- Every direction explored, including — especially — the ones that died.
-- A rejected territory is a negative example, and negative examples are the
-- half of a preference dataset that nobody keeps.
CREATE TABLE creative_territories (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mechanism          TEXT NOT NULL DEFAULT 'other',
  kept               BOOLEAN NOT NULL DEFAULT false,
  selected           BOOLEAN NOT NULL DEFAULT false,
  rejection_reason   TEXT,
  data               JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX creative_territories_project_idx ON creative_territories (project_id, created_at DESC);

-- What each specialist said, kept apart from what the director did about it.
CREATE TABLE critic_reviews (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_kind      TEXT NOT NULL,
  artifact_id        TEXT NOT NULL,
  critic             TEXT NOT NULL,
  verdict            TEXT NOT NULL,
  critic_version     TEXT NOT NULL DEFAULT 'v1',
  model              TEXT NOT NULL DEFAULT '',
  cost_usd           NUMERIC(12, 6) NOT NULL DEFAULT 0,
  data               JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX critic_reviews_artifact_idx ON critic_reviews (project_id, artifact_id);
CREATE INDEX critic_reviews_project_idx ON critic_reviews (project_id, created_at DESC);

-- The decisions themselves: what was chosen, what was not, and which conflict
-- between two specialists the director had to settle to choose it.
CREATE TABLE director_decisions (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage              TEXT NOT NULL,
  director_version   TEXT NOT NULL DEFAULT 'v1',
  data               JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX director_decisions_project_idx ON director_decisions (project_id, created_at DESC);

-- Devices this studio has used. Deliberately thin: a kind and a normalised
-- key, no product information, so it can be read across a workspace's own
-- projects to notice that the last seven films opened the same way.
CREATE TABLE creative_signatures (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL,
  device             TEXT NOT NULL,
  key                TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX creative_signatures_org_idx ON creative_signatures (organization_id, kind, created_at DESC);
CREATE INDEX creative_signatures_key_idx ON creative_signatures (organization_id, key);

-- Pairwise judgements, for a taste model that does not exist yet.
--
-- Collected now because preference data is the one thing a foundation model
-- cannot be asked for, and because the judge matters: a customer's preference,
-- a creative director's and an evaluator's are three different signals and
-- must never be averaged into one.
CREATE TABLE creative_preferences (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brief_id           TEXT NOT NULL DEFAULT '',
  artifact_a         TEXT NOT NULL,
  artifact_b         TEXT NOT NULL,
  judge              TEXT NOT NULL,
  winner             TEXT NOT NULL,
  dimension          TEXT,
  blind              BOOLEAN NOT NULL DEFAULT false,
  data               JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX creative_preferences_org_idx ON creative_preferences (organization_id, created_at DESC);

ALTER TABLE creative_models      ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE critic_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE director_decisions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_signatures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY creative_models_tenant ON creative_models
  USING (organization_id = app_current_organization() OR app_is_platform())
  WITH CHECK (organization_id = app_current_organization() OR app_is_platform());

CREATE POLICY creative_territories_tenant ON creative_territories
  USING (organization_id = app_current_organization() OR app_is_platform())
  WITH CHECK (organization_id = app_current_organization() OR app_is_platform());

CREATE POLICY critic_reviews_tenant ON critic_reviews
  USING (organization_id = app_current_organization() OR app_is_platform())
  WITH CHECK (organization_id = app_current_organization() OR app_is_platform());

CREATE POLICY director_decisions_tenant ON director_decisions
  USING (organization_id = app_current_organization() OR app_is_platform())
  WITH CHECK (organization_id = app_current_organization() OR app_is_platform());

CREATE POLICY creative_signatures_tenant ON creative_signatures
  USING (organization_id = app_current_organization() OR app_is_platform())
  WITH CHECK (organization_id = app_current_organization() OR app_is_platform());

CREATE POLICY creative_preferences_tenant ON creative_preferences
  USING (organization_id = app_current_organization() OR app_is_platform())
  WITH CHECK (organization_id = app_current_organization() OR app_is_platform());
