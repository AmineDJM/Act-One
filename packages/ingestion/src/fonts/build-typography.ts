import { parseCssColor } from '@act-one/design';
import type { AssetCollector } from '../assets.ts';
import type { RecordedResponse } from '../browser/network-recorder.ts';
import type { RawTypeRole, RawTypography } from '../probes/typography-probe.ts';
import type { AssetRef, FontFaceAsset, TypeRole, TypeSpec, Typography } from '../schema.ts';
import { parseFontFaceRules, parseSrcDescriptor, sameFace, splitTopLevel, type FontFaceDeclaration } from './font-face-css.ts';
import { detectFontFormat, FontFileError, inspectFontFile, type FontFileInfo } from './font-file.ts';
import { classifyLicence } from './licence.ts';

export type PlatformFont = { familyName: string; postScriptName?: string; isCustomFont: boolean; glyphCount: number };

export type TypographyInputs = {
  raw: RawTypography;
  /** Per role, what the renderer reported drawing the sample with. */
  platformFonts: Map<RawTypeRole, PlatformFont[]>;
  stylesheets: RecordedResponse[];
  fonts: RecordedResponse[];
  documentUrl: string;
  assets: AssetCollector;
};

export type BuiltTypography = { typography: Typography; warnings: string[] };

/** Family names that name no file: the renderer resolves them to whatever the machine has. */
const GENERIC = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif',
  'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'blinkmacsystemfont',
  'apple color emoji', 'segoe ui emoji', 'segoe ui symbol', 'noto color emoji', 'inherit', 'initial', 'unset',
]);

const MAX_FACES = 48;
const MAX_DATA_URL_BYTES = 6 * 1024 * 1024;

const FORMAT_MIME: Record<FontFaceAsset['format'], AssetRef['mime']> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  truetype: 'font/ttf',
  opentype: 'font/otf',
};

export function parseFamilyStack(fontFamily: string): string[] {
  return splitTopLevel(fontFamily, ',')
    .map((family) => family.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim())
    .filter((family) => family.length > 0 && family.length <= 160)
    .slice(0, 16);
}

export function buildTypography(inputs: TypographyInputs): BuiltTypography | null {
  const { raw } = inputs;
  const warnings: string[] = [];
  if (raw.samples.length === 0) return null;

  const roles: TypeSpec[] = raw.samples.map((sample) => toSpec(sample, inputs.platformFonts.get(sample.role) ?? []));
  const familyRoles = new Map<string, Set<TypeRole>>();
  for (const spec of roles) {
    for (const family of spec.stack) {
      const key = family.toLowerCase();
      if (GENERIC.has(key)) continue;
      familyRoles.set(key, (familyRoles.get(key) ?? new Set()).add(spec.role));
    }
  }

  // Every @font-face the page declared: readable sheets through the CSSOM,
  // cross-origin ones from the text the recorder kept.
  const declarations: FontFaceDeclaration[] = [];
  for (const rule of raw.rules) {
    const sources = parseSrcDescriptor(rule.src, rule.baseUrl || inputs.documentUrl);
    if (!rule.family || sources.length === 0) continue;
    declarations.push({
      family: rule.family,
      sources,
      weight: rule.weight,
      style: rule.style,
      stretch: rule.stretch || null,
      unicodeRange: rule.unicodeRange || null,
      origin: rule.baseUrl,
    });
  }
  for (const sheet of inputs.stylesheets) {
    declarations.push(...parseFontFaceRules(sheet.body.toString('utf8'), sheet.url));
  }

  const recordedFonts = new Map(inputs.fonts.map((font) => [font.url, font] as const));
  const faces: FontFaceAsset[] = [];
  const missing: Typography['missing'] = [];
  const keptHashes = new Set<string>();
  const inspected = new Map<string, FontFileInfo | null>();

  const relevantLoaded = raw.loadedFaces.filter(
    (face) => face.status === 'loaded' && familyRoles.has(face.family.toLowerCase()),
  );

  for (const loaded of relevantLoaded) {
    if (faces.length >= MAX_FACES) {
      warnings.push(`More than ${MAX_FACES} faces are in use; the rest were not kept.`);
      break;
    }
    const face = { family: loaded.family, weight: loaded.weight, style: loaded.style, unicodeRange: loaded.unicodeRange };
    const declaration = declarations.find((candidate) => sameFace(candidate, face));
    if (!declaration) {
      missing.push({ family: loaded.family, reason: 'Loaded by the page from a script, not from a stylesheet we could read.' });
      continue;
    }

    let file: { url: string; bytes: Buffer } | null = null;
    for (const source of declaration.sources) {
      if (source.url.startsWith('data:')) {
        const decoded = decodeDataUrl(source.url);
        if (decoded) {
          file = { url: 'data:', bytes: decoded };
          break;
        }
        continue;
      }
      const recorded = recordedFonts.get(source.url);
      if (recorded) {
        file = { url: source.url, bytes: recorded.body };
        break;
      }
    }
    if (!file) {
      missing.push({ family: loaded.family, reason: 'Loaded by the page, but its file did not come through the browser for us to keep.' });
      continue;
    }

    const format = detectFontFormat(file.bytes);
    if (!format || format === 'collection') {
      missing.push({ family: loaded.family, reason: format === 'collection' ? 'A font collection, which a page cannot name one face of.' : 'Not a font file we can read.' });
      continue;
    }
    const cacheKey = `${file.bytes.byteLength}:${file.url}`;
    let info = inspected.get(cacheKey);
    if (info === undefined) {
      try {
        info = inspectFontFile(file.bytes);
      } catch (error) {
        info = null;
        warnings.push(`${loaded.family}: ${error instanceof FontFileError ? error.message : 'unreadable font file'}`);
      }
      inspected.set(cacheKey, info);
    }

    const asset = inputs.assets.add('font', FORMAT_MIME[format], file.bytes);
    if (!asset) {
      missing.push({ family: loaded.family, reason: 'Over the size budget for one brand.' });
      continue;
    }
    if (keptHashes.has(asset.sha256)) {
      const existing = faces.find((kept) => kept.sha256 === asset.sha256);
      if (existing) existing.usedBy = [...new Set([...existing.usedBy, ...(familyRoles.get(loaded.family.toLowerCase()) ?? [])])];
      continue;
    }
    keptHashes.add(asset.sha256);

    faces.push({
      assetId: asset.id,
      family: declaration.family.slice(0, 160),
      weight: declaration.weight.slice(0, 40),
      style: declaration.style.slice(0, 40),
      stretch: declaration.stretch?.slice(0, 40) ?? null,
      unicodeRange: declaration.unicodeRange?.slice(0, 8000) ?? null,
      format,
      sourceUrl: file.url.slice(0, 2048),
      postScriptName: info?.names.postScriptName?.slice(0, 160) ?? null,
      fullName: info?.names.fullName?.slice(0, 300) ?? null,
      version: info?.names.version?.slice(0, 200) ?? null,
      axes: (info?.axes ?? []).filter((axis) => axis.tag.length > 0).slice(0, 16),
      bytes: asset.bytes,
      sha256: asset.sha256,
      licence: classifyLicence(info, file.url),
      usedBy: [...(familyRoles.get(loaded.family.toLowerCase()) ?? [])],
    });
  }

  // A family a role asks for first that never loaded is a font we cannot
  // have: a system face, or a web font that failed. Named, not dropped.
  for (const spec of roles) {
    const first = spec.stack.find((family) => !GENERIC.has(family.toLowerCase()));
    if (!first) continue;
    const loaded = relevantLoaded.some((face) => face.family.toLowerCase() === first.toLowerCase());
    if (loaded || missing.some((entry) => entry.family.toLowerCase() === first.toLowerCase())) continue;
    const declared = declarations.some((declaration) => declaration.family.toLowerCase() === first.toLowerCase());
    missing.push({
      family: first,
      reason: declared
        ? 'Declared by the site but never loaded by the browser.'
        : 'A system font on the visitor’s machine, not served by the site.',
    });
  }

  return {
    typography: { roles, faces, missing: missing.slice(0, 64) },
    warnings,
  };
}

