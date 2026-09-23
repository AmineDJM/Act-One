/**
 * The security boundary for every SVG this system keeps.
 *
 * A logo is markup from somebody else's server, and it will later be drawn
 * inside the render farm's browser. So it is re-parsed here, in Node, where
 * the page it came from has no say, by a parser that accepts a deliberately
 * small subset of XML and rejects everything else rather than repairing it:
 * no DOCTYPE (so no entity expansion), no processing instructions, no CDATA,
 * no unknown entities. What parses is then filtered by allowlist — elements,
 * attributes, and the values of anything that can reference another resource
 * — and written out again canonically. Nothing is copied through as text.
 */
export type SvgElement = { name: string; attributes: [string, string][]; children: SvgNode[] };
export type SvgNode = SvgElement | { text: string };

export class SvgRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgRejected';
  }
}

export type SanitizedSvg = {
  svg: string;
  width: number | null;
  height: number | null;
  /** What was taken out, for the diagnostics. */
  removed: string[];
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const MAX_INPUT = 1_000_000;
const MAX_OUTPUT = 512 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 20_000;
const MAX_IMAGE_DATA = 2 * 1024 * 1024;

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text',
  'tspan', 'textPath', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'filter',
  'feGaussianBlur', 'feOffset', 'feFlood', 'feComposite', 'feMerge', 'feMergeNode', 'feColorMatrix', 'feBlend',
  'feMorphology', 'feDropShadow', 'image', 'marker',
]);
/** Kept for their children, dropped themselves. */
const UNWRAP = new Set(['a', 'switch']);

const ATTRIBUTES = new Set([
  // geometry and structure
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'width', 'height', 'd', 'points',
  'pathLength', 'transform', 'viewBox', 'preserveAspectRatio', 'offset', 'gradientUnits', 'gradientTransform',
  'spreadMethod', 'patternUnits', 'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits',
  'maskContentUnits', 'filterUnits', 'primitiveUnits', 'stdDeviation', 'dx', 'dy', 'in', 'in2', 'result',
  'operator', 'k1', 'k2', 'k3', 'k4', 'mode', 'values', 'type', 'radius', 'refX', 'refY', 'markerWidth',
  'markerHeight', 'orient', 'markerUnits', 'id', 'version', 'startOffset', 'method', 'spacing', 'lengthAdjust',
  'textLength', 'rotate',
  // presentation
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'clip-path',
  'clip-rule', 'mask', 'filter', 'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity', 'color', 'display',
  'visibility', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'word-spacing',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'text-decoration', 'paint-order',
  'vector-effect', 'shape-rendering', 'text-rendering', 'image-rendering', 'color-interpolation',
  'color-interpolation-filters', 'isolation', 'mix-blend-mode', 'overflow',
  // namespaces, links, accessibility
  'xmlns', 'xmlns:xlink', 'href', 'xlink:href', 'role', 'aria-label', 'aria-hidden',
]);

