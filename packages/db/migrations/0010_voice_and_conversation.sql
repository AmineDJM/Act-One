-- The language a storyboard was written in, so the voice can follow it.
ALTER TABLE storyboards ADD COLUMN language TEXT;

-- A revision is a conversation: what the customer asked, what we understood
-- and proposed, and whether they said go. Nothing is applied on a proposal.
ALTER TABLE revision_requests
  ADD COLUMN status     TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN proposal   JSONB,
  ADD COLUMN reply      TEXT NOT NULL DEFAULT '',
  ADD COLUMN decided_at TIMESTAMPTZ;
UPDATE revision_requests SET status = 'applied' WHERE applied;
