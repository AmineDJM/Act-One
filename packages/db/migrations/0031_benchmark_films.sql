-- The reference corpus: films Act One is measured against, kept permanently.
--
-- These were attachments passed into a session and analysed into files under
-- .renders/ref, which meant the corpus only existed on whichever machine last
-- ran the analysis, could not be added to without editing a script, and had no
-- way to report that one of its films had come back empty.
--
-- The original file is kept forever and never replaced by its analysis. Every
-- reading here is re-derivable, and a corpus that cannot be re-analysed is one
-- frozen at the capability of the day it was uploaded — which is the wrong
-- thing to freeze when the analysers are the part improving fastest.
CREATE TABLE benchmark_films (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  storage_key       TEXT NOT NULL,
  original_filename TEXT NOT NULL DEFAULT '',
  byte_size         BIGINT NOT NULL DEFAULT 0,
  duration_seconds  DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- pending | analysing | analysed | partial | failed | disabled.
  -- 'partial' and 'failed' are first-class rather than inferred: a reference
  -- that contributes nothing while looking like taste calibration is worse
  -- than one that is absent, and the only symptom is retrieval quietly
  -- returning less than it should.
  status            TEXT NOT NULL DEFAULT 'pending',
  note              TEXT NOT NULL DEFAULT '',

  -- The whole record, as every other table in this schema keeps it. The
  -- columns above are denormalised for the console's list and for retrieval's
  -- status filter; `data` is what is read back.
  data              JSONB NOT NULL,

  -- How many described moments the reading yielded. Zero with a present
  -- reading is exactly the case 'partial' exists to make visible.
  mechanism_count   INTEGER NOT NULL DEFAULT 0,

  analysed_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The console lists by status and by recency; retrieval asks only for the
-- films it is allowed to draw on.
CREATE INDEX benchmark_films_status_idx ON benchmark_films (status, created_at DESC);

-- The same file uploaded twice is the same reference, and paying to analyse it
-- again teaches nothing.
CREATE UNIQUE INDEX benchmark_films_storage_key_idx ON benchmark_films (storage_key);
