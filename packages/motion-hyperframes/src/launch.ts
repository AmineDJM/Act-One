import { emphasisIn } from '@act-one/core';
import { contrastRatio, ensureContrast, fitToLines, hexToRgb, measureText, mix, rgbToHex, type DesignTokens } from '@act-one/design';
import type { StagedAsset } from './assets.ts';
import { escapeHtml } from './captions.ts';
import { shotOf } from './fallback.ts';
import { cssColour } from './tokens.ts';
import type { FilmedSequence, Rect } from './ui-sequence.ts';
import type { ScenePacket } from './types.ts';

/**
 * The launch look: the film as a motion designer would cut it.
 *
 * The classic composition is the Remotion engine's components drawn by
 * another renderer, and it is restrained on purpose: type on a dark field,
 * a camera on a still, a cut. Measured against the launch films customers
 * compare us with, that restraint reads as a slideshow — two per cent of the
 * frame in a vivid colour where they carry twenty, a hard cut every 1.4
 * seconds where theirs flow, and nothing moving inside a shot but the camera.
 *
 * This look keeps the storyboard exactly — its beats, words, pictures, planned
 * framings and timing — and changes how each beat is staged:
 *
 * - One continuous backdrop under every scene, in three acts: a night field
 *   for the opening problem, a light field for the product, the brand's own
 *   colour for the close. Scenes are transparent over it, so a cut between
 *   two scenes changes what stands in the frame, never the frame itself.
 * - Every element arrives and leaves on its own: words resolve out of a blur,
 *   the opening line is typed, a capture lands on a tilted card and the
 *   storyboard's camera moves inside it, rings open around a chapter's word,
 *   a list becomes connected chips, the close's mark gathers its orbit.
 * - One word of every line is the line's accent: italic, in the brand's
 *   colour, underlined as it lands.
 *
 * No element keeps a CSS filter at rest. HyperFrames captures frames through
 * the compositor, and a page carrying some forty filtered layers — hidden
 * ones included, and every scene of a film is in the page at once — captures
 * black. A word's blur is its text shadow, which is painted, not composited.
 *
 * Nothing here is written by a model and nothing costs anything to draw.
 */
export type LaunchAct = 'night' | 'day' | 'brand';

export type LaunchBeat = {
  act: LaunchAct;
  /** The film's first beat, and a line of type: it opens on a burst of light and is typed. */
  opener: boolean;
  /** A short line between product beats, staged as a chapter card. */
  chapter: boolean;
  /** Which chapter this is, from 0, so consecutive chapters alternate sides; -1 for any other beat. */
  chapterIndex: number;
};

type Parts = { styles: string[]; markup: string[]; tweens: string[] };

type Palette = {
  ink: string;
  muted: string;
  accent: string;
  /** A card's face. */
  surface: string;
  line: string;
  glow: string;
};

/** How long a beat that leaves by a cut takes to clear. */
const EXIT_SECONDS = 0.36;

/*
 * GSAP's own curves, for the shapes Act One's runtime does not carry — it has
 * no overshoot and no symmetric cubic, and names it does not know fall back to
 * `out_quint`. These are functions of time like the runtime's, deterministic
 * under seek, and need no plugin.
 */
const OVERSHOOT = '"back.out(1.6)"';
const SWING = '"power2.inOut"';
const EASE_OUT = '"power2.out"';

const FIGURE_RECIPES: ReadonlySet<string> = new Set(['statistic_reveal', 'metric_reveal']);

/** How each beat of the film is staged, from what the beats are. */
export function planLaunch(packets: readonly ScenePacket[]): Map<string, LaunchBeat> {
  const kinds = packets.map((packet) => shotOf(packet).kind);
  const firstVisual = kinds.findIndex((kind) => kind !== 'words' && kind !== 'logo' && kind !== 'end_card');
  const plan = new Map<string, LaunchBeat>();
  let chapters = 0;
  packets.forEach((packet, index) => {
    const kind = kinds[index]!;
    const closing = kind === 'end_card' || (kind === 'logo' && index === packets.length - 1);
    // The problem is set before the product appears; a film with no pictures is all problem and close.
    const act: LaunchAct = closing ? 'brand' : firstVisual < 0 || index < firstVisual ? 'night' : 'day';
    const text = lineOf(packet);
    const words = text.split(' ').filter(Boolean).length;
    const chapter =
      kind === 'words' &&
      act === 'day' &&
      words > 0 &&
      words <= 3 &&
      !FIGURE_RECIPES.has(packet.recipe.name) &&
      packet.recipe.name !== 'quote_hold' &&
      listItems(text).length === 0;
    plan.set(packet.frameId, { act, opener: index === 0 && kind === 'words' && words > 0, chapter, chapterIndex: chapter ? chapters++ : -1 });
  });
  return plan;
}

/** How strongly each act's glows are lit; the backdrop draws them at these alphas. */
const GLOW_ALPHA: Record<LaunchAct, number> = { night: 0.36, day: 0.3, brand: 0.24 };

const NIGHT_INK = '#F4F6FB';
const DAY_INK = '#0D1117';

/** A glow taken toward its field, a step at a time, until type reads over its strongest point. */
function tamedGlow(field: string, glow: string, alpha: number, reads: (lit: string) => boolean): string {
  let colour = glow;
  for (let step = 0; step < 16 && !reads(over(field, colour, alpha)); step += 1) colour = mix(colour, field, 0.2);
  return colour;
}

/** The colours of each act, from the brand's accent. */
export function launchPalettes(design: DesignTokens): Record<LaunchAct, Palette & { base: [string, string] }> {
  const accent = cssColour(design.accent);
  const nightBase: [string, string] = [mix(accent, '#04060c', 0.9), mix(accent, '#0a1024', 0.82)];
  // A tint of the brand, not a white: the product's light is the brand's light.
  const dayBase: [string, string] = [mix(accent, '#ffffff', 0.9), mix(accent, '#f2f4fa', 0.8)];
  // A pale brand colour cannot carry white type; it is taken down until it can.
  let brandTop = accent;
  for (let step = 0; step < 12 && contrastRatio(brandTop, '#ffffff') < 3.2; step += 1) brandTop = mix(brandTop, '#000000', 0.1);
  const brandBase: [string, string] = [brandTop, mix(brandTop, '#000000', 0.38)];
  /*
   * Type sits over the glows as well as the field. Each act's glow is the
   * brand's colour taken toward the field until the act's type still reads
   * where the glow is strongest — the base with the glow laid over it at one
   * and a half times its alpha, where two glows meet — and the act's colours
   * are then held to that point. A pale brand gets a quieter night glow, a
   * dark one a quieter day glow; the type is never the one that gives way.
   */
  const nightGlow = tamedGlow(nightBase[1], accent, GLOW_ALPHA.night * 1.5, (lit) => contrastRatio(NIGHT_INK, lit) >= 9);
  const dayGlow = tamedGlow(dayBase[1], accent, GLOW_ALPHA.day * 1.5, (lit) => contrastRatio(DAY_INK, lit) >= 9);
  const nightLit = over(nightBase[1], nightGlow, GLOW_ALPHA.night * 1.5);
  const dayLit = over(dayBase[1], dayGlow, GLOW_ALPHA.day * 1.5);
  return {
    night: {
      base: nightBase,
      ink: NIGHT_INK,
      muted: 'rgba(244,246,251,0.62)',
      accent: ensureContrast(mix(accent, '#ffffff', 0.18), nightLit, 4.5),
      surface: 'rgba(255,255,255,0.06)',
      line: 'rgba(255,255,255,0.16)',
      glow: nightGlow,
    },
    day: {
      base: dayBase,
      ink: DAY_INK,
      muted: ensureContrast('#5C6473', dayLit, 4.5),
      accent: ensureContrast(accent, dayLit, 4.5),
      surface: '#FFFFFF',
      line: 'rgba(13,17,23,0.09)',
      glow: dayGlow,
    },
    brand: {
      base: brandBase,
      ink: '#FFFFFF',
      muted: 'rgba(255,255,255,0.78)',
      accent: '#FFFFFF',
      surface: 'rgba(255,255,255,0.14)',
      line: 'rgba(255,255,255,0.28)',
      glow: '#FFFFFF',
    },
  };
}

/** How a beat is staged: what its words are, or what its picture is. */
type Staging = 'headline' | 'chapter' | 'list' | 'metric' | 'quote' | 'product' | 'mark';

function stagingOf(packet: ScenePacket, beat: LaunchBeat): Staging {
  const shot = shotOf(packet);
  switch (shot.kind) {
    case 'words':
      if (FIGURE_RECIPES.has(packet.recipe.name)) return 'metric';
      if (packet.recipe.name === 'quote_hold') return 'quote';
      if (listItems(lineOf(packet)).length >= 2) return 'list';
      return beat.chapter ? 'chapter' : 'headline';
    case 'logo':
    case 'end_card':
      return 'mark';
    default:
      return 'product';
  }
}

/** When a beat's first element moves, in seconds after the beat starts: a breath after the cut, or the recipe's own delay. */
function entranceOf(packet: ScenePacket, staging: Staging): number {
  switch (staging) {
    case 'chapter':
      return 0.04;
    case 'mark':
      return 0.05;
    case 'headline':
      return Math.max(0.06, packet.recipe.delaySeconds);
    case 'product':
      return Math.max(0.04, packet.recipe.delaySeconds);
    default:
      return Math.max(0.05, packet.recipe.delaySeconds);
  }
}

