-- Act One :: initial schema
--
-- Shape of this schema, and why:
--
--  * Everything a customer owns carries organization_id, NOT NULL, with a
--    foreign key. Tenancy is a column constraint, not a convention.
--  * Operational facts we aggregate over (cost, duration, status, timings)
--    are real columns so Super Admin dashboards are index scans rather than
--    JSONB extractions across every row.
--  * Creative documents (product understanding, concepts, treatments, brand
--    systems) live in JSONB. They are versioned, schema-validated in the
--    application by zod, and almost always read and written whole. Modelling
--    a creative treatment as 40 columns buys nothing and costs a migration
--    every time art direction learns something.
--  * Scenes are their own table, not JSONB inside a storyboard: they are
--    individually rendered, repaired, commented on and reused by variants.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  plan_id             TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id  TEXT UNIQUE,
  credit_balance      NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (credit_balance >= 0),
  max_project_cost_usd NUMERIC(10, 2) NOT NULL DEFAULT 120,
  is_suspended        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL DEFAULT '',
  avatar_url     TEXT,
  password_hash  TEXT,
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'reviewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE invitations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'reviewer')),
  token_hash      TEXT NOT NULL UNIQUE,
  invited_by      TEXT NOT NULL REFERENCES users(id),
  accepted_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE TABLE subscriptions (
  id                      TEXT PRIMARY KEY,
  organization_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id                 TEXT NOT NULL,
  status                  TEXT NOT NULL,
  stripe_subscription_id  TEXT UNIQUE,
  stripe_customer_id      TEXT,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
  seats                   INTEGER NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscriptions_org_idx ON subscriptions (organization_id);

CREATE TABLE brands (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  confirmed       BOOLEAN NOT NULL DEFAULT FALSE,
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX brands_org_idx ON brands (organization_id);

CREATE TABLE projects (
  id                        TEXT PRIMARY KEY,
  organization_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id        TEXT NOT NULL REFERENCES users(id),
  name                      TEXT NOT NULL,
  website_url               TEXT NOT NULL,
  supplemental_urls         JSONB NOT NULL DEFAULT '[]'::jsonb,
  brand_id                  TEXT REFERENCES brands(id) ON DELETE SET NULL,
  product_understanding_id  TEXT,
  selected_concept_id       TEXT,
  active_storyboard_id      TEXT,
  latest_render_id          TEXT,
  stage                     TEXT NOT NULL DEFAULT 'created',
  brief                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  product_credential_id     TEXT,
  cost_usd                  NUMERIC(12, 4) NOT NULL DEFAULT 0,
  credits_spent             NUMERIC(12, 2) NOT NULL DEFAULT 0,
  archived_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX projects_org_idx ON projects (organization_id, created_at DESC);
CREATE INDEX projects_stage_idx ON projects (stage) WHERE archived_at IS NULL;

CREATE TABLE product_understandings (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_understandings_project_idx ON product_understandings (project_id, created_at DESC);

CREATE TABLE concepts (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  creative_system TEXT NOT NULL,
  selected        BOOLEAN NOT NULL DEFAULT FALSE,
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX concepts_project_idx ON concepts (project_id, created_at DESC);

CREATE TABLE treatments (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  concept_id      TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  data            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX treatments_project_idx ON treatments (project_id);

CREATE TABLE storyboards (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  concept_id      TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  treatment_id    TEXT NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'draft',
  voice_strategy  TEXT NOT NULL DEFAULT 'none',
  music_direction TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);
CREATE INDEX storyboards_project_idx ON storyboards (project_id, version DESC);

CREATE TABLE scenes (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  storyboard_id   TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
  scene_index     INTEGER NOT NULL,
  start_time      NUMERIC(8, 3) NOT NULL,
  duration        NUMERIC(8, 3) NOT NULL CHECK (duration > 0),
  visual_type     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft',
  estimated_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
  data            JSONB NOT NULL,
  UNIQUE (storyboard_id, scene_index)
);
CREATE INDEX scenes_storyboard_idx ON scenes (storyboard_id, scene_index);

CREATE TABLE assets (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
  concept_id      TEXT,
  scene_id        TEXT,
  kind            TEXT NOT NULL,
  origin          TEXT NOT NULL,
  rights          TEXT NOT NULL DEFAULT 'unknown',
  storage_key     TEXT NOT NULL,
  content_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
  bytes           BIGINT NOT NULL DEFAULT 0,
  width           INTEGER,
  height          INTEGER,
  duration_seconds NUMERIC(8, 3),
  checksum        TEXT,
  provider        TEXT,
  model           TEXT,
  source_url      TEXT,
  cost_usd        NUMERIC(10, 4) NOT NULL DEFAULT 0,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assets_project_idx ON assets (project_id, created_at DESC);
CREATE INDEX assets_scene_idx ON assets (scene_id);
CREATE UNIQUE INDEX assets_storage_key_idx ON assets (storage_key);

CREATE TABLE renders (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  storyboard_id    TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL DEFAULT 1,
  aspect           TEXT NOT NULL DEFAULT '16:9',
  quality          TEXT NOT NULL DEFAULT 'hd',
  fps              INTEGER NOT NULL DEFAULT 30,
  status           TEXT NOT NULL DEFAULT 'queued',
  master_asset_id  TEXT,
  poster_asset_id  TEXT,
  watermarked      BOOLEAN NOT NULL DEFAULT FALSE,
  duration_seconds NUMERIC(8, 3) NOT NULL DEFAULT 0,
  cost_usd         NUMERIC(12, 4) NOT NULL DEFAULT 0,
  qa_report_id     TEXT,
  error            TEXT,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX renders_project_idx ON renders (project_id, created_at DESC);
CREATE INDEX renders_status_idx ON renders (status) WHERE status NOT IN ('completed', 'failed', 'canceled');

CREATE TABLE variants (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  render_id        TEXT NOT NULL REFERENCES renders(id) ON DELETE CASCADE,
  purpose          TEXT NOT NULL,
  aspect           TEXT NOT NULL,
  duration_seconds NUMERIC(8, 3) NOT NULL,
  scene_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  audio_stem       TEXT NOT NULL DEFAULT 'full',
  captions_burned  BOOLEAN NOT NULL DEFAULT FALSE,
  asset_id         TEXT,
  status           TEXT NOT NULL DEFAULT 'queued',
  cost_usd         NUMERIC(10, 4) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX variants_render_idx ON variants (render_id);

CREATE TABLE qa_reports (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  render_id        TEXT NOT NULL REFERENCES renders(id) ON DELETE CASCADE,
  passed           BOOLEAN NOT NULL,
  frames_inspected INTEGER NOT NULL DEFAULT 0,
  data             JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX qa_reports_render_idx ON qa_reports (render_id, created_at DESC);

CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'queued',
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  progress        NUMERIC(4, 3) NOT NULL DEFAULT 0,
  status_message  TEXT NOT NULL DEFAULT '',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  last_error      TEXT,
  run_after       TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by       TEXT,
  locked_at       TIMESTAMPTZ,
  priority        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The claim query orders by priority DESC, run_after ASC over runnable rows.
CREATE INDEX jobs_claim_idx ON jobs (priority DESC, run_after ASC)
  WHERE state = 'queued' AND locked_by IS NULL;
CREATE INDEX jobs_project_idx ON jobs (project_id, created_at DESC);
-- A stuck worker must not strand a job forever; the reaper scans by lock age.
CREATE INDEX jobs_locked_idx ON jobs (locked_at) WHERE locked_by IS NOT NULL;

CREATE TABLE generation_costs (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         TEXT REFERENCES projects(id) ON DELETE SET NULL,
  scene_id           TEXT,
  render_id          TEXT,
  provider           TEXT NOT NULL,
  model              TEXT,
  operation          TEXT NOT NULL,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  actual_cost_usd    NUMERIC(12, 6) NOT NULL DEFAULT 0,
  credits_charged    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  quantity           NUMERIC(14, 4) NOT NULL DEFAULT 1,
  unit               TEXT NOT NULL DEFAULT 'call',
  succeeded          BOOLEAN NOT NULL DEFAULT TRUE,
  is_retry           BOOLEAN NOT NULL DEFAULT FALSE,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX generation_costs_org_idx ON generation_costs (organization_id, created_at DESC);
CREATE INDEX generation_costs_project_idx ON generation_costs (project_id);
CREATE INDEX generation_costs_provider_idx ON generation_costs (provider, created_at DESC);

CREATE TABLE comments (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target             TEXT NOT NULL,
  target_id          TEXT NOT NULL,
  author_user_id     TEXT NOT NULL REFERENCES users(id),
  body               TEXT NOT NULL,
  at_seconds         NUMERIC(8, 3),
  resolved_at        TIMESTAMPTZ,
  resolved_by_user_id TEXT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_target_idx ON comments (target, target_id, created_at);

CREATE TABLE approvals (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  gate                TEXT NOT NULL CHECK (gate IN ('concept', 'storyboard', 'final')),
  target_id           TEXT NOT NULL,
  approved_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, gate, target_id)
);

CREATE TABLE revision_requests (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  storyboard_id      TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
  author_user_id     TEXT NOT NULL REFERENCES users(id),
  instruction        TEXT NOT NULL,
  intent             TEXT NOT NULL DEFAULT 'unknown',
  affected_scene_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  applied            BOOLEAN NOT NULL DEFAULT FALSE,
  applied_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX revision_requests_project_idx ON revision_requests (project_id, created_at DESC);

CREATE TABLE product_credentials (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL,
  login_url            TEXT NOT NULL,
  username             TEXT,
  -- Ciphertext only. The plaintext never exists in this database, and the
  -- envelope is bound to organization_id + project_id as AAD, so a row copied
  -- to another tenant cannot be decrypted even with the vault key.
  secret_ciphertext    JSONB NOT NULL,
  authorized_by_user_id TEXT NOT NULL REFERENCES users(id),
  authorized_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  allowed_paths        JSONB NOT NULL DEFAULT '[]'::jsonb,
  denied_paths         JSONB NOT NULL DEFAULT '[]'::jsonb,
  revoked_at           TIMESTAMPTZ,
  last_used_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_credentials_project_idx
  ON product_credentials (project_id) WHERE revoked_at IS NULL;

CREATE TABLE credential_audit_events (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL,
  credential_id   TEXT NOT NULL,
  action          TEXT NOT NULL,
  detail          TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX credential_audit_idx ON credential_audit_events (credential_id, created_at DESC);

CREATE TABLE voice_consents (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       TEXT REFERENCES projects(id) ON DELETE CASCADE,
  subject_name     TEXT NOT NULL,
  granted_by_user_id TEXT NOT NULL REFERENCES users(id),
  scope            TEXT NOT NULL CHECK (scope IN ('project', 'organization')),
  provider_voice_id TEXT,
  granted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ
);

-- Platform configuration. Single-row tables keyed by a constant so the app can
-- upsert without worrying about which row is current.
CREATE TABLE platform_settings (
  id              TEXT PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  provider_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  plans           JSONB NOT NULL DEFAULT '[]'::jsonb,
  feature_flags   JSONB NOT NULL DEFAULT '{}'::jsonb,
  creative_budget JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT
);

CREATE TABLE provider_secrets (
  provider      TEXT PRIMARY KEY,
  ciphertext    JSONB NOT NULL,
  fingerprint   TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT
);

CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
