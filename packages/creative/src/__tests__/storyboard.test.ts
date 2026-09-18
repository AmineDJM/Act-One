import { describe, it, expect } from 'vitest';
import { RECIPES_FOR_VISUAL, coherentRecipe, recipeSuitsVisual, type VisualType } from '@act-one/core';
import { ScriptedLlmProvider } from '@act-one/providers';
import { StoryboardEngine, limitWords, stagedForCapture } from '../index.ts';
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

describe('what a public capture is allowed to do', () => {
  const momentBase = {
    description: '',
    startState: '',
    endState: '',
    recording: null,
    interactionSteps: [],
    requiresAuth: false,
    elementBounds: null,
    evidenceIds: [],
    wowScore: 0.5,
    relevanceScore: 0.7,
  };
  const published = {
    ...momentBase,
    id: 'mom_image',
    title: 'The dashboard',
    screenshots: ['ast_image'],
    sourceUrl: 'https://acme.com/product',
    captureKind: 'product_image' as const,
    captureLabel: 'product image on a product page — the dashboard',
    captureAspect: 1.571,
  };
  const page = {
    ...momentBase,
    id: 'mom_page',
    title: 'Pricing',
    screenshots: ['ast_page'],
    sourceUrl: 'https://acme.com/pricing',
    captureKind: 'public_page' as const,
    captureLabel: 'the pricing page (acme.com/pricing)',
    captureAspect: 1.6,
  };

  function planWith(scenes: { archetypeId: string; momentId: string | null }[]) {
    return {
      scenes: scenes.map((scene, index) => ({
        archetypeId: scene.archetypeId,
        purpose: `Beat ${index + 1}`,
        onScreenText: [`Line ${index + 1}`],
        narration: '',
        momentId: scene.momentId,
        generativeBrief: '',
        claimText: '',
      })),
    };
  }

  async function build(plan: ReturnType<typeof planWith>) {
    const llm = new ScriptedLlmProvider([{ respond: () => plan }]);
    return new StoryboardEngine(llm).build(
      {
        projectId: 'prj_1',
        concept: conceptFixture({ creativeSystem: 'kinetic_product' }),
        treatment: treatmentFixture(),
        understanding: understandingFixture({ productMoments: [published, page] }),
        brand: brandFixture(),
        brief: briefFixture(),
        version: 1,
      },
      context,
    );
  }

  it('lets a public capture carry a product scene', async () => {
    const { storyboard } = await build(
      planWith([
        { archetypeId: 'word_slam', momentId: null },
        { archetypeId: 'workflow', momentId: 'mom_image' },
        { archetypeId: 'annotated_ui', momentId: 'mom_page' },
      ]),
    );
    const [, image, pricing] = storyboard.scenes;
    // The whole point: these used to route to typography because the moment
    // had no capture. Now they show the product.
    expect(image!.visualType).toBe('product_ui');
    expect(image!.assetRefs).toEqual(['ast_image']);
    expect(pricing!.visualType).toBe('screenshot_motion');
    expect(pricing!.assetRefs).toEqual(['ast_page']);
  });

  it('stages a published product image as published, at its own shape', async () => {
    const { storyboard } = await build(
      planWith([
        { archetypeId: 'word_slam', momentId: null },
        { archetypeId: 'workflow', momentId: 'mom_image' },
        { archetypeId: 'annotated_ui', momentId: 'mom_page' },
      ]),
    );
    const [, image, pricing] = storyboard.scenes;
    expect(image!.motionRecipe.params).toMatchObject({ frame: 'bare', aspect: 1.571 });
    // A page is a page: it keeps the browser frame.
    expect(pricing!.motionRecipe.params['frame']).toBeUndefined();
    expect(pricing!.motionRecipe.params['aspect']).toBe(1.6);
  });

  it('never replays an interaction that did not happen on a public capture', () => {
    // cursor_sequence is a cursor moving and clicking. On a capture where
    // nobody clicked, that is an invented interaction, which is the one thing
    // a product scene must never be. In the product it happened, so it stays.
    const cursor = {
      name: 'cursor_sequence' as const,
      easing: 'out_quint' as const,
      delay: 0,
      stagger: 0.05,
      intensity: 0.6,
      params: {},
    };
    expect(stagedForCapture(cursor, page, 'product_ui', null).name).toBe('product_window');
    expect(stagedForCapture(cursor, published, 'product_ui', null).name).toBe('product_window');
    expect(
      stagedForCapture(cursor, { ...page, captureKind: 'in_app' }, 'product_ui', null).name,
    ).toBe('cursor_sequence');
    // Without a capture there is nothing to stage, and nothing to change.
    expect(stagedForCapture(cursor, undefined, 'product_ui', null)).toBe(cursor);
  });

  it('tells the director what each capture is', async () => {
    const llm = new ScriptedLlmProvider([
      { respond: () => planWith([{ archetypeId: 'word_slam', momentId: null }, { archetypeId: 'workflow', momentId: 'mom_image' }, { archetypeId: 'lockup', momentId: null }]) },
    ]);
    await new StoryboardEngine(llm).build(
      {
        projectId: 'prj_1',
        concept: conceptFixture({ creativeSystem: 'kinetic_product' }),
        treatment: treatmentFixture(),
        understanding: understandingFixture({ productMoments: [published, page, { ...momentBase, id: 'mom_none', title: 'Unseen', screenshots: [], sourceUrl: null, captureKind: null, captureLabel: '', captureAspect: null }] }),
        brand: brandFixture(),
        brief: briefFixture(),
        version: 1,
      },
      context,
    );
    const prompt = llm.calls[0]!.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('[real product image the company published: product image on a product page — the dashboard]');
    expect(prompt).toContain('[capture of the pricing page (acme.com/pricing)]');
    expect(prompt).toContain('[NOT captured — cannot be filmed in detail]');
  });
});

describe('copy longer than the archetype asked for', () => {
  it('drops whole trailing lines before it touches the first one', () => {
    expect(limitWords(['Order from chaos.', 'And then some more.'], 3)).toEqual([
      'Order from chaos.',
    ]);
  });

  it('never cuts a line into a fragment', () => {
    /*
     * The fallback used to return the first N words, which put "See how fast
     * work" on screen in a finished film — a phrase ending nowhere. The word
     * limit is guidance for the model, in the prompt; a line that overruns it
     * is a fitting problem, and the type engine solves fitting by sizing.
     */
    const line = 'See how fast work moves with Linear.';
    expect(limitWords([line], 4)).toEqual([line]);
  });

  it('leaves copy that already fits alone', () => {
    expect(limitWords(['Order from chaos.'], 10)).toEqual(['Order from chaos.']);
  });

  it('returns nothing when nothing is allowed', () => {
    expect(limitWords(['Anything'], 0)).toEqual([]);
  });
});
