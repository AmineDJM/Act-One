import { describe, it, expect } from 'vitest';
import {
  AUDIO_STANDARDS,
  briefedStandards,
  cite,
  standardsBrief,
  standardsFor,
  type Craft,
} from '../index.ts';

/**
 * The corpus and the briefs are the same thing said twice.
 *
 * The failure this guards against is quiet: a rule softened in a brief so a
 * model finds it easier to satisfy, while the check keeps the hard version.
 * The film then fails a check for a rule it was told something different
 * about, and nobody can see why.
 */
const CRAFTS: Craft[] = ['direction', 'storyboard', 'copy', 'narration', 'sound', 'editing', 'short_form', 'localization'];

describe('briefing an agent on the standards', () => {
  it('gives every craft rules that are actually in the corpus', () => {
    for (const craft of CRAFTS) {
      const standards = standardsFor(craft);
      expect(standards.length).toBeGreaterThan(2);
      for (const standard of standards) {
        expect(standard.id).toMatch(/^[a-z_]+\.[a-z_]+$/);
        expect(standard.source.length).toBeGreaterThan(3);
        expect(standard.because.length).toBeGreaterThan(20);
      }
    }
  });

  it('states each rule with its source and its reasoning, verbatim', () => {
    const brief = standardsBrief('sound');
    for (const standard of standardsFor('sound')) {
      // Verbatim, so a rule cannot be softened for the brief while the check
      // keeps the hard version.
      expect(brief).toContain(standard.rule);
      expect(brief).toContain(cite(standard));
      expect(brief).toContain(standard.because);
    }
    expect(brief).toContain(AUDIO_STANDARDS.truePeak.rule);
  });

  it('says plainly when a rule is not negotiable', () => {
    const brief = standardsBrief('storyboard');
    expect(brief).toContain('not negotiable');
    // A house rule is not dressed up as law.
    expect(standardsBrief('direction')).toMatch(/— house\)/);
  });

  it('never briefs a craft on somebody else’s rules', () => {
    // The composer has no business being told about text contrast, and the
    // writer has none being told about true peak: a brief full of rules an
    // agent cannot act on is a brief it stops reading.
    expect(standardsFor('sound').map((standard) => standard.id)).not.toContain('color.text_contrast');
    expect(standardsFor('copy').map((standard) => standard.id)).not.toContain('audio.true_peak');
  });

  it('covers every craft, so nothing is briefed on nothing', () => {
    const briefed = briefedStandards();
    expect([...briefed.keys()].sort()).toEqual([...CRAFTS].sort());
    for (const [, standards] of briefed) expect(standards.length).toBeGreaterThan(0);
  });
});
