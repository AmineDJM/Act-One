import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { EasingName } from '@act-one/core';
import { applyCase, fitTextToBox, fitToLines } from '@act-one/design';
import { EASINGS } from '@act-one/motion';
import { BUNDLED_FONTS, parseFontFaces } from '../fonts.ts';
import { EASING_CURVES, motionRuntimeSource } from '../motion-runtime.ts';
import { typesetScene, type TypesetInput } from '../typeset.ts';
import { design } from './helpers.ts';

/**
 * The parts of this engine that are copies of the Remotion engine's, held to
 * it by test rather than by hope: the curves every scene moves on, the faces
 * every line is set in, and the lines themselves.
 */
describe('the easing curves in the browser', () => {
  const window: { ActOne?: { ease: (name: string) => (t: number) => number; names: string[] } } = {};
  vm.runInNewContext(motionRuntimeSource(), { window });
  const runtime = window.ActOne!;

  it('are the Remotion engine’s, at every point', () => {
    for (const name of Object.keys(EASINGS) as EasingName[]) {
      const reference = EASINGS[name];
      const browser = runtime.ease(name);
      for (let step = 0; step <= 200; step += 1) {
        const t = step / 200;
        expect(browser(t), `${name} at ${t}`).toBeCloseTo(reference(t), 9);
      }
    }
  });

  it('name every curve the storyboard can name, and nothing else', () => {
    expect([...runtime.names].sort()).toEqual(Object.keys(EASINGS).sort());
    expect(Object.keys(EASING_CURVES).sort()).toEqual(Object.keys(EASINGS).sort());
  });

  it('fall back to the workhorse for a name they do not know', () => {
    expect(runtime.ease('bounce')(0.3)).toBe(EASINGS.out_quint(0.3));
  });

  it('are frozen, so a scene cannot replace a curve for the scenes after it', () => {
    expect(Object.isFrozen(runtime)).toBe(true);
  });
});

describe('the faces', () => {
  it('are exactly the ones the Remotion engine bundles', async () => {
    const source = await readFile(fileURLToPath(new URL('../../../motion/src/fonts.ts', import.meta.url)), 'utf8');
    const remotion = [...source.matchAll(/import '(@fontsource\/[a-z0-9-]+)\/(\d+)\.css';/g)].map((match) => `${match[1]}/${match[2]}`).sort();
    const here = BUNDLED_FONTS.flatMap((font) => font.weights.map((weight) => `${font.packageName}/${weight}`)).sort();
    expect(here).toEqual(remotion);
  });

  it('are read from @fontsource stylesheets, woff2 only, plain file names only', () => {
    const css = `
@font-face { font-family: 'Inter'; font-style: normal; font-display: swap; font-weight: 400; src: url(./files/inter-latin-400-normal.woff2) format('woff2'), url(./files/inter-latin-400-normal.woff) format('woff'); unicode-range: U+0000-00FF; }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url(./files/../../etc/passwd.woff2) format('woff2'); }`;
    expect(parseFontFaces(css)).toEqual([
      { family: 'Inter', style: 'normal', weight: '400', file: 'inter-latin-400-normal.woff2', unicodeRange: 'U+0000-00FF' },
    ]);
  });
});

describe('the lines', () => {
  const tokens = design();
  const base: TypesetInput = {
    recipe: 'word_reveal', index: 1, onScreenText: ['We have not been paged in eleven months.'],
    hasClip: false, hasImage: false, hasLogo: false, brandName: 'Northwind', cta: 'northwind.example', tagline: 'Close the books while you sleep.',
  };

  it('break as the Remotion WordReveal breaks them', () => {
    const token = tokens.type.statement;
    const expected = fitToLines(applyCase(base.onScreenText.join(' '), token), {
      family: token.family, fontSizePx: token.sizePx, tracking: token.tracking, weight: token.weight,
      maxWidthPx: tokens.grid.safe.width * 0.82, maxLines: 3,
    });
    const block = typesetScene(base, tokens)!.blocks[0]!;
    expect(block.lines).toEqual(expected.lines);
    expect(block.fontSizePx).toBeCloseTo(expected.fontSizePx, 1);
    expect(block.role).toBe('statement');
  });

  it('use the display role on the film’s first beat', () => {
    expect(typesetScene({ ...base, index: 0 }, tokens)!.blocks[0]!.role).toBe('display');
  });

  it('fit the end card the way the Remotion CtaEndCard fits it', () => {
    const statement = tokens.type.statement;
    const typeset = typesetScene({ ...base, recipe: 'cta_end_card', onScreenText: [] }, tokens)!;
    const expected = fitTextToBox(
      base.tagline,
      { widthPx: tokens.grid.safe.width * 0.8, heightPx: statement.sizePx * 2.6 },
      { family: statement.family, tracking: statement.tracking, weight: statement.weight, lineHeight: statement.lineHeight, maxLines: 2, maxFontSizePx: statement.sizePx, minFontSizePx: statement.sizePx * 0.62 },
    );
    expect(typeset.placement).toBe('end_card');
    expect(typeset.blocks.map((block) => block.part)).toEqual(['headline', 'address', 'wordmark']);
    expect(typeset.blocks[0]!.lines).toEqual(expected.lines);
    expect(typeset.blocks[1]!.lines).toEqual([applyCase('northwind.example', tokens.type.caption)]);
    expect(typeset.blocks[1]!.colour).toBe('accent');
  });

  it('give the logo its place on an end card that has one, and drop the wordmark', () => {
    const typeset = typesetScene({ ...base, recipe: 'cta_end_card', hasLogo: true }, tokens)!;
    expect(typeset.blocks.map((block) => block.part)).toEqual(['headline', 'address']);
    expect(typeset.logo).toEqual({ heightPx: Math.round(tokens.type.statement.sizePx * 0.62 * 10) / 10, marginTopPx: Math.round(tokens.space(4) * 10) / 10 });
  });

  it('keep a quote as written and case only its attribution', () => {
    const typeset = typesetScene({ ...base, recipe: 'quote_hold', onScreenText: ['We have not been paged.', 'Infrastructure lead'] }, tokens)!;
    expect(typeset.blocks[0]!.lines.join(' ')).toBe('We have not been paged.');
    expect(typeset.blocks[1]!.lines).toEqual([applyCase('Infrastructure lead', tokens.type.caption)]);
  });

  it('set no type where the Remotion engine sets none', () => {
    expect(typesetScene({ ...base, recipe: 'product_window', hasImage: true }, tokens)).toBeNull();
    expect(typesetScene({ ...base, recipe: 'footage', hasImage: true }, tokens)).toBeNull();
    expect(typesetScene({ ...base, recipe: 'logo_reveal', hasLogo: true }, tokens)!.blocks).toEqual([]);
  });

  it('fall back to type on the canvas when the picture did not arrive', () => {
    const typeset = typesetScene({ ...base, recipe: 'product_window' }, tokens)!;
    expect(typeset.placement).toBe('center_left');
    expect(typeset.blocks[0]!.role).toBe('statement');
    expect(typeset.blocks[0]!.maxWidthPx).toBeCloseTo(tokens.grid.safe.width * 0.8, 0);
  });

  it('put a clip’s words in the lower third, in white', () => {
    const typeset = typesetScene({ ...base, recipe: 'footage', hasClip: true }, tokens)!;
    expect(typeset.placement).toBe('lower_third');
    expect(typeset.blocks[0]!.colour).toBe('white');
  });
});