/** The scene, as the launch look stages it. */
export function launchScene(packet: ScenePacket, design: DesignTokens, beat: LaunchBeat): string {
  const id = packet.frameId;
  const palette = launchPalettes(design)[beat.act];
  const parts: Parts = { styles: [], markup: [], tweens: [] };
  const shot = shotOf(packet);

  switch (stagingOf(packet, beat)) {
    case 'metric':
      metricScene(packet, design, palette, parts);
      break;
    case 'quote':
      quoteScene(packet, design, palette, parts);
      break;
    case 'list':
      listScene(packet, design, palette, parts, listItems(lineOf(packet)));
      break;
    case 'chapter':
      chapterScene(packet, design, palette, parts, beat.chapterIndex);
      break;
    case 'headline':
      headlineScene(packet, design, palette, parts, beat.opener);
      break;
    case 'mark':
      markScene(packet, design, palette, parts, shot.kind === 'end_card' || packet.isFinalScene);
      break;
    case 'product':
      if (shot.kind === 'ui') productScene(packet, design, palette, parts, { picture: shot.picture, sequence: shot.sequence });
      else if (shot.kind === 'product') productScene(packet, design, palette, parts, { picture: shot.picture });
      else if (shot.kind === 'photo') productScene(packet, design, palette, parts, { picture: shot.picture, tilt: 0.45 });
      else if (shot.kind === 'footage') productScene(packet, design, palette, parts, { picture: shot.clip, tilt: 0.3 });
      break;
  }

  // A beat that leaves by a cut clears itself, so the next one lands on an empty field; a join carries it out whole.
  const beatEnd = packet.timing.beatStart + packet.timing.beatDuration;
  if (!packet.timing.leaves && !packet.isFinalScene) {
    parts.tweens.push(
      `tl.fromTo("#${id}-content", { opacity: 1, scale: 1, y: 0 }, { opacity: 0, scale: 0.97, y: ${num(-design.frame.height * 0.012)}, duration: ${num(EXIT_SECONDS)}, ease: ActOne.ease("in_cubic"), immediateRender: false }, ${num(Math.max(0, beatEnd - EXIT_SECONDS))});`,
    );
  }

  const script = [
    'const tl = gsap.timeline({ paused: true });',
    ...parts.tweens,
    `tl.set({}, {}, ${num(packet.timing.mountedSeconds)});`,
    'window.__timelines = window.__timelines || {};',
    `window.__timelines[${JSON.stringify(id)}] = tl;`,
  ];
  return [
    '<template>',
    `<style>\n${['#root { position: absolute; inset: 0; overflow: hidden; }', `#${id}-content { position: absolute; inset: 0; transform-origin: 50% 50%; }`, ...parts.styles].join('\n')}\n</style>`,
    `<div id="root" data-composition-id="${id}" data-width="${packet.canvas.width}" data-height="${packet.canvas.height}">`,
    `<div id="${id}-content">`,
    ...parts.markup,
    '</div>',
    '</div>',
    `<script>\n${script.join('\n')}\n</script>`,
    '</template>',
  ].join('\n');
}

/**
 * The scene as its words read, for the honesty check.
 *
 * A typed line is one element per glyph, and the check, which reads every
 * tag as a word break, would read it as a string of one-letter words. The
 * glyphs are put back inside their words here; everything else is checked
 * exactly as it is drawn.
 */
export function launchReadable(html: string): string {
  return html.replace(/<span id="[\w-]+-g\d+" class="ao-g">([^<]*)<\/span>/g, '$1');
}

/*
 * ---------------------------------------------------------------------------
 * Type
 * ---------------------------------------------------------------------------
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'it', 'its', 'is', 'are', 'be', 'was',
  'must', 'as', 'by', 'from', 'that', 'thats', 'this', 'your', 'you', 'we', 'our', 'what', 'when', 'if', 'so', 'do', 'does',
  'not', 'no', 'all', 'can', 'will', 'just', 'more', 'need', 'into', 'out', 'up', 'than', 'then', 'how', 'every', 'one',
]);

/**
 * The word a line turns on.
 *
 * A figure or a name first, by the rule captions already use. Otherwise the
 * longest word that carries meaning — the noun or verb the line is about —
 * with ties going to the later one, where English puts its weight.
 */
