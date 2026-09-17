import { describe, it, expect } from 'vitest';
import {
  Channel,
  lenientEnumArray,
  conceptDivergence,
  conceptSetIsDiverse,
  leastDivergentPair,
  lexicalOverlap,
  ACTIONABLE_CTAS,
  ctaNeedsAction,
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
    expect(primaryCtaFor('film_ready')).toBe('create_variants');
  });

  it('offers a way forward at every point the customer has to act', () => {
    // Each of these produced a CTA the UI had no action for, so the page
    // rendered no button at all: a finished storyboard could not be rendered, a
    // finished film could not be cut, and a failed project could only be
    // restarted by creating a whole new one.
    expect(primaryCtaFor('storyboard_ready')).toBe('render_film');
    expect(primaryCtaFor('film_ready')).toBe('create_variants');
    expect(primaryCtaFor('failed')).toBe('retry');
  });

  it('never produces a CTA the page has no button for', () => {
    // The invariant the three bugs above all broke. ACTIONABLE_CTAS is what the
    // project page wires; anything the state machine can produce that needs a
    // button must be in it.
    const needing = new Set(
      ProjectStage.options.map(primaryCtaFor).filter((cta) => ctaNeedsAction(cta)),
    );
    for (const cta of needing) {
      expect(ACTIONABLE_CTAS, `${cta} has no action`).toContain(cta);
    }
  });

  it('wires nothing it cannot reach', () => {
    // The other direction: an action wired for a CTA no stage produces is dead
    // code that looks like a feature.
    const produced = new Set(ProjectStage.options.map(primaryCtaFor));
    for (const cta of ACTIONABLE_CTAS) {
      expect(produced, `${cta} is wired but unreachable`).toContain(cta);
    }
  });

  it('only asks the customer to wait while work is actually running', () => {
    const waiting = ProjectStage.options.filter((stage) => primaryCtaFor(stage) === 'watch_progress');
    expect(waiting.sort()).toEqual(
      [
        'capturing_product',
        'concepting',
        'generating_assets',
        'qa',
        'rendering',
        'researching',
        'storyboarding',
        'understanding_ready',
      ].sort(),
    );
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

describe('lenientEnumArray', () => {
  it('maps the synonyms models actually return', () => {
    const schema = lenientEnumArray(Channel.options, {
      synonyms: { website: 'homepage_hero', social: 'paid_social', twitter: 'x' },
      fallback: ['homepage_hero'],
    });
    expect(schema.parse(['Website', 'social', 'Twitter'])).toEqual([
      'homepage_hero',
      'paid_social',
      'x',
    ]);
  });

  it('drops what it cannot map rather than failing the whole response', () => {
    const schema = lenientEnumArray(Channel.options, { fallback: ['homepage_hero'] });
    // A concept worth keeping must not be thrown away for naming a channel we
    // did not enumerate.
    expect(schema.parse(['linkedin', 'billboard', 'skywriting'])).toEqual(['linkedin']);
  });

  it('falls back when nothing survives', () => {
    const schema = lenientEnumArray(Channel.options, { fallback: ['homepage_hero'] });
    expect(schema.parse(['billboard'])).toEqual(['homepage_hero']);
    expect(schema.parse([])).toEqual(['homepage_hero']);
  });

  it('deduplicates and respects the cap', () => {
    const schema = lenientEnumArray(Channel.options, {
      synonyms: { web: 'homepage_hero' },
      fallback: ['homepage_hero'],
      max: 2,
    });
    expect(schema.parse(['web', 'homepage_hero', 'linkedin', 'x'])).toEqual([
      'homepage_hero',
      'linkedin',
    ]);
  });

  it('tolerates non-string values without throwing', () => {
    const schema = lenientEnumArray(Channel.options, { fallback: ['homepage_hero'] });
    expect(schema.parse([42, true, 'linkedin'])).toEqual(['linkedin']);
  });
});
