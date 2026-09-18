import { describe, it, expect } from 'vitest';
import {
  ATTRIBUTION,
  ORIGINAL_LABEL,
  PRODUCTION_PHASES,
  PRODUCTION_PHASE_LABELS,
  PRODUCTION_PHASE_LINES,
  ProjectStage,
  STAGE_STATUS,
  NOTICE_STATUS,
  productionPhaseOfJob,
  phaseIndex,
  pieceLabel,
  productionPhase,
} from '../index.ts';

/**
 * The words are part of the product, so they are checked like the rest of it.
 *
 * The invariant that matters: the status a customer reads on the card and the
 * phase the rail highlights are the same thing said twice. They drifted apart
 * once already, and a production that says MASTERING while the rail points at
 * PRODUCTION reads as a system that does not know what it is doing.
 */
describe('the production vocabulary', () => {
  it('places every stage that is a phase, and nothing else', () => {
    const unplaced = ProjectStage.options.filter((stage) => productionPhase(stage) === null);
    expect(unplaced).toEqual(['created', 'failed']);
  });

  it('never moves backwards as a production advances', () => {
    let last = -1;
    for (const stage of ProjectStage.options) {
      const phase = productionPhase(stage);
      if (!phase) continue;
      const index = phaseIndex(phase);
      expect(index).toBeGreaterThanOrEqual(last);
      last = index;
    }
    expect(last).toBe(PRODUCTION_PHASES.length - 1);
  });

  it('says the same word on the card as on the rail', () => {
    for (const stage of ProjectStage.options) {
      const phase = productionPhase(stage);
      if (!phase) continue;
      const status = STAGE_STATUS[stage].label;
      const word = PRODUCTION_PHASE_LABELS[phase];
      // Either the status is the phase, or it is that phase said more
      // precisely — "STORYBOARD READY", "CHOOSE A DIRECTION" — never a word
      // from somewhere else entirely.
      const agrees =
        status === word ||
        status.startsWith(`${word} `) ||
        (phase === 'discovery' && status === 'PRODUCT UNDERSTOOD') ||
        (phase === 'direction' && status === 'CHOOSE A DIRECTION') ||
        (phase === 'ready' && status === 'MASTER READY');
      expect({ stage, status, word, agrees }).toMatchObject({ agrees: true });
    }
  });

  it('gives every phase a line worth reading', () => {
    for (const phase of PRODUCTION_PHASES) {
      expect(PRODUCTION_PHASE_LINES[phase].length).toBeGreaterThan(20);
      expect(PRODUCTION_PHASE_LABELS[phase]).toBe(PRODUCTION_PHASE_LABELS[phase].toUpperCase());
    }
  });

  it('places a failed job in the phase it interrupted', () => {
    expect(productionPhaseOfJob('research_product')).toBe('discovery');
    expect(productionPhaseOfJob('generate_concepts')).toBe('direction');
    expect(productionPhaseOfJob('build_storyboard')).toBe('storyboard');
    expect(productionPhaseOfJob('render_film')).toBe('production');
    expect(productionPhaseOfJob(null)).toBeNull();
  });

  it("says the status in the phase's words, never in ours", () => {
    for (const status of Object.values(NOTICE_STATUS)) {
      expect(status.label).toBe(status.label.toUpperCase());
      // Nothing a customer reads may name our machinery.
      expect(status.label).not.toMatch(/render|api|job|worker|queue/i);
    }
    expect(NOTICE_STATUS.discovery_paused.label).toBe('DISCOVERY PAUSED');
    expect(NOTICE_STATUS.refining.tone).toBe('active');
  });

  it('credits a film to the studio, never to a machine', () => {
    expect(ATTRIBUTION).toBe('An Act One Production');
    expect(ORIGINAL_LABEL).toBe('Act One Original');
    for (const line of [ATTRIBUTION, ORIGINAL_LABEL]) {
      expect(line).not.toMatch(/\b(ai|generated|automated)\b/i);
    }
  });

  it('numbers a piece the way a credit does', () => {
    expect(pieceLabel('master')).toBe('MASTER');
    expect(pieceLabel('master', 1)).toBe('MASTER 01');
    expect(pieceLabel('cut', 3)).toBe('CUT 03');
    expect(pieceLabel('workprint')).toBe('WORKPRINT');
    expect(pieceLabel('cut', 12)).toBe('CUT 12');
  });
});
