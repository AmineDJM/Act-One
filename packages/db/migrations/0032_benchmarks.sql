-- Act One :: the benchmark library
--
-- Reference films a Super Admin keeps so Act One can learn how finished films
-- are made. A document each, with the columns the console sorts and filters
-- by. The film itself and its FilmIR live in object storage under the
-- platform's own prefix; this row is what the library knows without opening
-- either.
--
-- One film is one row: the SHA-256 of its bytes is unique, so uploading the
-- same file twice finds the first rather than analysing it again.
--
-- Platform-only. A benchmark belongs to the product, never to a workspace.

CREATE TABLE benchmarks (
  id          TEXT PRIMARY KEY,
  sha256      TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'uploaded',
  retrieval   TEXT NOT NULL DEFAULT 'enabled',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  data        JSONB NOT NULL
);

CREATE INDEX benchmarks_status_idx ON benchmarks (status, updated_at DESC);
CREATE INDEX benchmarks_retrieval_idx ON benchmarks (retrieval, status);

ALTER TABLE benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmarks FORCE ROW LEVEL SECURITY;
CREATE POLICY benchmarks_platform_only ON benchmarks USING (app_is_platform()) WITH CHECK (app_is_platform());
