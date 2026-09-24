import type { MotionRecipeName } from '@act-one/core';
import { applyCase, fitToLines, type DesignTokens } from '@act-one/design';
import type { StagedAsset } from './assets.ts';
import { escapeHtml } from './captions.ts';
import { PLACEMENT_CLASS, type ProductWindowBox } from './studio.ts';
import type { TypesetBlock } from './typeset.ts';
import type { ScenePacket } from './types.ts';

/**
 * The scene the engine draws itself when the agent could not write one.
 *
 * A port of the Remotion engine's own components, number for number: the
 * product window with its bar and its one-second settle, the photograph that
 * breathes, the clip under its camera, the lines that rise out of their own
 * masks, the figure that counts, the end card's three staggered arrivals and
 * the fade each of them leaves on. The lines are the design engine's, set by
 * the same functions at the same widths (see typeset.ts), so a film made
 * entirely of these scenes is the Remotion film drawn by another renderer.
 *
 * It is the floor under the agent: a render that stops because one scene
 * would not validate is a worse outcome than a film with one faithful, plain
 * scene in it, and the render record names the scene and the reason.
 */
type Parts = { styles: string[]; markup: string[]; tweens: string[] };

type Shot =
  | { kind: 'words' }
  | { kind: 'product'; picture: StagedAsset; box: ProductWindowBox }
  | { kind: 'ui'; picture: StagedAsset; sequence: FilmedSequence }
  | { kind: 'photo'; picture: StagedAsset }
  | { kind: 'footage'; clip: StagedAsset }
  | { kind: 'logo' }
  | { kind: 'end_card' };

/** How long each Remotion component takes to clear at the end of its beat. */
const WORDS_TAIL: Partial<Record<MotionRecipeName, number>> = {
  kinetic_headline: 0.18,
  editorial_headline: 0.4,
  statistic_reveal: 0.3,
  metric_reveal: 0.3,
  quote_hold: 0.4,
};
const PRODUCT_TAIL: Partial<Record<MotionRecipeName, number>> = {
  product_zoom: 0.3,
  spatial_cards: 0.4,
  image_wall: 0.4,
  cursor_sequence: 0.3,
};
const DEFAULT_TAIL = 0.35;

export function shotOf(packet: ScenePacket): Shot {
  const recipe = packet.recipe.name;
  const image = packet.assets.find((asset) => asset.kind === 'image') ?? null;
  if (recipe === 'cta_end_card') return { kind: 'end_card' };
  if (recipe === 'logo_reveal') return { kind: 'logo' };
  if (recipe === 'footage' && packet.clip) return { kind: 'footage', clip: packet.clip };
  if ((recipe === 'footage' || recipe === 'photo_hold') && image) return { kind: 'photo', picture: image };
  const sequence = FILMED_RECIPES.has(recipe) ? filmedSequence(packet.uiSequence) : null;
  const capture = packet.assets[0];
  if (sequence && capture?.kind === 'image') return { kind: 'ui', picture: capture, sequence };
  if (packet.productWindow && image) return { kind: 'product', picture: image, box: packet.productWindow };
  return { kind: 'words' };
}

