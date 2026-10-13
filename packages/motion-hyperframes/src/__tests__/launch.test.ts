import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { sceneWindows, UiDrawing, UiSequence, type CaptionCue, type MotionRecipeName } from '@act-one/core';
import { contrastRatio, resolveTokens } from '@act-one/design';
import type { LlmProvider } from '@act-one/providers';
import { writeProject } from '../assemble.ts';
import { authorScene, engineScene, validationContextFor, type SceneAuthorOptions } from '../author.ts';
import { captionCss, captionsComposition, captionsMarkup } from '../captions.ts';
import {
  accentWordOf,
  countable,
  launchBackdrop,
  launchSoundCues,
  launchPalettes,
  launchReadable,
  launchScene,
  listItems,
  planLaunch,
  type LaunchBeat,
} from '../launch.ts';
import { motionRuntimeSource } from '../motion-runtime.ts';
import { MemorySceneStore, sceneKey } from '../scene-store.ts';
import { studioCss } from '../studio.ts';
import { filmTokens, tokenCss } from '../tokens.ts';
import type { ScenePacket } from '../types.ts';
import { validateScene } from '../validate.ts';
import { brand, clip, design, image, packet, packetsFor, scene, sceneTokens, storyboard } from './helpers.ts';

/**
 * The launch look.
 *
 * Drawn by the engine for every scene of a film, so it must pass every check
 * the engine holds its own composition to, for every recipe and material a
 * storyboard can name; it must say only what the storyboard wrote; and it
 * must leave nothing filtered at rest, because HyperFrames captures a page
 * carrying a few dozen filtered layers as black frames.
 */
const DAY: LaunchBeat = { act: 'day', opener: false, chapter: false, chapterIndex: -1 };

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

function errorsOf(html: string, target: ScenePacket): string[] {
  return validateScene(launchReadable(html), { ...validationContextFor(target), expectsFrame: false })
    .filter((finding) => finding.severity === 'error')
    .map((finding) => `${finding.code}: ${finding.message}`);
}

function textFor(recipe: MotionRecipeName): string[] {
  if (recipe === 'metric_reveal' || recipe === 'statistic_reveal') return ['12,500', 'invoices matched'];
  if (recipe === 'quote_hold') return ['We close the books on the first.', 'Dana Ruiz, Controller'];
  return ['Forty unmatched rows.', 'Every Monday.'];
}

const BEATS: Record<string, LaunchBeat> = {
  night: { act: 'night', opener: false, chapter: false, chapterIndex: -1 },
  opener: { act: 'night', opener: true, chapter: false, chapterIndex: -1 },
  day: DAY,
  chapter: { act: 'day', opener: false, chapter: true, chapterIndex: 1 },
  brand: { act: 'brand', opener: false, chapter: false, chapterIndex: -1 },
};

describe('every beat of the launch look passes the engine’s own checks', () => {
  for (const recipe of RECIPES) {
    for (const [material, { assets, staged }] of Object.entries(MATERIAL)) {
      it(`${recipe} with ${material}`, () => {
        const target = packet({ recipe, text: textFor(recipe), assets: [...assets] }, { staged: [...staged], logo: image('ast_logo') });
        for (const [name, beat] of Object.entries(BEATS)) {
          const html = launchScene(target, design(), beat);
          expect(errorsOf(html, target), `${recipe} as ${name}`).toEqual([]);
          // Nothing composited at rest: no filter anywhere, a word's blur is its own text shadow.
          expect(html, `${recipe} as ${name}`).not.toMatch(/filter/i);
        }
      });
    }
  }

  it('without a logo, setting the brand’s name in the disc, never a letter of it', () => {
    for (const recipe of ['logo_reveal', 'cta_end_card'] as const) {
      const target = packet({ recipe, text: [] });
      const html = launchScene(target, design(), BEATS.brand!);
      expect(errorsOf(html, target)).toEqual([]);
      expect(html).toContain('>Northwind</span>');
    }
  });

  it('through the engine, marked as its own and reported as the launch look', () => {
    const target = packet({ recipe: 'kinetic_headline', text: ['If it’s customizable, it must be complicated.'] });
    const drawn = engineScene(target, design(), 'key', 0, 0, 'test', { name: 'launch', plan: planLaunch([target]) });
    expect(drawn.html).toContain('data-ao-fallback="true" id="root"');
    expect(drawn.report.findings.map((finding) => finding.code)).not.toContain('studio_frame_unused');
  });

  it('refuses a colour that is not a hex colour rather than drawing a glow opaque', () => {
    const target = packet({ recipe: 'kinetic_headline' });
    expect(() => launchScene(target, { ...design(), accent: 'rgb(1, 2, 3)' }, DAY)).toThrow();
  });
});

