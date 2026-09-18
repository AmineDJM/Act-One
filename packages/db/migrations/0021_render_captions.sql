-- The caption track, beside the master and the poster.
--
-- A sidecar rather than part of the picture: captions burned into a frame
-- cannot be turned off, translated, or read by anything but a human eye, and
-- the track is what makes a film usable by a screen reader, a search index,
-- and everybody watching with the sound off.
ALTER TABLE renders ADD COLUMN captions_asset_id TEXT;
