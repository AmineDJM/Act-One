-- A master in another language.
--
-- The same film, written again by somebody working in that language, read by a
-- voice that speaks it, rendered from the same picture and the same score. Its
-- own kind rather than a cut, because it must not replace the film on the
-- project page, must not be what the next campaign is cut from, and must not
-- spend a render from a plan that sells renders of the film — all three of
-- which follow from the kind.
ALTER TABLE renders DROP CONSTRAINT IF EXISTS renders_kind_check;
ALTER TABLE renders ADD CONSTRAINT renders_kind_check
  CHECK (kind IN ('film', 'cut', 'animatic', 'localised'));
