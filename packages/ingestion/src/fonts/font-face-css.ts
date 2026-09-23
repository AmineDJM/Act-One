/**
 * `@font-face` rules, read from stylesheet text.
 *
 * The CSSOM refuses to open a cross-origin stylesheet, and the fonts of most
 * brands live in exactly those: a font service, a CDN. The recorder kept their
 * text; this reads the rules out of it. A deliberately small reader rather
 * than a CSS parser: it only needs `@font-face` blocks, which cannot nest, and
 * the one thing it must get right is not splitting inside quotes and
 * parentheses — a `data:` URL carries a semicolon in `;base64`.
 */
export type FontSource = { url: string; format: string | null };

export type FontFaceDeclaration = {
  family: string;
  sources: FontSource[];
  weight: string;
  style: string;
  stretch: string | null;
  unicodeRange: string | null;
  origin: string;
};

const MAX_RULES = 600;

export function parseFontFaceRules(css: string, baseUrl: string): FontFaceDeclaration[] {
  const text = stripComments(css);
  const rules: FontFaceDeclaration[] = [];
  const pattern = /@font-face\s*\{/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null && rules.length < MAX_RULES) {
    const open = match.index + match[0].length;
    const close = findBlockEnd(text, open);
    if (close < 0) break;
    const declarations = splitTopLevel(text.slice(open, close), ';');
    const fields = new Map<string, string>();
    for (const declaration of declarations) {
      const colon = declaration.indexOf(':');
      if (colon <= 0) continue;
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).replace(/!important\s*$/i, '').trim();
      if (name && value) fields.set(name, value);
    }
    pattern.lastIndex = close + 1;

    const family = unquote(fields.get('font-family') ?? '');
    const src = fields.get('src');
    if (!family || !src) continue;
    const sources = parseSrcDescriptor(src, baseUrl);
    if (sources.length === 0) continue;
    rules.push({
      family,
      sources,
      weight: normaliseSpaces(fields.get('font-weight') ?? 'normal'),
      style: normaliseSpaces(fields.get('font-style') ?? 'normal'),
      stretch: fields.has('font-stretch') ? normaliseSpaces(fields.get('font-stretch')!) : null,
      unicodeRange: fields.has('unicode-range') ? normaliseSpaces(fields.get('unicode-range')!) : null,
      origin: baseUrl,
    });
  }
  return rules;
}

/**
 * The `src` descriptor: `url(…) format(…)` entries in order of preference.
 * `local()` entries name a font installed on the visitor's machine, which is
 * nothing we can keep, and are skipped.
 */
export function parseSrcDescriptor(src: string, baseUrl: string): FontSource[] {
  const sources: FontSource[] = [];
  for (const entry of splitTopLevel(src, ',')) {
    const url = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s]*))\s*\)/i.exec(entry);
    if (!url) continue;
    const raw = unescapeCss(url[1] ?? url[2] ?? url[3] ?? '');
    if (!raw) continue;
    const format = /format\(\s*["']?([a-z0-9-]+)["']?\s*\)/i.exec(entry)?.[1]?.toLowerCase() ?? null;
    let resolved: string;
    try {
      resolved = raw.startsWith('data:') ? raw : new URL(raw, baseUrl).href;
    } catch {
      continue;
    }
    sources.push({ url: resolved, format });
  }
  return sources;
}

/** A face's descriptors compared the way a browser matches them. */
export function sameFace(
  a: { family: string; weight: string; style: string; unicodeRange: string | null },
  b: { family: string; weight: string; style: string; unicodeRange: string | null },
): boolean {
  return (
    a.family.toLowerCase() === b.family.toLowerCase() &&
    normaliseWeight(a.weight) === normaliseWeight(b.weight) &&
    normaliseStyle(a.style) === normaliseStyle(b.style) &&
    normaliseRange(a.unicodeRange) === normaliseRange(b.unicodeRange)
  );
}

export function normaliseWeight(weight: string): string {
  const value = normaliseSpaces(weight).toLowerCase();
  if (value === 'normal') return '400';
  if (value === 'bold') return '700';
  const [low, high] = value.split(' ');
  return high && high !== low ? `${low} ${high}` : (low ?? '400');
}

function normaliseStyle(style: string): string {
  const value = normaliseSpaces(style).toLowerCase();
  return value.startsWith('oblique') ? 'oblique' : value || 'normal';
}

/**
 * A unicode-range as numbers, so `U+0000-00FF` from a stylesheet and
 * `U+0-FF` from the browser's own serialisation compare equal. Wildcards
 * (`U+4??`) expand to the range they stand for.
 */
export function normaliseRange(range: string | null): string {
  if (!range || !range.trim()) return 'u+0-10ffff';
  return range
    .toLowerCase()
    .split(',')
    .map((part) => {
      const match = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/.exec(part.trim());
      if (!match) return part.trim();
      const first = match[1]!;
      const low = Number.parseInt(first.replace(/\?/g, '0'), 16);
      const high = match[2] ? Number.parseInt(match[2], 16) : Number.parseInt(first.replace(/\?/g, 'f'), 16);
      return low === high ? `u+${low.toString(16)}` : `u+${low.toString(16)}-${high.toString(16)}`;
    })
    .filter(Boolean)
    .join(',');
}

function normaliseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function stripComments(css: string): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;
  while (index < css.length) {
    const char = css[index]!;
    if (quote) {
      out += char;
      if (char === '\\' && index + 1 < css.length) {
        out += css[index + 1];
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end < 0 ? css.length : end + 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** Index of the `}` closing the block whose body starts at `start`, or -1. */
function findBlockEnd(text: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '{') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === '}') {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

/** Splits on `separator` where it is not inside quotes or parentheses. */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      current += char;
      if (char === '\\' && index + 1 < text.length) {
        current += text[index + 1];
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (char === separator && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed);
  return unescapeCss(quoted ? quoted[2]! : trimmed).trim();
}

function unescapeCss(value: string): string {
  return value.replace(/\\([0-9a-f]{1,6}\s?|[\s\S])/gi, (_, escaped: string) => {
    const hex = escaped.trim();
    if (/^[0-9a-f]{1,6}$/i.test(hex)) {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return escaped === '\n' ? '' : escaped;
  });
}
