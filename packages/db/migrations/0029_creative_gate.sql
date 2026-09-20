-- Two gates, recorded separately.
--
-- Production QA asks whether the film is technically complete. Creative QA
-- asks whether it is any good, by watching the finished file. A film can pass
-- either and fail the other, and collapsing both into one `status` meant
-- "completed" was said of a film nobody had judged for quality at all.
--
-- Null rather than a default verdict: a gate that never ran has not passed,
-- and every render made before this existed will honestly say so instead of
-- being back-filled with a judgement nobody made.
ALTER TABLE renders
  ADD COLUMN production_verdict TEXT,
  ADD COLUMN creative_verdict   TEXT,
  ADD COLUMN creative_reason    TEXT NOT NULL DEFAULT '';

CREATE INDEX renders_creative_verdict_idx
  ON renders (organization_id, creative_verdict)
  WHERE creative_verdict IS NOT NULL;
