import { BUNDLED_FAMILIES } from './fonts.ts';

/**
 * What a written scene must be before it goes anywhere near a browser.
 *
 * The scene is HTML and JavaScript written by a language model from a brief
 * that contains a customer's words, so it is treated the way any untrusted
 * code is: checked against an allowlist, then run behind a content policy
 * that forbids the network. The checks come in four kinds, each with a reason
 * the render record can state:
 *
 *  - shape: one template, one composition root, one paused timeline registered
 *    under the scene's id, every clip timed inside the scene's window;
 *  - safety: no element, attribute, script call or stylesheet rule that could
 *    reach the network, the storage, another frame or the page's own markup;
 *  - determinism: no randomness, no clock, no browser-driven animation — the
 *    renderer seeks the timeline frame by frame, and a scene that moves on its
 *    own renders differently every time;
 *  - honesty: type only in Act One's faces, and no word on screen that the
 *    storyboard did not write. The film says what the customer published.
 */
export type Severity = 'error' | 'warning';
export type ValidationFinding = { code: string; severity: Severity; message: string };

export type ValidationContext = {
  frameId: string;
  /** Seconds the scene is mounted for; no clip may run past it. */
  mountedSeconds: number;
  /** Project paths the scene may place. Anything else is refused. */
  allowedPaths: ReadonlySet<string>;
  /** Every word the scene may set in type: its on-screen text, and the brand, address and line for end cards. */
  allowedWords: ReadonlySet<string>;
  /** Every figure it may show, from the same texts. A count's starting zero is always allowed. */
  allowedFigures: ReadonlySet<string>;
  /** Whether the scene sets type the studio frames: it should place it in the studio's frame. */
  expectsFrame?: boolean;
};

export const MAX_SCENE_BYTES = 160 * 1024;

/** The template out of whatever the model wrapped it in. */
export function normalizeScene(raw: string): string {
  const unfenced = raw.replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  const start = unfenced.search(/<template[\s>]/i);
  const end = unfenced.toLowerCase().lastIndexOf('</template>');
  if (start < 0 || end < start) return unfenced.trim();
  return unfenced.slice(start, end + '</template>'.length).trim();
}

const ALLOWED_TAGS = new Set([
  'template', 'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'strong', 'em', 'b', 'i', 'small', 'sup', 'sub',
  'figure', 'figcaption', 'section', 'header', 'footer', 'ul', 'ol', 'li', 'img', 'video', 'style', 'script',
  // Inline SVG, for marks, rules, masks and the shapes a scene draws itself.
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'use',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'symbol', 'title', 'desc',
  'filter', 'fegaussianblur', 'feoffset', 'fecolormatrix', 'feblend', 'femerge', 'femergenode', 'feflood', 'fecomposite',
  'fedropshadow', 'femorphology',
]);

const URL_ATTRIBUTES = new Set(['src', 'href', 'xlink:href', 'poster', 'srcset', 'action', 'formaction', 'data', 'background']);

/*
 * Each rule is matched against the code with its strings blanked, so a word
 * inside a string is not read as a call — except the rules that are about a
 * string argument (which element is created, which attribute is set, which
 * address appears), which must see the strings to see anything at all.
 */
