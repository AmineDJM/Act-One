-- The one shot a film is meant to be remembered for, and how it was found.
--
-- Kept with the storyboard rather than in a log, because it is a creative
-- decision: which frame out of every frame the customer's captures could hold,
-- what the measurement said about it, what the director said after seeing it
-- rendered, and what that cost. The next person to open this film should be
-- able to see the choice and take a different one.
ALTER TABLE storyboards ADD COLUMN hero_shot JSONB;
