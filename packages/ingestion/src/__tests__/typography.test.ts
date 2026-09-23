import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AssetCollector } from '../assets.ts';
import type { RecordedResponse } from '../browser/network-recorder.ts';
import { buildTypography, parseFamilyStack, type PlatformFont } from '../fonts/build-typography.ts';
import type { RawTypeRole, RawTypography } from '../probes/typography-probe.ts';
import { Typography } from '../schema.ts';

const INTER_400 = readFileSync(
  fileURLToPath(new URL('../../../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2', import.meta.url)),
);
const INTER_700 = readFileSync(
  fileURLToPath(new URL('../../../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2', import.meta.url)),
);

function sample(role: RawTypeRole, fontFamily: string, extra: Partial<RawTypography['samples'][number]> = {}) {
  return {
    role,
    fontFamily,
    fontWeight: '400',
    fontStyle: 'normal',
    fontSize: '16px',
    lineHeight: '24px',
    letterSpacing: 'normal',
    textTransform: 'none',
    color: 'rgb(17, 17, 19)',
    text: 'Close the books while you sleep.',
    ...extra,
  };
}

function raw(overrides: Partial<RawTypography> = {}): RawTypography {
  return {
    samples: [
      sample('display', '"Brand Sans", system-ui, sans-serif', {
        fontWeight: '700',
        fontSize: '72px',
        lineHeight: '72px',
        letterSpacing: '-2.16px',
      }),
      sample('body', '"Brand Sans", system-ui, sans-serif'),
      sample('ui', '"Brand Sans", sans-serif', { fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.7px', fontSize: '14px' }),
      sample('mono', 'Menlo, "SF Mono", monospace', { fontSize: '13px', lineHeight: 'normal' }),
    ],
    loadedFaces: [
      { family: 'Brand Sans', weight: '400', style: 'normal', stretch: 'normal', unicodeRange: 'U+0-10FFFF', status: 'loaded' },
      { family: 'Brand Sans', weight: '700', style: 'normal', stretch: 'normal', unicodeRange: 'U+0-10FFFF', status: 'loaded' },
      { family: 'Scripted Face', weight: '400', style: 'normal', stretch: 'normal', unicodeRange: 'U+0-10FFFF', status: 'loaded' },
      { family: 'Icon Font', weight: '400', style: 'normal', stretch: 'normal', unicodeRange: 'U+0-10FFFF', status: 'loaded' },
    ],
    rules: [
      {
        family: 'Brand Sans',
        src: 'url("/fonts/brand-400.woff2") format("woff2")',
        weight: '400',
        style: 'normal',
        stretch: 'normal',
        unicodeRange: '',
        baseUrl: 'https://brand.example/',
      },
    ],
    unreadableSheets: ['https://cdn.brand.example/fonts.css'],
    lang: 'en',
    ...overrides,
  };
}

const PLATFORM = new Map<RawTypeRole, PlatformFont[]>([
  ['display', [{ familyName: 'Inter', postScriptName: 'Inter-Bold', isCustomFont: true, glyphCount: 30 }]],
  ['body', [{ familyName: 'Inter', postScriptName: 'Inter-Regular', isCustomFont: true, glyphCount: 32 }]],
  ['mono', [{ familyName: 'DejaVu Sans Mono', postScriptName: 'DejaVuSansMono', isCustomFont: false, glyphCount: 20 }]],
]);

const recorded = (url: string, body: Buffer, kind: RecordedResponse['kind']): RecordedResponse => ({
  url,
  kind,
  contentType: kind === 'font' ? 'font/woff2' : 'text/css',
  body,
});

function build(overrides: Partial<RawTypography> = {}, budget = 64 * 1024 * 1024) {
  const assets = new AssetCollector(budget);
  const result = buildTypography({
    raw: raw(overrides),
    platformFonts: PLATFORM,
    stylesheets: [
      recorded(
        'https://cdn.brand.example/fonts.css',
        Buffer.from('@font-face{font-family:"Brand Sans";src:url(bold.woff2) format("woff2");font-weight:700}'),
        'stylesheet',
      ),
    ],
    fonts: [
      recorded('https://brand.example/fonts/brand-400.woff2', INTER_400, 'font'),
      recorded('https://cdn.brand.example/bold.woff2', INTER_700, 'font'),
    ],
    documentUrl: 'https://brand.example/',
    assets,
  });
  return { result: result!, assets };
}

describe('buildTypography', () => {
  const { result, assets } = build();
  const { typography } = result;

  it('produces what the schema accepts', () => {
    expect(() => Typography.parse(typography)).not.toThrow();
  });

  it('describes each role in the units a motion system uses', () => {
    const display = typography.roles.find((role) => role.role === 'display')!;
    expect(display.stack).toEqual(['Brand Sans', 'system-ui', 'sans-serif']);
    expect(display.weight).toBe(700);
    expect(display.sizePx).toBe(72);
    expect(display.lineHeight).toBe(1);
    expect(display.letterSpacingEm).toBe(-0.03);
    expect(display.rendered).toEqual({ family: 'Inter', postScriptName: 'Inter-Bold', isWebFont: true });
    const ui = typography.roles.find((role) => role.role === 'ui')!;
    expect(ui.textTransform).toBe('uppercase');
    expect(ui.letterSpacingEm).toBe(0.05);
    expect(typography.roles.find((role) => role.role === 'mono')!.lineHeight).toBeNull();
  });

  it('keeps the exact files the page drew with, from the CSSOM and from cross-origin stylesheets', () => {
    expect(typography.faces.map((face) => [face.family, face.weight, face.postScriptName])).toEqual([
      ['Brand Sans', '400', 'Inter-Regular'],
      ['Brand Sans', '700', 'Inter-Bold'],
    ]);
    const bold = typography.faces[1]!;
    expect(bold.sourceUrl).toBe('https://cdn.brand.example/bold.woff2');
    expect(bold.format).toBe('woff2');
    expect(bold.licence.kind).toBe('open');
    expect(bold.usedBy).toEqual(expect.arrayContaining(['display', 'body', 'ui']));
    expect(assets.files().filter((file) => file.kind === 'font')).toHaveLength(2);
  });

  it('never loses a face silently: each one it could not keep is named with the reason', () => {
    expect(typography.missing).toEqual(
      expect.arrayContaining([expect.objectContaining({ family: 'Menlo', reason: expect.stringMatching(/system font/) })]),
    );
    // Loaded from script and unrelated to any role: not the brand's type, not reported.
    expect(typography.faces.some((face) => face.family === 'Icon Font')).toBe(false);
  });

  it('reports a face used by a role that arrived from a script', () => {
    const scripted = build({
      samples: [sample('display', '"Scripted Face", sans-serif')],
    }).result.typography;
    expect(scripted.missing[0]).toMatchObject({ family: 'Scripted Face', reason: expect.stringMatching(/script/) });
  });

  it('reads a font inlined as a data URL', () => {
    const inline = build({
      rules: [
        {
          family: 'Brand Sans',
          src: `url("data:font/woff2;base64,${INTER_400.toString('base64')}") format("woff2")`,
          weight: '400',
          style: 'normal',
          stretch: 'normal',
          unicodeRange: '',
          baseUrl: 'https://brand.example/',
        },
      ],
    }).result.typography;
    expect(inline.faces[0]).toMatchObject({ family: 'Brand Sans', sourceUrl: 'data:', postScriptName: 'Inter-Regular' });
  });

  it('respects the byte budget and says what it left out', () => {
    const tight = build({}, INTER_400.byteLength + 10).result.typography;
    expect(tight.faces).toHaveLength(1);
    expect(tight.missing.some((entry) => /budget/.test(entry.reason))).toBe(true);
  });

  it('returns nothing for a page with no text to measure', () => {
    expect(buildTypography({ raw: raw({ samples: [] }), platformFonts: new Map(), stylesheets: [], fonts: [], documentUrl: 'https://a.example/', assets: new AssetCollector(1) })).toBeNull();
  });
});

describe('parseFamilyStack', () => {
  it('splits on commas outside quotes and unquotes', () => {
    expect(parseFamilyStack('"Brand, Sans", \'Other\', -apple-system,BlinkMacSystemFont , sans-serif')).toEqual([
      'Brand, Sans',
      'Other',
      '-apple-system',
      'BlinkMacSystemFont',
      'sans-serif',
    ]);
  });
});
