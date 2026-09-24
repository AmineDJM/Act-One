import { describe, expect, it } from 'vitest';
import { UiSequence, type MotionRecipeName } from '@act-one/core';
import { stageProduct } from '@act-one/design';
import { validationContextFor } from '../author.ts';
import { fallbackScene, shotOf } from '../fallback.ts';
import { validateScene } from '../validate.ts';
import { clip, design, image, packetsFor, scene, storyboard, packet } from './helpers.ts';

/**
 * The engine's own composition.
 *
 * It is the floor under the agent, so it must pass the same checks the agent's
 * scenes pass, for every recipe the storyboard can name, whatever material
 * arrived — or a render that fell back to it would stop anyway.
 */
const RECIPES: MotionRecipeName[] = [
  'word_reveal', 'kinetic_headline', 'editorial_headline', 'mask_reveal', 'hold', 'statistic_reveal', 'metric_reveal',
  'quote_hold', 'product_window', 'product_sequence', 'floating_ui', 'feature_stack', 'product_zoom', 'spatial_cards',
  'image_wall', 'cursor_sequence', 'depth_transition', 'footage', 'photo_hold', 'logo_reveal', 'cta_end_card',
  'split_screen', 'window_explosion', 'command_bar_collapse', 'hard_cut',
];

const MATERIAL = {
  none: { assets: [] as string[], staged: [] },
  image: { assets: ['ast_img'], staged: [image('ast_img')] },
  clip: { assets: ['ast_clip'], staged: [clip('ast_clip')] },
} as const;

function errorsOf(html: string, target: ReturnType<typeof packet>): string[] {
  return validateScene(html, validationContextFor(target))
    .filter((finding) => finding.severity === 'error')
    .map((finding) => `${finding.code}: ${finding.message}`);
}

describe('the engine composition passes its own checks', () => {
  for (const recipe of RECIPES) {
    for (const [material, { assets, staged }] of Object.entries(MATERIAL)) {
      it(`${recipe} with ${material}`, () => {
        const text = recipe === 'metric_reveal' || recipe === 'statistic_reveal' ? ['12,500', 'invoices matched'] : ['Forty unmatched rows.', 'Every Monday.'];
        const target = packet({ recipe, text, assets: [...assets] }, { staged: [...staged], logo: image('ast_logo') });
        expect(errorsOf(fallbackScene(target, design()), target)).toEqual([]);
      });
    }
  }

  it('without a logo, setting the brand name instead', () => {
    for (const recipe of ['logo_reveal', 'cta_end_card'] as const) {
      const target = packet({ recipe, text: ['See everything, calmly.'] });
      const html = fallbackScene(target, design());
      expect(errorsOf(html, target)).toEqual([]);
      expect(html).toContain('>Northwind<');
    }
  });

  it('in every position of a film with joins', () => {
    const board = storyboard(
      [scene(0, { recipe: 'kinetic_headline' }), scene(1, { recipe: 'photo_hold', assets: ['ast_img'] }), scene(2, { recipe: 'cta_end_card' })],
      {
        scn_0: { kind: 'scale_through', seconds: 0.8, anchor: null, reason: 'test' },
        scn_1: { kind: 'field_change', seconds: 0.8, anchor: null, reason: 'test' },
      },
    );
    for (const target of packetsFor(board, { staged: [image('ast_img')] })) {
      expect(errorsOf(fallbackScene(target, design()), target), target.frameId).toEqual([]);
    }
  });
});

