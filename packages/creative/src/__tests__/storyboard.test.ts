import { describe, it, expect } from 'vitest';
import { RECIPES_FOR_VISUAL, coherentRecipe, recipeSuitsVisual, type VisualType } from '@act-one/core';
import { ScriptedLlmProvider } from '@act-one/providers';
import { StoryboardEngine } from '../index.ts';
import { brandFixture, briefFixture, conceptFixture, treatmentFixture, understandingFixture } from './fixtures.ts';

const context = { organizationId: 'org_1', projectId: 'prj_1' };

describe('recipe coherence', () => {
  it('keeps a recipe the visual type can render', () => {
    expect(coherentRecipe('kinetic_typography', 'kinetic_headline')).toBe('kinetic_headline');
    expect(coherentRecipe('statistic', 'statistic_reveal')).toBe('statistic_reveal');
  });

  it('replaces a recipe the visual type cannot feed', () => {
    // cursor_sequence drives a captured frame. On typography there is nothing
    // for the cursor to move across, and the renderer would draw nothing.
    const recipe = coherentRecipe('kinetic_typography', 'cursor_sequence');
    expect(recipeSuitsVisual(recipe, 'kinetic_typography')).toBe(true);
  });

  it('steps away from the previous scene so two in a row do not match', () => {
    expect(coherentRecipe('kinetic_typography', 'kinetic_headline', 'kinetic_headline')).not.toBe(
      'kinetic_headline',
    );
  });

  it('still returns something renderable when every option is the one to avoid', () => {
    // quote has exactly one recipe; avoiding it cannot be honoured, and
    // returning undefined would be worse than repeating a treatment.
    expect(coherentRecipe('quote', 'quote_hold', 'quote_hold')).toBe('quote_hold');
  });

  it('gives every visual type at least one recipe', () => {
    for (const [visualType, recipes] of Object.entries(RECIPES_FOR_VISUAL)) {
      expect(recipes.length, `${visualType} has no recipe`).toBeGreaterThan(0);
    }
  });
});

/** Plans one scene per archetype so every routing path is exercised at once. */
function planFor(archetypeIds: string[]) {
  return {
    scenes: archetypeIds.map((archetypeId, index) => ({
      archetypeId,
      purpose: `Beat ${index + 1}`,
      onScreenText: [`Line ${index + 1}`],
      narration: '',
      momentId: null,
      generativeBrief: '',
      claimText: '',
    })),
  };
}

describe('StoryboardEngine', () => {
  it('never pairs a scene with a recipe its visual type cannot render', async () => {
    // Every product archetype in the system, and no capture behind any of them:
    // the case that used to produce scenes of flat brand colour.
    const archetypes = ['word_slam', 'cursor_cold_open', 'workflow', 'annotated_ui', 'stack', 'metric', 'lockup'];
    const llm = new ScriptedLlmProvider([{ respond: () => planFor(archetypes) }]);

    const { storyboard } = await new StoryboardEngine(llm).build(
      {
        projectId: 'prj_1',
        concept: conceptFixture({ creativeSystem: 'kinetic_product' }),
        treatment: treatmentFixture(),
        understanding: understandingFixture({ productMoments: [] }),
        brand: brandFixture(),
        brief: briefFixture(),
        version: 1,
      },
      context,
    );

    expect(storyboard.scenes.length).toBeGreaterThan(0);
    for (const scene of storyboard.scenes) {
      expect(
        recipeSuitsVisual(scene.motionRecipe.name, scene.visualType as VisualType),
        `scene ${scene.index} is ${scene.visualType} carrying ${scene.motionRecipe.name}`,
      ).toBe(true);
    }
  });

  it('does not run the same recipe through consecutive scenes', async () => {
    const archetypes = ['workflow', 'annotated_ui', 'stack', 'workflow', 'annotated_ui', 'stack'];
    const llm = new ScriptedLlmProvider([{ respond: () => planFor(archetypes) }]);

    const { storyboard } = await new StoryboardEngine(llm).build(
      {
        projectId: 'prj_1',
        concept: conceptFixture({ creativeSystem: 'kinetic_product' }),
        treatment: treatmentFixture(),
        understanding: understandingFixture({ productMoments: [] }),
        brand: brandFixture(),
        brief: briefFixture(),
        version: 1,
      },
      context,
    );

    const recipes = storyboard.scenes.map((s) => s.motionRecipe.name);
    for (let i = 1; i < recipes.length; i += 1) {
      expect(recipes[i], `scenes ${i - 1} and ${i} share a treatment`).not.toBe(recipes[i - 1]);
    }
  });
});
