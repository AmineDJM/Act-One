-- Says what a render is for.
--
-- Every render used to be indistinguishable in the database: the film, the six
-- campaign cuts made from it, and the timing preview of the storyboard were all
-- just rows in `renders`. Three things read that table and all three were wrong
-- because of it — the project page offered whichever row finished last as the
-- deliverable, the version number counted cuts, and the plan's renders-per-project
-- limit was spent by cuts and previews the customer never asked to pay for.
--
-- Backfill: everything that exists today is a film except preview-quality rows,
-- which could only have been animatics. Campaign cuts rendered before this
-- migration stay marked as films, which over-counts a few projects against their
-- limit rather than under-counting — the safe direction when the alternative is
-- guessing which of a project's HD renders were cuts.

ALTER TABLE renders ADD COLUMN kind TEXT NOT NULL DEFAULT 'film';

UPDATE renders SET kind = 'animatic' WHERE quality = 'preview';

ALTER TABLE renders ADD CONSTRAINT renders_kind_check
  CHECK (kind IN ('film', 'cut', 'animatic'));

-- The lookups that matter are "the films of this project" (version numbering,
-- the plan limit) and "the animatic for this storyboard".
CREATE INDEX renders_project_kind_idx ON renders (project_id, kind, created_at DESC);
