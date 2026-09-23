import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { detectFontFormat, FontFileError, inspectFontFile, readBase128 } from '../fonts/font-file.ts';
import { normaliseRange, normaliseWeight, parseFontFaceRules, parseSrcDescriptor, sameFace } from '../fonts/font-face-css.ts';
import { classifyLicence } from '../fonts/licence.ts';
import { fvarTable, nameTable, os2Table, sfnt } from './fixtures/font-builder.ts';

const INTER = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../node_modules/@fontsource/inter/files/${file}`, import.meta.url)));

describe('inspectFontFile on real web fonts', () => {
  it.each([
    ['inter-latin-400-normal.woff2', 'woff2', 'Inter-Regular', 400],
    ['inter-latin-700-normal.woff2', 'woff2', 'Inter-Bold', 700],
    ['inter-latin-400-normal.woff', 'woff', 'Inter-Regular', 400],
  ] as const)('%s', (file, format, postScriptName, weight) => {
    const info = inspectFontFile(INTER(file));
    expect(info.format).toBe(format);
    expect(info.names.family).toBe('Inter');
    expect(info.names.postScriptName).toBe(postScriptName);
    expect(info.weightClass).toBe(weight);
    expect(info.fsType).toBe(0);
    expect(info.names.licenseUrl).toMatch(/openfontlicense\.org/);
  });
});

describe('inspectFontFile on built fonts', () => {
  const variable = sfnt({
    name: nameTable([
      { id: 1, value: 'Brand Grotesk' },
      { id: 6, value: 'BrandGrotesk-Variable' },
      { id: 13, value: 'This font software is licensed to Acme Inc. for web use only.' },
      { id: 14, value: 'https://foundry.example/eula' },
      { id: 0, value: '© 2024 Foundry', platform: 1 },
    ]),
    'OS/2': os2Table({ weight: 400, fsType: 0x0002, vendor: 'FNDR' }),
    fvar: fvarTable([
      { tag: 'wght', min: 100, def: 400, max: 900 },
      { tag: 'opsz', min: 14, def: 14, max: 32.5 },
    ]),
  });

  it('reads names from both platforms, the embedding bits and the axes', () => {
    const info = inspectFontFile(variable);
    expect(info.format).toBe('truetype');
    expect(info.names.family).toBe('Brand Grotesk');
    expect(info.names.postScriptName).toBe('BrandGrotesk-Variable');
    expect(info.names.copyright).toBe('© 2024 Foundry');
    expect(info.fsType).toBe(2);
    expect(info.vendorId).toBe('FNDR');
    expect(info.axes).toEqual([
      { tag: 'wght', min: 100, default: 400, max: 900 },
      { tag: 'opsz', min: 14, default: 14, max: 32.5 },
    ]);
  });

  it('reads the same tables through the WOFF container, compressed or not', () => {
    const tables = { name: nameTable([{ id: 1, value: 'Brand Grotesk' }]), 'OS/2': os2Table({ weight: 600, fsType: 8 }) };
    const tags = Object.keys(tables).sort() as (keyof typeof tables)[];
    const header = Buffer.alloc(44 + tags.length * 20);
    header.write('wOFF', 0, 'latin1');
    header.writeUInt32BE(0x00010000, 4);
    header.writeUInt16BE(tags.length, 12);
    let offset = header.length;
    const bodies: Buffer[] = [];
    tags.forEach((tag, index) => {
      const original = tables[tag];
      const compressed = index === 0 ? deflateSync(original) : original;
      const stored = compressed.length < original.length ? compressed : original;
      const at = 44 + index * 20;
      header.write(tag, at, 'latin1');
      header.writeUInt32BE(offset, at + 4);
      header.writeUInt32BE(stored.length, at + 8);
      header.writeUInt32BE(original.length, at + 12);
      offset += stored.length;
      bodies.push(stored);
    });
    const info = inspectFontFile(Buffer.concat([header, ...bodies]));
    expect(info.format).toBe('woff');
    expect(info.names.family).toBe('Brand Grotesk');
    expect(info.weightClass).toBe(600);
    expect(info.fsType).toBe(8);
  });

  it('refuses files that lie about their own layout', () => {
    const lying = Buffer.from(variable);
    lying.writeUInt32BE(0x7fffffff, 12 + 8); // the first table's offset, far past the end
    expect(() => inspectFontFile(lying)).toThrow(FontFileError);
    expect(() => inspectFontFile(Buffer.from('not a font at all'))).toThrow(FontFileError);
    expect(() => inspectFontFile(INTER('inter-latin-400-normal.woff2').subarray(0, 60))).toThrow();
  });

  it('refuses a WOFF2 that declares more data than any font should decompress to', () => {
    const bomb = Buffer.alloc(64);
    bomb.write('wOF2', 0, 'latin1');
    bomb.writeUInt32BE(0x00010000, 4);
    bomb.writeUInt16BE(1, 12);
    bomb.writeUInt32BE(0xffffffff, 16);
    bomb.writeUInt32BE(4, 20);
    bomb[48] = 5; // the `name` table, null transform
    // UIntBase128 for 2^31: far over the ceiling.
    Buffer.from([0x88, 0x80, 0x80, 0x80, 0x00]).copy(bomb, 49);
    expect(() => inspectFontFile(bomb)).toThrow(/implausibly large/);
  });

  it('knows each container by its signature', () => {
    expect(detectFontFormat(INTER('inter-latin-400-normal.woff2'))).toBe('woff2');
    expect(detectFontFormat(variable)).toBe('truetype');
    expect(detectFontFormat(sfnt({ name: nameTable([]) }, 'opentype'))).toBe('opentype');
    expect(detectFontFormat(Buffer.from('ttcf00000000'))).toBe('collection');
    expect(detectFontFormat(Buffer.from('<html>'))).toBeNull();
  });
});

describe('readBase128', () => {
  it('reads one to five bytes and refuses the malformed', () => {
    expect(readBase128(Buffer.from([0x3f]), 0)).toEqual([63, 1]);
    expect(readBase128(Buffer.from([0x81, 0x00]), 0)).toEqual([128, 2]);
    expect(readBase128(Buffer.from([0x8f, 0xff, 0xff, 0xff, 0x7f]), 0)).toEqual([0xffffffff, 5]);
    expect(() => readBase128(Buffer.from([0x80, 0x01]), 0)).toThrow(/leading zero/);
    expect(() => readBase128(Buffer.from([0x90, 0x80, 0x80, 0x80, 0x00]), 0)).toThrow(/overflows/);
    expect(() => readBase128(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]), 0)).toThrow();
    expect(() => readBase128(Buffer.from([0x81]), 0)).toThrow(/Truncated/);
  });
});

describe('classifyLicence', () => {
  const inter = inspectFontFile(INTER('inter-latin-400-normal.woff2'));
  const built = (fsType: number, description: string | null) =>
    inspectFontFile(
      sfnt({
        name: nameTable(description ? [{ id: 13, value: description }] : []),
        'OS/2': os2Table({ weight: 400, fsType }),
      }),
    );

  it('an open licence declared in the file needs no attestation', () => {
    expect(classifyLicence(inter, 'https://brand.example/fonts/inter.woff2')).toMatchObject({
      kind: 'open',
      requiresAttestation: false,
      embedding: 'installable',
    });
  });

  it('a host that only serves open fonts is evidence on its own', () => {
    const silent = built(0, null);
    expect(classifyLicence(silent, 'https://fonts.gstatic.com/s/x/v1/a.woff2').kind).toBe('open');
    expect(classifyLicence(silent, 'https://cdn.jsdelivr.net/npm/@fontsource/inter/files/a.woff2').kind).toBe('open');
    // jsDelivr serves anything published to npm; an arbitrary package is not evidence.
    expect(classifyLicence(silent, 'https://cdn.jsdelivr.net/npm/some-brand-kit/font.woff2').kind).toBe('unknown');
    expect(classifyLicence(silent, 'https://cdn.jsdelivr.net/npm/some-brand-kit/inter/font.woff2').kind).toBe('unknown');
  });

  it('a restricted file, proprietary terms and silence all need the customer to attest', () => {
    expect(classifyLicence(built(2, null), 'https://brand.example/a.woff2')).toMatchObject({
      kind: 'restricted',
      requiresAttestation: true,
      embedding: 'restricted',
    });
    expect(classifyLicence(built(8, 'Licensed to Acme for web use only.'), 'https://brand.example/a.woff2')).toMatchObject({
      kind: 'proprietary',
      requiresAttestation: true,
      embedding: 'editable',
    });
    expect(classifyLicence(built(0, null), 'https://brand.example/a.woff2')).toMatchObject({
      kind: 'unknown',
      requiresAttestation: true,
    });
    expect(classifyLicence(null, 'https://brand.example/a.woff2').reason).toMatch(/could not be read/);
  });

  it('an open licence wins over a restrictive fsType, which open fonts sometimes carry by mistake', () => {
    expect(classifyLicence(built(2, 'SIL Open Font License, Version 1.1'), 'https://brand.example/a.woff2').kind).toBe('open');
  });
});

describe('@font-face rules from stylesheet text', () => {
  const css = `
    /* a comment with @font-face { src: url(ignored.woff2) } inside */
    @font-face{font-family:"Brand Sans";src:url(../fonts/brand.woff2)format("woff2"),url('/fonts/brand.woff') format('woff');font-weight:100 900;font-display:swap}
    @media (min-width: 1px) {
      @font-face {
        font-family: 'Brand Serif';
        src: local("Brand Serif"), url("data:font/woff2;base64,d09GMg==") format("woff2");
        font-style: italic;
        unicode-range: U+0000-00FF, U+0131;
      }
    }
    @font-face { font-family: Brand\\ Mono; src: url(https://cdn.brand.example/mono.ttf); }
    @font-face { font-family: "No Source"; }
  `;
  const rules = parseFontFaceRules(css, 'https://cdn.brand.example/css/site.css');

  it('reads every rule, including those nested in at-rules, and skips the incomplete', () => {
    expect(rules.map((rule) => rule.family)).toEqual(['Brand Sans', 'Brand Serif', 'Brand Mono']);
  });

  it('resolves sources against the stylesheet, in order, and keeps data URLs whole', () => {
    expect(rules[0]!.sources).toEqual([
      { url: 'https://cdn.brand.example/fonts/brand.woff2', format: 'woff2' },
      { url: 'https://cdn.brand.example/fonts/brand.woff', format: 'woff' },
    ]);
    expect(rules[1]!.sources).toEqual([{ url: 'data:font/woff2;base64,d09GMg==', format: 'woff2' }]);
    expect(rules[0]!.weight).toBe('100 900');
    expect(rules[1]!.style).toBe('italic');
    expect(rules[1]!.unicodeRange).toBe('U+0000-00FF, U+0131');
  });

  it('matches a face the way the browser reports it', () => {
    expect(sameFace(rules[0]!, { family: 'brand sans', weight: '100 900', style: 'normal', unicodeRange: 'U+0-10FFFF' })).toBe(true);
    expect(sameFace(rules[1]!, { family: 'Brand Serif', weight: '400', style: 'italic', unicodeRange: 'U+0-FF, U+131' })).toBe(true);
    expect(sameFace(rules[1]!, { family: 'Brand Serif', weight: '700', style: 'italic', unicodeRange: 'U+0-FF, U+131' })).toBe(false);
    expect(normaliseRange('U+0000-00FF, U+0131, U+4??')).toBe('u+0-ff,u+131,u+400-4ff');
    expect(normaliseRange(null)).toBe(normaliseRange('U+0-10FFFF'));
    expect(normaliseWeight('bold')).toBe('700');
    expect(normaliseWeight('normal')).toBe('400');
    expect(normaliseWeight('300 300')).toBe('300');
  });

  it('parses a src descriptor on its own, refusing what is not a URL', () => {
    expect(parseSrcDescriptor('local(Arial), url(x.woff2) format("woff2")', 'https://a.example/b/c.css')).toEqual([
      { url: 'https://a.example/b/x.woff2', format: 'woff2' },
    ]);
    expect(parseSrcDescriptor('url()', 'https://a.example/')).toEqual([]);
  });
});
