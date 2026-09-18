-- When a job actually began, kept after it finishes.
--
-- locked_at is cleared on completion, so nothing recorded how long a job
-- took, and the project page could only show a bar with no sense of time.
-- started_at is set when a worker claims the job and never cleared; the
-- median over recent completed jobs of a kind is what "usually about 3
-- minutes" means on the page.
ALTER TABLE jobs ADD COLUMN started_at TIMESTAMPTZ;

CREATE INDEX jobs_kind_completed_idx ON jobs (kind, updated_at DESC)
  WHERE state = 'completed' AND started_at IS NOT NULL;