describe('the plan of a launch film', () => {
  const board = storyboard([
    scene(0, { recipe: 'kinetic_headline', text: ['If it’s customizable,'] }),
    scene(1, { recipe: 'editorial_headline', text: ['it must be complicated.'] }),
    scene(2, { recipe: 'product_window', text: ['Plasma starts as a desktop.'], assets: ['ast_img'] }),
    scene(3, { recipe: 'kinetic_headline', text: ['Apps.'] }),
    scene(4, { recipe: 'feature_stack', text: ['Panel. Theme. Widget.'] }),
    scene(5, { recipe: 'metric_reveal', text: ['40%', 'faster'] }),
    scene(6, { recipe: 'kinetic_headline', text: ['Switch the theme.'] }),
    scene(7, { recipe: 'kinetic_headline', text: ['Simple by default, powerful when needed.'] }),
    scene(8, { recipe: 'cta_end_card', text: [] }),
  ]);
  const packets = packetsFor(board, { staged: [image('ast_img')] });
  const plan = planLaunch(packets);
  const beats = packets.map((target) => plan.get(target.frameId)!);

  it('sets the problem at night, the product in daylight and the close in the brand’s colour', () => {
    expect(beats.map((beat) => beat.act)).toEqual(['night', 'night', 'day', 'day', 'day', 'day', 'day', 'day', 'brand']);
  });

  it('opens on the first line, and only there', () => {
    expect(beats.map((beat) => beat.opener)).toEqual([true, false, false, false, false, false, false, false, false]);
  });

  it('makes chapters of the short lines between product beats, alternating, and nothing else', () => {
    expect(beats.map((beat) => beat.chapterIndex)).toEqual([-1, -1, -1, 0, -1, -1, 1, -1, -1]);
  });

  it('keeps a film with no pictures at night until its close', () => {
    const words = packetsFor(storyboard([scene(0, { recipe: 'kinetic_headline' }), scene(1, { recipe: 'word_reveal' }), scene(2, { recipe: 'logo_reveal', text: [] })]));
    expect(words.map((target) => planLaunch(words).get(target.frameId)!.act)).toEqual(['night', 'night', 'brand']);
  });

  it('opens a film that starts on the product in daylight, with no night to open out of', () => {
    const product = packetsFor(storyboard([scene(0, { recipe: 'product_window', assets: ['ast_img'] }), scene(1, { recipe: 'cta_end_card', text: [] })]), { staged: [image('ast_img')] });
    const productPlan = planLaunch(product);
    expect(product.map((target) => productPlan.get(target.frameId)!.act)).toEqual(['day', 'brand']);
    const backdrop = launchBackdrop(product, productPlan, new Map([['scene-01', 0], ['scene-02', 3]]), design());
    expect(backdrop.css).toContain('#ao-bd-day { opacity: 1; }');
    expect(backdrop.statements.join('\n')).not.toContain('clipPath');
  });
});

describe('the words of a launch film', () => {
  it('turns each line on one word: a figure or a name first, else the longest word that carries meaning', () => {
    expect(accentWordOf('Close 40% of tickets.')).toBe('40');
    expect(accentWordOf('Plasma starts as a desktop.')).toBe('desktop');
    expect(accentWordOf('Find it as you type.')).toBe('type');
    expect(accentWordOf('It is.')).toBeNull();
  });

  it('reads a line of short items as a list, and a sentence as a sentence', () => {
    expect(listItems('Launcher. Tasks. Tray. Files.')).toEqual(['Launcher', 'Tasks', 'Tray', 'Files']);
    expect(listItems('Plan · Build · Ship')).toEqual(['Plan', 'Build', 'Ship']);
    expect(listItems('Plan; build; ship.')).toEqual(['Plan', 'build', 'ship']);
    expect(listItems('One.')).toEqual([]);
    expect(listItems('Plasma is customizable.')).toEqual([]);
    expect(listItems('Fast. Built for everyone who ships every day.')).toEqual([]);
  });

  it('counts up to a plain figure, and shows every other figure as it was written', () => {
    expect(countable('40%')).toMatchObject({ prefix: '', digits: '40', suffix: '%', value: 40, decimals: 0, grouped: false });
    expect(countable('$12,500')).toMatchObject({ prefix: '$', value: 12_500, grouped: true });
    expect(countable('1.5x')).toMatchObject({ value: 1.5, decimals: 1, suffix: 'x' });
    for (const figure of ['2026', '3.5.1', '24/7', '1 in 3', 'twelve']) expect(countable(figure), figure).toBeNull();
    expect(countable('2026%')).not.toBeNull();
  });

  it('types the opening line glyph by glyph, and the check still reads its words', () => {
    const target = packet({ recipe: 'kinetic_headline', text: ['If it’s customizable,'] });
    const html = launchScene(target, design(), BEATS.opener!);
    const glyphs = [...html.matchAll(/class="ao-g">([^<]*)</g)].map((match) => match[1]);
    expect(glyphs.join('')).toBe('Ifit’scustomizable,');
    // Each glyph arrives once, lighting the caret; the caret leaves every glyph but the last as the next one arrives.
    expect(html.match(/borderRightColor: "rgba\([^)]*,1\)", duration: 0\.001, ease: "none" \}/g)!.length).toBeGreaterThanOrEqual(glyphs.length);
    expect(launchReadable(html)).toContain('customizable,');
    expect(errorsOf(html, target)).toEqual([]);
  });
});

