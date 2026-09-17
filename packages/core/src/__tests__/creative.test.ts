import { describe, it, expect } from 'vitest';
import {
  conceptDivergence,
  conceptSetIsDiverse,
  leastDivergentPair,
  lexicalOverlap,
  primaryCtaFor,
  CTA_LABELS,
  ProjectStage,
  type Concept,
} from '../index.ts';

function concept(over: Partial<Concept> & Pick<Concept, 'id' | 'name' | 'keyIdea'>): Concept {
  return {
    projectId: 'prj_1',
    hook: 'A hook',
    targetEmotion: 'relief',
    productAngle: 'angle',
    narrativeStructure: 'problem_shift_proof',
    visualDirection: 'v',
    motionDirection: 'm',
    soundDirection: 's',
    productUiUsage: 'p',
    generativeUsage: 'g',
    creativeSystem: 'cinematic_black',
    estimatedDurationSeconds: 60,
    recommendedChannels: ['homepage_hero'],
    keyScenes: ['one', 'two', 'three'],
    momentIds: [],
    animaticAssetId: null,
    selected: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('lexicalOverlap', () => {
  it('ignores stopwords and short words', () => {
    expect(lexicalOverlap('that this with from', 'which while they them')).toBe(0);
  });

  it('detects genuinely restated ideas', () => {
    const a = 'Collapse complex operational workflows into one single command';
    const b = 'Complex workflows collapse into a single command';
    expect(lexicalOverlap(a, b)).toBeGreaterThan(0.7);
  });
});

describe('conceptDivergence', () => {
  it('flags three tints of the same idea', () => {
    const a = concept({ id: '1', name: 'One command', keyIdea: 'Collapse complexity into one command' });
    const b = concept({ id: '2', name: 'Single command', keyIdea: 'Collapse complexity into a command' });
    expect(conceptDivergence(a, b)).toBeLessThan(0.45);
    expect(conceptSetIsDiverse([a, b])).toBe(false);
  });

  it('accepts structurally different directions', () => {
    const a = concept({
      id: '1',
      name: 'One command',
      keyIdea: 'Watch twenty scattered tools collapse into a single instruction',
      narrativeStructure: 'metaphor_to_product',
      creativeSystem: 'cinematic_black',
      targetEmotion: 'relief',
    });
    const b = concept({
      id: '2',
      name: 'Meet your operator',
      keyIdea: 'Introduce the agent as a new colleague joining the team on Monday',
      narrativeStructure: 'day_in_the_life',
      creativeSystem: 'editorial_tech',
      targetEmotion: 'curiosity',
    });
    expect(conceptDivergence(a, b)).toBeGreaterThan(0.45);
    expect(conceptSetIsDiverse([a, b])).toBe(true);
  });

  it('identifies which pair to regenerate', () => {
    const a = concept({ id: '1', name: 'A', keyIdea: 'Speed through automated machine execution' });
    const b = concept({ id: '2', name: 'B', keyIdea: 'Speed through automated machine execution now', narrativeStructure: 'problem_shift_proof' });
    const c = concept({
      id: '3',
      name: 'C',
      keyIdea: 'A calm editorial statement about craft',
      narrativeStructure: 'manifesto',
      creativeSystem: 'editorial_tech',
      targetEmotion: 'awe',
    });
    expect(leastDivergentPair([a, b, c])).toEqual([0, 1]);
  });
});

describe('primary CTA', () => {
  it('maps every stage to exactly one labelled CTA', () => {
    for (const stage of ProjectStage.options) {
      const cta = primaryCtaFor(stage);
      expect(CTA_LABELS[cta]).toBeTruthy();
    }
  });

  it('asks for concept choice only once concepts exist', () => {
    expect(primaryCtaFor('created')).toBe('understand_product');
    expect(primaryCtaFor('concepting')).toBe('watch_progress');
    expect(primaryCtaFor('concepts_ready')).toBe('choose_concept');
    expect(primaryCtaFor('film_ready')).toBe('review_film');
  });
});

describe('idea-level veto', () => {
  it('refuses to call three restatements of one idea diverse, however differently shot', () => {
    const shared = 'Collapse a week of manual reconciliation into one automated run';
    const a = concept({
      id: '1',
      name: 'One run',
      keyIdea: shared,
      narrativeStructure: 'problem_shift_proof',
      creativeSystem: 'cinematic_black',
      targetEmotion: 'relief',
    });
    const b = concept({
      id: '2',
      name: 'Single run',
      keyIdea: 'Collapse a week of manual reconciliation into a single automated run',
      // Every structural signal differs — and it still must not count as diverse.
      narrativeStructure: 'manifesto',
      creativeSystem: 'editorial_tech',
      targetEmotion: 'ambition',
    });

    expect(conceptDivergence(a, b)).toBeLessThan(0.45);
    expect(conceptSetIsDiverse([a, b])).toBe(false);
  });

  it('still rewards genuinely different ideas that share a structure', () => {
    const a = concept({
      id: '1',
      name: 'One run',
      keyIdea: 'A week of manual matching disappears into a single automated run',
      targetEmotion: 'relief',
      creativeSystem: 'cinematic_black',
    });
    const b = concept({
      id: '2',
      name: 'Nobody waits',
      keyIdea: 'Finance stops being the department everyone else waits for',
      targetEmotion: 'ambition',
      creativeSystem: 'editorial_tech',
    });
    expect(conceptDivergence(a, b)).toBeGreaterThan(0.45);
  });
});
