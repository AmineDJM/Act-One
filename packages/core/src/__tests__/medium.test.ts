import { describe, it, expect } from 'vitest';
import { Scene, Storyboard, deckSymptoms, mediumOf, mediumMix } from '../index.ts';

/**
 * What a shot is made of, and what happened when it could not be.
 *
 * The bug this file is about is not a crash. It is a film in which a beat
 * written as moving footage came out as a word on a coloured card, and the
 * finished picture gave nobody any way to tell that from a beat that was
 * always meant to be a word on a coloured card. An absence read as a
 * decision, one more time.
 */
function scene(index: number, over: Record<string, unknown> = {}): Scene {
  return Scene.parse({
    id: `scn_${index}`,
    storyboardId: 'sbd_1',
    index,
    startTime: index * 2,
    duration: 2,
    purpose: 'a beat',
    visualType: 'kinetic_typography',
    motionRecipe: { name: 'word_reveal' },
    cameraRecipe: {},
    onScreenText: ['Something'],
    narration: '',
    assetRefs: [],
    generativeNeeds: [],
    status: 'ready',
    notes: '',
    ...over,
  });
}

function board(scenes: Scene[]): Storyboard {
  return Storyboard.parse({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1',
    version: 1, scenes, language: 'en',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const EVERYTHING = { video: true, threeD: true };
const NOTHING = { video: false, threeD: false };

const RECT = { x: 0.1, y: 0.1, width: 0.6, height: 0.5 };
const sequence = (framings: unknown[]) => ({
  sourceWidth: 2400, sourceHeight: 1500, background: { r: 255, g: 255, b: 255 }, framings,
});
const framing = (over: Record<string, unknown> = {}) => ({
  role: 'subject', move: 'push', from: RECT, to: RECT, seconds: 2, ...over,
});

describe('the medium of a shot', () => {
  it('reads the medium from what the beat is, not from what was lying around', () => {
    expect(mediumOf(scene(0), EVERYTHING).medium).toBe('motion_graphics');
    expect(mediumOf(scene(0, { visualType: 'generated_broll' }), EVERYTHING).medium).toBe('generative_video');
    expect(mediumOf(scene(0, { visualType: 'cinematic_3d' }), EVERYTHING).medium).toBe('three_d');
    expect(mediumOf(scene(0, { visualType: 'product_ui', assetRefs: ['ast_1'] }), EVERYTHING).medium).toBe('real_product');
  });

  it('calls real product inside a constructed space a hybrid', () => {
    const volume = scene(0, {
      visualType: 'product_ui',
      assetRefs: ['ast_1'],
      uiSequence: sequence([framing({ space: 'volume' })]),
    });
    expect(mediumOf(volume, EVERYTHING).medium).toBe('hybrid');
  });

  it('says out loud when a beat written as footage is playing as something else', () => {
    const plan = mediumOf(scene(0, { visualType: 'generated_broll' }), NOTHING);
    expect(plan.medium).toBe('generative_video');
    expect(plan.produced).toBe('motion_graphics');
    expect(plan.shortfall).toMatch(/directed as moving footage/);
    expect(plan.shortfall).toMatch(/Higgsfield/);
  });

  it('does not invent a shortfall when the provider is there', () => {
    expect(mediumOf(scene(0, { visualType: 'generated_broll' }), EVERYTHING).shortfall).toBe('');
    expect(mediumOf(scene(0, { visualType: 'cinematic_3d' }), EVERYTHING).shortfall).toBe('');
  });

  it('names the worker, not the credentials, when 3D is what is missing', () => {
    const plan = mediumOf(scene(0, { visualType: 'cinematic_3d' }), { video: true, threeD: false });
    expect(plan.shortfall).toMatch(/Blender/);
    expect(plan.shortfall).not.toMatch(/Higgsfield/);
  });

  it('counts the film by what it was actually made of', () => {
    const mix = mediumMix(
      board([
        scene(0),
        scene(1, { visualType: 'generated_broll' }),
        scene(2, { visualType: 'product_ui', assetRefs: ['ast_1'] }),
      ]),
      NOTHING,
    );
    // The generated beat had no material, so it plays as type: two media, not three.
    expect(mix.distinct).toBe(2);
    expect(mix.bySeconds.generative_video).toBe(0);
    expect(mix.bySeconds.motion_graphics).toBe(4);
    expect(mix.shortfalls).toHaveLength(1);
    expect(mix.shortfalls[0]).toMatchObject({ index: 1, startTime: 2 });
  });
});

describe('a film that is really a presentation', () => {
  const card = (index: number) => scene(index, { onScreenText: ['ATS'] });
  const held = (index: number) => scene(index, { visualType: 'product_ui', assetRefs: ['ast_1'], onScreenText: [] });

  it('does not accuse a cut that operates its product', () => {
    const operated = (index: number) =>
      scene(index, {
        visualType: 'product_ui',
        assetRefs: ['ast_1'],
        onScreenText: [],
        uiSequence: sequence([
          framing({
            layers: [
              { role: 'control', motion: 'press', rect: { x: 0.2, y: 0.2, width: 0.1, height: 0.05 }, knockout: true },
            ],
          }),
        ]),
      });
    const verdict = deckSymptoms(board([scene(0), operated(1), operated(2), operated(3), operated(4)]));
    expect(verdict.isDeck).toBe(false);
    expect(verdict.symptoms).not.toContain('nothing_happens');
  });

  it('names every habit when the cut is a deck, and refuses the deck repair', () => {
    const verdict = deckSymptoms(board([card(0), card(1), card(2), card(3), held(4), held(5)]));
    expect(verdict.isDeck).toBe(true);
    expect(verdict.symptoms).toContain('cards_carry_the_film');
    expect(verdict.symptoms).toContain('feature_by_feature');
    expect(verdict.symptoms).toContain('screens_held_not_operated');
    expect(verdict.message).toMatch(/different visual idea/);
    expect(verdict.message).toMatch(/not more words, another screenshot or one more card/);
  });

  it('counts honestly when one habit is present rather than three', () => {
    const verdict = deckSymptoms(board([card(0), card(1), card(2), card(3)]));
    expect(verdict.symptoms.length).toBeGreaterThan(0);
    if (!verdict.isDeck) expect(verdict.message).toMatch(new RegExp(`^${verdict.symptoms.length} of the`));
  });
});