describe('the colours of a launch film', () => {
  it('keep the accent and the quiet type readable on every act, over the glows too, even for a pale brand', () => {
    const over = (base: string, colour: string, alpha: number) => {
      const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
      const blend = (at: number) => Math.round(channel(colour, at) * alpha + channel(base, at) * (1 - alpha)).toString(16).padStart(2, '0');
      return `#${blend(1)}${blend(3)}${blend(5)}`;
    };
    for (const primary of ['#3d7bfd', '#ffe680', '#0b0b0b', '#316f98', '#ff5a1f', '#22c55e']) {
      const tokens = resolveTokens({ ...brand, primaryColor: primary, primaryCandidates: [primary] }, { aspect: '16:9', quality: 'hd', theme: 'dark' });
      const palettes = launchPalettes(tokens);
      for (const field of [palettes.night.base[0], palettes.night.base[1], over(palettes.night.base[1], palettes.night.glow, 0.54)]) {
        expect(contrastRatio(palettes.night.accent, field), `${primary} night on ${field}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palettes.night.ink, field), `${primary} night ink on ${field}`).toBeGreaterThanOrEqual(7);
      }
      for (const field of [palettes.day.base[0], palettes.day.base[1], over(palettes.day.base[1], palettes.day.glow, 0.45)]) {
        expect(contrastRatio(palettes.day.accent, field), `${primary} day accent on ${field}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palettes.day.muted, field), `${primary} day muted on ${field}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palettes.day.ink, field), `${primary} day ink on ${field}`).toBeGreaterThanOrEqual(7);
      }
      expect(contrastRatio('#ffffff', palettes.brand.base[0]), primary).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the backdrop of a launch film', () => {
  const board = storyboard([
    scene(0, { recipe: 'kinetic_headline', duration: 2 }),
    scene(1, { recipe: 'product_window', assets: ['ast_img'], duration: 3 }),
    scene(2, { recipe: 'cta_end_card', text: [], duration: 2 }),
  ]);
  const packets = packetsFor(board, { staged: [image('ast_img')] });
  const plan = planLaunch(packets);
  const backdrop = launchBackdrop(packets, plan, new Map([['scene-01', 0], ['scene-02', 2], ['scene-03', 5]]), design());
  const statements = backdrop.statements.join('\n');

  it('is on from the first frame in the first act, the others hidden until they arrive', () => {
    expect(backdrop.css).toContain('.ao-bd { position: absolute; inset: 0; opacity: 0; }');
    expect(backdrop.css).toContain('#ao-bd-night { opacity: 1; }');
    expect(backdrop.markup).toContain('<div id="ao-bd-night" class="ao-bd">');
    expect(backdrop.markup).toContain('<div id="ao-bd-line"></div>');
  });

  it('draws a line of light across the night, then opens the day out of it as the product arrives', () => {
    expect(statements).toContain('tl.fromTo("#ao-bd-line", { opacity: 0, scaleX: 0 }, { opacity: 1, scaleX: 1, duration: 0.35, ease: "power2.out" }, 1.5);');
    expect(statements).toContain('tl.fromTo("#ao-bd-day", { opacity: 1, clipPath: "circle(0% at 50% 50%)" }, { opacity: 1, clipPath: "circle(75% at 50% 50%)", duration: 0.75, ease: "power2.inOut", immediateRender: false }, 1.85);');
  });

  it('washes the brand’s colour in for the close', () => {
    expect(statements).toContain('tl.fromTo("#ao-bd-brand", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power2.inOut", immediateRender: false }, 4.85);');
  });

  it('holds its glows still, so each act is painted once, and filters nothing', () => {
    expect(backdrop.markup).toContain('id="ao-bd-night-g1"');
    expect(statements).not.toContain('-g1');
    expect(statements).not.toContain('-g2');
    expect(`${backdrop.css}${backdrop.markup}${statements}`).not.toMatch(/filter/i);
  });
});

describe('the sound a launch film’s motion asks for', () => {
  const board = storyboard([
    scene(0, { recipe: 'kinetic_headline', text: ['If it’s customizable,'], duration: 2 }),
    scene(1, { recipe: 'product_window', text: ['Launcher. Tasks. Tray.'], assets: ['ast_img'], duration: 3 }),
    scene(2, { recipe: 'kinetic_headline', text: ['Apps.'], duration: 1.5 }),
    scene(3, { recipe: 'cta_end_card', text: [], duration: 2 }),
  ]);
  const packets = packetsFor(board, { staged: [image('ast_img')] });
  const plan = planLaunch(packets);
  const starts = new Map([['scene-01', 0], ['scene-02', 2], ['scene-03', 5], ['scene-04', 6.5]]);
  const cues = launchSoundCues(packets, plan, starts);

  it('lands on the first light, the day opening, the chapter and the mark — and never clicks for a chip nobody clicked', () => {
    expect(cues.map((cue) => `${cue.sceneId} ${cue.time} ${cue.type}`)).toEqual([
      'scn_0 0.06 whoosh',
      'scn_1 1.85 whoosh',
      'scn_1 2.3 impact',
      'scn_1 2.04 whoosh',
      'scn_2 5.16 impact',
      'scn_3 6.35 whoosh',
      'scn_3 6.55 logo_sting',
    ]);
  });

  it('asks for nothing before the film starts, and nothing for a classic film’s plan it was not given', () => {
    expect(cues.every((cue) => cue.time >= 0)).toBe(true);
    expect(launchSoundCues(packets, plan, new Map())).toEqual([]);
  });
});

describe('a filmed capture on a launch card', () => {
  const sequence = UiSequence.parse({
    sourceWidth: 1600,
    sourceHeight: 1000,
    background: { r: 16, g: 20, b: 29 },
    framings: [
      { role: 'establish', move: 'hold', from: { x: 0, y: 0, width: 1, height: 0.9 }, to: { x: 0, y: 0, width: 1, height: 0.9 }, seconds: 1.2 },
      { role: 'subject', move: 'lateral', from: { x: 0.1, y: 0.1, width: 0.5, height: 0.45 }, to: { x: 0.3, y: 0.2, width: 0.5, height: 0.45 }, seconds: 1.8 },
    ],
  });
  const board = storyboard([scene(0, { recipe: 'product_sequence', text: ['Every signal in one place.'], assets: ['ast_img'], duration: 3 })]);
  board.scenes[0]!.uiSequence = sequence;
  const target = packetsFor(board, { staged: [image('ast_img')] })[0]!;
  const html = launchScene(target, design(), DAY);

  it('passes the checks and holds the storyboard’s camera inside the card', () => {
    expect(errorsOf(html, target)).toEqual([]);
    const card = /#scene-01-plate \{ position: absolute; left: 0; top: 0; width: ([\d.]+)px; height: ([\d.]+)px;/.exec(html)!;
    const [cardWidth, plateHeight] = [Number(card[1]), Number(card[2])];
    expect(plateHeight / cardWidth).toBeCloseTo(1000 / 1600, 3);
    const at = run(html);
    const expected = (rect: { x: number; y: number; width: number }) => {
      const s = 1 / rect.width;
      return [-rect.x * cardWidth * s, -rect.y * plateHeight * s, s];
    };
    expectTransform(at(0)('scene-01-plate'), expected({ x: 0, y: 0, width: 1 }));
    // Halfway through a lateral framing, the crop is halfway between its two rectangles.
    expectTransform(at(1.2 + 0.9)('scene-01-plate'), expected({ x: 0.2, y: 0.15, width: 0.5 }));
    expectTransform(at(3)('scene-01-plate'), expected({ x: 0.3, y: 0.2, width: 0.5 }));
  });
});

describe('a launch film, assembled', () => {
  it('lays the backdrop under every scene in place of the flat field, with its tweens on the film’s clock and pill captions', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-hf-launch-'));
    const board = storyboard([scene(0, { recipe: 'kinetic_headline' }), scene(1, { recipe: 'product_window', assets: ['ast_img'] }), scene(2, { recipe: 'cta_end_card', text: [] })]);
    const packets = packetsFor(board, { staged: [image('ast_img')] });
    const plan = planLaunch(packets);
    const tokens = sceneTokens();
    const cues: CaptionCue[] = [{ start: 0.5, end: 2, text: 'A line the voice reads.', lines: ['A line the voice reads.'], emphasis: null }];
    await writeProject({
      projectDir: dir,
      canvas: { width: 1920, height: 1080 },
      fps: 30,
      filmFrames: 270,
      language: 'en',
      packets,
      scenes: new Map(packets.map((target) => [target.frameId, launchScene(target, tokens.design, plan.get(target.frameId)!)])),
      windows: new Map(sceneWindows(board).map((window, index) => [packets[index]!.frameId, window])),
      tokenCss: tokenCss(tokens.film),
      studioCss: studioCss(tokens.design),
      fontCss: '',
      captions: (seconds) => captionsComposition(cues, tokens.film, '16:9', 'pill', seconds),
      watermarkSvg: null,
      backdrop: (beatStarts) => launchBackdrop(packets, plan, beatStarts, tokens.design),
    });
    const index = await readFile(path.join(dir, 'index.html'), 'utf8');
    // Mounted as a composition of its own, on the lowest track, for the whole film.
    expect(index).toContain('<div id="host-ao-backdrop" class="ao-scene" data-composition-id="ao-backdrop" data-composition-src="compositions/ao-backdrop.html" data-start="0" data-duration="9" data-track-index="0"');
    expect(index).not.toContain('id="ao-field"');
    // The captions too, above the scenes: a clip holding elements in the film's page is a lint warning per cue.
    expect(index).toContain('<div id="host-ao-captions" class="ao-scene" data-composition-id="ao-captions" data-composition-src="compositions/ao-captions.html" data-start="0" data-duration="9" data-track-index="3"');
    expect(index).not.toContain('ao-caption-1');
    const captions = await readFile(path.join(dir, 'compositions', 'ao-captions.html'), 'utf8');
    expect(captions).toContain('border-radius: 999px;');
    expect(captions).toContain('font-size:28px');
    expect(captions).toContain('tl.set("#ao-caption-1", { visibility: "visible" }, 0.5);');
    expect(captions).toContain('tl.fromTo("#ao-caption-1 .ao-caption-block", { opacity: 0, y: 9 }, { opacity: 1, y: 0, duration: 0.14, ease: "power2.out", immediateRender: false }, 0.5);');
    expect(captions).toContain('tl.set("#ao-caption-1", { visibility: "hidden" }, 2);');
    expect(captions).toContain('window.__timelines["ao-captions"] = tl;');
    const field = await readFile(path.join(dir, 'compositions', 'ao-backdrop.html'), 'utf8');
    expect(field).toContain('<div id="root" data-composition-id="ao-backdrop" data-width="1920" data-height="1080">');
    expect(field).toContain('#ao-bd-night { opacity: 1; }');
    // The day opens where the product's beat starts on the film's clock, a little ahead of it.
    expect(field).toContain('clipPath: "circle(75% at 50% 50%)", duration: 0.75, ease: "power2.inOut", immediateRender: false }, 2.85);');
    expect(field.indexOf('#ao-bd-line", {')).toBeLessThan(field.indexOf('tl.set({}, {}, 9);'));
    expect(field).toContain('window.__timelines["ao-backdrop"] = tl;');
    expect(field).toContain('<script src="vendor/gsap.min.js"></script>');
  });

  it('keeps the classic film’s field and plate captions when no backdrop is given', () => {
    expect(captionCss('plate')).toContain('padding: var(--ao-caption-pad)');
    expect(captionCss('pill')).toContain('border-radius: 999px');
    const tokens = sceneTokens();
    const cue: CaptionCue = { start: 0, end: 1, text: 'Hi there.', lines: ['Hi there.'], emphasis: null };
    expect(captionsMarkup([cue], tokens.film, '16:9')).toContain('font-size:32px');
    expect(captionsMarkup([cue], tokens.film, '16:9', 'pill')).toContain('font-size:28px');
    // A plate cuts in and out, as the Remotion engine sets it; nothing to show is no composition at all.
    expect(captionsComposition([cue], tokens.film, '16:9', 'plate', 1)).not.toContain('fromTo');
    expect(captionsComposition([], tokens.film, '16:9', 'plate', 1)).toBeNull();
  });
});

describe('the scene author in the launch look', () => {
  const never: LlmProvider = new Proxy({} as LlmProvider, {
    get: () => {
      throw new Error('the launch look never asks a model');
    },
  });

  it('draws every scene itself, keeps nothing and asks no model, under a key of its own', async () => {
    const target = packet({ recipe: 'kinetic_headline', text: ['Forty unmatched rows.'] });
    const store = new MemorySceneStore();
    const plan = planLaunch([target]);
    const options: SceneAuthorOptions = {
      llm: never,
      call: { organizationId: 'org_test' },
      tier: 'deep',
      store,
      maxAttempts: 3,
      concurrency: 1,
      showPictures: false,
      constructions: 'engine',
      look: { name: 'launch', plan },
      log: () => undefined,
    };
    const tokens = sceneTokens();
    const drawn = await authorScene(target, tokens, '/nonexistent', options);
    expect(drawn.report.source).toBe('fallback');
    expect(drawn.report.costUsd).toBe(0);
    expect(drawn.report.fallbackReason).toMatch(/launch look/);
    expect(store.scenes.size).toBe(0);
    expect(drawn.key).not.toBe(sceneKey(target, tokens.film, 'deep'));
  });
});

/*
 * The scene's script run against a stand-in for the page, as the layers tests
 * run theirs: every tween that drives a plain object's `t` is seeked, and the
 * styles its update sets are read back.
 */
type Style = Record<string, string>;

function run(html: string): (seconds: number) => (id: string) => Style {
  const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(html)![1]!;
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!));
  const styles = new Map<string, Style>();
  const document = {
    getElementById: (id: string) => {
      if (!ids.has(id)) return null;
      if (!styles.has(id)) styles.set(id, {});
      return { style: styles.get(id)!, textContent: '' };
    },
  };
  type Vars = { duration: number; ease?: unknown; onUpdate?: () => void };
  const drivers: { state: { t: number }; vars: Vars; position: number }[] = [];
  const timeline = {
    fromTo(target: unknown, _from: unknown, vars: Vars, position: number) {
      if (target && typeof target === 'object' && 't' in target && vars.onUpdate) drivers.push({ state: target as { t: number }, vars, position });
      return timeline;
    },
    set: () => timeline,
  };
  const window: { ActOne?: unknown } = {};
  vm.runInNewContext(motionRuntimeSource(), { window });
  vm.runInNewContext(script, { gsap: { timeline: () => timeline }, document, window, ActOne: window.ActOne });
  return (seconds) => {
    // Seeked in order, as a render worker moves forward through its frames.
    for (const driver of [...drivers].sort((a, b) => a.position - b.position)) {
      if (seconds < driver.position) continue;
      const linear = Math.min(1, (seconds - driver.position) / driver.vars.duration);
      driver.state.t = typeof driver.vars.ease === 'function' ? (driver.vars.ease as (t: number) => number)(linear) : linear;
      driver.vars.onUpdate!();
    }
    return (id) => styles.get(id) ?? {};
  };
}

function expectTransform(style: Style, [x, y, s]: number[]): void {
  const match = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(style.transform ?? '');
  expect(match, style.transform).not.toBeNull();
  expect(Number(match![1])).toBeCloseTo(x!, 3);
  expect(Number(match![2])).toBeCloseTo(y!, 3);
  expect(Number(match![3])).toBeCloseTo(s!, 5);
}

describe('the launch look on a square and an upright frame', () => {
  const pxOf = (html: string, pattern: RegExp): number => Number(pattern.exec(html)?.[1] ?? Number.NaN);

  it('sets a list beside the card at a size that keeps every chip inside its column, short of the card', () => {
    const square = resolveTokens(brand, { aspect: '1:1', quality: 'hd', theme: 'dark' });
    const target = packet({ recipe: 'feature_stack', text: ['Launcher. Tasks. Tray. Files.'], assets: ['ast_img'] }, { staged: [image('ast_img')] });
    const html = launchScene(target, square, DAY);
    const id = target.frameId;
    const chipLeft = pxOf(html, new RegExp(`#${id}-chip1 \\{ left: ([\\d.]+)px`));
    const chipWidth = pxOf(html, new RegExp(`#${id}-chip1 \\{[^}]*width: ([\\d.]+)px`));
    const cardLeft = pxOf(html, new RegExp(`#${id}-space \\{ position: absolute; left: ([\\d.]+)px`));
    const fontSize = pxOf(html, new RegExp(`\\.${id}-chip \\{[^}]*font-size: ([\\d.]+)px`));
    expect(chipLeft + chipWidth).toBeLessThan(cardLeft);
    // Stepped down from 4% of the frame's height to fit the column, not clipped to it.
    expect(fontSize).toBeLessThan(1080 * 0.04);
    expect(fontSize).toBeGreaterThanOrEqual(1080 * 0.026);
  });

  it('keeps an upright frame’s card clear of the lowest quarter, where the captions are', () => {
    const upright = resolveTokens(brand, { aspect: '9:16', quality: 'hd', theme: 'dark' });
    const target = packet({ recipe: 'product_zoom', text: ['Plasma starts as a desktop.'], assets: ['ast_img'] }, { staged: [image('ast_img')] });
    const html = launchScene(target, upright, DAY);
    const id = target.frameId;
    const top = pxOf(html, new RegExp(`#${id}-space \\{[^}]*top: ([\\d.]+)px`));
    const height = pxOf(html, new RegExp(`#${id}-space \\{[^}]*height: ([\\d.]+)px`));
    expect(top + height).toBeLessThanOrEqual(1920 * 0.7);
  });

  it('sets a square film’s caption pill at the plate’s size: it is read on a phone', () => {
    const square = resolveTokens(brand, { aspect: '1:1', quality: 'hd', theme: 'dark' });
    const cue: CaptionCue = { start: 0, end: 1, text: 'Hi there.', lines: ['Hi there.'], emphasis: null };
    expect(captionsMarkup([cue], filmTokens(square), '1:1', 'pill')).toContain('font-size:32px');
  });
});

describe('an upright frame’s words', () => {
  const upright = resolveTokens(brand, { aspect: '9:16', quality: 'hd', theme: 'dark' });
  const H = 1920;
  const pxOf = (html: string, pattern: RegExp): number => Number(pattern.exec(html)?.[1] ?? Number.NaN);

  it('end above the captions on a chapter: two lines of the title, under its label, by 72% of the height', () => {
    const target = packet({ recipe: 'kinetic_headline', text: ['Powerful when needed.'] });
    const html = launchScene(target, upright, { act: 'day', opener: false, chapter: true, chapterIndex: 1 });
    const id = target.frameId;
    const top = pxOf(html, new RegExp(`#${id}-text \\{[^}]*top: ([\\d.]+)px`));
    const size = pxOf(html, new RegExp(`#${id}-title \\{[^}]*font-size: ([\\d.]+)px`));
    const lines = html.split('class="ao-l"').length - 1;
    expect(lines).toBeGreaterThanOrEqual(1);
    // The label above the title takes about 4% of the height; a display line about 1.1 of its size.
    expect(top + H * 0.04 + lines * size * 1.1).toBeLessThanOrEqual(H * 0.72);
  });

  it('put the mark high enough that its line starts in the upper half and a bit', () => {
    const target = packet({ recipe: 'cta_end_card', text: [] }, { logo: image('ast_logo') });
    const html = launchScene(target, upright, { act: 'brand', opener: false, chapter: false, chapterIndex: -1 });
    const top = pxOf(html, new RegExp(`#${target.frameId}-words \\{[^}]*top: ([\\d.]+)px`));
    expect(top).toBeLessThanOrEqual(H * 0.53);
  });
});

describe('a capture drawn back up in the launch look', () => {
  const drawing = UiDrawing.parse({
    background: '#ffffff',
    theme: 'light',
    nodes: [
      { id: 'win', parent: null, kind: 'window', rect: { x: 0, y: 0, w: 1, h: 1 }, fill: '#ffffff', radius: 'md', text: null, ink: null, strong: false },
      { id: 'side', parent: 'win', kind: 'sidebar', rect: { x: 0, y: 0, w: 0.2, h: 1 }, fill: '#f2f3f5', radius: 'none', text: null, ink: null, strong: false },
      { id: 'r1', parent: 'side', kind: 'row', rect: { x: 0.01, y: 0.1, w: 0.18, h: 0.05 }, fill: null, radius: 'sm', text: 'Inbox', ink: '#1b1f24', strong: true },
      { id: 'r2', parent: 'side', kind: 'row', rect: { x: 0.01, y: 0.16, w: 0.18, h: 0.05 }, fill: null, radius: 'sm', text: null, ink: null, strong: false },
      { id: 'search', parent: 'win', kind: 'input', rect: { x: 0.3, y: 0.02, w: 0.4, h: 0.06 }, fill: '#f6f7f9', radius: 'pill', text: null, ink: '#5c6473', strong: false },
    ],
    focus: { nodeId: 'search', action: 'type', typed: 'March' },
  });
  const drawn = (duration: number): ScenePacket => ({
    ...packet({ recipe: 'product_zoom', text: ['Matched as they land.'], assets: ['ast_img'], duration }, { staged: [image('ast_img')] }),
    drawing,
  });

  it('builds the parts, uses the control, and ends on the capture itself — passing the engine’s own checks', () => {
    const target = drawn(3);
    const html = launchScene(target, design(), DAY);
    expect(errorsOf(html, target)).toEqual([]);
    expect(html).toContain('<span class="scene-01-t">Inbox</span>');
    // The row the capture's words were not found in is a neutral line, not a word.
    expect(html).toContain('<div id="scene-01-n4" class="scene-01-n"><span class="scene-01-sk"></span></div>');
    expect(html).toContain('id="scene-01-cursor"');
    expect(html).toContain('id="scene-01-ty-g1" class="ao-g">M</span>');
    expect(html).toContain('<img id="scene-01-real" src="assets/ast_img.png" alt="">');
    const realAt = Number(/tl\.fromTo\("#scene-01-real", \{ opacity: 0 \}, \{ opacity: 1, duration: 0\.45, ease: "power2\.inOut" \}, ([\d.]+)\);/.exec(html)?.[1]);
    // The capture itself is fully up, and held, for at least 0.7 s before the beat starts to leave (0.36 s from its end).
    expect(realAt + 0.45).toBeLessThanOrEqual(target.timing.beatStart + 3 - 0.36 - 0.7 + 1e-6);
    expect(realAt).toBeGreaterThan(target.timing.beatStart + 1);
    // The click lands, and is seen to land, before the capture comes up.
    const clickAt = Number(/tl\.fromTo\("#scene-01-ripple", [^)]*\}, ([\d.]+)\);/.exec(html)?.[1]);
    expect(clickAt).toBeGreaterThan(target.timing.beatStart + 0.5);
    expect(clickAt + 0.3).toBeLessThanOrEqual(realAt + 1e-6);
  });

  it('shows a picture inside the interface as the capture’s own pixels of it', () => {
    const withPicture = { ...drawn(3), drawing: { ...drawing, nodes: [...drawing.nodes, { id: 'shot', parent: 'win', kind: 'image' as const, rect: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 }, fill: null, radius: 'md' as const, text: null, ink: null, strong: false }] } };
    const html = launchScene(withPicture, design(), DAY);
    expect(html).toMatch(/#scene-01-n6 \{[^}]*background: url\(assets\/ast_img\.png\) -[\d.]+px -[\d.]+px \/ [\d.]+px [\d.]+px no-repeat/);
    expect(errorsOf(html, withPicture)).toEqual([]);
  });

  it('is heard where the hand acts: one click on the click, keystrokes exactly while the field is typed into', () => {
    const target = drawn(3);
    const html = launchScene(target, design(), DAY);
    const filmStart = 10;
    const cues = launchSoundCues([target], planLaunch([target]), new Map([[target.frameId, filmStart]]));
    const toFilm = (composition: number) => Math.round((filmStart + composition - target.timing.beatStart) * 1000) / 1000;

    const clickAt = Number(/tl\.fromTo\("#scene-01-ripple", [^)]*\}, ([\d.]+)\);/.exec(html)?.[1]);
    const glyphAt = [...html.matchAll(/tl\.fromTo\("#scene-01-ty-g\d+", [^)]*\}, ([\d.]+)\);/g)].map((match) => Number(match[1]));
    expect(glyphAt).toHaveLength('March'.length);
    const clicks = cues.filter((cue) => cue.type === 'ui_click');
    const typing = cues.filter((cue) => cue.type === 'typing');
    expect(clicks.map((cue) => cue.time)).toEqual([toFilm(clickAt)]);
    expect(typing).toHaveLength(1);
    expect(typing[0]!.time).toBeCloseTo(toFilm(glyphAt[0]!), 3);
    // The keystrokes stop with the last glyph: one glyph's time after it lands.
    const perGlyph = glyphAt[1]! - glyphAt[0]!;
    expect(typing[0]!.time + typing[0]!.durationSeconds!).toBeCloseTo(toFilm(glyphAt.at(-1)!) + perGlyph, 3);
  });

  it('is never heard typing when the hand only clicks, or when the beat is too short to draw the interface', () => {
    const clicking = { ...drawn(3), drawing: { ...drawing, focus: { nodeId: 'search', action: 'click' as const, typed: null } } };
    const clickCues = launchSoundCues([clicking], planLaunch([clicking]), new Map([[clicking.frameId, 0]]));
    expect(clickCues.filter((cue) => cue.type === 'ui_click')).toHaveLength(1);
    expect(clickCues.some((cue) => cue.type === 'typing')).toBe(false);
    const short = drawn(2.4);
    const shortCues = launchSoundCues([short], planLaunch([short]), new Map([[short.frameId, 0]]));
    expect(shortCues.some((cue) => cue.type === 'typing' || cue.type === 'ui_click')).toBe(false);
  });

  it('is shown as captured when its beat is too short to draw it first', () => {
    const html = launchScene(drawn(2.4), design(), DAY);
    expect(html).not.toContain('scene-01-ui');
    expect(html).toContain('id="scene-01-media"');
  });
});
