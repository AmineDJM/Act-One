-- Which engine drew a film's picture, and how.
--
-- Two engines take the same storyboard to the same silent master: Remotion,
-- and HyperFrames with each scene written by an agent. A film that looks wrong
-- is first a question of which one drew it, and for HyperFrames of who drew
-- each scene and what the writing cost. One document rather than columns: it
-- is read whole, next to the render, and its shape belongs to the engines.
--
-- Null for every film drawn before this existed: nothing recorded it, and a
-- back-filled guess would be a record of something nobody saw.
ALTER TABLE renders
  ADD COLUMN engine JSONB;
