-- Act One :: the journal
--
-- Articles and the topics waiting to become articles. A document each, with
-- the columns the public list and the console sort by. Publication is a
-- status, so unpublishing is instant and reversible, and a scheduled piece
-- is simply one with a time and no publication yet.
--
-- The editorial schedule itself (may the machine draft, how often, may it
-- publish) lives in platform_settings.product beside the phase: it is the
-- operator's configuration, not content.
--
-- Platform-only. The journal belongs to the product, not to a workspace.

CREATE TABLE articles (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  origin        TEXT NOT NULL DEFAULT 'written',
  scheduled_for TIMESTAMPTZ,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  data          JSONB NOT NULL
);

CREATE INDEX articles_status_idx ON articles (status, COALESCE(published_at, created_at) DESC);
CREATE INDEX articles_scheduled_idx ON articles (scheduled_for) WHERE scheduled_for IS NOT NULL;

CREATE TABLE article_topics (
  id         TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'open',
  score      INTEGER NOT NULL DEFAULT 50,
  article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data       JSONB NOT NULL
);

CREATE INDEX article_topics_status_idx ON article_topics (status, score DESC, created_at DESC);

DO $$
DECLARE platform_table TEXT;
BEGIN
  FOREACH platform_table IN ARRAY ARRAY['articles', 'article_topics']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', platform_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', platform_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_is_platform()) WITH CHECK (app_is_platform())',
      platform_table || '_platform_only', platform_table
    );
  END LOOP;
END $$;
