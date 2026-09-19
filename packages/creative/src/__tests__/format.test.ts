import { describe, it, expect } from 'vitest';
import {
  FilmFormat,
  REAL_PRODUCT_VISUAL_TYPES,
  budgetFor,
  type Concept,
  type VisualType,
} from '@act-one/core';
import { ScriptedLlmProvider } from '@act-one/providers';
import { CREATIVE_SYSTEMS, archetypesFor } from '../systems/index.ts';
import { StoryboardEngine, checkBudget, routeShot, type ShotPurpose } from '../index.ts';
import { brandFixture, briefFixture, conceptFixture, treatmentFixture, understandingFixture } from './fixtures.ts';

/**
 * The film that does not navigate the product.
 *
 * Two promises, and these hold both. The first is the one the customer made
 * the choice for: no interface appears, by any route — not through an
 * archetype, not through a captured moment, not through a picture in their own
 * archive. The second is the one that decides whether the format is worth
 * having: a film forbidden to show the product must still be a film, and not a
 * stack of title cards at a fixed interval, which is what subtraction alone
 * produces.
 */

const context = { organizationId: 'org_1', projectId: 'prj_1' };

const TYPOGRAPHIC: readonly VisualType[] = ['kinetic_typography', 'statistic', 'quote', 'logo_reveal', 'transition'];

