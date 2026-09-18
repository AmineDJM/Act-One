-- Act One :: why a job stopped, not just what it said
--
-- `last_error` is a sentence written for an operator. Deciding what to tell a
-- customer needs the category, not the prose: a provider that was briefly
-- unavailable reads "Production paused" and resumes itself, while something
-- that actually broke reads "Production interrupted" and waits for a person.
-- Parsing the sentence to tell those apart would be guesswork, so the code
-- the stage failed with is kept beside it.

ALTER TABLE jobs ADD COLUMN last_error_code TEXT;