const FORBIDDEN_SCRIPT: { pattern: RegExp; what: string; inStrings?: true }[] = [
  { pattern: /\bfetch\s*\(/, what: 'fetch()' },
  { pattern: /\bXMLHttpRequest\b/, what: 'XMLHttpRequest' },
  { pattern: /\bWebSocket\b/, what: 'WebSocket' },
  { pattern: /\bEventSource\b/, what: 'EventSource' },
  { pattern: /\bsendBeacon\b/, what: 'navigator.sendBeacon' },
  { pattern: /\bimportScripts\b|\bnew\s+(Shared)?Worker\b|\bServiceWorker\b|\bserviceWorker\b/, what: 'workers' },
  { pattern: /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/, what: 'code built from strings' },
  { pattern: /\bimport\s*\(/, what: 'dynamic import' },
  { pattern: /\bdocument\s*\.\s*cookie\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bcaches\s*\./, what: 'browser storage' },
  { pattern: /\bwindow\s*\.\s*open\b|\blocation\b|\bhistory\s*\.|\bpostMessage\b|\bdocument\s*\.\s*domain\b/, what: 'navigation or messaging' },
  { pattern: /\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|\bdocument\s*\.\s*write\b|\bcreateContextualFragment\b|\bsetHTMLUnsafe\b/, what: 'markup written from a script' },
  { pattern: /createElement(NS)?\s*\([^)]*['"`](script|iframe|frame|object|embed|link|meta|base|form|input|portal|a|img|video|audio|source|style)['"`]/i, what: 'creating an element this engine forbids', inStrings: true },
  { pattern: /setAttribute(NS)?\s*\([^)]*['"`](src|href|xlink:href|srcset|style|on\w+)['"`]/i, what: 'setting a URL, style or handler attribute from a script', inStrings: true },
  { pattern: /\.\s*(src|href|srcset)\s*=(?!=)/, what: 'assigning a URL from a script' },
  { pattern: /https?:\/\/|\bwss?:\/\//i, what: 'a network address', inStrings: true },
];

const NONDETERMINISTIC = [
  { pattern: /\bMath\s*\.\s*random\b/, what: 'Math.random' },
  { pattern: /\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bperformance\s*\.\s*now\b/, what: 'the clock' },
  { pattern: /\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b|\brequestIdleCallback\b/, what: 'timers' },
  { pattern: /\brepeat\s*:\s*-\s*1\b/, what: 'an infinite repeat' },
  { pattern: /\byoyo\s*:\s*true\b/, what: 'a yoyo' },
  // gsap.set is immediate and allowed for initial states; anything else outside the timeline plays on the browser's clock.
  { pattern: /\bgsap\s*\.\s*(to|from|fromTo|delayedCall)\s*\(|\bgsap\s*\.\s*ticker\b/, what: 'a tween outside the scene timeline' },
];

/** Checks one scene. Errors refuse it; warnings travel with it into the render record. */
export function validateScene(html: string, context: ValidationContext): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const error = (code: string, message: string) => findings.push({ code, severity: 'error', message });
  const warn = (code: string, message: string) => findings.push({ code, severity: 'warning', message });

  if (Buffer.byteLength(html, 'utf8') > MAX_SCENE_BYTES) {
    error('scene_too_large', `The scene is larger than ${MAX_SCENE_BYTES / 1024} KB.`);
    return findings;
  }
  const trimmed = html.trim();
  if (!/^<template[\s>]/i.test(trimmed) || !/<\/template>$/i.test(trimmed)) {
    error('missing_template', 'The scene must be exactly one <template>…</template> fragment and nothing else.');
    return findings;
  }
  if ((trimmed.match(/<template[\s>]/gi) ?? []).length !== 1) {
    error('multiple_templates', 'The scene contains more than one <template>.');
  }
  if (/<!--/.test(trimmed)) warn('comment', 'Comments are removed before rendering.');

  const scripts = [...trimmed.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const styles = [...trimmed.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)];
  const markup = trimmed
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  checkMarkup(markup, context, error, warn);
  checkStudioFrame(markup, styles.map((match) => match[1] ?? ''), scripts.map((match) => match[2] ?? ''), context, error, warn);
  checkStyles(
    [...styles.map((match) => match[1] ?? ''), ...inlineStyles(markup)],
    context,
    error,
  );
  checkScripts(scripts, context, error);
  checkWords(markup, scripts.map((match) => match[2] ?? ''), context, error);
  return findings;
}

type Report = (code: string, message: string) => void;

function checkMarkup(markup: string, context: ValidationContext, error: Report, warn: Report): void {
  let roots = 0;
  for (const tag of markup.matchAll(/<([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const name = tag[1]!.toLowerCase();
    const attributes = parseAttributes(tag[2] ?? '');
    if (!ALLOWED_TAGS.has(name)) {
      error('forbidden_element', `<${name}> is not allowed in a scene.`);
      continue;
    }
    for (const [attribute, value] of attributes) {
      if (/^on/i.test(attribute)) error('event_handler', `The ${attribute} attribute is not allowed: a scene's motion lives in its timeline.`);
      if (URL_ATTRIBUTES.has(attribute)) checkReference(attribute, value, context, error);
      if (/javascript\s*:/i.test(value) || /vbscript\s*:/i.test(value)) error('script_url', `The ${attribute} attribute carries a script address.`);
    }
    if (attributes.has('data-composition-src')) {
      error('nested_composition', 'A scene may not mount another composition.');
    }
    const compositionId = attributes.get('data-composition-id');
    if (compositionId !== undefined) {
      if (compositionId !== context.frameId) {
        error('wrong_composition_id', `The composition id is "${compositionId}"; it must be "${context.frameId}".`);
      } else {
        roots += 1;
        if (attributes.get('id') !== 'root') error('root_id', 'The composition root must carry id="root".');
      }
    }
    const classes = (attributes.get('class') ?? '').split(/\s+/);
    if (classes.includes('clip')) checkClip(name, attributes, context, error);
    if (name === 'video') {
      if (!attributes.has('muted')) error('video_sound', 'A <video> must be muted: the film\'s sound is mixed by Act One, not played by a scene.');
      if (attributes.has('autoplay')) warn('video_autoplay', 'autoplay is ignored: the renderer seeks every clip.');
      if (!classes.includes('clip')) error('video_not_clip', 'A <video> must be a clip, with data-start, data-duration and data-track-index, so the renderer can seek it.');
    }
  }
  if (roots !== 1) error('missing_root', `The scene must have exactly one element with data-composition-id="${context.frameId}".`);
}

/**
 * The studio's frame is shared by every scene on the page.
 *
 * A rule that restyles `.ao-frame` in one scene, or a tween that selects it by
 * class, reaches every scene's frame at once: the film would move the type of
 * scenes nobody touched. So it is placed, never styled, animated or selected.
 */
function checkStudioFrame(markup: string, styles: string[], scripts: string[], context: ValidationContext, error: Report, warn: Report): void {
  const frameClass = /\bao-(frame|lockup)\b/;
  if (styles.some((css) => /\.ao-(frame|lockup)\b/.test(css))) {
    error('studio_frame_restyled', 'A stylesheet rule targets the studio frame (.ao-frame or .ao-lockup); place blocks in it, never restyle it.');
  }
  for (const tag of markup.matchAll(/<([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const attributes = parseAttributes(tag[2] ?? '');
    if (frameClass.test(attributes.get('class') ?? '') && attributes.has('style')) {
      error('studio_frame_restyled', 'The studio frame carries a style attribute; it must keep the studio’s own box.');
    }
  }
  for (const code of scripts) {
    for (const literal of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      if (/\.ao-(frame|lockup)\b/.test(literal[2] ?? '')) {
        error('studio_frame_selected', 'A script selects the studio frame by class, which would reach every scene’s frame; select your own elements by id.');
      }
    }
  }
  if (context.expectsFrame && !frameClass.test(markup)) {
    warn('studio_frame_unused', 'The scene sets its type outside the studio frame, so it may not sit where the other engine sets it.');
  }
}

function checkClip(name: string, attributes: Map<string, string>, context: ValidationContext, error: Report): void {
  const start = Number(attributes.get('data-start'));
  const duration = Number(attributes.get('data-duration'));
  const track = attributes.get('data-track-index');
  if (!attributes.has('data-start') || !attributes.has('data-duration') || track === undefined) {
    error('clip_missing_timing', `A <${name}> clip needs data-start, data-duration and data-track-index.`);
    return;
  }
  if (!Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration <= 0 || !/^\d+$/.test(track)) {
    error('clip_bad_timing', `A <${name}> clip has timing that is not a non-negative number: start ${attributes.get('data-start')}, duration ${attributes.get('data-duration')}, track ${track}.`);
    return;
  }
  if (start + duration > context.mountedSeconds + 0.05) {
    error('clip_outside_scene', `A <${name}> clip runs to ${round(start + duration)} s; the scene is mounted for ${round(context.mountedSeconds)} s.`);
  }
}

function checkReference(attribute: string, value: string, context: ValidationContext, error: Report): void {
  const reference = value.trim();
  if (attribute === 'srcset') {
    error('srcset', 'srcset is not allowed; place one file with src.');
    return;
  }
  // SVG references into the same document: <use href="#shape">, fill="url(#grad)" and the like.
  if ((attribute === 'href' || attribute === 'xlink:href') && /^#[A-Za-z][\w-]*$/.test(reference)) return;
  if (!context.allowedPaths.has(reference)) {
    error('unknown_file', `${attribute}="${truncate(reference, 80)}" is not one of the files this scene was given.`);
  }
}

function checkStyles(blocks: string[], context: ValidationContext, error: Report): void {
  for (const css of blocks) {
    if (/@import\b/i.test(css)) error('css_import', 'Stylesheets may not import other stylesheets.');
    if (/expression\s*\(|behavior\s*:|-moz-binding/i.test(css)) error('css_script', 'The stylesheet carries a script hook.');
    if (/@font-face\b/i.test(css)) error('font_face', 'Faces are declared by the engine; a scene may not declare its own.');
    if (/(^|[\s;{])transition(-[a-z-]+)?\s*:/i.test(css)) error('css_transition', 'CSS transitions run on the browser\'s clock; animate in the timeline instead.');
    if (/(^|[\s;{])animation(-[a-z-]+)?\s*:|@keyframes\b/i.test(css)) error('css_animation', 'CSS animations run on the browser\'s clock; animate in the timeline instead.');
    for (const url of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
      const reference = (url[2] ?? '').trim();
      if (/^#[A-Za-z][\w-]*$/.test(reference)) continue;
      if (!context.allowedPaths.has(reference)) error('unknown_file', `url(${truncate(reference, 80)}) is not one of the files this scene was given.`);
    }
    for (const declaration of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
      checkFontFamily(declaration[1] ?? '', error);
    }
    for (const declaration of css.matchAll(/(^|[\s;{])font\s*:\s*([^;}]+)/gi)) {
      if (!/var\(--ao-[a-z]+-family\)/.test(declaration[2] ?? '')) {
        error('font_shorthand', 'Use font-family with the role variables rather than the font shorthand.');
      }
    }
  }
}

const GENERIC_FAMILIES = new Set(['sans-serif', 'serif', 'monospace']);

function checkFontFamily(value: string, error: Report): void {
  for (const part of value.split(',')) {
    const family = part.trim().replace(/^['"]|['"]$/g, '').trim();
    if (family.length === 0) continue;
    if (/^var\(--ao-[a-z]+-family\)$/.test(family)) continue;
    if (GENERIC_FAMILIES.has(family.toLowerCase())) continue;
    if (BUNDLED_FAMILIES.includes(family)) continue;
    error('unknown_font', `"${family}" is not one of the faces this engine bundles; it would render in a fallback face. Use var(--ao-display-family) and the other role variables.`);
  }
}

function checkScripts(scripts: RegExpMatchArray[], context: ValidationContext, error: Report): void {
  if (scripts.length === 0) {
    error('missing_timeline', 'The scene has no script, so it has no timeline.');
    return;
  }
  let timelines = 0;
  let registered = false;
  for (const script of scripts) {
    const attributes = parseAttributes(script[1] ?? '');
    const code = script[2] ?? '';
    if (attributes.has('src')) error('external_script', 'Scripts are provided by the engine; a scene may not load one.');
    if (attributes.has('type') && !/^(text|application)\/javascript$/i.test(attributes.get('type') ?? '')) {
      error('script_type', `A script of type "${attributes.get('type')}" is not allowed.`);
    }
    const stripped = stripStringsAndComments(code);
    for (const rule of FORBIDDEN_SCRIPT) {
      if (rule.pattern.test(rule.inStrings ? code : stripped)) error('forbidden_script', `The script uses ${rule.what}, which scenes may not.`);
    }
    for (const rule of NONDETERMINISTIC) {
      if (rule.pattern.test(stripped)) error('nondeterministic', `The script uses ${rule.what}; the renderer seeks the timeline, so a scene must be a pure function of time.`);
    }
    timelines += (stripped.match(/\bgsap\s*\.\s*timeline\s*\(/g) ?? []).length;
    if (/\bgsap\s*\.\s*timeline\s*\(\s*\{[^}]*\bpaused\s*:\s*true/.test(code) === false && /\bgsap\s*\.\s*timeline\s*\(/.test(stripped)) {
      error('timeline_not_paused', 'The timeline must be created with { paused: true }.');
    }
    const registration = new RegExp(`window\\s*\\.\\s*__timelines\\s*\\[\\s*(['"\`])${escapeRegExp(context.frameId)}\\1\\s*\\]\\s*=(?!=)`);
    if (registration.test(code)) registered = true;
  }
  if (timelines !== 1) error('timeline_count', `The scene must create exactly one timeline; it creates ${timelines}.`);
  if (!registered) error('timeline_not_registered', `The timeline must be registered as window.__timelines["${context.frameId}"].`);
}

/**
 * No word and no figure on screen that the storyboard did not write.
 *
 * Markup text is checked word by word and figure by figure: a statistic the
 * customer never published is the worst thing a launch film can say. Strings
 * in the scripts are checked for words when they read as prose — two words or
 * more, no selector punctuation — which is how a scene splits a line into
 * words to reveal them. Figures in scripts pass: a number that counts up goes
 * through every number below it, and a starting zero is how it begins.
 */
function checkWords(markup: string, scripts: string[], context: ValidationContext, error: Report): void {
  const invented = new Set<string>();
  const consider = (text: string, ignore: ReadonlySet<string>) => {
    for (const word of wordsOf(text)) {
      if (!context.allowedWords.has(word) && !ignore.has(word)) invented.add(word);
    }
  };
  // An SVG's title and description are for assistive tools, not the frame; only its text and tspan draw words.
  const visible = decodeEntities(
    markup
      .replace(/<title\b[\s\S]*?<\/title\s*>|<desc\b[\s\S]*?<\/desc\s*>/gi, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, (svg) => svg.replace(/<(?!\/?(text|tspan)\b)[^>]+>/gi, ' '))
      .replace(/<[^>]+>/g, ' '),
  );
  consider(visible, NOTHING);
  const inventedFigures = figuresOf(visible).filter((figure) => !context.allowedFigures.has(figure) && !ZERO.test(figure));
  if (inventedFigures.length > 0) {
    error('invented_figure', `The scene shows figures the storyboard did not write: ${[...new Set(inventedFigures)].slice(0, 8).join(', ')}.`);
  }
  for (const code of scripts) {
    for (const literal of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const text = literal[2] ?? '';
      if (/[#.[\]{}:;=<>()$]/.test(text)) continue;
      if (!/\s/.test(text.trim())) continue;
      // CSS values written in the timeline — "left center", "top left" — are not words on screen.
      consider(text, CSS_WORDS);
    }
  }
  if (invented.size > 0) {
    error('invented_text', `The scene sets words the storyboard did not write: ${[...invented].slice(0, 12).join(', ')}. Use only the scene's on-screen text.`);
  }
}

const NOTHING: ReadonlySet<string> = new Set();

const CSS_WORDS: ReadonlySet<string> = new Set([
  'center', 'left', 'right', 'top', 'bottom', 'middle', 'auto', 'none', 'inherit', 'initial', 'unset',
  'block', 'inline', 'flex', 'grid', 'absolute', 'relative', 'hidden', 'visible', 'solid', 'dashed',
  'normal', 'bold', 'italic', 'uppercase', 'lowercase', 'capitalize', 'nowrap', 'wrap', 'cover', 'contain',
  'inset', 'linear', 'px', 'em', 'rem', 'vh', 'vw', 'deg', 'turn', 'ms', 'transparent', 'currentcolor',
  'start', 'end', 'baseline', 'row', 'column', 'space', 'between', 'around', 'stretch', 'fill', 'stroke',
  'round', 'butt', 'square', 'miter', 'bevel', 'repeat', 'no', 'x', 'y', 'z', 'ease', 'in', 'out', 'inout',
]);

/** Words as they are compared: lower case letters, apostrophes kept inside a word. Figures are compared apart. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().normalize('NFKC').match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? [];
}

/** Figures as they are compared: digit groups with their separators, "12,500" and "3.5" whole. */
export function figuresOf(text: string): string[] {
  return text.normalize('NFKC').match(/\p{N}+(?:[.,]\p{N}+)*/gu) ?? [];
}

const ZERO = /^0+(?:[.,]0+)*$/;

/** The vocabulary a scene may use. */
export function vocabulary(...texts: string[]): Set<string> {
  const words = new Set<string>();
  for (const text of texts) for (const word of wordsOf(text)) words.add(word);
  return words;
}

/** The figures a scene may show. */
export function figures(...texts: string[]): Set<string> {
  const found = new Set<string>();
  for (const text of texts) for (const figure of figuresOf(text)) found.add(figure);
  return found;
}

function inlineStyles(markup: string): string[] {
  return [...markup.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((match) => match[2] ?? match[3] ?? '');
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = match[1]!.toLowerCase();
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** Code with string and comment contents blanked, so a word inside a string is not read as a call. */
function stripStringsAndComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;|&#8212;/g, '—')
    .replace(/&ndash;|&#8211;/g, '–')
    .replace(/&rsquo;|&#8217;/g, '’');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