function toSpec(sample: RawTypography['samples'][number], platform: PlatformFont[]): TypeSpec {
  const size = Math.max(0.1, Number.parseFloat(sample.fontSize) || 16);
  const lineHeightPx = Number.parseFloat(sample.lineHeight);
  const letterSpacingPx = Number.parseFloat(sample.letterSpacing);
  const drawn = [...platform].sort((a, b) => b.glyphCount - a.glyphCount)[0];
  const stack = parseFamilyStack(sample.fontFamily);
  const transform = sample.textTransform as TypeSpec['textTransform'];
  return {
    role: sample.role,
    stack: stack.length > 0 ? stack : ['sans-serif'],
    rendered: drawn
      ? {
          family: drawn.familyName.slice(0, 160) || 'unknown',
          postScriptName: drawn.postScriptName?.slice(0, 160) || null,
          isWebFont: drawn.isCustomFont,
        }
      : null,
    weight: Math.min(1000, Math.max(1, Math.round(Number.parseFloat(sample.fontWeight) || 400))),
    style: /^italic/i.test(sample.fontStyle) ? 'italic' : /^oblique/i.test(sample.fontStyle) ? 'oblique' : 'normal',
    sizePx: Math.round(size * 100) / 100,
    lineHeight: Number.isFinite(lineHeightPx) ? Math.round((lineHeightPx / size) * 1000) / 1000 : null,
    letterSpacingEm: Number.isFinite(letterSpacingPx)
      ? Math.max(-1, Math.min(2, Math.round((letterSpacingPx / size) * 10000) / 10000))
      : 0,
    textTransform: ['none', 'uppercase', 'lowercase', 'capitalize'].includes(transform) ? transform : 'none',
    color: parseCssColor(sample.color)?.hex8 ?? null,
    sample: sample.text.slice(0, 160),
  };
}

function decodeDataUrl(url: string): Buffer | null {
  const match = /^data:[^,;]*(;[^,]*)?,(.*)$/s.exec(url);
  if (!match) return null;
  const base64 = /;base64/i.test(match[1] ?? '');
  const payload = match[2] ?? '';
  if (payload.length > MAX_DATA_URL_BYTES * 1.4) return null;
  try {
    const bytes = base64 ? Buffer.from(payload.replace(/\s+/g, ''), 'base64') : Buffer.from(decodeURIComponent(payload), 'latin1');
    return bytes.byteLength > 0 && bytes.byteLength <= MAX_DATA_URL_BYTES ? bytes : null;
  } catch {
    return null;
  }
}