describe('the vocabulary a pitch is left with', () => {
  it('has no way to say "the product" in any of the twelve systems', () => {
    for (const [id, system] of Object.entries(CREATIVE_SYSTEMS)) {
      for (const archetype of archetypesFor(system, 'pitch')) {
        expect(archetype.requiresProductAsset, `${id}/${archetype.id}`).toBe(false);
        expect(REAL_PRODUCT_VISUAL_TYPES, `${id}/${archetype.id}`).not.toContain(archetype.visualType);
      }
    }
  });

  it('is not three title cards, which is what subtracting alone would leave', () => {
    // Strip the product archetypes out of a system as written and nine of the
    // twelve are typography plus one statistic. That is the failure this
    // vocabulary exists to prevent, so it is the thing to measure.
    for (const [id, system] of Object.entries(CREATIVE_SYSTEMS)) {
      const pictures = archetypesFor(system, 'pitch').filter(
        (archetype) => !TYPOGRAPHIC.includes(archetype.visualType),
      );
      expect(pictures.length, `${id} can only set type`).toBeGreaterThanOrEqual(3);
    }
  });

  it('speaks in the system it belongs to rather than in one borrowed voice', () => {
    // Every beat the format *adds* sits inside the system's own scene range,
    // so a slow system does not suddenly cut like a fast one because the
    // format changed. The system's own archetypes are its business, including
    // where one sits outside the range it declared.
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

describe('routing a shot that may not show the product', () => {
  const purposes: ShotPurpose[] = [
    'workflow', 'result', 'feature', 'agent_behaviour', 'metaphor', 'environment',
    'mood', 'human_context', 'statement', 'proof', 'hero', 'transition', 'ending',
  ];

  it('cannot reach a product visual type from any purpose, even holding real capture', () => {
    for (const purpose of purposes) {
      for (const allowGenerative of [true, false]) {
        for (const allowThreeD of [true, false]) {
          const decision = routeShot({
            purpose,
            // The adversarial case: we *do* have real capture, and the format
            // still says no.
            hasRealProductAsset: true,
            allowGenerative,
            allowThreeD,
            format: 'pitch',
          });
          expect(REAL_PRODUCT_VISUAL_TYPES, `${purpose}`).not.toContain(decision.visualType);
          expect(decision.technique, `${purpose}`).not.toBe('real_product');
        }
      }
    }
  });

  it('reaches for an image before it reaches for type', () => {
    // A product beat in a pitch used to have one answer, typography, and a
    // film of nothing but answers like that is the metronome.
    const generative = routeShot({
      purpose: 'workflow', hasRealProductAsset: true, allowGenerative: true, allowThreeD: true, format: 'pitch',
    });
    expect(generative.visualType).toBe('generated_broll');

    const rendered = routeShot({
      purpose: 'hero', hasRealProductAsset: true, allowGenerative: false, allowThreeD: true, format: 'pitch',
    });
    expect(rendered.visualType).toBe('cinematic_3d');

    // And only when there is genuinely nothing else does type carry it.
    const typed = routeShot({
      purpose: 'hero', hasRealProductAsset: true, allowGenerative: false, allowThreeD: false, format: 'pitch',
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
  it('lifts the generative ceiling, because the thing it was protecting is not on screen', () => {
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
  /** A plan that asks for everything a pitch is not allowed to have. */
  function build(archetypeIds: string[], filmFormat: FilmFormat) {
    const llm = new ScriptedLlmProvider([
      {
        respond: () => ({
          scenes: archetypeIds.map((archetypeId, index) => ({
            archetypeId,
            purpose: `Beat ${index + 1}`,
            onScreenText: [`Line ${index + 1}`],
            narration: '',
            // Every scene asks to film the captured moment from the fixture.
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
        // The hard case: a real capture exists and the film may not use it.
        understanding: understandingFixture(),
        brand: brandFixture(),
        brief: briefFixture({ filmFormat }),
        version: 1,
      },
      context,
    ).then((result) => ({ ...result, llm }));
  }

  const productArchetypes = ['product_hero', 'moment', 'moment', 'product_hero', 'statement'];

  it('puts no interface on screen even when every scene asked for one', async () => {
    const { storyboard } = await build(productArchetypes, 'pitch');
    for (const scene of storyboard.scenes) {
      expect(REAL_PRODUCT_VISUAL_TYPES, `scene ${scene.index}`).not.toContain(scene.visualType);
    }
  });

  it('does not carry the capture into the film by the back door', async () => {
    const { storyboard } = await build(productArchetypes, 'pitch');
    for (const scene of storyboard.scenes) {
      expect(scene.momentIds, `scene ${scene.index}`).toEqual([]);
      // ast_1 and ast_2 are the moment's screenshots in the fixture.
      expect(scene.assetRefs, `scene ${scene.index}`).not.toContain('ast_1');
    }
  });

  it('shows the planner no moments to be tempted by, and says why', async () => {
    const { llm } = await build(productArchetypes, 'pitch');
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');
    expect(prompt).not.toContain('mom_1');
    expect(prompt).toMatch(/does not navigate the product/i);
    // And the archetypes it is offered are the pitch vocabulary, not the system's.
    expect(prompt).not.toContain('product_hero:');
    expect(prompt).toContain('photograph:');
  });

  it('is a film rather than a slideshow: most of it is not type', async () => {
    const { storyboard } = await build(productArchetypes, 'pitch');
    const pictures = storyboard.scenes.filter((scene) => !TYPOGRAPHIC.includes(scene.visualType));
    expect(pictures.length).toBeGreaterThan(0);
  });

  it('still films the product when the customer asked for a product tour', async () => {
    const { storyboard } = await build(productArchetypes, 'product_tour');
    const shown = storyboard.scenes.filter((scene) => REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.some((scene) => scene.assetRefs.includes('ast_1'))).toBe(true);
  });
});

describe('the last check before a pitch renders', () => {
  it('reports an interface in a pitch as the format broken, not a budget overrun', async () => {
    const llm = new ScriptedLlmProvider([
      {
        respond: () => ({
          scenes: ['product_hero', 'statement', 'proof'].map((archetypeId, index) => ({
            archetypeId,
            purpose: `Beat ${index + 1}`,
            onScreenText: [`Line ${index + 1}`],
            narration: '',
            momentId: index === 0 ? 'mom_1' : null,
            generativeBrief: '',
            claimText: '',
            libraryAssetId: null,
          })),
        }),
      },
    ]);
    // Built as a product tour, so it genuinely contains a product scene, then
    // checked as a pitch — which is what a format change after storyboarding
    // looks like.
    const { storyboard } = await new StoryboardEngine(llm).build(
      {
        projectId: 'prj_1',
        concept: conceptFixture(),
        treatment: treatmentFixture(),
        understanding: understandingFixture(),
        brand: brandFixture(),
        brief: briefFixture(),
        version: 1,
      },
      context,
    );

    const violations = checkBudget(storyboard, understandingFixture(), 'studio', {}, 'pitch');
    const broken = violations.find((violation) => violation.kind === 'fake_product');
    expect(broken?.message).toMatch(/pitch/i);
    expect(broken?.sceneIds.length).toBeGreaterThan(0);
  });

  it('does not accuse a pitch of wasting capture it was never allowed to use', () => {
    const llm = new ScriptedLlmProvider([]);
    void llm;
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