export function fallbackScene(packet: ScenePacket, design: DesignTokens): string {
  const id = packet.frameId;
  const shot = shotOf(packet);
  const parts: Parts = { styles: [], markup: [], tweens: [] };
  const ease = `ActOne.ease(${JSON.stringify(packet.recipe.easing)})`;

  switch (shot.kind) {
    case 'words':
      wordsShot(packet, design, parts, ease);
      break;
    case 'product':
      productShot(packet, design, shot.picture, shot.box, parts, ease);
      break;
    case 'ui':
      filmedShot(packet, design, shot.picture, shot.sequence, parts);
      break;
    case 'photo':
      pictureShot(packet, design, shot.picture, parts, ease, 0.9);
      break;
    case 'footage':
      pictureShot(packet, design, shot.clip, parts, ease, 0.6);
      break;
    case 'logo':
      logoShot(packet, design, parts, ease);
      break;
    case 'end_card':
      endCardShot(packet, design, parts, ease);
      break;
  }

  // A scene that leaves by a cut clears itself over its component's tail; one that leaves through a join is carried out whole.
  const tail = packet.timing.leaves ? 0 : tailOf(packet, shot);
  const beatEnd = packet.timing.beatStart + packet.timing.beatDuration;
  if (tail > 0) {
    parts.tweens.push(
      `tl.fromTo("#${id}-content", { opacity: 1 }, { opacity: 0, duration: ${num(tail)}, ease: "none", immediateRender: false }, ${num(Math.max(0, beatEnd - tail))});`,
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
    `<style>\n${['#root { position: absolute; inset: 0; overflow: hidden; }', `#${id}-content { position: absolute; inset: 0; }`, ...parts.styles].join('\n')}\n</style>`,
    `<div id="root" data-composition-id="${id}" data-width="${packet.canvas.width}" data-height="${packet.canvas.height}">`,
    `<div id="${id}-content">`,
    ...parts.markup,
    '</div>',
    '</div>',
    `<script>\n${script.join('\n')}\n</script>`,
    '</template>',
  ].join('\n');
}

function tailOf(packet: ScenePacket, shot: Shot): number {
  switch (shot.kind) {
    case 'words':
      return WORDS_TAIL[packet.recipe.name] ?? DEFAULT_TAIL;
    case 'product':
      return PRODUCT_TAIL[packet.recipe.name] ?? DEFAULT_TAIL;
    case 'ui':
      // The Remotion UiCinema clears inside its last framing, which this shot does itself.
      return 0;
    case 'logo':
      return 0.5;
    case 'end_card':
      return 0.4;
    default:
      return DEFAULT_TAIL;
  }
}

/** The block the grid frames type in: the studio's frame, the Remotion engine's `Framed`. */
function framed(id: string, placement: 'center_left' | 'lower_third', parts: Parts, inner: string): void {
  parts.markup.push(`<div id="${id}-frame" class="${PLACEMENT_CLASS[placement]}">${inner}</div>`);
}

/** Exactly the properties the Remotion component sets, and no others: each one moves a glyph. */
function typeStyle(block: TypesetBlock, colour?: string): string {
  return [
    `font-family: var(--ao-${block.role}-family)`,
    `font-size: ${px(block.fontSizePx)}`,
    `font-weight: ${block.weight}`,
    `line-height: ${block.lineHeight ?? 'normal'}`,
    `letter-spacing: ${block.trackingEm}em`,
    `color: ${colour ?? colourOf(block.colour)}`,
    'text-transform: none',
    ...(block.features
      ? ['text-align: left', 'font-kerning: normal', 'font-feature-settings: "kern" 1, "liga" 1, "calt" 1', 'text-rendering: geometricPrecision', 'margin: 0']
      : []),
  ].join('; ');
}

function colourOf(colour: TypesetBlock['colour']): string {
  switch (colour) {
    case 'primary':
      return 'var(--ao-primary)';
    case 'muted':
      return 'var(--ao-muted)';
    case 'accent':
      return 'var(--ao-accent)';
    case 'white':
      return '#FFFFFF';
  }
}

/** Lines that rise out of masks of their own height, one after another: the Remotion `WordReveal`. */
function wordReveal(
  id: string,
  key: string,
  block: TypesetBlock,
  parts: Parts,
  ease: string,
  delay: number,
  stagger: number,
  ownTail: number,
  beatEnd: number,
): string {
  const lineHeight = block.fontSizePx * (block.lineHeight ?? 1.2);
  parts.styles.push(
    `#${id}-${key} { ${typeStyle(block)}; }`,
    `.${id}-${key}-mask { overflow: hidden; height: ${px(lineHeight)}; }`,
  );
  block.lines.forEach((_, index) => {
    parts.tweens.push(
      `tl.fromTo("#${id}-${key}-line-${index + 1}", { y: ${num(lineHeight * 0.92)}, opacity: 0 }, { y: 0, opacity: 1, duration: 0.72, ease: ${ease} }, ${num(delay + index * stagger)});`,
    );
  });
  if (ownTail > 0) {
    parts.tweens.push(
      `tl.fromTo("#${id}-${key}", { opacity: 1 }, { opacity: 0, duration: ${num(ownTail)}, ease: "none", immediateRender: false }, ${num(Math.max(0, beatEnd - ownTail))});`,
    );
  }
  const lines = block.lines
    .map((line, index) => `<div class="${id}-${key}-mask"><div id="${id}-${key}-line-${index + 1}">${escapeHtml(line)}</div></div>`)
    .join('');
  return `<div id="${id}-${key}">${lines}</div>`;
}

function wordsShot(packet: ScenePacket, design: DesignTokens, parts: Parts, ease: string): void {
  const id = packet.frameId;
  const typeset = packet.typeset;
  if (!typeset || typeset.blocks.length === 0) return;
  const recipe = packet.recipe.name;
  const delay = packet.recipe.delaySeconds;
  const [first, second] = typeset.blocks;

  switch (recipe) {
    case 'kinetic_headline': {
      const block = first!;
      const gap = block.fontSizePx * 0.26;
      parts.styles.push(
        `#${id}-kinetic { ${typeStyle(block)}; }`,
        `.${id}-kinetic-line { display: flex; flex-wrap: wrap; gap: 0 ${px(gap)}; justify-content: flex-start; }`,
        `.${id}-kinetic-word { display: inline-block; }`,
      );
      let wordIndex = 0;
      const lines = block.lines.map((line) => {
        const words = line.split(' ').map((word) => {
          wordIndex += 1;
          parts.tweens.push(
            `tl.fromTo("#${id}-word-${wordIndex}", { opacity: 0, y: ${num(block.fontSizePx * 0.22)} }, { opacity: 1, y: 0, duration: 0.34, ease: ${ease} }, ${num(delay + (wordIndex - 1) * packet.recipe.staggerSeconds)});`,
          );
          return `<span class="${id}-kinetic-word" id="${id}-word-${wordIndex}">${escapeHtml(word)}</span>`;
        });
        return `<div class="${id}-kinetic-line">${words.join('')}</div>`;
      });
      framed(id, 'center_left', parts, `<div id="${id}-kinetic">${lines.join('')}</div>`);
      return;
    }

    case 'editorial_headline': {
      const block = first!;
      const rule = Math.max(1, Math.round(design.frame.height * 0.0015));
      parts.styles.push(
        `#${id}-rule { height: ${px(rule)}; width: 0%; background: var(--ao-line); margin-bottom: ${px(design.space(2))}; }`,
        `#${id}-editorial { ${typeStyle(block)}; }`,
      );
      parts.tweens.push(
        `tl.fromTo("#${id}-rule", { width: "0%" }, { width: "100%", duration: 0.9, ease: ${ease} }, ${num(delay)});`,
        `tl.fromTo("#${id}-editorial", { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.9, ease: ${ease} }, ${num(delay)});`,
      );
      const lines = block.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
      framed(id, 'center_left', parts, `<div id="${id}-editorial-block"><div id="${id}-rule"></div><div id="${id}-editorial">${lines}</div></div>`);
      return;
    }

    case 'statistic_reveal':
    case 'metric_reveal': {
      const figure = first!;
      const value = figure.lines[0] ?? '';
      const numeric = /^([^\d]*)([\d,.]+)(.*)$/.exec(value);
      parts.styles.push(
        `#${id}-figure { ${typeStyle(figure)}; font-variant-numeric: tabular-nums; }`,
      );
      const markup = [`<div id="${id}-figure">${escapeHtml(numeric ? `${numeric[1]}${formatLike(numeric[2]!, 0)}${numeric[3]}` : value)}</div>`];
      parts.tweens.push(
        `var ${idVar(id)}Settle = ${ease};`,
        `tl.fromTo("#${id}-figure", { opacity: 0 }, { opacity: 1, duration: 1.1, ease: function (p) { return Math.min(1, ${idVar(id)}Settle(p) * 2); } }, ${num(delay)});`,
      );
      if (numeric) {
        // Counts only when the figure is a number, formatted the way it was written, as the Remotion engine counts.
        parts.tweens.push(
          `var ${idVar(id)}Figure = document.getElementById(${JSON.stringify(`${id}-figure`)});`,
          `var ${idVar(id)}Count = { t: 0 };`,
          `function ${idVar(id)}Format(original, value) { var decimals = original.indexOf(".") >= 0 ? (original.split(".")[1] || "").length : 0; var rounded = value.toFixed(decimals); return original.indexOf(",") >= 0 ? Number(rounded).toLocaleString("en-US", { minimumFractionDigits: decimals }) : rounded; }`,
          `tl.fromTo(${idVar(id)}Count, { t: 0 }, { t: 1, duration: 1.1, ease: ${idVar(id)}Settle, onUpdate: function () { ${idVar(id)}Figure.textContent = ${JSON.stringify(numeric[1])} + ${idVar(id)}Format(${JSON.stringify(numeric[2])}, ${Number(numeric[2]!.replace(/,/g, ''))} * ${idVar(id)}Count.t) + ${JSON.stringify(numeric[3])}; } }, ${num(delay)});`,
        );
      }
      if (second) {
        parts.styles.push(`#${id}-caption { ${typeStyle(second)}; margin-top: ${px(second.marginTopPx)}; }`);
        markup.push(`<div id="${id}-caption">${escapeHtml(second.lines.join(' '))}</div>`);
        parts.tweens.push(
          `tl.fromTo("#${id}-caption", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: ActOne.ease("out_quint") }, ${num(delay + 0.25)});`,
        );
      }
      framed(id, 'center_left', parts, `<div id="${id}-metric">${markup.join('')}</div>`);
      return;
    }

    case 'quote_hold': {
      const quote = first!;
      parts.styles.push(`#${id}-quote { max-width: ${px(quote.maxWidthPx)}; }`, `#${id}-quote-text { ${typeStyle(quote)}; }`);
      const markup = [`<div id="${id}-quote-text">${quote.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>`];
      if (second) {
        parts.styles.push(`#${id}-attribution { ${typeStyle(second)}; margin-top: ${px(second.marginTopPx)}; }`);
        markup.push(`<div id="${id}-attribution">${escapeHtml(second.lines.join(' '))}</div>`);
      }
      // The quote arrives on out_expo whatever the recipe says, as the Remotion QuoteScene does.
      parts.tweens.push(`tl.fromTo("#${id}-quote", { opacity: 0 }, { opacity: 1, duration: 1, ease: ActOne.ease("out_expo") }, ${num(delay)});`);
      framed(id, 'center_left', parts, `<div id="${id}-quote">${markup.join('')}</div>`);
      return;
    }

    default: {
      const block = first!;
      // The recipe's own delay and stagger where the Remotion engine passes them; its defaults where it does not.
      const own = recipe === 'word_reveal' || recipe === 'hold';
      const inner = wordReveal(id, 'words', block, parts, ease, own ? delay : 0, own ? packet.recipe.staggerSeconds : 0.06, 0, 0);
      framed(id, 'center_left', parts, inner);
    }
  }
}

/** The capture as a physical object: the Remotion `ProductWindow`. */
function productShot(packet: ScenePacket, design: DesignTokens, picture: StagedAsset, box: ProductWindowBox, parts: Parts, ease: string): void {
  const id = packet.frameId;
  const camera = packet.camera;
  const chromeHeight = box.barHeightPx;
  const chrome = chromeHeight > 0;
  const { width, height } = design.frame;

  parts.styles.push(
    `#${id}-fade { position: absolute; inset: 0; }`,
    `#${id}-camera { position: absolute; left: ${px(box.x)}; top: ${px(box.y)}; width: ${px(box.width)}; height: ${px(box.height)}; transform-origin: 50% 50%; }`,
    `#${id}-surface { position: absolute; inset: 0; border-radius: var(--ao-radius-lg); overflow: hidden; background: var(--ao-surface); box-shadow: var(--ao-shadow-soft); transform-origin: 50% 50%; }`,
    `#${id}-picture { width: 100%; height: calc(100% - ${px(chromeHeight)}); object-fit: cover; object-position: top center; display: block; }`,
  );
  let bar = '';
  if (chrome) {
    parts.styles.push(
      `#${id}-bar { height: ${px(chromeHeight)}; background: var(--ao-surface-raised); display: flex; align-items: center; padding-left: ${px(chromeHeight * 0.6)}; gap: ${px(chromeHeight * 0.32)}; border-bottom: 1px solid var(--ao-line); }`,
      `.${id}-dot { width: ${px(chromeHeight * 0.22)}; height: ${px(chromeHeight * 0.22)}; border-radius: 50%; background: var(--ao-line); }`,
    );
    bar = `<div id="${id}-bar"><div class="${id}-dot"></div><div class="${id}-dot"></div><div class="${id}-dot"></div></div>`;
  }
  parts.markup.push(
    `<div id="${id}-fade"><div id="${id}-camera"><div id="${id}-surface">${bar}<img id="${id}-picture" src="${picture.path}" alt=""></div></div></div>`,
  );

  const blur = camera.depthOfField > 0 ? camera.depthOfField * 3 : 0;
  const delay = num(packet.recipe.delaySeconds);
  parts.tweens.push(
    `tl.fromTo("#${id}-camera", { x: ${num(camera.fromX * width * 0.08)}, y: ${num(camera.fromY * height * 0.08)}, scale: ${num(camera.fromScale)}${blur > 0 ? `, filter: "blur(${num(blur)}px)"` : ''} }, { x: ${num(camera.toX * width * 0.08)}, y: ${num(camera.toY * height * 0.08)}, scale: ${num(camera.toScale)}${blur > 0 ? ', filter: "blur(0px)"' : ''}, duration: ${num(packet.timing.beatDuration)}, ease: ActOne.ease(${JSON.stringify(camera.easing)}) }, 0);`,
    // The Remotion component blurs and then fades one element, so the fade wraps the blur: faded inside it,
    // the surface would be blurred from a nearly transparent 8-bit copy and come out darker.
    `tl.fromTo("#${id}-fade", { opacity: 0 }, { opacity: 1, duration: 1, ease: ${ease} }, ${delay});`,
    `tl.fromTo("#${id}-surface", { y: ${num(height * 0.025)}, scale: 0.965 }, { y: 0, scale: 1, duration: 1, ease: ${ease} }, ${delay});`,
  );
}

/** The recipes the Remotion engine films as a sequence of framings when production planned one. */
const FILMED_RECIPES: ReadonlySet<MotionRecipeName> = new Set<MotionRecipeName>([
  'product_window', 'product_sequence', 'floating_ui', 'feature_stack', 'product_zoom',
]);

type Rect = { x: number; y: number; width: number; height: number };
type Framing = {
  move: string;
  from: Rect;
  to: Rect;
  seconds: number;
  cut: boolean;
  lift: Rect | null;
  words: 'none' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  layers: { role: string; motion: string; delaySeconds: number; durationSeconds: number }[];
};
type FilmedSequence = { sourceWidth: number; sourceHeight: number; background: { r: number; g: number; b: number }; framings: Framing[] };

/** The planned sequence, read defensively: the brief carries it as data, and a malformed one is not filmed. */
function filmedSequence(value: unknown): FilmedSequence | null {
  const sequence = value as Partial<FilmedSequence> | null;
  if (!sequence || !Array.isArray(sequence.framings) || sequence.framings.length === 0) return null;
  const finite = (...numbers: unknown[]) => numbers.every((number) => typeof number === 'number' && Number.isFinite(number));
  const rect = (candidate: unknown): candidate is Rect => {
    const r = candidate as Rect | null;
    return Boolean(r) && finite(r!.x, r!.y, r!.width, r!.height) && r!.width > 0 && r!.height > 0;
  };
  if (!finite(sequence.sourceWidth, sequence.sourceHeight) || !sequence.background || !finite(sequence.background.r, sequence.background.g, sequence.background.b)) return null;
  const framings = sequence.framings.filter((framing) => rect(framing.from) && rect(framing.to) && finite(framing.seconds) && framing.seconds > 0);
  if (framings.length === 0) return null;
  return {
    sourceWidth: sequence.sourceWidth!,
    sourceHeight: sequence.sourceHeight!,
    background: { r: channel(sequence.background.r), g: channel(sequence.background.g), b: channel(sequence.background.b) },
    framings: framings.map((framing) => ({
      move: String(framing.move ?? 'settle'),
      from: framing.from,
      to: framing.to,
      seconds: framing.seconds,
      cut: framing.cut !== false,
      lift: rect(framing.lift) ? framing.lift : null,
      words: (['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const).find((corner) => corner === framing.words) ?? 'none',
      layers: Array.isArray(framing.layers) ? framing.layers.map((layer) => ({ role: String(layer.role), motion: String(layer.motion), delaySeconds: Number(layer.delaySeconds) || 0, durationSeconds: Number(layer.durationSeconds) || 0.8 })) : [],
    })),
  };
}

function channel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * The capture filmed as its sequence of framings: the Remotion `UiCinema`.
 *
 * Each framing is the camera on the still, moving from one crop to another
 * so the crop exactly fills the frame, cutting in with a hair of settle,
 * lifting a region off the interface where production found one, and setting
 * the scene's words in the corner the planner chose. A framing the Remotion
 * engine takes apart into layers or builds a volume around is filmed here as
 * the same camera on the same crops: the framing holds, the construction does
 * not, and the render record says the scene was the engine's.
 */
function filmedShot(packet: ScenePacket, design: DesignTokens, picture: StagedAsset, sequence: FilmedSequence, parts: Parts): void {
  const id = packet.frameId;
  const token = idVar(id);
  const { width: W, height: H } = design.frame;
  const recipeEase = packet.recipe.easing;
  const words = packet.onScreenText.join(' ').trim();
  const mounted = packet.timing.mountedSeconds;
  const leavesByCut = packet.timing.leaves === null;

  parts.styles.push(
    `.${id}-framing { position: absolute; inset: 0; }`,
    `.${id}-ground { position: absolute; inset: 0; overflow: hidden; background: rgb(${sequence.background.r}, ${sequence.background.g}, ${sequence.background.b}); }`,
    `.${id}-move { position: absolute; inset: 0; transform-origin: 50% 50%; }`,
    `.${id}-plate { position: absolute; max-width: none; display: block; }`,
    `.${id}-lift { position: absolute; overflow: hidden; border-radius: var(--ao-radius-md); transform-origin: 50% 50%; }`,
    // A lens falls off at the corners; nothing else is added to the picture.
    `.${id}-vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(120% 110% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.26) 100%); }`,
  );
  parts.tweens.push(
    `function ${token}Place(plate, lift, liftImage, from, to, cut, t) {`,
    `  var x = from[0] + (to[0] - from[0]) * t, y = from[1] + (to[1] - from[1]) * t, w = from[2] + (to[2] - from[2]) * t, h = from[3] + (to[3] - from[3]) * t;`,
    `  var iw = ${W} / Math.max(0.02, w), ih = iw * ${num(sequence.sourceHeight / sequence.sourceWidth)};`,
    `  plate.style.left = (-x * iw) + "px"; plate.style.top = (-y * ih) + "px"; plate.style.width = iw + "px"; plate.style.height = ih + "px";`,
    `  if (!lift) return;`,
    `  lift.style.left = ((cut[0] - x) / w) * ${W} + "px"; lift.style.top = ((cut[1] - y) / h) * ${H} + "px"; lift.style.width = (cut[2] / w) * ${W} + "px"; lift.style.height = (cut[3] / h) * ${H} + "px";`,
    `  liftImage.style.left = (-cut[0] * iw) + "px"; liftImage.style.top = (-cut[1] * ih) + "px"; liftImage.style.width = iw + "px"; liftImage.style.height = ih + "px";`,
    `}`,
  );

  let cursor = 0;
  sequence.framings.forEach((framing, index) => {
    const start = cursor;
    cursor += framing.seconds;
    if (start >= mounted - 0.001) return;
    const seconds = Math.min(framing.seconds, mounted - start);
    const last = index === sequence.framings.length - 1;
    const key = `${id}-f${index + 1}`;
    const rects = (rect: Rect) => `[${num(rect.x)}, ${num(rect.y)}, ${num(rect.width)}, ${num(rect.height)}]`;

    const markup: string[] = [
      `<div id="${key}-move" class="${id}-move"><img id="${key}-plate" class="${id}-plate" src="${picture.path}" alt=""></div>`,
    ];
    if (framing.lift) {
      markup.push(`<div id="${key}-lift" class="${id}-lift"><img id="${key}-lift-image" class="${id}-plate" src="${picture.path}" alt=""></div>`);
    }
    markup.push(`<div class="${id}-vignette"></div>`);

    // The camera: on the subject's own timing when the product brings something on screen, else across the framing.
    const arriving =
      framing.layers.find((layer) => layer.role === 'overlay' && layer.motion !== 'hold') ??
      framing.layers.find((layer) => layer.role === 'control' && layer.motion !== 'hold');
    const curve = arriving ? 'out_expo' : framing.move === 'lateral' || framing.move === 'hold' ? 'linear' : recipeEase;
    const cameraDelay = arriving ? arriving.delaySeconds : 0;
    const cameraSeconds = arriving ? arriving.durationSeconds : framing.seconds;
    const at = (seconds: number) => num(start + seconds);
    parts.tweens.push(
      `var ${token}F${index + 1} = { t: 0 };`,
      `var ${token}F${index + 1}Place = function () { ${token}Place(document.getElementById(${JSON.stringify(`${key}-plate`)}), ${framing.lift ? `document.getElementById(${JSON.stringify(`${key}-lift`)}), document.getElementById(${JSON.stringify(`${key}-lift-image`)})` : 'null, null'}, ${rects(framing.from)}, ${rects(framing.to)}, ${framing.lift ? rects(framing.lift) : 'null'}, ${token}F${index + 1}.t); };`,
      `${token}F${index + 1}Place();`,
      `tl.fromTo(${token}F${index + 1}, { t: 0 }, { t: 1, duration: ${num(cameraSeconds)}, ease: ActOne.ease(${JSON.stringify(curve)}), onUpdate: ${token}F${index + 1}Place }, ${at(cameraDelay)});`,
    );
    if (framing.cut) {
      // A cut lands: the picture arrives a hair wide and settles, in under a quarter of a second.
      parts.tweens.push(`tl.fromTo("#${key}-move", { scale: 1.02 }, { scale: 1, duration: 0.22, ease: ActOne.ease("out_quint") }, ${at(0)});`);
    }
    if (framing.lift) {
      const shadow = (alpha: number) => `0px ${num(H * 0.02)}px ${num(H * 0.055)}px rgba(0,0,0,${alpha})`;
      parts.tweens.push(
        `tl.fromTo("#${key}-move", { filter: "brightness(1) blur(0px)" }, { filter: "brightness(0.72) blur(2.4px)", duration: 0.5, ease: ActOne.ease("out_expo") }, ${at(0.12)});`,
        `tl.fromTo("#${key}-lift", { scale: 1, y: ${num(H * 0.012)}, boxShadow: ${JSON.stringify(shadow(0))} }, { scale: 1.05, y: 0, boxShadow: ${JSON.stringify(shadow(0.42))}, duration: 0.5, ease: ActOne.ease("out_expo") }, ${at(0.12)});`,
      );
      if (framing.cut) parts.tweens.push(`tl.fromTo("#${key}-lift", { opacity: 0 }, { opacity: 1, duration: 0.22, ease: ActOne.ease("out_quint") }, ${at(0)});`);
    }
    if (words && framing.words !== 'none') markup.push(wordsInFrame(packet, design, key, framing.words, words, start, framing.seconds, parts));
    if (last && leavesByCut) {
      parts.tweens.push(`tl.fromTo("#${key}-ground", { opacity: 1 }, { opacity: 0, duration: 0.3, ease: "none", immediateRender: false }, ${at(Math.max(0, framing.seconds - 0.3))});`);
    }

    parts.markup.push(
      `<div id="${key}" class="clip ${id}-framing" data-start="${num(start)}" data-duration="${num(seconds)}" data-track-index="1"><div id="${key}-ground" class="${id}-ground">${markup.join('')}</div></div>`,
    );
  });
}

/** The scene's words in the quiet corner of a framing, over a scrim anchored to it: the Remotion `WordsInFrame`. */
function wordsInFrame(
  packet: ScenePacket,
  design: DesignTokens,
  key: string,
  corner: Exclude<Framing['words'], 'none'>,
  words: string,
  start: number,
  seconds: number,
  parts: Parts,
): string {
  const { width: W, height: H } = design.frame;
  const top = corner === 'top_left' || corner === 'top_right';
  const leftSide = corner === 'top_left' || corner === 'bottom_left';
  const margin = design.grid.safe.x;
  const blockWidth = Math.min(design.grid.safe.width * 0.46, W * 0.42);
  const statement = design.type.statement;
  const fitted = fitToLines(applyCase(words, statement), {
    family: statement.family,
    fontSizePx: statement.sizePx,
    tracking: statement.tracking,
    weight: statement.weight,
    maxWidthPx: blockWidth,
    maxLines: 3,
  });
  const lineHeight = fitted.fontSizePx * statement.lineHeight;
  const at = (offset: number) => num(start + offset);

  parts.styles.push(
    `#${key}-scrim { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(84% 68% at ${leftSide ? '6%' : '94%'} ${top ? '8%' : '92%'}, rgba(6,6,10,0.86) 0%, rgba(6,6,10,0.62) 34%, rgba(6,6,10,0.18) 66%, rgba(6,6,10,0) 100%); }`,
    `#${key}-words { position: absolute; ${top ? 'top' : 'bottom'}: ${px(margin)}; ${leftSide ? 'left' : 'right'}: ${px(margin)}; width: ${px(blockWidth)}; display: flex; flex-direction: column; align-items: ${leftSide ? 'flex-start' : 'flex-end'}; gap: ${px(Math.round(statement.sizePx * 0.42))}; }`,
    `#${key}-rule { width: ${px(Math.round(W * 0.036))}; height: 3px; background: var(--ao-accent); border-radius: 2px; }`,
    `#${key}-shadow { text-shadow: 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.02)}px rgba(0,0,0,0.55); }`,
    `#${key}-lines { font-family: var(--ao-statement-family); font-size: ${px(fitted.fontSizePx)}; font-weight: ${statement.weight}; line-height: ${statement.lineHeight}; letter-spacing: ${statement.tracking}em; color: #FFFFFF; text-align: ${leftSide ? 'left' : 'right'}; text-transform: none; font-kerning: normal; font-feature-settings: "kern" 1, "liga" 1, "calt" 1; text-rendering: geometricPrecision; margin: 0; }`,
    `.${key}-mask { overflow: hidden; height: ${px(lineHeight)}; }`,
  );
  parts.tweens.push(
    `tl.fromTo("#${key}-scrim", { opacity: 0 }, { opacity: 1, duration: 0.7, ease: ActOne.ease("out_quint") }, ${at(0.18)});`,
    `tl.fromTo("#${key}-words", { opacity: 0, y: ${num(H * 0.018)} }, { opacity: 1, y: 0, duration: 0.7, ease: ActOne.ease("out_quint") }, ${at(0.18)});`,
    ...fitted.lines.map(
      (_, index) =>
        `tl.fromTo("#${key}-line-${index + 1}", { y: ${num(lineHeight * 0.92)}, opacity: 0 }, { y: 0, opacity: 1, duration: 0.72, ease: ActOne.ease(${JSON.stringify(packet.recipe.easing)}) }, ${at(0.25 + index * 0.06)});`,
    ),
    // The words clear at the end of their framing, as the Remotion WordReveal inside it does.
    `tl.fromTo("#${key}-lines", { opacity: 1 }, { opacity: 0, duration: ${DEFAULT_TAIL}, ease: "none", immediateRender: false }, ${at(Math.max(0, seconds - DEFAULT_TAIL))});`,
  );
  const lines = fitted.lines.map((line, index) => `<div class="${key}-mask"><div id="${key}-line-${index + 1}">${escapeHtml(line)}</div></div>`).join('');
  return `<div id="${key}-scrim"></div><div id="${key}-words"><div id="${key}-rule"></div><div id="${key}-shadow"><div id="${key}-lines">${lines}</div></div></div>`;
}

/** A photograph or a clip filling the frame under its camera: the Remotion `PhotoHold` and `Footage`. */
function pictureShot(
  packet: ScenePacket,
  design: DesignTokens,
  picture: StagedAsset,
  parts: Parts,
  ease: string,
  entranceSeconds: number,
): void {
  const id = packet.frameId;
  const camera = packet.camera;
  const { width, height } = design.frame;
  const video = picture.kind === 'video';
  // A static camera still breathes: the quietest possible push keeps a held picture from reading as a paused one.
  const fromScale = camera.move === 'static' ? 1 : camera.fromScale;
  const toScale = camera.move === 'static' ? 1.03 : camera.toScale;

  parts.styles.push(
    `#${id}-plate { position: absolute; inset: 0; overflow: hidden; background: var(--ao-canvas); }`,
    `#${id}-camera { position: absolute; inset: 0; transform-origin: 50% 50%; }`,
    `#${id}-picture { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }`,
  );
  // The camera moves a wrapper, never the clip itself: HyperFrames owns a clip element's visibility.
  const media = video
    ? `<video id="${id}-picture" class="clip" src="${picture.path}" muted playsinline data-start="0" data-duration="${num(packet.timing.mountedSeconds)}" data-track-index="1"></video>`
    : `<img id="${id}-picture" src="${picture.path}" alt="">`;

  let words = '';
  const block = packet.typeset?.blocks[0];
  if (block) {
    const beatEnd = packet.timing.beatStart + packet.timing.beatDuration;
    const ownTail = packet.timing.leaves ? 0 : DEFAULT_TAIL;
    const inner = wordReveal(id, 'words', block, parts, ease, 0.4, 0.06, ownTail, beatEnd);
    const frame: Parts = { styles: [], markup: [], tweens: [] };
    framed(id, 'lower_third', frame, inner);
    parts.styles.push(...frame.styles);
    if (video) {
      words = frame.markup.join('');
    } else {
      // Only where the words sit: the picture stays the picture.
      parts.styles.push(`#${id}-shade { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.0) 45%); }`);
      words = `<div id="${id}-shade">${frame.markup.join('')}</div>`;
    }
  }
  parts.markup.push(`<div id="${id}-plate"><div id="${id}-camera">${media}</div>${words}</div>`);

  parts.tweens.push(
    `var ${idVar(id)}Enter = ${ease};`,
    `tl.fromTo("#${id}-plate", { opacity: 0 }, { opacity: 1, duration: ${num(entranceSeconds)}, ease: function (p) { return Math.min(1, ${idVar(id)}Enter(p) * 1.4); } }, ${num(packet.recipe.delaySeconds)});`,
    `tl.fromTo("#${id}-camera", { x: ${num(camera.fromX * width)}, y: ${num(camera.fromY * height)}, scale: ${num(fromScale)} }, { x: ${num(camera.toX * width)}, y: ${num(camera.toY * height)}, scale: ${num(toScale)}, duration: ${num(packet.timing.beatDuration)}, ease: ActOne.ease(${JSON.stringify(camera.easing)}) }, 0);`,
  );
}

/** The mark, optically sized and centred: the Remotion `LogoReveal`. */
function logoShot(packet: ScenePacket, design: DesignTokens, parts: Parts, ease: string): void {
  const id = packet.frameId;
  const logo = packet.brand.logo;
  parts.styles.push(`#${id}-lockup { display: flex; align-items: center; gap: ${px(design.space(2))}; }`);
  let mark: string;
  if (logo) {
    parts.styles.push(`#${id}-logo { height: ${px(packet.typeset?.logo?.heightPx ?? design.type.display.sizePx * 0.9)}; width: auto; display: block; }`);
    mark = `<img id="${id}-logo" src="${logo.path}" alt="">`;
  } else {
    const block = packet.typeset?.blocks[0];
    const name = block?.lines[0] ?? packet.brand.name;
    parts.styles.push(`#${id}-wordmark { ${block ? typeStyle(block) : 'font-weight: 700'}; }`);
    mark = `<div id="${id}-wordmark">${escapeHtml(name)}</div>`;
  }
  parts.markup.push(`<div id="${id}-lockup-frame" class="${PLACEMENT_CLASS.lockup}"><div id="${id}-lockup">${mark}</div></div>`);
  parts.tweens.push(
    `tl.fromTo("#${id}-lockup", { opacity: 0, y: ${num(design.frame.height * 0.012)} }, { opacity: 1, y: 0, duration: 1.1, ease: ${ease} }, 0);`,
  );
}

/** The headline, the address and the mark, arriving 0.22 s apart: the Remotion `CtaEndCard`. */
function endCardShot(packet: ScenePacket, design: DesignTokens, parts: Parts, ease: string): void {
  const id = packet.frameId;
  const blocks = packet.typeset?.blocks ?? [];
  const headline = blocks.find((block) => block.part === 'headline');
  const address = blocks.find((block) => block.part === 'address');
  const wordmark = blocks.find((block) => block.part === 'wordmark');
  const logoBox = packet.typeset?.logo ?? null;

  parts.styles.push(
    `#${id}-mark { margin-top: ${px(logoBox?.marginTopPx ?? wordmark?.marginTopPx ?? design.space(4))}; display: flex; align-items: center; }`,
  );
  const markup: string[] = [];
  if (headline) {
    parts.styles.push(`#${id}-headline { ${typeStyle(headline)}; }`);
    markup.push(`<div id="${id}-headline">${headline.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>`);
    parts.tweens.push(
      `tl.fromTo("#${id}-headline", { opacity: 0, y: ${num(design.frame.height * 0.015)} }, { opacity: 1, y: 0, duration: 0.8, ease: ${ease} }, 0);`,
    );
  }
  if (address) {
    parts.styles.push(`#${id}-address { ${typeStyle(address)}; margin-top: ${px(address.marginTopPx)}; }`);
    markup.push(`<div id="${id}-address">${escapeHtml(address.lines.join(' '))}</div>`);
    parts.tweens.push(`tl.fromTo("#${id}-address", { opacity: 0 }, { opacity: 1, duration: 0.7, ease: ${ease} }, 0.22);`);
  }
  if (packet.brand.logo) {
    parts.styles.push(`#${id}-logo { height: ${px(logoBox?.heightPx ?? design.type.statement.sizePx * 0.62)}; width: auto; }`);
    markup.push(`<div id="${id}-mark"><img id="${id}-logo" src="${packet.brand.logo.path}" alt=""></div>`);
  } else if (wordmark) {
    parts.styles.push(`#${id}-wordmark { ${typeStyle(wordmark)}; }`);
    markup.push(`<div id="${id}-mark"><div id="${id}-wordmark">${escapeHtml(wordmark.lines.join(' '))}</div></div>`);
  }
  parts.tweens.push(`tl.fromTo("#${id}-mark", { opacity: 0 }, { opacity: 1, duration: 0.7, ease: ${ease} }, 0.44);`);
  parts.markup.push(`<div id="${id}-card" class="${PLACEMENT_CLASS.end_card}">${markup.join('')}</div>`);
}

/** The Remotion engine's figure formatting, for the first frame of a count. */
function formatLike(original: string, value: number): string {
  const decimals = original.includes('.') ? (original.split('.')[1]?.length ?? 0) : 0;
  const rounded = value.toFixed(decimals);
  return original.includes(',') ? Number(rounded).toLocaleString('en-US', { minimumFractionDigits: decimals }) : rounded;
}

/** A frame id as part of a script identifier: `scene-03` becomes `scene03`. */
function idVar(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '');
}

function px(value: number): string {
  return `${num(value)}px`;
}

function num(value: number): number {
  return Math.round(value * 1000) / 1000;
}
