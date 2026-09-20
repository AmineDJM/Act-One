import { describe, it, expect } from 'vitest';
import {
  BRAND_DIMENSIONS,
  CreativeTerritory,
  REPETITION_WARNING_THRESHOLD,
  collapsedTerritories,
  disagreements,
  genomeContrast,
  genomeDistance,
  paretoFront,
  repetitionAgainst,
  signatureKey,
  strictestVerdict,
  territoryDistance,
  territorySpread,
  verdictForFindings,
  type BrandGenome,
  type CreativeSignature,
  type CriticReview,
} from '../index.ts';

/**
 * The arithmetic the Director Brain reasons over.
 *
 * None of it decides anything on its own — that is the whole point of keeping
 * it here, apart from the model calls. What it does is make two claims
 * checkable: that a set of directions is genuinely different, and that a
 * candidate nothing else beats outright has not been quietly dropped for a
 * candidate that is second-best at everything.
 */

function territory(over: Partial<CreativeTerritory> & Pick<CreativeTerritory, 'id'>): CreativeTerritory {
  return CreativeTerritory.parse({
    name: 'A direction',
    premise: 'The close happens once, in one run, and the week disappears.',
    mechanism: 'data_proof',
    rationale: 'It answers the objection this audience actually has.',
    emotion: 'relief',
    productRole: 'evidence',
    opening: 'A ledger, already closed.',
    risk: 'It could read as cold.',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
}

describe('two directions are different when the film would be', () => {
  it('reads a different mechanism and product role as real difference', () => {
    const a = territory({ id: 'a', mechanism: 'data_proof', productRole: 'evidence' });
    const b = territory({
      id: 'b',
      mechanism: 'human_transformation',
      productRole: 'absent',
      premise: 'A person who used to dread Thursday now leaves at six.',
      opening: 'An empty desk at six in the evening.',
      emotion: 'release',
    });
    expect(territoryDistance(a, b)).toBeGreaterThan(0.8);
  });

  /*
   * The failure mode this exists for: a model asked for variety produces
   * variety in language. "Fast modern launch" and "Bold dynamic launch" are
   * one direction written twice, and a check that looked at the words would
   * call them different because the words are different.
   */
  it('refuses to be fooled by different adjectives over one idea', () => {
    const a = territory({
      id: 'a',
      name: 'Fast modern launch',
      premise: 'The close happens once, in one run, and the week disappears.',
    });
    const b = territory({
      id: 'b',
      name: 'Bold dynamic launch',
      mechanism: 'narrative_reveal',
      premise: 'The close happens once, in a single run, and the whole week disappears.',
    });
    // A different mechanism and the same idea. The idea vetoes the structure.
    expect(territoryDistance(a, b)).toBeLessThan(0.45);
  });

  it('drops the near-duplicates and keeps the first of each cluster', () => {
    const pool = [
      territory({ id: 'a' }),
      territory({ id: 'b' }),
      territory({
        id: 'c',
        mechanism: 'world_building',
        productRole: 'context',
        emotion: 'awe',
        premise: 'An empire of spreadsheets, seen from above, collapsing into one line.',
        opening: 'A city of ledgers at night.',
      }),
    ];
    expect(collapsedTerritories(pool)).toEqual([1]);
  });

  it('measures the spread of a set, so a collapse is visible', () => {
    const same = [territory({ id: 'a' }), territory({ id: 'b' })];
    expect(territorySpread(same)).toBeLessThan(0.3);
    expect(territorySpread([territory({ id: 'a' })])).toBe(0);
  });
});

describe('scores are evidence, not the decision', () => {
  /*
   * A weighted sum would pick the candidate that is second-best at everything
   * over the one that is extraordinary at the two things the brief is about.
   * The front keeps both and hands the trade-off to the director.
   */
  it('keeps every genuine trade-off and drops only what is beaten outright', () => {
    const clear = { scores: { productClarity: 0.9, memorability: 0.3 } };
    const memorable = { scores: { productClarity: 0.4, memorability: 0.95 } };
    const worse = { scores: { productClarity: 0.3, memorability: 0.2 } };

    const front = paretoFront([clear, memorable, worse], ['productClarity', 'memorability']);
    expect(front).toHaveLength(2);
    expect(front).toContain(clear);
    expect(front).toContain(memorable);
    expect(front).not.toContain(worse);
  });

  it('treats a missing dimension as nothing rather than as a good score', () => {
    const full = { scores: { productClarity: 0.5, memorability: 0.5 } };
    const partial = { scores: { productClarity: 0.5 } };
    expect(paretoFront([full, partial], ['productClarity', 'memorability'])).toEqual([full]);
  });
});

describe('the panel is allowed to disagree', () => {
  const review = (critic: CriticReview['critic'], verdict: CriticReview['verdict']): CriticReview => ({
    id: `crv_${critic}`, projectId: 'prj_1', artifactKind: 'animatic', artifactId: 'rnd_1',
    critic, verdict, findings: [], criticVersion: 'v1', model: '', costUsd: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  it('names the pairs that are two steps apart, and ignores mild differences', () => {
    const found = disagreements([
      review('conversion', 'block'),
      review('film', 'pass'),
      review('brand', 'pass_with_concerns'),
    ]);
    expect(found).toHaveLength(2);
    expect(found.map((entry) => `${entry.a}/${entry.b}`)).toContain('conversion/film');
    // pass and pass_with_concerns is one step: not a conflict worth a ruling.
    expect(found.map((entry) => `${entry.a}/${entry.b}`)).not.toContain('film/brand');
  });

  it('takes the strictest verdict in the room as the gate', () => {
    expect(strictestVerdict(['pass', 'revise', 'pass_with_concerns'])).toBe('revise');
    expect(strictestVerdict(['pass', 'pass'])).toBe('pass');
    expect(strictestVerdict([])).toBe('pass');
  });

  it('derives a verdict from findings, so a critic cannot be softer than its own evidence', () => {
    expect(verdictForFindings([])).toBe('pass');
    expect(verdictForFindings([{ severity: 'note', observation: 'x', evidence: [], risk: '', recommendation: '', confidence: 0.5 }])).toBe('pass');
    expect(verdictForFindings([{ severity: 'medium', observation: 'x', evidence: [], risk: '', recommendation: '', confidence: 0.5 }])).toBe('pass_with_concerns');
    expect(verdictForFindings([{ severity: 'critical', observation: 'x', evidence: [], risk: '', recommendation: '', confidence: 0.5 }])).toBe('block');
  });
});

describe('the studio notices when it repeats itself', () => {
  const signature = (device: string): CreativeSignature => ({
    id: `sig_${device.slice(0, 4)}`, organizationId: 'org_1', projectId: 'prj_1',
    kind: 'opening', device, key: signatureKey('opening', device),
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  it('matches a device however it was worded', () => {
    // The same mechanism described two ways is the same mechanism.
    expect(signatureKey('opening', 'Opens on a held black frame with ONE word')).toBe(
      signatureKey('opening', 'a held black frame, opening with one word'),
    );
    // A different kind of device is never the same device.
    expect(signatureKey('ending', 'held black frame one word')).not.toBe(
      signatureKey('opening', 'held black frame one word'),
    );
  });

  it('scores the share of proposed devices this studio has already used', () => {
    const recent = [signature('held black frame with one word'), signature('held black frame with one word')];
    const result = repetitionAgainst(recent, [
      { kind: 'opening', device: 'a held black frame with one word' },
      { kind: 'opening', device: 'a cursor crossing an empty spreadsheet' },
    ]);
    expect(result.score).toBe(0.5);
    expect(result.repeated[0]).toContain('used 2×');
    expect(result.score).toBeGreaterThanOrEqual(REPETITION_WARNING_THRESHOLD);
  });

  it('says nothing about a studio that has made nothing', () => {
    expect(repetitionAgainst([], [{ kind: 'opening', device: 'anything' }])).toEqual({ score: 0, repeated: [] });
    expect(repetitionAgainst([signature('x')], [])).toEqual({ score: 0, repeated: [] });
  });
});

describe('a brand genome that reads nothing is visible', () => {
  const genome = (dimensions: Partial<Record<(typeof BRAND_DIMENSIONS)[number], number>>): BrandGenome => ({
    id: 'gen_1', projectId: 'prj_1', brandId: 'brd_1', version: 1,
    dimensions: dimensions as BrandGenome['dimensions'],
    archetype: 'the_engineer', productPresentation: '', languageBehaviour: '', motionBehaviour: '',
    taboos: [], provenance: {}, createdAt: '2026-01-01T00:00:00.000Z',
  });

  it('separates two brands that were genuinely read differently', () => {
    const infrastructure = genome({ rationality: 0.9, humour: 0.05, motionEnergy: 0.2 });
    const consumer = genome({ rationality: 0.3, humour: 0.8, motionEnergy: 0.9 });
    expect(genomeDistance(infrastructure, consumer)).toBeGreaterThan(0.5);
  });

  it('shows nothing between two genomes that are the same middle', () => {
    const middle = genome({ rationality: 0.5, humour: 0.5, motionEnergy: 0.5 });
    expect(genomeDistance(middle, genome({ rationality: 0.5, humour: 0.5, motionEnergy: 0.5 }))).toBe(0);
  });

  it('compares only the dimensions both of them state', () => {
    expect(genomeDistance(genome({ humour: 0.9 }), genome({ rationality: 0.9 }))).toBe(0);
  });

  /*
   * The mean across every dimension is honest and, on its own, misleading.
   * A reconciliation tool and a luxury atelier agree on most of these
   * dimensions because they really are both serious, reduced and unfunny —
   * and separate hard on the three that carry their character. Averaged over
   * ten that reads as a genome that saw nothing, which is the opposite of
   * what happened.
   */
  it('separates two serious brands on the dimensions where they are not alike', () => {
    const exact = genome({
      rationality: 0.92, sophistication: 0.72, technicality: 0.86,
      humour: 0.02, confidence: 0.84, minimalism: 0.82, warmth: 0.2,
    });
    const atelier = genome({
      rationality: 0.72, sophistication: 0.89, technicality: 0.58,
      humour: 0.03, confidence: 0.84, minimalism: 0.81, warmth: 0.22,
    });

    // Overall they look almost identical, and that reading is not wrong.
    expect(genomeDistance(exact, atelier)).toBeLessThan(0.12);
    // Where they differ, they differ clearly, and the contrast says where.
    const contrast = genomeContrast(exact, atelier);
    expect(contrast.score).toBeGreaterThan(0.2);
    expect(contrast.on).toContain('technicality');
    expect(contrast.on).toContain('rationality');
  });

  it('still reports nothing for two identical genomes', () => {
    const same = genome({ rationality: 0.5, humour: 0.5, warmth: 0.5 });
    expect(genomeContrast(same, same)).toEqual({ score: 0, on: ['rationality', 'humour', 'warmth'] });
  });
});