describe('the engine composition is the Remotion component', () => {
  it('sets the lines the layout engine broke, and no others', () => {
    const target = packet({ recipe: 'word_reveal', text: ['We have not been paged in eleven months.'] });
    const html = fallbackScene(target, design());
    for (const line of target.typeset!.blocks[0]!.lines) expect(html).toContain(`>${line}<`);
  });

  it('clears on the component tail when it leaves by a cut, and not when it leaves through a join', () => {
    const tails: [MotionRecipeName, number][] = [['kinetic_headline', 0.18], ['editorial_headline', 0.4], ['word_reveal', 0.35], ['metric_reveal', 0.3], ['quote_hold', 0.4], ['cta_end_card', 0.4], ['logo_reveal', 0.5]];
    for (const [recipe, tail] of tails) {
      const cut = fallbackScene(packet({ recipe, text: ['12', 'months'], duration: 3 }), design());
      expect(cut, recipe).toContain(`{ opacity: 0, duration: ${tail}, ease: "none", immediateRender: false }, ${Math.round((3 - tail) * 1000) / 1000});`);
    }
    const joined = packetsFor(
      storyboard([scene(0, { recipe: 'word_reveal' }), scene(1, { recipe: 'word_reveal' })], {
        scn_0: { kind: 'camera_carry', seconds: 0.8, anchor: null, reason: 'test' },
      }),
    );
    expect(fallbackScene(joined[0]!, design())).not.toContain('ease: "none", immediateRender: false');
    // The second leaves by the film's end, which is a cut.
    expect(fallbackScene(joined[1]!, design())).toContain('ease: "none", immediateRender: false');
  });

  it('frames a capture exactly where the Remotion product window stages it', () => {
    const tokens = design();
    const target = packet({ recipe: 'product_window', assets: ['ast_img'], params: { aspect: 1.6 }, visualType: 'product_ui' }, { staged: [image('ast_img')] });
    const box = stageProduct(tokens.grid, 1.6 / (1 + 0.052 * 1.6), { inset: 0.86 });
    const html = fallbackScene(target, tokens);
    expect(html).toContain(`left: ${box.x}px; top: ${box.y}px; width: ${box.width}px; height: ${box.height}px;`);
    expect(html).toContain('class="scene-01-dot"');
  });

  it('fades around the blur, as the Remotion component blurs and then fades one element', () => {
    const html = fallbackScene(packet({ recipe: 'product_window', assets: ['ast_img'] }, { staged: [image('ast_img')] }), design());
    expect(html).toContain('<div id="scene-01-fade"><div id="scene-01-camera"><div id="scene-01-surface">');
    expect(html).toContain('tl.fromTo("#scene-01-fade", { opacity: 0 }, { opacity: 1, duration: 1, ');
    expect(html).not.toMatch(/tl\.fromTo\("#scene-01-(surface|camera)", \{[^}]*opacity/);
  });

  it('leaves the bar off a bare frame and a 3D surface', () => {
    const bare = packet({ recipe: 'product_window', assets: ['ast_img'], params: { frame: 'bare' } }, { staged: [image('ast_img')] });
    expect(fallbackScene(bare, design())).not.toContain('scene-01-dot');
    const surface = packet({ recipe: 'product_window', assets: ['ast_img'], visualType: 'product_ui_3d' }, { staged: [image('ast_img')] });
    expect(fallbackScene(surface, design())).not.toContain('scene-01-dot');
  });

  it('plays a clip from the mount for the whole scene, and moves a wrapper rather than the clip', () => {
    const target = packet({ recipe: 'footage', text: ['Built for the night shift.'], assets: ['ast_clip'], duration: 4 }, { staged: [clip('ast_clip')] });
    const html = fallbackScene(target, design());
    expect(html).toContain('class="clip" src="assets/ast_clip.mp4" muted playsinline data-start="0" data-duration="4"');
    expect(html).toContain('tl.fromTo("#scene-01-camera"');
    expect(html).not.toContain('tl.fromTo("#scene-01-picture"');
  });

  it('chooses the shot the Remotion engine would', () => {
    const shot = (recipe: MotionRecipeName, material: keyof typeof MATERIAL) =>
      shotOf(packet({ recipe, assets: [...MATERIAL[material].assets] }, { staged: [...MATERIAL[material].staged] })).kind;
    expect(shot('footage', 'clip')).toBe('footage');
    expect(shot('footage', 'image')).toBe('photo');
    expect(shot('footage', 'none')).toBe('words');
    expect(shot('photo_hold', 'image')).toBe('photo');
    expect(shot('product_window', 'image')).toBe('product');
    expect(shot('product_window', 'none')).toBe('words');
    expect(shot('cta_end_card', 'image')).toBe('end_card');
    expect(shot('logo_reveal', 'none')).toBe('logo');
  });

  it('films a planned capture as its framings, the Remotion UiCinema', () => {
    const board = storyboard([scene(0, { recipe: 'product_sequence', text: ['Every signal in one place.'], assets: ['ast_img'], duration: 4 })]);
    board.scenes[0]!.uiSequence = UiSequence.parse({
      sourceWidth: 1600,
      sourceHeight: 1000,
      background: { r: 16, g: 20, b: 29 },
      framings: [
        { role: 'establish', move: 'settle', from: { x: 0, y: 0, width: 1, height: 0.9 }, to: { x: 0.05, y: 0.05, width: 0.9, height: 0.81 }, seconds: 1.8 },
        { role: 'subject', move: 'push', from: { x: 0.02, y: 0.1, width: 0.6, height: 0.54 }, to: { x: 0.05, y: 0.15, width: 0.45, height: 0.405 }, seconds: 3, lift: { x: 0.06, y: 0.2, width: 0.28, height: 0.2 }, words: 'bottom_right' },
      ],
    });
    const [target] = packetsFor(board, { staged: [image('ast_img')] });
    expect(shotOf(target!).kind).toBe('ui');
    const html = fallbackScene(target!, design());
    expect(errorsOf(html, target!)).toEqual([]);
    // Each framing is a clip on the scene's own clock; the second is held to the scene's end.
    expect(html).toContain('id="scene-01-f1" class="clip scene-01-framing" data-start="0" data-duration="1.8"');
    expect(html).toContain('id="scene-01-f2" class="clip scene-01-framing" data-start="1.8" data-duration="2.2"');
    expect(html).toContain('background: rgb(16, 20, 29)');
    expect(html).toContain('id="scene-01-f2-lift"');
    expect(html).toContain('id="scene-01-f2-words"');
    // The last framing clears over 0.3 s at its own end, as the Remotion component does.
    expect(html).toContain('tl.fromTo("#scene-01-f2-ground", { opacity: 1 }, { opacity: 0, duration: 0.3, ease: "none", immediateRender: false }, 4.5);');
  });

  it('counts a figure the way it was written, starting from zero', () => {
    const html = fallbackScene(packet({ recipe: 'metric_reveal', text: ['$12,500', 'saved each month'] }), design());
    expect(html).toContain('>$0<');
    expect(html).toContain('"12,500", 12500 * ');
  });
});
