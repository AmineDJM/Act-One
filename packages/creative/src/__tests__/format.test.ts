import { describe, it, expect } from 'vitest';
import {
  FilmFormat,
  PITCH_PRODUCT_CEILING,
  PRODUCT_NAVIGATION_VISUAL_TYPES,
  REAL_PRODUCT_VISUAL_TYPES,
  budgetFor,
  pitchDrift,
  type Concept,
  type VisualType,
} from '@act-one/core';
import { ScriptedLlmProvider } from '@act-one/providers';
import { CREATIVE_SYSTEMS, archetypesFor } from '../systems/index.ts';
import { StoryboardEngine, checkBudget, routeShot, type ShotPurpose } from '../index.ts';
import { brandFixture, briefFixture, conceptFixture, treatmentFixture, understandingFixture } from './fixtures.ts';

/**
 * The film that is not about the interface.
 *
 * The rule these guard is structural rather than categorical, and that is the
 * whole point of them. A pitch is allowed to cut to the real thing — a brand
 * film cutting to the object it has been talking about is an old and good
 * move, and forbidding it made the format poorer than it needed to be. What
 * it is not allowed to do is become a product tour wearing a pitch's clothes:
 * opening on a screen, working through one, cutting two together, or spending
 * enough of the runtime on the interface that the film is really a
 * demonstration with an atmospheric introduction.
 *
 * The second promise matters as much: a film forbidden to be *led* by the
 * product must still be a film, not a stack of title cards, which is what
 * subtraction alone produces.
 */

const context = { organizationId: 'org_1', projectId: 'prj_1' };

const TYPOGRAPHIC: readonly VisualType[] = ['kinetic_typography', 'statistic', 'quote', 'logo_reveal', 'transition'];

describe('the vocabulary a pitch works in', () => {
  it('has no way to drive the interface, in any of the twelve systems', () => {
    for (const [id, system] of Object.entries(CREATIVE_SYSTEMS)) {
      for (const archetype of archetypesFor(system, 'pitch')) {
        expect(PRODUCT_NAVIGATION_VISUAL_TYPES, `${id}/${archetype.id}`).not.toContain(
          archetype.visualType,
        );
      }
    }
  });

  it('keeps one way to cut to the real thing, which is the point of allowing it', () => {
    for (const [id, system] of Object.entries(CREATIVE_SYSTEMS)) {
      const glimpses = archetypesFor(system, 'pitch').filter((archetype) =>
        REAL_PRODUCT_VISUAL_TYPES.includes(archetype.visualType),
      );
      expect(glimpses.length, `${id} has nothing to cut to`).toBeGreaterThan(0);
    }
  });

  it('is not three title cards, which is what subtracting alone would leave', () => {
    // Strip the product archetypes out of a system as written and nine of the
    // twelve are typography plus one statistic. That is the failure this
    // vocabulary exists to prevent, so it is the thing to measure.
    for (const [id, system] of Object.entries(CREATIVE_SYSTEMS)) {
      const pictures = archetypesFor(system, 'pitch').filter(
        (archetype) =>
          !TYPOGRAPHIC.includes(archetype.visualType) &&
          !REAL_PRODUCT_VISUAL_TYPES.includes(archetype.visualType),
      );
      expect(pictures.length, `${id} can only set type`).toBeGreaterThanOrEqual(3);
    }
  });

  it('speaks in the system it belongs to rather than in one borrowed voice', () => {
    for (const [id, system] of Object.entries(CREATIVE_SYSTEMS)) {
      const own = new Set(system.archetypes.map((archetype) => archetype.id));
      for (const archetype of archetypesFor(system, 'pitch')) {
        if (own.has(archetype.id)) continue;
        const [min, max] = archetype.durationRange;
        expect(min, `${id}/${archetype.id}`).toBeGreaterThanOrEqual(system.pacing.sceneRange[0]);
        expect(max, `${id}/${archetype.id}`).toBeLessThanOrEqual(system.pacing.sceneRange[1]);
        expect(max).toBeGreaterThan(min);
      }
    }
  });

  it('leaves a product tour exactly as its system wrote it', () => {
    for (const system of Object.values(CREATIVE_SYSTEMS)) {
      expect(archetypesFor(system, 'product_tour')).toBe(system.archetypes);
    }
  });
});