export function accentWordOf(text: string): string | null {
  const emphasised = emphasisIn(text);
  if (emphasised) return bare(emphasised);
  let best: string | null = null;
  for (const raw of text.split(/\s+/)) {
    const word = bare(raw);
    const key = word.toLowerCase().replace(/['’]/g, '');
    if (word.length < 4 || STOP_WORDS.has(key)) continue;
    if (!best || word.length >= best.length) best = word;
  }
  return best;
}

/** A word without the punctuation around it. */
function bare(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** A scene's words as one line of plain text. */
function lineOf(packet: ScenePacket): string {
  return packet.onScreenText.join(' ').replace(/\s+/g, ' ').trim();
}

type SetText = { lines: { words: { text: string; accent: boolean }[] }[]; fontSizePx: number };

/** Lines broken to a width at a size, the accent word marked where it falls. */
function setLines(text: string, design: DesignTokens, options: { fontSizePx: number; maxWidthPx: number; maxLines: number; role: 'display' | 'statement' }): SetText {
  const token = design.type[options.role];
  const fitted = fitToLines(text, { family: token.family, fontSizePx: options.fontSizePx, tracking: token.tracking, weight: token.weight, maxWidthPx: options.maxWidthPx, maxLines: options.maxLines });
  const accent = accentWordOf(text);
  let marked = false;
  const lines = fitted.lines.map((line) => ({
    words: line.split(' ').filter(Boolean).map((word) => {
      const isAccent = !marked && accent !== null && bare(word) === accent;
      if (isAccent) marked = true;
      return { text: word, accent: isAccent };
    }),
  }));
  return { lines, fontSizePx: fitted.fontSizePx };
}

function titleCss(key: string, role: 'display' | 'statement', fontSizePx: number, palette: Palette, align: 'left' | 'center'): string[] {
  return [
    `#${key} { font-family: var(--ao-${role}-family); font-size: ${px(fontSizePx)}; font-weight: var(--ao-${role}-weight); letter-spacing: var(--ao-${role}-tracking); line-height: 1.06; color: ${palette.ink}; text-align: ${align}; text-transform: none; margin: 0; }`,
    `#${key} .ao-l { display: block; white-space: nowrap; }`,
    `#${key} .ao-wd { display: inline-block; }`,
    // The accent's underline is its own box under the word, drawn by a scale: nothing measured, nothing repainted.
    `#${key} .ao-a { position: relative; color: ${palette.accent}; font-style: italic; padding-right: 0.05em; }`,
    `#${key} .ao-u { position: absolute; left: 0; right: 0.05em; bottom: 0.02em; height: 0.07em; border-radius: 0.035em; background: ${palette.accent}; transform-origin: 0 50%; }`,
  ];
}

/**
 * Words that resolve out of a blur, one after another.
 *
 * The blur is the word's own shadow: the glyphs start transparent over a
 * soft copy of themselves, and as they rise the copy tightens and the glyphs
 * fill in. It reads as a lens pulling focus and leaves nothing composited
 * behind it.
 */
function risingTitle(key: string, set: SetText, palette: Palette, parts: Parts, at: number, stagger = 0.065): string {
  const rise = set.fontSizePx * 0.34;
  const blur = Math.max(6, set.fontSizePx * 0.16);
  let index = 0;
  const lines = set.lines.map((line) => {
    const words = line.words.map((word) => {
      index += 1;
      const wordId = `${key}-w${index}`;
      const colour = word.accent ? palette.accent : palette.ink;
      const when = at + (index - 1) * stagger;
      parts.tweens.push(
        `tl.fromTo("#${wordId}", { opacity: 0, y: ${num(rise)}, color: "${rgba(colour, 0)}", textShadow: "${rgba(colour, 0.85)} 0px 0px ${num(blur)}px" }, { opacity: 1, y: 0, color: "${rgba(colour, 1)}", textShadow: "${rgba(colour, 0)} 0px 0px 0px", duration: 0.7, ease: ActOne.ease("out_expo") }, ${num(when)});`,
      );
      if (word.accent) parts.tweens.push(underline(`#${wordId}-u`, when + 0.38));
      return `<span id="${wordId}" class="${word.accent ? 'ao-a ' : ''}ao-wd">${escapeHtml(word.text)}${word.accent ? `<span id="${wordId}-u" class="ao-u"></span>` : ''}</span>`;
    });
    return `<span class="ao-l">${words.join(' ')}</span>`;
  });
  return lines.join('');
}

function underline(selector: string, at: number): string {
  return `tl.fromTo("${selector}", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: ActOne.ease("out_quint") }, ${num(at)});`;
}

/**
 * The opening line, typed.
 *
 * The line is laid out whole from the first frame and its glyphs appear one
 * after another, so nothing reflows while it types. The caret is the right
 * border of the glyph typed last, pulled back into it by a margin of the same
 * width: it moves with the text without a width being measured or guessed.
 */
function typedTitle(key: string, set: SetText, palette: Palette, parts: Parts, at: number, perGlyph = 0.045): string {
  const caret = Math.max(2, set.fontSizePx * 0.05);
  const on = rgba(palette.accent, 1);
  const off = rgba(palette.accent, 0);
  parts.styles.push(`#${key} .ao-g { opacity: 0; border-right: ${px(caret)} solid ${off}; margin-right: ${px(-caret)}; }`);
  let glyph = 0;
  let time = at;
  let previous: string | null = null;
  let accentTyped: number | null = null;
  const html = set.lines.map((line) => {
    const words = line.words.map((word, wordIndex) => {
      if (wordIndex > 0) time += perGlyph;
      const glyphs = [...word.text].map((char) => {
        glyph += 1;
        const glyphId = `${key}-g${glyph}`;
        parts.tweens.push(`tl.fromTo("#${glyphId}", { opacity: 0, borderRightColor: "${off}" }, { opacity: 1, borderRightColor: "${on}", duration: 0.001, ease: "none" }, ${num(time)});`);
        if (previous) parts.tweens.push(`tl.fromTo("#${previous}", { borderRightColor: "${on}" }, { borderRightColor: "${off}", duration: 0.001, ease: "none", immediateRender: false }, ${num(time)});`);
        previous = glyphId;
        time += perGlyph;
        return `<span id="${glyphId}" class="ao-g">${escapeHtml(char)}</span>`;
      });
      if (word.accent) accentTyped = time;
      return word.accent ? `<span id="${key}-acc" class="ao-a">${glyphs.join('')}<span id="${key}-acc-u" class="ao-u"></span></span>` : glyphs.join('');
    });
    return `<span class="ao-l">${words.join(' ')}</span>`;
  });
  if (previous) {
    // The caret blinks twice where the line ends, then goes.
    [0.35, 1.05, 1.75].forEach((offset) => parts.tweens.push(`tl.fromTo("#${previous}", { borderRightColor: "${on}" }, { borderRightColor: "${off}", duration: 0.001, ease: "none", immediateRender: false }, ${num(time + offset)});`));
    [0.7, 1.4].forEach((offset) => parts.tweens.push(`tl.fromTo("#${previous}", { borderRightColor: "${off}" }, { borderRightColor: "${on}", duration: 0.001, ease: "none", immediateRender: false }, ${num(time + offset)});`));
  }
  if (accentTyped !== null) parts.tweens.push(underline(`#${key}-acc-u`, accentTyped + 0.05));
  return html.join('');
}

/** The brand's name, small and spaced, between two short rules: the one label the film is allowed to add. */
function eyebrow(key: string, packet: ScenePacket, palette: Palette, parts: Parts, at: number, H: number, align: 'center' | 'left'): string {
  parts.styles.push(
    `#${key} { display: flex; align-items: center; justify-content: ${align === 'center' ? 'center' : 'flex-start'}; gap: ${px(H * 0.014)}; font-family: var(--ao-body-family); font-weight: 600; font-size: ${px(H * 0.02)}; letter-spacing: 0.3em; text-transform: uppercase; color: ${palette.muted}; margin-bottom: ${px(H * 0.028)}; }`,
    `#${key} .ao-rule { width: ${px(H * 0.04)}; height: ${px(Math.max(1, H * 0.0012))}; background: ${palette.accent}; }`,
  );
  parts.tweens.push(`tl.fromTo("#${key}", { opacity: 0, y: ${num(H * 0.012)} }, { opacity: 1, y: 0, duration: 0.6, ease: ActOne.ease("out_quint") }, ${num(at)});`);
  const rule = '<span class="ao-rule"></span>';
  return `<div id="${key}">${align === 'center' ? rule : ''}<span>${escapeHtml(packet.brand.name)}</span>${rule}</div>`;
}

/** A short accent rule that draws itself above a line of type. */
function accentRule(key: string, palette: Palette, parts: Parts, at: number, H: number, align: 'center' | 'left'): string {
  parts.styles.push(
    `#${key} { width: ${px(H * 0.06)}; height: ${px(Math.max(3, H * 0.0045))}; border-radius: 999px; background: ${palette.accent}; margin: 0 ${align === 'center' ? 'auto' : '0'} ${px(H * 0.03)}; transform-origin: ${align === 'center' ? '50%' : '0%'} 50%; }`,
  );
  parts.tweens.push(`tl.fromTo("#${key}", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: ActOne.ease("out_expo") }, ${num(at)});`);
  return `<div id="${key}"></div>`;
}

/*
 * ---------------------------------------------------------------------------
 * Beats
 * ---------------------------------------------------------------------------
 */

function headlineScene(packet: ScenePacket, design: DesignTokens, palette: Palette, parts: Parts, opener: boolean): void {
  const id = packet.frameId;
  const { width: W, height: H } = design.frame;
  const text = lineOf(packet);
  if (!text) return;
  const portrait = H > W;
  const set = setLines(text, design, { fontSizePx: H * (portrait ? 0.066 : 0.104), maxWidthPx: design.grid.safe.width * (portrait ? 0.96 : 0.84), maxLines: 3, role: 'display' });
  const start = packet.timing.beatStart + entranceOf(packet, 'headline');

  parts.styles.push(
    `#${id}-stage { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 ${px(design.grid.safe.x)}; }`,
    ...titleCss(`${id}-title`, 'display', set.fontSizePx, palette, 'center'),
    `#${id}-halo { position: absolute; left: ${px(W * 0.1)}; top: ${px(H * 0.05)}; width: ${px(W * 0.8)}; height: ${px(H * 0.9)}; background: radial-gradient(closest-side, ${hexAlpha(palette.glow, 0.26)}, ${hexAlpha(palette.glow, 0)}); opacity: 0; }`,
  );
  parts.tweens.push(`tl.fromTo("#${id}-halo", { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 1.4, ease: ActOne.ease("out_quint") }, ${num(start)});`);

  let titleHtml: string;
  let label = '';
  if (opener) {
    burst(packet, design, palette, parts, start);
    label = eyebrow(`${id}-eyebrow`, packet, palette, parts, start + 0.2, H, 'center');
    titleHtml = typedTitle(`${id}-title`, set, palette, parts, start + 0.35);
  } else {
    titleHtml = risingTitle(`${id}-title`, set, palette, parts, start);
  }
  parts.markup.push(`<div id="${id}-halo"></div>`, `<div id="${id}-stage">${label}<h1 id="${id}-title">${titleHtml}</h1></div>`);
}

/** A short line between product beats: a word beside opening rings, alternating sides from one chapter to the next. */
function chapterScene(packet: ScenePacket, design: DesignTokens, palette: Palette, parts: Parts, chapterIndex: number): void {
  const id = packet.frameId;
  const { width: W, height: H } = design.frame;
  const portrait = H > W;
  const ringsLeft = chapterIndex % 2 === 0;
  const text = lineOf(packet);
  const set = setLines(text, design, { fontSizePx: H * (portrait ? 0.08 : 0.12), maxWidthPx: portrait ? design.grid.safe.width : W * 0.44, maxLines: 2, role: 'display' });
  const start = packet.timing.beatStart + entranceOf(packet, 'chapter');
  const cx = portrait ? W / 2 : ringsLeft ? W * 0.29 : W * 0.71;
  const cy = portrait ? H * 0.36 : H / 2;
  const radii = [0.13, 0.2, 0.28, 0.37].map((share) => share * H);

  parts.styles.push(
    `.${id}-ring { position: absolute; border-radius: 50%; border: ${px(Math.max(1, H * 0.0014))} solid ${hexAlpha(palette.accent, 0.4)}; }`,
    `#${id}-core { position: absolute; left: ${px(cx - radii[0]! * 0.62)}; top: ${px(cy - radii[0]! * 0.62)}; width: ${px(radii[0]! * 1.24)}; height: ${px(radii[0]! * 1.24)}; border-radius: 50%; background: radial-gradient(circle at 35% 30%, ${hexAlpha('#ffffff', 0.2)}, ${hexAlpha('#ffffff', 0)} 62%), ${palette.accent}; box-shadow: 0 0 0 ${px(H * 0.012)} ${hexAlpha(palette.accent, 0.16)}, 0 ${px(H * 0.02)} ${px(H * 0.06)} ${hexAlpha(palette.accent, 0.35)}; }`,
    `#${id}-pulse { position: absolute; left: ${px(cx - radii[0]!)}; top: ${px(cy - radii[0]!)}; width: ${px(radii[0]! * 2)}; height: ${px(radii[0]! * 2)}; border-radius: 50%; border: ${px(Math.max(2, H * 0.003))} solid ${palette.accent}; opacity: 0; }`,
    portrait
      ? `#${id}-text { position: absolute; left: ${px(design.grid.safe.x)}; right: ${px(design.grid.safe.x)}; top: ${px(H * 0.62)}; }`
      : `#${id}-text { position: absolute; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; ${ringsLeft ? `left: ${px(W * 0.5)}; right: ${px(design.grid.safe.x)};` : `left: ${px(design.grid.safe.x)}; right: ${px(W * 0.5)};`} }`,
    ...titleCss(`${id}-title`, 'display', set.fontSizePx, palette, portrait ? 'center' : 'left'),
  );
  const rings = radii.map((radius, index) => {
    parts.styles.push(`#${id}-ring${index + 1} { left: ${px(cx - radius)}; top: ${px(cy - radius)}; width: ${px(radius * 2)}; height: ${px(radius * 2)}; opacity: 0; }`);
    parts.tweens.push(`tl.fromTo("#${id}-ring${index + 1}", { scale: 0.35, opacity: 0 }, { scale: 1, opacity: ${num(0.9 - index * 0.2)}, duration: 0.9, ease: ActOne.ease("out_expo") }, ${num(start + index * 0.07)});`);
    return `<div id="${id}-ring${index + 1}" class="${id}-ring"></div>`;
  });
  parts.tweens.push(
    `tl.fromTo("#${id}-core", { scale: 0 }, { scale: 1, duration: 0.7, ease: ${OVERSHOOT} }, ${num(start + 0.12)});`,
    `tl.fromTo("#${id}-pulse", { scale: 1, opacity: 0.7 }, { scale: 2.6, opacity: 0, duration: 1.1, ease: ${EASE_OUT} }, ${num(start + 0.3)});`,
  );
  const label = eyebrow(`${id}-eyebrow`, packet, palette, parts, start + 0.18, H, portrait ? 'center' : 'left');
  const title = risingTitle(`${id}-title`, set, palette, parts, start + 0.22, 0.08);
  parts.markup.push(...rings, `<div id="${id}-pulse"></div>`, `<div id="${id}-core"></div>`, `<div id="${id}-text">${label}<h1 id="${id}-title">${title}</h1></div>`);
}

type CardPicture = {
  picture: StagedAsset;
  /** The storyboard's framings of a capture: the card holds them, one after another, with their moves. */
  sequence?: FilmedSequence;
  /** How far the card turns, 1 for a capture of the product. */
  tilt?: number;
};

/**
 * A capture on a card: tilted in depth, lit from behind by the brand, and
 * drifting while it is read. A filmed capture keeps its planned camera inside
 * the card. A line of short items becomes a column of chips wired into it.
 */
function productScene(packet: ScenePacket, design: DesignTokens, palette: Palette, parts: Parts, card: CardPicture): void {
  const id = packet.frameId;
  const { width: W, height: H } = design.frame;
  const portrait = H > W;
  const tilt = card.tilt ?? 1;
  const { picture, sequence } = card;
  const text = lineOf(packet);
  const items = listItems(text);
  const start = packet.timing.beatStart + entranceOf(packet, 'product');
  const beatEnd = packet.timing.beatStart + packet.timing.beatDuration;

  // The framings were planned at the frame's proportions; any other picture keeps its own, within reason.
  const own = picture.width && picture.height ? picture.height / picture.width : 0.625;
  const aspect = sequence ? H / W : Math.min(0.75, Math.max(0.5, own));
  let cardW = portrait ? design.grid.safe.width : W * 0.56;
  let cardH = cardW * aspect;
  const maxH = portrait ? H * 0.44 : H * 0.72;
  if (cardH > maxH) {
    cardH = maxH;
    cardW = cardH / aspect;
  }
  const cardX = portrait ? (W - cardW) / 2 : W - design.grid.safe.x * 0.7 - cardW;
  const cardY = portrait ? H * 0.47 : (H - cardH) / 2 + H * 0.02;
  const radius = Math.max(design.radius.lg, H * 0.014);

  parts.styles.push(
    `#${id}-glow { position: absolute; left: ${px(cardX - cardW * 0.25)}; top: ${px(cardY - cardH * 0.3)}; width: ${px(cardW * 1.5)}; height: ${px(cardH * 1.6)}; background: radial-gradient(closest-side, ${hexAlpha(palette.glow, 0.34)}, ${hexAlpha(palette.glow, 0)}); opacity: 0; }`,
    `#${id}-space { position: absolute; left: ${px(cardX)}; top: ${px(cardY)}; width: ${px(cardW)}; height: ${px(cardH)}; perspective: ${px(H * 2)}; }`,
    `#${id}-card { position: absolute; inset: 0; border-radius: ${px(radius)}; overflow: hidden; background: ${palette.surface}; border: 1px solid ${palette.line}; box-shadow: 0 ${px(H * 0.035)} ${px(H * 0.09)} rgba(8,12,24,0.28), 0 ${px(H * 0.006)} ${px(H * 0.016)} rgba(8,12,24,0.12); transform-origin: 50% 50%; opacity: 0; }`,
    `#${id}-shine { position: absolute; top: -20%; bottom: -20%; left: 0; width: 38%; background: linear-gradient(100deg, rgba(255,255,255,0), rgba(255,255,255,0.32), rgba(255,255,255,0)); opacity: 0; }`,
  );
  const media = sequence
    ? framedPlate(packet, sequence, picture, { width: cardW, height: cardH }, parts)
    : picture.kind === 'video'
      ? `<video id="${id}-media" class="clip" src="${picture.path}" muted playsinline data-start="0" data-duration="${num(packet.timing.mountedSeconds)}" data-track-index="1"></video>`
      : `<img id="${id}-media" src="${picture.path}" alt="">`;
  if (!sequence) parts.styles.push(`#${id}-media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; }`);
  parts.markup.push(`<div id="${id}-glow"></div>`, `<div id="${id}-space"><div id="${id}-card">${media}<div id="${id}-shine"></div></div></div>`);

  const settle = Math.max(0.8, Math.min(1.1, packet.timing.beatDuration * 0.45));
  parts.tweens.push(
    `tl.fromTo("#${id}-glow", { opacity: 0, scale: 0.75 }, { opacity: 1, scale: 1, duration: 1.2, ease: ActOne.ease("out_quint") }, ${num(start)});`,
    `tl.fromTo("#${id}-card", { rotationY: ${num(-24 * tilt)}, rotationX: ${num(12 * tilt)}, y: ${num(H * 0.08)}, scale: 0.9, opacity: 0 }, { rotationY: ${num(-10 * tilt)}, rotationX: ${num(5 * tilt)}, y: 0, scale: 1, opacity: 1, duration: ${num(settle)}, ease: ActOne.ease("out_expo") }, ${num(start)});`,
    // While it is read, it keeps turning toward the viewer: a held card that still breathes.
    `tl.fromTo("#${id}-card", { rotationY: ${num(-10 * tilt)}, rotationX: ${num(5 * tilt)}, y: 0 }, { rotationY: ${num(-4 * tilt)}, rotationX: ${num(2 * tilt)}, y: ${num(-H * 0.012)}, duration: ${num(Math.max(0.3, beatEnd - start - settle))}, ease: "none", immediateRender: false }, ${num(start + settle + 0.002)});`,
    `tl.fromTo("#${id}-shine", { x: ${num(-cardW * 0.5)}, opacity: 1 }, { x: ${num(cardW * 1.3)}, opacity: 1, duration: 0.9, ease: ${SWING} }, ${num(start + settle * 0.55)});`,
  );

  if (!text) return;
  const colW = portrait ? design.grid.safe.width : cardX - design.grid.safe.x - W * 0.04;
  const colX = design.grid.safe.x;
  if (items.length >= 2 && !portrait) {
    chips(packet, design, palette, parts, items, { x: colX, width: colW, cardX, cardY, cardH, start });
    return;
  }
  const set = setLines(text, design, { fontSizePx: H * (portrait ? 0.05 : 0.066), maxWidthPx: colW, maxLines: 3, role: 'display' });
  parts.styles.push(
    portrait
      ? `#${id}-words { position: absolute; left: ${px(colX)}; width: ${px(colW)}; top: ${px(H * 0.16)}; }`
      : `#${id}-words { position: absolute; left: ${px(colX)}; width: ${px(colW)}; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }`,
    ...titleCss(`${id}-title`, 'display', set.fontSizePx, palette, portrait ? 'center' : 'left'),
  );
  const rule = accentRule(`${id}-rule`, palette, parts, start + 0.1, H, portrait ? 'center' : 'left');
  parts.markup.push(`<div id="${id}-words">${rule}<h1 id="${id}-title">${risingTitle(`${id}-title`, set, palette, parts, start + 0.15)}</h1></div>`);
}

/**
 * The storyboard's camera on a capture, inside the card.
 *
 * Each framing is a crop of the capture at the frame's proportions, moving
 * from one crop to another over its seconds; the card shows exactly the crop
 * the frame would have filled, smaller. The crop is interpolated as the
 * Remotion engine interpolates it — the rectangle, not the transform — so a
 * push lands where it was planned to.
 */
function framedPlate(packet: ScenePacket, sequence: FilmedSequence, picture: StagedAsset, card: { width: number; height: number }, parts: Parts): string {
  const id = packet.frameId;
  const token = idVar(id);
  const mounted = packet.timing.mountedSeconds;
  const plateHeight = card.width * (sequence.sourceHeight / sequence.sourceWidth);
  parts.styles.push(`#${id}-plate { position: absolute; left: 0; top: 0; width: ${px(card.width)}; height: ${px(plateHeight)}; max-width: none; display: block; transform-origin: 0 0; }`);
  parts.tweens.push(
    `var ${token}Plate = document.getElementById(${JSON.stringify(`${id}-plate`)});`,
    `function ${token}Crop(from, to, t) {`,
    `  var x = from[0] + (to[0] - from[0]) * t, y = from[1] + (to[1] - from[1]) * t, w = Math.max(0.02, from[2] + (to[2] - from[2]) * t);`,
    `  var s = 1 / w;`,
    `  ${token}Plate.style.transform = "translate(" + (-x * ${num(card.width)} * s) + "px, " + (-y * ${num(plateHeight)} * s) + "px) scale(" + s + ")";`,
    `}`,
  );
  let cursor = 0;
  sequence.framings.forEach((framing, index) => {
    const at = cursor;
    cursor += framing.seconds;
    if (at >= mounted - 0.001) return;
    const state = `${token}F${index + 1}`;
    const curve = framing.move === 'lateral' || framing.move === 'hold' ? 'linear' : packet.recipe.easing;
    parts.tweens.push(
      `var ${state} = { t: 0 };`,
      `tl.fromTo(${state}, { t: 0 }, { t: 1, duration: ${num(Math.min(framing.seconds, mounted - at))}, ease: ActOne.ease(${JSON.stringify(curve)}), onUpdate: function () { ${token}Crop(${rectArray(framing.from)}, ${rectArray(framing.to)}, ${state}.t); }, immediateRender: ${index === 0} }, ${num(at)});`,
    );
    if (index === 0) parts.tweens.push(`${token}Crop(${rectArray(framing.from)}, ${rectArray(framing.to)}, 0);`);
  });
  return `<img id="${id}-plate" src="${picture.path}" alt="">`;
}

/** "Launcher. Tasks. Tray. Files." as the things they are: short items, each a chip. */
export function listItems(text: string): string[] {
  const items = text.split(/(?<=[.;·•|])\s+/).map((item) => item.replace(/[.;·•|]+$/, '').trim()).filter(Boolean);
  if (items.length < 2 || items.length > 6) return [];
  return items.every((item) => item.split(/\s+/).length <= 3) ? items : [];
}

/** Chips beside a card, each wired to where it lands on the card. */
function chips(
  packet: ScenePacket,
  design: DesignTokens,
  palette: Palette,
  parts: Parts,
  items: string[],
  frame: { x: number; width: number; cardX: number; cardY: number; cardH: number; start: number },
): void {
  const id = packet.frameId;
  const { height: H } = design.frame;
  const size = H * 0.04;
  const chipH = size * 2.2;
  const gap = H * 0.024;
  const total = items.length * chipH + (items.length - 1) * gap;
  const top = frame.cardY + frame.cardH / 2 - total / 2;
  const chipW = Math.min(frame.width * 0.8, chipWidth(items, design, size));
  parts.styles.push(...chipCss(id, design, palette, size, chipH), `#${id}-wires { position: absolute; left: 0; top: 0; overflow: visible; }`);
  const wires: string[] = [];
  items.forEach((item, index) => {
    const y = top + index * (chipH + gap);
    const at = frame.start + 0.12 + index * 0.14;
    parts.styles.push(`#${id}-chip${index + 1} { left: ${px(frame.x)}; top: ${px(y)}; width: ${px(chipW)}; }`);
    parts.markup.push(chipMarkup(id, index, item));
    parts.tweens.push(`tl.fromTo("#${id}-chip${index + 1}", { opacity: 0, x: ${num(-H * 0.04)}, scale: 0.94 }, { opacity: 1, x: 0, scale: 1, duration: 0.55, ease: ActOne.ease("out_expo") }, ${num(at)});`);
    // A wire from the chip to where it lands on the card, drawn once the chip is there.
    const x1 = frame.x + chipW;
    const y1 = y + chipH / 2;
    const x2 = frame.cardX + H * 0.02;
    const y2 = frame.cardY + frame.cardH * (0.22 + (0.56 * index) / Math.max(1, items.length - 1));
    const mid = (x1 + x2) / 2;
    wires.push(wire(`${id}-wire${index + 1}`, `M${num(x1)} ${num(y1)} C${num(mid)} ${num(y1)} ${num(mid)} ${num(y2)} ${num(x2)} ${num(y2)}`, Math.hypot(x2 - x1, y2 - y1) * 1.25, palette, H, parts, at + 0.3));
    wires.push(`<circle id="${id}-node${index + 1}" cx="${num(x2)}" cy="${num(y2)}" r="${num(H * 0.006)}" fill="${palette.accent}" opacity="0"/>`);
    parts.tweens.push(`tl.fromTo("#${id}-node${index + 1}", { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.3, ease: ${OVERSHOOT}, transformOrigin: "50% 50%" }, ${num(at + 0.85)});`);
  });
  parts.markup.push(`<svg id="${id}-wires" width="${design.frame.width}" height="${H}" viewBox="0 0 ${design.frame.width} ${H}">${wires.join('')}</svg>`);
}

/**
 * A line of short items with no picture: the items as chips in a row, joined
 * by wires a signal runs along, one after another.
 */
function listScene(packet: ScenePacket, design: DesignTokens, palette: Palette, parts: Parts, items: string[]): void {
  const id = packet.frameId;
  const { width: W, height: H } = design.frame;
  const size = H * (H > W ? 0.03 : 0.036);
  const chipH = size * 2.3;
  const chipW = chipWidth(items, design, size);
  const gapRow = H * 0.07;
  const rowWidth = items.length * chipW + (items.length - 1) * gapRow;
  const row = rowWidth <= design.grid.safe.width;
  const gapColumn = H * 0.05;
  const start = packet.timing.beatStart + entranceOf(packet, 'list');
  parts.styles.push(
    ...chipCss(id, design, palette, size, chipH),
    `#${id}-wires { position: absolute; left: 0; top: 0; overflow: visible; }`,
    `#${id}-halo { position: absolute; left: ${px(W * 0.15)}; top: ${px(H * 0.1)}; width: ${px(W * 0.7)}; height: ${px(H * 0.8)}; background: radial-gradient(closest-side, ${hexAlpha(palette.glow, 0.2)}, ${hexAlpha(palette.glow, 0)}); opacity: 0; }`,
  );
  parts.markup.push(`<div id="${id}-halo"></div>`);
  parts.tweens.push(`tl.fromTo("#${id}-halo", { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 1.2, ease: ActOne.ease("out_quint") }, ${num(start)});`);
  const centres: { x: number; y: number }[] = [];
  items.forEach((item, index) => {
    const x = row ? (W - rowWidth) / 2 + index * (chipW + gapRow) : (W - chipW) / 2;
    const y = row ? (H - chipH) / 2 : (H - (items.length * chipH + (items.length - 1) * gapColumn)) / 2 + index * (chipH + gapColumn);
    centres.push({ x: x + chipW / 2, y: y + chipH / 2 });
    const at = start + index * 0.16;
    parts.styles.push(`#${id}-chip${index + 1} { left: ${px(x)}; top: ${px(y)}; width: ${px(chipW)}; }`);
    parts.markup.push(chipMarkup(id, index, item));
    parts.tweens.push(`tl.fromTo("#${id}-chip${index + 1}", { opacity: 0, y: ${num(H * 0.03)}, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: ${OVERSHOOT} }, ${num(at)});`);
  });
  const wires: string[] = [];
  for (let index = 1; index < centres.length; index += 1) {
    const a = centres[index - 1]!;
    const b = centres[index]!;
    const x1 = row ? a.x + chipW / 2 : a.x;
    const y1 = row ? a.y : a.y + chipH / 2;
    const x2 = row ? b.x - chipW / 2 : b.x;
    const y2 = row ? b.y : b.y - chipH / 2;
    const at = start + index * 0.16 + 0.1;
    wires.push(wire(`${id}-wire${index}`, `M${num(x1)} ${num(y1)} L${num(x2)} ${num(y2)}`, Math.hypot(x2 - x1, y2 - y1), palette, H, parts, at));
    // The signal: a dot that runs the wire once it is drawn.
    wires.push(`<circle id="${id}-pulse${index}" cx="${num(x1)}" cy="${num(y1)}" r="${num(H * 0.0055)}" fill="${palette.accent}" opacity="0"/>`);
    parts.tweens.push(
      `tl.fromTo("#${id}-pulse${index}", { opacity: 0, x: 0, y: 0 }, { opacity: 1, x: ${num(x2 - x1)}, y: ${num(y2 - y1)}, duration: 0.5, ease: ${SWING} }, ${num(at + 0.45)});`,
      `tl.fromTo("#${id}-pulse${index}", { opacity: 1 }, { opacity: 0, duration: 0.15, ease: "none", immediateRender: false }, ${num(at + 0.95)});`,
    );
  }
  parts.markup.push(`<svg id="${id}-wires" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${wires.join('')}</svg>`);
}

function chipWidth(items: readonly string[], design: DesignTokens, size: number): number {
  const token = design.type.statement;
  const widest = Math.max(...items.map((item) => measureText(item, { family: token.family, fontSizePx: size, tracking: token.tracking, weight: 600 })));
  // Room for the dot and the padding, and a margin for the measurement's approximation.
  return widest * 1.04 + size * 3.4;
}

function chipCss(id: string, design: DesignTokens, palette: Palette, size: number, chipH: number): string[] {
  const { height: H } = design.frame;
  return [
    `.${id}-chip { position: absolute; height: ${px(chipH)}; display: flex; align-items: center; gap: ${px(size * 0.6)}; padding: 0 ${px(size * 0.8)}; border-radius: ${px(chipH / 2)}; background: ${palette.surface}; border: 1px solid ${palette.line}; box-shadow: 0 ${px(H * 0.008)} ${px(H * 0.024)} rgba(8,12,24,0.1); font-family: var(--ao-statement-family); font-weight: 600; font-size: ${px(size)}; color: ${palette.ink}; white-space: nowrap; opacity: 0; }`,
    `.${id}-dot { width: ${px(size * 0.5)}; height: ${px(size * 0.5)}; border-radius: 50%; background: ${palette.accent}; box-shadow: 0 0 0 ${px(size * 0.22)} ${hexAlpha(palette.accent, 0.18)}; flex: none; }`,
  ];
}

function chipMarkup(id: string, index: number, item: string): string {
  return `<div id="${id}-chip${index + 1}" class="${id}-chip"><span class="${id}-dot"></span><span>${escapeHtml(item)}</span></div>`;
}

/** A wire that draws itself along its path. */
function wire(key: string, d: string, length: number, palette: Palette, H: number, parts: Parts, at: number): string {
  parts.tweens.push(`tl.fromTo("#${key}", { strokeDashoffset: ${num(length)} }, { strokeDashoffset: 0, duration: 0.6, ease: ${SWING} }, ${num(at)});`);
  return `<path id="${key}" d="${d}" fill="none" stroke="${hexAlpha(palette.accent, 0.55)}" stroke-width="${num(Math.max(1.5, H * 0.0018))}" stroke-linecap="round" stroke-dasharray="${num(length)}" stroke-dashoffset="${num(length)}"/>`;
}

/** A figure that counts, on a card, with bars that grow beside it. */
function metricScene(packet: ScenePacket, design: DesignTokens, palette: Palette, parts: Parts): void {
  const id = packet.frameId;
  const { width: W, height: H } = design.frame;
  const [value = '', ...rest] = packet.onScreenText;
  const caption = rest.join(' ');
  const start = packet.timing.beatStart + entranceOf(packet, 'metric');
  const counting = countable(value.trim());
  const cardW = Math.min(W * 0.62, design.grid.safe.width);
  const cardH = H * 0.46;
  parts.styles.push(
    `#${id}-card { position: absolute; left: ${px((W - cardW) / 2)}; top: ${px((H - cardH) / 2)}; width: ${px(cardW)}; height: ${px(cardH)}; border-radius: ${px(H * 0.03)}; background: ${palette.surface}; border: 1px solid ${palette.line}; box-shadow: 0 ${px(H * 0.03)} ${px(H * 0.08)} rgba(8,12,24,0.18); display: flex; align-items: center; justify-content: space-between; padding: 0 ${px(cardW * 0.08)}; opacity: 0; }`,
    `#${id}-figure { font-family: var(--ao-display-family); font-weight: var(--ao-display-weight); font-size: ${px(H * 0.15)}; letter-spacing: -0.03em; line-height: 1; color: ${palette.accent}; font-variant-numeric: tabular-nums; white-space: nowrap; }`,
    `#${id}-caption { margin-top: ${px(H * 0.02)}; font-family: var(--ao-body-family); font-size: ${px(H * 0.03)}; color: ${palette.muted}; max-width: ${px(cardW * 0.5)}; }`,
    `#${id}-bars { display: flex; align-items: flex-end; gap: ${px(H * 0.008)}; height: ${px(cardH * 0.5)}; }`,
    `.${id}-bar { width: ${px(H * 0.016)}; border-radius: ${px(H * 0.006)}; background: linear-gradient(${palette.accent}, ${hexAlpha(palette.accent, 0.35)}); transform-origin: 50% 100%; }`,
  );
  const bars = Array.from({ length: 12 }, (_, index) => {
    const share = 0.28 + 0.72 * ((index + 1) / 12) ** 1.4;
    parts.styles.push(`#${id}-bar${index + 1} { height: ${px(cardH * 0.5 * share)}; }`);
    parts.tweens.push(`tl.fromTo("#${id}-bar${index + 1}", { scaleY: 0 }, { scaleY: 1, duration: 0.55, ease: ActOne.ease("out_expo") }, ${num(start + 0.25 + index * 0.045)});`);
    return `<div id="${id}-bar${index + 1}" class="${id}-bar"></div>`;
  });
  const shown = counting ? `${counting.prefix}${formatLike(counting.digits, 0)}${counting.suffix}` : value;
  parts.markup.push(`<div id="${id}-card"><div><div id="${id}-figure">${escapeHtml(shown)}</div>${caption ? `<div id="${id}-caption">${escapeHtml(caption)}</div>` : ''}</div><div id="${id}-bars">${bars.join('')}</div></div>`);
  parts.tweens.push(`tl.fromTo("#${id}-card", { opacity: 0, y: ${num(H * 0.05)}, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: ActOne.ease("out_expo") }, ${num(start)});`);
  if (counting) {
    const token = idVar(id);
    parts.tweens.push(
      `var ${token}Figure = document.getElementById(${JSON.stringify(`${id}-figure`)});`,
      `var ${token}Count = { t: 0 };`,
      `function ${token}Format(value) { var rounded = value.toFixed(${counting.decimals}); return ${counting.grouped ? `Number(rounded).toLocaleString("en-US", { minimumFractionDigits: ${counting.decimals}, maximumFractionDigits: ${counting.decimals} })` : 'rounded'}; }`,
      `tl.fromTo(${token}Count, { t: 0 }, { t: 1, duration: 1.2, ease: ActOne.ease("out_expo"), onUpdate: function () { ${token}Figure.textContent = ${JSON.stringify(counting.prefix)} + ${token}Format(${counting.value} * ${token}Count.t) + ${JSON.stringify(counting.suffix)}; } }, ${num(start + 0.15)});`,
    );
  }
}

type Countable = { prefix: string; digits: string; suffix: string; value: number; decimals: number; grouped: boolean };

/**
 * A figure that can be counted up to: one plain number, not a year, not a
 * version, not a phone number. Anything else is shown as it was written.
 */
export function countable(value: string): Countable | null {
  const match = /^([^\d]*?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\D.*)?$/.exec(value);
  if (!match) return null;
  const digits = match[2]!;
  const number = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;
  const suffix = match[3] ?? '';
  // "24/7", "3.5.1", "1 in 3": more than one figure, which no single count arrives at.
  if (/\d/.test(suffix)) return null;
  // A year counted up from nothing is not a statistic.
  if (/^(19|20)\d{2}$/.test(digits) && !/%/.test(suffix)) return null;
  return {
    prefix: match[1] ?? '',
    digits,
    suffix,
    value: number,
    decimals: digits.includes('.') ? digits.split('.')[1]!.length : 0,
    grouped: digits.includes(','),
  };
}

function quoteScene(packet: ScenePacket, design: DesignTokens, palette: Palette, parts: Parts): void {
  const id = packet.frameId;
  const { height: H } = design.frame;
  const [quote = '', ...attribution] = packet.onScreenText;
  const start = packet.timing.beatStart + entranceOf(packet, 'quote');
  const set = setLines(quote, design, { fontSizePx: H * 0.06, maxWidthPx: design.grid.safe.width * 0.78, maxLines: 4, role: 'statement' });
  parts.styles.push(
    `#${id}-stage { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 ${px(design.grid.safe.x * 1.6)}; }`,
    `#${id}-mark { font-family: var(--ao-display-family); font-weight: 700; font-size: ${px(H * 0.2)}; line-height: 0.7; color: ${palette.accent}; opacity: 0; }`,
    ...titleCss(`${id}-title`, 'statement', set.fontSizePx, palette, 'left'),
    `#${id}-by { margin-top: ${px(H * 0.035)}; font-family: var(--ao-body-family); font-size: ${px(H * 0.026)}; color: ${palette.muted}; opacity: 0; }`,
  );
  parts.tweens.push(
    `tl.fromTo("#${id}-mark", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.6, ease: ${OVERSHOOT} }, ${num(start)});`,
    `tl.fromTo("#${id}-by", { opacity: 0, x: ${num(-H * 0.02)} }, { opacity: 1, x: 0, duration: 0.6, ease: ActOne.ease("out_quint") }, ${num(start + 0.7)});`,
  );
  parts.markup.push(`<div id="${id}-stage"><div id="${id}-mark">“</div><h1 id="${id}-title">${risingTitle(`${id}-title`, set, palette, parts, start + 0.15, 0.05)}</h1>${attribution.length ? `<div id="${id}-by">${escapeHtml(attribution.join(' '))}</div>` : ''}</div>`);
}

/**
 * The mark in its orbit: the logo on a lit disc, rings opening around it, the
 * brand's satellites circling. With the film's address beneath it as a button
 * when it closes the film.
 */
function markScene(packet: ScenePacket, design: DesignTokens, palette: Palette, parts: Parts, closing: boolean): void {
  const id = packet.frameId;
  const { width: W, height: H } = design.frame;
  const portrait = H > W;
  const start = packet.timing.beatStart + entranceOf(packet, 'mark');
  const beatEnd = packet.timing.beatStart + packet.timing.beatDuration;
  const cx = W / 2;
  const cy = H * (portrait ? 0.34 : 0.36);
  const disc = H * (portrait ? 0.12 : 0.17);
  const orbit = disc * 1.45;
  const brandColour = cssColour(design.accent);

  parts.styles.push(
    `.${id}-ring { position: absolute; border-radius: 50%; border: ${px(Math.max(1, H * 0.0012))} solid ${hexAlpha(palette.ink, 0.28)}; opacity: 0; }`,
    `#${id}-disc { position: absolute; left: ${px(cx - disc / 2)}; top: ${px(cy - disc / 2)}; width: ${px(disc)}; height: ${px(disc)}; border-radius: 50%; background: #FFFFFF; box-shadow: 0 ${px(H * 0.025)} ${px(H * 0.07)} rgba(0,0,0,0.25), 0 0 0 ${px(H * 0.012)} ${hexAlpha('#ffffff', 0.16)}; display: flex; align-items: center; justify-content: center; opacity: 0; }`,
    `#${id}-logo { max-width: 62%; max-height: 52%; display: block; }`,
    `#${id}-orbit { position: absolute; left: ${px(cx - orbit)}; top: ${px(cy - orbit)}; width: ${px(orbit * 2)}; height: ${px(orbit * 2)}; }`,
    `.${id}-moon { position: absolute; width: ${px(H * 0.036)}; height: ${px(H * 0.036)}; margin: ${px(-H * 0.018)} 0 0 ${px(-H * 0.018)}; border-radius: 50%; background: #FFFFFF; box-shadow: 0 ${px(H * 0.006)} ${px(H * 0.018)} rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; opacity: 0; }`,
    `.${id}-moon i { width: 38%; height: 38%; border-radius: 50%; background: ${brandColour}; display: block; }`,
  );
  const rings = [1.35, 1.95, 2.7].map((factor, index) => {
    const radius = (disc / 2) * factor;
    parts.styles.push(`#${id}-ring${index + 1} { left: ${px(cx - radius)}; top: ${px(cy - radius)}; width: ${px(radius * 2)}; height: ${px(radius * 2)}; }`);
    parts.tweens.push(`tl.fromTo("#${id}-ring${index + 1}", { scale: 0.4, opacity: 0 }, { scale: 1, opacity: ${num(0.85 - index * 0.25)}, duration: 1, ease: ActOne.ease("out_expo") }, ${num(start + 0.1 + index * 0.08)});`);
    return `<div id="${id}-ring${index + 1}" class="${id}-ring"></div>`;
  });
  const moons = Array.from({ length: 5 }, (_, index) => {
    const angle = (index / 5) * Math.PI * 2 - Math.PI / 2;
    const x = orbit + Math.cos(angle) * orbit;
    const y = orbit + Math.sin(angle) * orbit * 0.92;
    parts.styles.push(`#${id}-moon${index + 1} { left: ${px(x)}; top: ${px(y)}; }`);
    parts.tweens.push(`tl.fromTo("#${id}-moon${index + 1}", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: ${OVERSHOOT} }, ${num(start + 0.45 + index * 0.07)});`);
    return `<div id="${id}-moon${index + 1}" class="${id}-moon"><i></i></div>`;
  });
  const logo = packet.brand.logo;
  let mark: string;
  if (logo) mark = `<img id="${id}-logo" src="${logo.path}" alt="">`;
  else {
    // No mark to place: the name itself, set to sit inside the disc. Never an initial, which is a letter the brand did not write.
    const token = design.type.display;
    const fitted = fitToLines(packet.brand.name, { family: token.family, fontSizePx: disc * 0.3, tracking: token.tracking, weight: 700, maxWidthPx: disc * 0.7, maxLines: 2 });
    parts.styles.push(`#${id}-name { font-family: var(--ao-display-family); font-weight: 700; font-size: ${px(fitted.fontSizePx)}; line-height: 1.05; letter-spacing: var(--ao-display-tracking); color: ${brandColour}; text-align: center; }`);
    mark = `<span id="${id}-name">${fitted.lines.map((line) => escapeHtml(line)).join('<br>')}</span>`;
  }
  parts.markup.push(...rings, `<div id="${id}-orbit">${moons.join('')}</div>`, `<div id="${id}-disc">${mark}</div>`);
  parts.tweens.push(
    `tl.fromTo("#${id}-disc", { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.8, ease: ${OVERSHOOT} }, ${num(start)});`,
    // The satellites keep circling for as long as the mark is on screen.
    `tl.fromTo("#${id}-orbit", { rotation: -14 }, { rotation: 26, duration: ${num(Math.max(0.5, beatEnd - start))}, ease: "none" }, ${num(start)});`,
  );

  const line = lineOf(packet) || (closing ? packet.brand.tagline.trim() : packet.brand.name);
  const textTop = cy + orbit + H * 0.07;
  const button = closing && packet.brand.cta ? ctaButton(packet, parts, design, start + 0.75) : '';
  if (!line && !button) return;
  parts.styles.push(`#${id}-words { position: absolute; left: ${px(design.grid.safe.x)}; right: ${px(design.grid.safe.x)}; top: ${px(textTop)}; display: flex; flex-direction: column; align-items: center; }`);
  let title = '';
  if (line) {
    const set = setLines(line, design, { fontSizePx: H * (portrait ? 0.045 : 0.058), maxWidthPx: design.grid.safe.width * 0.8, maxLines: 2, role: 'display' });
    parts.styles.push(...titleCss(`${id}-title`, 'display', set.fontSizePx, palette, 'center'));
    title = `<h1 id="${id}-title">${risingTitle(`${id}-title`, set, palette, parts, start + 0.4, 0.06)}</h1>`;
  }
  parts.markup.push(`<div id="${id}-words">${title}${button}</div>`);
}

function ctaButton(packet: ScenePacket, parts: Parts, design: DesignTokens, at: number): string {
  const id = packet.frameId;
  const { height: H } = design.frame;
  const address = packet.brand.cta.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  if (!address) return '';
  parts.styles.push(
    `#${id}-button { margin-top: ${px(H * 0.04)}; display: inline-flex; align-items: center; gap: ${px(H * 0.012)}; padding: ${px(H * 0.017)} ${px(H * 0.034)}; border-radius: 999px; background: #FFFFFF; color: ${cssColour(design.accent)}; font-family: var(--ao-body-family); font-weight: 700; font-size: ${px(H * 0.026)}; box-shadow: 0 ${px(H * 0.014)} ${px(H * 0.04)} rgba(0,0,0,0.22); position: relative; overflow: hidden; opacity: 0; }`,
    `#${id}-sheen { position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: linear-gradient(100deg, rgba(255,255,255,0), rgba(255,255,255,0.7), rgba(255,255,255,0)); opacity: 0; }`,
  );
  parts.tweens.push(
    `tl.fromTo("#${id}-button", { opacity: 0, y: ${num(H * 0.03)}, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: ${OVERSHOOT} }, ${num(at)});`,
    `tl.fromTo("#${id}-sheen", { x: ${num(-H * 0.3)}, opacity: 1 }, { x: ${num(H * 0.6)}, opacity: 1, duration: 0.8, ease: ${SWING} }, ${num(at + 0.55)});`,
  );
  return `<div id="${id}-button"><span>${escapeHtml(address)}</span><span aria-hidden="true">→</span><span id="${id}-sheen"></span></div>`;
}

/**
 * The film's first light: streaks thrown out from the centre as the line
 * begins, placed by the golden angle so no two films' bursts need a random
 * number and no two streaks crowd each other.
 */
function burst(packet: ScenePacket, design: DesignTokens, palette: Palette, parts: Parts, at: number): void {
  const id = packet.frameId;
  const { width: W, height: H } = design.frame;
  const count = 44;
  parts.styles.push(
    `#${id}-burst { position: absolute; left: ${px(W / 2)}; top: ${px(H / 2)}; width: 0; height: 0; }`,
    `.${id}-ray { position: absolute; left: 0; top: 0; width: 0; height: 0; }`,
    `.${id}-streak { position: absolute; left: 0; top: ${px(-1)}; height: ${px(2)}; border-radius: 2px; background: linear-gradient(to right, ${hexAlpha(palette.accent, 0)}, ${palette.accent}); opacity: 0; }`,
  );
  const rays = Array.from({ length: count }, (_, index) => {
    const angle = (index * 137.508) % 360;
    const reach = H * (0.22 + ((index * 7) % 11) / 22);
    const length = H * (0.03 + ((index * 5) % 7) / 60);
    const when = at + 0.02 * (index % 6);
    parts.styles.push(`#${id}-ray${index + 1} { transform: rotate(${num(angle)}deg); }`, `#${id}-streak${index + 1} { width: ${px(length)}; }`);
    parts.tweens.push(
      `tl.fromTo("#${id}-streak${index + 1}", { x: ${num(H * 0.02)}, opacity: 0 }, { x: ${num(reach)}, opacity: 1, duration: 0.55, ease: ${EASE_OUT} }, ${num(when)});`,
      `tl.fromTo("#${id}-streak${index + 1}", { opacity: 1 }, { opacity: 0, duration: 0.45, ease: "none", immediateRender: false }, ${num(when + 0.552)});`,
    );
    return `<div id="${id}-ray${index + 1}" class="${id}-ray"><div id="${id}-streak${index + 1}" class="${id}-streak"></div></div>`;
  });
  parts.markup.push(`<div id="${id}-burst">${rays.join('')}</div>`);
}

/*
 * ---------------------------------------------------------------------------
 * The sound the motion asks for
 * ---------------------------------------------------------------------------
 */

export type LaunchSoundCue = {
  sceneId: string;
  /** Seconds from the start of the film. */
  time: number;
  type: 'whoosh' | 'impact' | 'ui_click' | 'logo_sting';
  intensity: number;
};

/**
 * Where the launch look's motion lands, as sound cues on the film's clock.
 *
 * The moments a viewer's ear expects something because their eye just got it:
 * the first light, the night opening into the day, a card arriving, each chip
 * landing, a chapter's core, the mark. They are offered to the Sound Director
 * as a storyboard's cues would be — it picks the samples, sets the gains and
 * thins the clicks to its budget — and only for beats whose storyboard asked
 * for no sound of its own.
 */
export function launchSoundCues(
  packets: readonly ScenePacket[],
  plan: ReadonlyMap<string, LaunchBeat>,
  beatStarts: ReadonlyMap<string, number>,
): LaunchSoundCue[] {
  const cues: LaunchSoundCue[] = [];
  let previous: LaunchAct | null = null;
  for (const packet of packets) {
    const beat = plan.get(packet.frameId) ?? { act: 'day', opener: false, chapter: false, chapterIndex: -1 };
    const beatStart = beatStarts.get(packet.frameId);
    if (beatStart === undefined) continue;
    const staging = stagingOf(packet, beat);
    const entrance = entranceOf(packet, staging);
    const cue = (after: number, type: LaunchSoundCue['type'], intensity: number) => {
      const time = beatStart + after;
      if (time >= 0) cues.push({ sceneId: packet.sceneId, time: Math.round(time * 1000) / 1000, type, intensity });
    };
    // The backdrop's own changes, where the backdrop makes them.
    if (previous === 'night' && beat.act === 'day') {
      cue(-0.15, 'whoosh', 0.55);
      cue(0.3, 'impact', 0.45);
    } else if (previous !== null && previous !== 'brand' && beat.act === 'brand') {
      cue(-0.15, 'whoosh', 0.4);
    }
    previous = beat.act;
    const items = listItems(lineOf(packet));
    switch (staging) {
      case 'headline':
        if (beat.opener) cue(entrance, 'whoosh', 0.45);
        break;
      case 'chapter':
        cue(entrance + 0.12, 'impact', 0.35);
        break;
      case 'list':
        items.forEach((_, index) => cue(entrance + index * 0.16, 'ui_click', 0.5));
        break;
      case 'product':
        cue(entrance, 'whoosh', 0.3);
        if (items.length >= 2 && packet.canvas.height <= packet.canvas.width) items.forEach((_, index) => cue(entrance + 0.12 + index * 0.14, 'ui_click', 0.45));
        break;
      case 'metric':
        cue(entrance, 'impact', 0.4);
        break;
      case 'mark':
        cue(entrance, beat.act === 'brand' ? 'logo_sting' : 'impact', 0.7);
        break;
      case 'quote':
        break;
    }
  }
  return cues;
}

/*
 * ---------------------------------------------------------------------------
 * The film's backdrop
 * ---------------------------------------------------------------------------
 */

/** The backdrop's styles, its layers, and the statements that move them on the film's clock. */
export type Backdrop = { css: string; markup: string; statements: string[] };

/**
 * One field under the whole film, in its acts.
 *
 * Each act is a layer of gradients and two glows; the film opens on the
 * first act's layer and each change of act brings the next one in — a line
 * of light drawn across the night, then the product's light field opening out
 * of it as a circle from the centre; the brand's colour washing in for the
 * close.
 */
export function launchBackdrop(
  packets: readonly ScenePacket[],
  plan: ReadonlyMap<string, LaunchBeat>,
  beatStarts: ReadonlyMap<string, number>,
  design: DesignTokens,
): Backdrop {
  const palettes = launchPalettes(design);
  const { width: W, height: H } = design.frame;
  const acts: LaunchAct[] = ['night', 'day', 'brand'];

  // The acts in film time, in order.
  const changes: { act: LaunchAct; at: number }[] = [];
  for (const packet of packets) {
    const act = plan.get(packet.frameId)?.act ?? 'day';
    const at = beatStarts.get(packet.frameId) ?? 0;
    if (changes.length === 0 || changes[changes.length - 1]!.act !== act) changes.push({ act, at });
  }
  const first = changes[0]?.act ?? 'day';

  const css = [
    '.ao-bd { position: absolute; inset: 0; opacity: 0; }',
    // The act the film opens on is there from the first frame; the others arrive.
    `#ao-bd-${first} { opacity: 1; }`,
    '.ao-bd-glow { position: absolute; border-radius: 50%; }',
    `#ao-bd-line { position: absolute; left: 0; top: ${px(H / 2 - 1)}; width: ${px(W)}; height: ${px(2)}; background: linear-gradient(to right, ${hexAlpha('#ffffff', 0)}, #ffffff, ${hexAlpha('#ffffff', 0)}); box-shadow: 0 0 ${px(H * 0.02)} ${hexAlpha(palettes.night.accent, 0.9)}; opacity: 0; transform-origin: 50% 50%; }`,
  ];
  for (const act of acts) {
    const palette = palettes[act];
    const [a, b] = palette.base;
    const glow = GLOW_ALPHA[act];
    const second = act === 'day' ? mix(palette.glow, '#ff7a59', 0.45) : palette.glow;
    css.push(
      `#ao-bd-${act} { background: radial-gradient(120% 90% at 50% 115%, ${hexAlpha(palette.glow, glow)}, ${hexAlpha(palette.glow, 0)} 60%), linear-gradient(160deg, ${a} 0%, ${b} 100%); }`,
      `#ao-bd-${act}-g1 { width: ${px(H * 1.1)}; height: ${px(H * 1.1)}; left: ${px(-W * 0.12)}; top: ${px(-H * 0.3)}; background: radial-gradient(closest-side, ${hexAlpha(act === 'brand' ? '#ffffff' : palette.glow, glow * 0.9)}, ${hexAlpha(act === 'brand' ? '#ffffff' : palette.glow, 0)}); }`,
      `#ao-bd-${act}-g2 { width: ${px(H * 0.9)}; height: ${px(H * 0.9)}; right: ${px(-W * 0.1)}; bottom: ${px(-H * 0.35)}; background: radial-gradient(closest-side, ${hexAlpha(second, glow * 0.8)}, ${hexAlpha(second, 0)}); }`,
    );
  }

  const statements: string[] = [];
  changes.slice(1).forEach((change, index) => {
    const previous = changes[index]!;
    const at = Math.max(0, change.at - 0.15);
    const incoming = `#ao-bd-${change.act}`;
    if (acts.indexOf(change.act) > acts.indexOf(previous.act)) {
      // Above the one it replaces: it opens out over it.
      if (change.act === 'day' && previous.act === 'night') {
        const lineAt = Math.max(0, at - 0.35);
        statements.push(
          `tl.fromTo("#ao-bd-line", { opacity: 0, scaleX: 0 }, { opacity: 1, scaleX: 1, duration: 0.35, ease: ${EASE_OUT} }, ${num(lineAt)});`,
          `tl.fromTo("#ao-bd-line", { opacity: 1, scaleY: 1 }, { opacity: 0, scaleY: 6, duration: 0.45, ease: ActOne.ease("in_cubic"), immediateRender: false }, ${num(at + 0.1)});`,
          `tl.fromTo("${incoming}", { opacity: 1, clipPath: "circle(0% at 50% 50%)" }, { opacity: 1, clipPath: "circle(75% at 50% 50%)", duration: 0.75, ease: ${SWING}, immediateRender: false }, ${num(at)});`,
        );
      } else {
        statements.push(`tl.fromTo("${incoming}", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: ${SWING}, immediateRender: false }, ${num(at)});`);
      }
    } else {
      // Below it: the one on top clears to show it.
      statements.push(
        `tl.fromTo("${incoming}", { opacity: 0 }, { opacity: 1, duration: 0.001, ease: "none", immediateRender: false }, ${num(at)});`,
        `tl.fromTo("#ao-bd-${previous.act}", { opacity: 1 }, { opacity: 0, duration: 0.6, ease: ${SWING}, immediateRender: false }, ${num(at)});`,
      );
    }
  });
  /*
   * The glows hold still. Drifting them across the film moved them a tenth of
   * a pixel a frame — nothing anyone sees — and made the renderer repaint
   * three screens of gradient on every frame, a sixth of the film's render
   * time. Still, each act is painted once and composited under the scenes.
   */
  const layers = acts.map((act) => `<div id="ao-bd-${act}" class="ao-bd"><div id="ao-bd-${act}-g1" class="ao-bd-glow"></div><div id="ao-bd-${act}-g2" class="ao-bd-glow"></div></div>`);
  return { css: css.join('\n'), markup: `${layers.join('')}<div id="ao-bd-line"></div>`, statements };
}

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

/** A hex colour at an alpha, as #rrggbbaa; anything that is not a hex colour is refused rather than drawn opaque. */
function hexAlpha(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (!hex) throw new Error(`The launch look needs a hex colour, not ${JSON.stringify(colour)}.`);
  const full = hex[1]!.length === 3 ? [...hex[1]!].map((digit) => digit + digit).join('') : hex[1]!;
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255))).toString(16).padStart(2, '0');
  return `#${full.toLowerCase()}${a}`;
}

/** A colour laid over another at an alpha, as the browser composites it: channel by channel. */
function over(base: string, colour: string, alpha: number): string {
  const under = hexToRgb(hexAlpha(base, 1).slice(0, 7));
  const top = hexToRgb(hexAlpha(colour, 1).slice(0, 7));
  const a = Math.max(0, Math.min(1, alpha));
  return rgbToHex({ r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a) });
}

/** A hex colour at an alpha, as rgba(), for the values GSAP interpolates. */
function rgba(colour: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hexAlpha(colour, 1).slice(0, 7));
  return `rgba(${r},${g},${b},${num(alpha)})`;
}

function formatLike(original: string, value: number): string {
  const decimals = original.includes('.') ? (original.split('.')[1]?.length ?? 0) : 0;
  const rounded = value.toFixed(decimals);
  return original.includes(',') ? Number(rounded).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : rounded;
}

function rectArray(rect: Rect): string {
  return JSON.stringify([rect.x, rect.y, rect.width, rect.height]);
}

function idVar(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '');
}

function px(value: number): string {
  return `${num(value)}px`;
}

function num(value: number): number {
  return Math.round(value * 1000) / 1000;
}
