-- Whether a recorded cost is a price or a guess.
--
-- A model absent from the price table was billed at the dearest rate on
-- record — the safe direction to guess — and entered the ledger looking
-- exactly like a measured cost. Every report built on it was confidently
-- wrong and nobody reading it could tell which part.
--
-- Existing rows are marked 'listed' because that is what they were recorded
-- as meaning; the distinction only exists from here forward, and saying so is
-- better than back-filling a judgement we cannot make.
ALTER TABLE generation_costs
  ADD COLUMN cost_basis TEXT NOT NULL DEFAULT 'listed';

CREATE INDEX generation_costs_basis_idx
  ON generation_costs (organization_id, cost_basis)
  WHERE cost_basis <> 'listed';