describe('the four ways a pitch becomes a tour', () => {
  function scene(over: { id: string; index: number; visualType: VisualType; duration?: number }) {
    return { duration: 3, ...over };
  }
  /** A film whose product shot is a cutaway with the story either side of it. */
  const honest = [
    scene({ id: 'a', index: 0, visualType: 'kinetic_typography' }),
    scene({ id: 'b', index: 1, visualType: 'generated_broll' }),
    scene({ id: 'c', index: 2, visualType: 'screenshot_motion', duration: 2 }),
    scene({ id: 'd', index: 3, visualType: 'statistic' }),
    scene({ id: 'e', index: 4, visualType: 'cinematic_3d' }),
    scene({ id: 'f', index: 5, visualType: 'logo_reveal' }),
  ];

  it('passes a pitch that cuts to the product once', () => {
    expect(pitchDrift(honest)).toEqual([]);
  });

  it('catches the interface being driven, however briefly', () => {
    const driven = honest.map((entry) =>
      entry.id === 'c' ? { ...entry, visualType: 'product_ui' as VisualType, duration: 0.5 } : entry,
    );
    expect(pitchDrift(driven).map((drift) => drift.kind)).toContain('navigated');
  });

  it('catches a film that opens on the product, because that is what it is about', () => {
    const opened = [
      scene({ id: 'z', index: 0, visualType: 'screenshot_motion', duration: 1 }),
      ...honest.slice(1),
    ];
    const kinds = pitchDrift(opened).map((drift) => drift.kind);
    expect(kinds).toContain('opens_on_product');
  });

  it('catches two product shots cut together, which is a walkthrough', () => {
    const sequence = honest.map((entry) =>
      entry.id === 'd' ? { ...entry, visualType: 'screenshot_motion' as VisualType, duration: 1 } : entry,
    );
    expect(pitchDrift(sequence).map((drift) => drift.kind)).toContain('product_spine');
  });

  it('catches a demonstration with an atmospheric introduction', () => {
    const mostly = [
      scene({ id: 'a', index: 0, visualType: 'kinetic_typography', duration: 2 }),
      scene({ id: 'b', index: 1, visualType: 'screenshot_motion', duration: 8 }),
      scene({ id: 'c', index: 2, visualType: 'statistic', duration: 2 }),
    ];
    const over = pitchDrift(mostly).find((drift) => drift.kind === 'over_ceiling');
    expect(over?.message).toMatch(new RegExp(`${Math.round(PITCH_PRODUCT_CEILING * 100)}%`));
  });

  it('says nothing about a film with no scenes in it', () => {
    expect(pitchDrift([])).toEqual([]);
  });
});

describe('routing a shot in a film led by its story', () => {
  const purposes: ShotPurpose[] = [
    'workflow', 'result', 'feature', 'agent_behaviour', 'metaphor', 'environment',
    'mood', 'human_context', 'statement', 'proof', 'hero', 'transition', 'ending',
  ];

  it('never drives the interface, from any purpose, even holding real capture', () => {
    for (const purpose of purposes) {
      for (const allowGenerative of [true, false]) {
        for (const allowThreeD of [true, false]) {
          const decision = routeShot({
            purpose,
            hasRealProductAsset: true,
            allowGenerative,
            allowThreeD,
            format: 'pitch',
          });
          expect(PRODUCT_NAVIGATION_VISUAL_TYPES, `${purpose}`).not.toContain(decision.visualType);
        }
      }
    }
  });

  it('cuts to a held capture where a tour would work through one', () => {
    const pitch = routeShot({
      purpose: 'workflow', hasRealProductAsset: true, allowGenerative: true, allowThreeD: true, format: 'pitch',
    });
    expect(pitch.visualType).toBe('screenshot_motion');

    const tour = routeShot({
      purpose: 'workflow', hasRealProductAsset: true, allowGenerative: true, allowThreeD: true,
    });
    expect(tour.visualType).toBe('product_ui');
  });

  it('reaches for an image before it reaches for type when there is no capture', () => {
    // A product beat in a pitch with nothing to cut to used to have one
    // answer, typography, and a film of nothing but those is the metronome.
    const generative = routeShot({
      purpose: 'workflow', hasRealProductAsset: false, allowGenerative: true, allowThreeD: true, format: 'pitch',
    });
    expect(generative.visualType).toBe('generated_broll');

    const rendered = routeShot({
      purpose: 'hero', hasRealProductAsset: false, allowGenerative: false, allowThreeD: true, format: 'pitch',
    });
    expect(rendered.visualType).toBe('cinematic_3d');

    const typed = routeShot({
      purpose: 'hero', hasRealProductAsset: false, allowGenerative: false, allowThreeD: false, format: 'pitch',
    });
    expect(typed.visualType).toBe('kinetic_typography');
  });

  it('routes a product tour exactly as it did before the choice existed', () => {
    for (const purpose of purposes) {
      const withFormat = routeShot({
        purpose, hasRealProductAsset: true, allowGenerative: true, allowThreeD: true, format: 'product_tour',
      });
      const without = routeShot({
        purpose, hasRealProductAsset: true, allowGenerative: true, allowThreeD: true,
      });
      expect(withFormat).toEqual(without);
    }
  });
});