const LONG_VALUE = new Set(['d', 'points', 'values', 'transform', 'href', 'xlink:href']);
const INTERNAL_REF = /^#[A-Za-z_][\w.:-]*$/;
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;
const DANGEROUS_VALUE = /javascript:|vbscript:|livescript:|expression\s*\(|@import|behavior\s*:|-moz-binding/i;

export function sanitizeSvg(markup: string): SanitizedSvg {
  if (markup.length > MAX_INPUT) throw new SvgRejected('The svg is larger than we keep.');
  const root = parseXml(markup);
  if (root.name !== 'svg') throw new SvgRejected('The root element is not <svg>.');
  const removed: string[] = [];
  const clean = filterElement(root, removed, true);
  if (!clean) throw new SvgRejected('Nothing of the svg survived sanitising.');

  const setAttribute = (name: string, value: string): void => {
    const existing = clean.attributes.findIndex(([key]) => key === name);
    if (existing >= 0) clean.attributes[existing] = [name, value];
    else clean.attributes.unshift([name, value]);
  };
  setAttribute('xmlns', SVG_NS);
  if (usesXlink(clean)) setAttribute('xmlns:xlink', XLINK_NS);
  else clean.attributes = clean.attributes.filter(([key]) => key !== 'xmlns:xlink');

  const svg = serialize(clean);
  if (svg.length > MAX_OUTPUT) throw new SvgRejected('The sanitised svg is larger than we keep.');
  const dimension = (name: string): number | null => {
    const raw = clean.attributes.find(([key]) => key === name)?.[1];
    const value = raw ? Number.parseFloat(raw) : Number.NaN;
    return Number.isFinite(value) && value > 0 && /^\s*[\d.]+(px)?\s*$/.test(raw ?? '') ? value : null;
  };
  return { svg, width: dimension('width'), height: dimension('height'), removed: [...new Set(removed)].slice(0, 50) };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function filterElement(element: SvgElement, removed: string[], isRoot: boolean): SvgElement | null {
  if (!ELEMENTS.has(element.name)) {
    removed.push(`<${element.name}>`);
    return null;
  }
  const attributes: [string, string][] = [];
  for (const [name, value] of element.attributes) {
    const verdict = judgeAttribute(element.name, name, value);
    if (verdict === null) attributes.push([name, value]);
    else removed.push(`${element.name}@${name}: ${verdict}`);
  }
  const children: SvgNode[] = [];
  const append = (node: SvgNode): void => {
    if ('text' in node) {
      if (node.text.trim()) children.push(node);
      return;
    }
    if (UNWRAP.has(node.name)) {
      removed.push(`<${node.name}> (unwrapped)`);
      for (const child of node.children) append(child);
      return;
    }
    const filtered = filterElement(node, removed, false);
    if (filtered) children.push(filtered);
  };
  for (const child of element.children) append(child);
  // Text is meaningful only inside text elements; elsewhere it is whitespace or noise.
  const textual = element.name === 'text' || element.name === 'tspan' || element.name === 'textPath';
  return {
    name: element.name,
    attributes: isRoot ? attributes.filter(([name]) => name !== 'x' && name !== 'y') : attributes,
    children: textual ? children : children.filter((child) => !('text' in child)),
  };
}

/** Null when the attribute may stay; otherwise why it goes. */
function judgeAttribute(element: string, name: string, value: string): string | null {
  if (!ATTRIBUTES.has(name)) return 'not allowed';
  if (value.length > (LONG_VALUE.has(name) ? 400_000 : 4_000)) return 'value too long';
  const compact = value.replace(/[\s\u0000-\u001f]+/g, '');
  if (DANGEROUS_VALUE.test(compact)) return 'executable value';
  if (name === 'xmlns') return value === SVG_NS ? null : 'foreign namespace';
  if (name === 'xmlns:xlink') return value === XLINK_NS ? null : 'foreign namespace';
  if (name === 'href' || name === 'xlink:href') {
    if (INTERNAL_REF.test(value.trim())) return null;
    if (element === 'image' && DATA_IMAGE.test(value.trim()) && value.length <= MAX_IMAGE_DATA) return null;
    return 'external reference';
  }
  if (/url\s*\(/i.test(value)) {
    const references = [...value.matchAll(/url\s*\(\s*(["']?)([^"')]*)\1\s*\)/gi)];
    if (references.length === 0 || !references.every((match) => INTERNAL_REF.test((match[2] ?? '').trim()))) {
      return 'external reference';
    }
  }
  if (/data:/i.test(compact)) return 'embedded data';
  return null;
}

function usesXlink(element: SvgElement): boolean {
  if (element.attributes.some(([name]) => name.startsWith('xlink:'))) return true;
  return element.children.some((child) => !('text' in child) && usesXlink(child));
}

// ---------------------------------------------------------------------------
// A strict XML subset
// ---------------------------------------------------------------------------

const NAME = /[A-Za-z_][\w.:-]*/y;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function parseXml(markup: string): SvgElement {
  let index = markup.charCodeAt(0) === 0xfeff ? 1 : 0;
  let nodes = 0;

  const fail = (message: string): never => {
    throw new SvgRejected(`${message} at offset ${index}.`);
  };
  const skipWhitespace = (): void => {
    while (index < markup.length && /\s/.test(markup[index]!)) index += 1;
  };
  const skipMisc = (): void => {
    for (;;) {
      skipWhitespace();
      if (markup.startsWith('<!--', index)) {
        const end = markup.indexOf('-->', index + 4);
        if (end < 0) fail('Unterminated comment');
        index = end + 3;
        continue;
      }
      return;
    }
  };
  const readName = (): string => {
    NAME.lastIndex = index;
    const match = NAME.exec(markup);
    if (!match) fail('Expected a name');
    index += match![0].length;
    return match![0];
  };
  const decode = (raw: string): string =>
    raw.replace(/&([^;&\s]{0,12});|&/g, (whole: string, entity: string | undefined) => {
      if (entity === undefined) return fail('A bare ampersand');
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const code = Number.parseInt(entity.slice(2), 16);
        return validCodePoint(code) ? String.fromCodePoint(code) : fail('An invalid character reference');
      }
      if (entity.startsWith('#')) {
        const code = Number.parseInt(entity.slice(1), 10);
        return validCodePoint(code) ? String.fromCodePoint(code) : fail('An invalid character reference');
      }
      const named = ENTITIES[entity];
      return named ?? fail(`An unknown entity &${entity}; (${whole.length} chars)`);
    });

  const parseElement = (depth: number): SvgElement => {
    if (depth > MAX_DEPTH) fail('Nested too deeply');
    nodes += 1;
    if (nodes > MAX_NODES) fail('Too many nodes');
    if (markup[index] !== '<') fail('Expected an element');
    index += 1;
    const name = readName();
    const attributes: [string, string][] = [];
    const seen = new Set<string>();
    for (;;) {
      const before = index;
      skipWhitespace();
      if (markup.startsWith('/>', index)) {
        index += 2;
        return { name, attributes, children: [] };
      }
      if (markup[index] === '>') {
        index += 1;
        break;
      }
      if (index === before) fail('Expected whitespace between attributes');
      const attribute = readName();
      if (seen.has(attribute)) fail(`A repeated attribute ${attribute}`);
      seen.add(attribute);
      skipWhitespace();
      if (markup[index] !== '=') fail('Expected =');
      index += 1;
      skipWhitespace();
      const quote = markup[index];
      if (quote !== '"' && quote !== "'") fail('Expected a quoted value');
      const end = markup.indexOf(quote!, index + 1);
      if (end < 0) fail('Unterminated attribute value');
      const raw = markup.slice(index + 1, end);
      if (raw.includes('<')) fail('A < inside an attribute value');
      attributes.push([attribute, decode(raw)]);
      index = end + 1;
    }

    const children: SvgNode[] = [];
    for (;;) {
      if (index >= markup.length) fail(`Unclosed <${name}>`);
      if (markup.startsWith('</', index)) {
        index += 2;
        const closing = readName();
        if (closing !== name) fail(`</${closing}> closes <${name}>`);
        skipWhitespace();
        if (markup[index] !== '>') fail('Expected >');
        index += 1;
        return { name, attributes, children };
      }
      if (markup.startsWith('<!--', index)) {
        const end = markup.indexOf('-->', index + 4);
        if (end < 0) fail('Unterminated comment');
        index = end + 3;
        continue;
      }
      if (markup.startsWith('<![CDATA[', index)) fail('CDATA is not accepted');
      if (markup.startsWith('<!', index)) fail('Declarations are not accepted');
      if (markup.startsWith('<?', index)) fail('Processing instructions are not accepted');
      if (markup[index] === '<') {
        children.push(parseElement(depth + 1));
        continue;
      }
      const next = markup.indexOf('<', index);
      const raw = markup.slice(index, next < 0 ? markup.length : next);
      if (raw.includes('>') && raw.includes(']]>')) fail('A stray CDATA terminator');
      nodes += 1;
      children.push({ text: decode(raw) });
      index = next < 0 ? markup.length : next;
    }
  };

  skipMisc();
  if (markup.startsWith('<?xml', index)) {
    const end = markup.indexOf('?>', index);
    if (end < 0) fail('Unterminated XML declaration');
    index = end + 2;
  }
  skipMisc();
  if (markup.startsWith('<!', index)) fail('A DOCTYPE is not accepted');
  if (markup.startsWith('<?', index)) fail('Processing instructions are not accepted');
  const root = parseElement(0);
  skipMisc();
  if (index < markup.length) fail('Content after the root element');
  return root;
}

function validCodePoint(code: number): boolean {
  return (
    Number.isInteger(code) &&
    (code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))
  );
}

export function serialize(element: SvgElement): string {
  const attributes = element.attributes.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
  if (element.children.length === 0) return `<${element.name}${attributes}/>`;
  const body = element.children.map((child) => ('text' in child ? escapeText(child.text) : serialize(child))).join('');
  return `<${element.name}${attributes}>${body}</${element.name}>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