describe('what a pitch may spend', () => {
  it('lifts the generative ceiling, because the thing it was protecting is not leading', () => {
    for (const mode of ['studio', 'cinematic'] as const) {
      expect(budgetFor(mode, 'pitch').maxGenerativeRatio).toBeGreaterThan(
        budgetFor(mode, 'product_tour').maxGenerativeRatio,
      );
    }
  });

  it('still keeps a third of the film rendered by our own engine', () => {
    for (const mode of ['studio', 'cinematic'] as const) {
      expect(budgetFor(mode, 'pitch').minDeterministicRatio).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('does not let a pitch talk its way out of real media only', () => {
    expect(budgetFor('authentic', 'pitch')).toEqual(budgetFor('authentic', 'product_tour'));
    expect(budgetFor('authentic', 'pitch').maxGenerativeRatio).toBe(0);
  });
});

describe('the storyboard a pitch actually gets', () => {
  /** A plan that asks for the product in every scene. */
  function build(archetypeIds: string[], filmFormat: FilmFormat) {
    const llm = new ScriptedLlmProvider([
      {
        respond: () => ({
          scenes: archetypeIds.map((archetypeId, index) => ({
            archetypeId,
            purpose: `Beat ${index + 1}`,
            onScreenText: [`Line ${index + 1}`],
            narration: '',
            momentId: 'mom_1',
            generativeBrief: '',
            claimText: '',
            libraryAssetId: null,
          })),
        }),
      },
    ]);
    return new StoryboardEngine(llm).build(
      {
        projectId: 'prj_1',
        concept: conceptFixture({ creativeSystem: 'cinematic_black' as Concept['creativeSystem'] }),
        treatment: treatmentFixture(),
        understanding: understandingFixture(),
        brand: brandFixture(),
        brief: briefFixture({ filmFormat }),
        version: 1,
      },
      context,
    ).then((result) => ({ ...result, llm }));
  }

  const productArchetypes = ['product_hero', 'moment', 'moment', 'product_hero', 'statement'];

  it('never drives the interface, even when every scene asked to', async () => {
    const { storyboard } = await build(productArchetypes, 'pitch');
    for (const scene of storyboard.scenes) {
      expect(PRODUCT_NAVIGATION_VISUAL_TYPES, `scene ${scene.index}`).not.toContain(scene.visualType);
    }
  });

  it('reports the drift rather than silently producing a tour', async () => {
    // Every scene asked for the product, so this plan *is* a tour. The engine
    // stops it driving anything; the violations say what is still wrong, which
    // is what the repair loop and the render guard act on.
    const { storyboard, violations } = await build(productArchetypes, 'pitch');
    const drift = pitchDrift(storyboard.scenes);
    expect(drift.length).toBeGreaterThan(0);
    expect(violations.some((violation) => violation.kind === 'pitch_drift')).toBe(true);
  });

  it('is shown a few moments to cut to, not the whole list to plan from', async () => {
    const { llm } = await build(productArchetypes, 'pitch');
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');
    expect(prompt).toMatch(/At most one of these reaches the film|led by the story/i);
    expect(prompt).toMatch(/walkthrough/i);
    expect(prompt).toMatch(/never a cursor moving/i);
    // And the archetypes it is offered include the pitch vocabulary.
    expect(prompt).toContain('photograph:');
  });

  it('still films the product when the customer asked for a product tour', async () => {
    const { storyboard } = await build(productArchetypes, 'product_tour');
    const shown = storyboard.scenes.filter((scene) => REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.some((scene) => scene.assetRefs.includes('ast_1'))).toBe(true);
  });
});

describe('the budget check on a pitch', () => {
  it('does not accuse a pitch of wasting capture it was never led by', () => {
    const violations = checkBudget(
      { scenes: [] } as unknown as Parameters<typeof checkBudget>[0],
      understandingFixture(),
      'studio',
      {},
      'pitch',
    );
    expect(violations.some((violation) => violation.kind === 'too_little_real')).toBe(false);
  });
});
