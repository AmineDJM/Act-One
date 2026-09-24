import type { MotionRecipeName } from '@act-one/core';
import type { DesignTokens } from '@act-one/design';
import type { StagedAsset } from './assets.ts';
import { escapeHtml } from './captions.ts';
import { cssColour } from './tokens.ts';
import { PLACEMENT_CLASS, type ProductWindowBox } from './studio.ts';
import type { InFrameWords, TypesetBlock } from './typeset.ts';
import { FILMED_RECIPES, filmedSequence, type FilmedSequence, type Framing, type Rect } from './ui-sequence.ts';
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

/**
 * The capture filmed as its sequence of framings: the Remotion `UiCinema`.
 *
 * Each framing is the camera on the still, moving from one crop to another
 * so the crop exactly fills the frame, cutting in with a hair of settle,
 * lifting a region off the interface where production found one, and setting
 * the scene's words in the corner the planner chose. A framing whose
 * interface was taken apart moves each part on its own clock (the Remotion
 * `LayeredShot`), and one set in a volume hangs its panels in a constructed
 * space (the Remotion `VolumeShot`).
 */
function filmedShot(packet: ScenePacket, design: DesignTokens, picture: StagedAsset, sequence: FilmedSequence, parts: Parts): void {
  const id = packet.frameId;
  const token = idVar(id);
  const { width: W, height: H } = design.frame;
  const mounted = packet.timing.mountedSeconds;
  const leavesByCut = packet.timing.leaves === null;
  const beatEnd = packet.timing.beatStart + packet.timing.beatDuration;

  let cursor = 0;
  const drawn: FilmedFraming[] = [];
  sequence.framings.forEach((framing, index) => {
    const start = cursor;
    cursor += framing.seconds;
    if (start >= mounted - 0.001) return;
    const last = index === sequence.framings.length - 1;
    drawn.push({
      framing,
      key: `${id}-f${index + 1}`,
      number: index + 1,
      start,
      // Each framing is cut away at its own end; the last one holds for as long as the scene is mounted.
      seconds: last ? mounted - start : Math.min(framing.seconds, mounted - start),
      // What a framing holds clears where it ends: at the cut to the next framing, or at the beat's end when the scene leaves by a cut.
      clearsAt: last ? (leavesByCut ? beatEnd : null) : start + framing.seconds,
      last,
    });
  });

  parts.styles.push(
    `.${id}-framing { position: absolute; inset: 0; }`,
    `.${id}-plate { position: absolute; max-width: none; display: block; }`,
    // A lens falls off at the corners; nothing else is added to the picture.
    `.${id}-vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(120% 110% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.26) 100%); }`,
  );
  const kinds = new Set(drawn.map((entry) => framingKind(entry.framing)));
  // A taken-apart or volume framing is held by a plain wrapper; its ground is inside it.
  if (kinds.has('layered') || kinds.has('volume')) parts.styles.push(`.${id}-wrap { position: absolute; inset: 0; }`);
  if (kinds.has('plate')) plateSetup(id, token, W, H, sequence, parts);
  if (kinds.has('layered')) layeredSetup(id, token, design, sequence, parts);
  if (kinds.has('volume')) volumeSetup(id, token, design, sequence, parts);

  for (const entry of drawn) {
    const { framing, key, start, clearsAt } = entry;
    const kind = framingKind(framing);
    const markup =
      kind === 'plate'
        ? plateFraming(packet, entry, token, H, picture, parts)
        : kind === 'layered'
          ? layeredFraming(packet, entry, token, picture, parts)
          : volumeFraming(packet, entry, token, design, picture, sequence, parts);
    // Words behind the product are part of the volume; everywhere else the line sits in the framing's quiet corner.
    const cornerWords = packet.inFrameWords && framing.words !== 'none' && !(kind === 'volume' && framing.wordsBehind);
    if (cornerWords) markup.push(wordsInFrame(packet, packet.inFrameWords!, design, key, framing.words as Exclude<Framing['words'], 'none'>, start, clearsAt, parts));
    if (entry.last && clearsAt !== null) {
      parts.tweens.push(`tl.fromTo("#${key}-ground", { opacity: 1 }, { opacity: 0, duration: 0.3, ease: "none", immediateRender: false }, ${num(Math.max(start, clearsAt - 0.3))});`);
    }
    const ground = kind === 'plate' ? `${id}-ground` : `${id}-wrap`;
    parts.markup.push(
      `<div id="${key}" class="clip ${id}-framing" data-start="${num(start)}" data-duration="${num(entry.seconds)}" data-track-index="1"><div id="${key}-ground" class="${ground}">${markup.join('')}</div></div>`,
    );
  }
}

type FilmedFraming = { framing: Framing; key: string; number: number; start: number; seconds: number; clearsAt: number | null; last: boolean };

/** Three kinds of shot, in order of how much of the interface moves, chosen as the Remotion `Shot` chooses. */
function framingKind(framing: Framing): 'plate' | 'layered' | 'volume' {
  if (framing.layers.length === 0) return 'plate';
  return framing.space === 'volume' ? 'volume' : 'layered';
}

/**
 * The camera's clock: the product's own when it brings something on screen.
 *
 * The frame opens as the toast rises, on that layer's timing, rather than on
 * the shot's; otherwise a lateral travels evenly and a push decelerates onto
 * its subject.
 */
function cameraOf(framing: Framing, recipeEase: string): { curve: string; delay: number; seconds: number; arriving: boolean } {
  const arriving =
    framing.layers.find((layer) => layer.role === 'overlay' && layer.motion !== 'hold') ??
    framing.layers.find((layer) => layer.role === 'control' && layer.motion !== 'hold');
  if (arriving) return { curve: 'out_expo', delay: arriving.delaySeconds, seconds: arriving.durationSeconds, arriving: true };
  const curve = framing.move === 'lateral' || framing.move === 'hold' ? 'linear' : recipeEase;
  return { curve, delay: 0, seconds: framing.seconds, arriving: false };
}

function plateSetup(id: string, token: string, W: number, H: number, sequence: FilmedSequence, parts: Parts): void {
  parts.styles.push(
    `.${id}-ground { position: absolute; inset: 0; overflow: hidden; background: rgb(${sequence.background.r}, ${sequence.background.g}, ${sequence.background.b}); }`,
    `.${id}-move { position: absolute; inset: 0; transform-origin: 50% 50%; }`,
    `.${id}-lift { position: absolute; overflow: hidden; border-radius: var(--ao-radius-md); transform-origin: 50% 50%; }`,
  );
  parts.tweens.push(
    `function ${token}Place(plate, lift, liftImage, from, to, cut, t) {`,
    `  var x = from[0] + (to[0] - from[0]) * t, y = from[1] + (to[1] - from[1]) * t, w = from[2] + (to[2] - from[2]) * t, h = from[3] + (to[3] - from[3]) * t;`,
    `  var iw = ${W} / Math.max(0.02, w), ih = iw * ${exact(sequence.sourceHeight / sequence.sourceWidth)};`,
    `  plate.style.left = (-x * iw) + "px"; plate.style.top = (-y * ih) + "px"; plate.style.width = iw + "px"; plate.style.height = ih + "px";`,
    `  if (!lift) return;`,
    `  lift.style.left = ((cut[0] - x) / w) * ${W} + "px"; lift.style.top = ((cut[1] - y) / h) * ${H} + "px"; lift.style.width = (cut[2] / w) * ${W} + "px"; lift.style.height = (cut[3] / h) * ${H} + "px";`,
    `  liftImage.style.left = (-cut[0] * iw) + "px"; liftImage.style.top = (-cut[1] * ih) + "px"; liftImage.style.width = iw + "px"; liftImage.style.height = ih + "px";`,
    `}`,
  );
}

/** The camera on the still: a plate, the lift where production found one, and the vignette. */
function plateFraming(packet: ScenePacket, entry: FilmedFraming, token: string, H: number, picture: StagedAsset, parts: Parts): string[] {
  const { framing, key, number, start } = entry;
  const id = packet.frameId;
  const markup: string[] = [
    `<div id="${key}-move" class="${id}-move"><img id="${key}-plate" class="${id}-plate" src="${picture.path}" alt=""></div>`,
  ];
  if (framing.lift) {
    markup.push(`<div id="${key}-lift" class="${id}-lift"><img id="${key}-lift-image" class="${id}-plate" src="${picture.path}" alt=""></div>`);
  }
  markup.push(`<div class="${id}-vignette"></div>`);

  const camera = cameraOf(framing, packet.recipe.easing);
  const at = (seconds: number) => num(start + seconds);
  const state = `${token}F${number}`;
  parts.tweens.push(
    `var ${state} = { t: 0 };`,
    `var ${state}Place = function () { ${token}Place(document.getElementById(${JSON.stringify(`${key}-plate`)}), ${framing.lift ? `document.getElementById(${JSON.stringify(`${key}-lift`)}), document.getElementById(${JSON.stringify(`${key}-lift-image`)})` : 'null, null'}, ${rectArray(framing.from)}, ${rectArray(framing.to)}, ${framing.lift ? rectArray(framing.lift) : 'null'}, ${state}.t); };`,
    `${state}Place();`,
    `tl.fromTo(${state}, { t: 0 }, { t: 1, duration: ${num(camera.seconds)}, ease: ActOne.ease(${JSON.stringify(camera.curve)}), onUpdate: ${state}Place }, ${at(camera.delay)});`,
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
  return markup;
}

/**
 * The interface taken apart: the Remotion `LayeredShot`.
 *
 * The capture drawn once per layer, each copy cut to one part and moving on
 * its own clock, all of them under the same camera. Every value is a function
 * of the framing's time, so one function sets them all from that time, the
 * way the Remotion component computes them from its frame; a render worker
 * that seeks out of order draws the same picture.
 */
function layeredSetup(id: string, token: string, design: DesignTokens, sequence: FilmedSequence, parts: Parts): void {
  const { width: W, height: H } = design.frame;
  parts.styles.push(
    `.${id}-stage { position: absolute; inset: 0; overflow: hidden; perspective: ${px(H * 2.2)}; background: rgb(${sequence.background.r}, ${sequence.background.g}, ${sequence.background.b}); }`,
    `.${id}-cutter { position: absolute; inset: 0; overflow: hidden; }`,
    `.${id}-shell { position: absolute; inset: 0; transform-origin: 50% 50%; }`,
    `.${id}-layer { position: absolute; overflow: hidden; transform-style: preserve-3d; }`,
    `.${id}-rounded { border-radius: ${px(design.radius.md)}; }`,
    // The one mark this system draws that is not in the capture: a ring leaving a control that was pressed.
    `.${id}-ring { position: absolute; display: none; border-radius: 999px; border: ${px(Math.max(2, H * 0.0022))} solid var(--ao-accent); pointer-events: none; }`,
  );
  parts.tweens.push(
    `function ${token}Layered(d, key, s) {`,
    `  var W = ${W}, H = ${H};`,
    `  function eased(curve, delay, duration) { return ActOne.ease(curve)(Math.min(1, Math.max(0, (s - delay) / duration))); }`,
    `  var c = eased(d.camera[0], d.camera[1], d.camera[2]);`,
    `  var x = d.from[0] + (d.to[0] - d.from[0]) * c, y = d.from[1] + (d.to[1] - d.from[1]) * c, w = d.from[2] + (d.to[2] - d.from[2]) * c, h = d.from[3] + (d.to[3] - d.from[3]) * c;`,
    `  var iw = W / Math.max(0.02, w), ih = iw * ${exact(sequence.sourceHeight / sequence.sourceWidth)};`,
    `  function box(r) { return [((r[0] - x) / w) * W, ((r[1] - y) / h) * H, (r[2] / w) * W, (r[3] / h) * H]; }`,
    `  function place(image, r) { image.style.left = -r[0] * iw + "px"; image.style.top = -r[1] * ih + "px"; image.style.width = iw + "px"; image.style.height = ih + "px"; }`,
    `  place(document.getElementById(key + "-plate"), [x, y]);`,
    // The shell falls back and softens so the part the shot is about takes the frame.
    `  if (d.shell) {`,
    `    var st = eased(d.shell.curve, d.shell.delay, d.shell.duration), shell = document.getElementById(key + "-shell");`,
    `    shell.style.transform = d.shell.motion === "recede" ? "translate3d(0, " + st * H * 0.012 + "px, " + -st * H * 0.42 + "px) scale(" + (1 - st * 0.06) + ")" : d.shell.motion === "advance" ? "scale(" + (1 + st * 0.05) + ")" : "none";`,
    `    shell.style.filter = d.shell.motion === "recede" ? "blur(" + st * 7 + "px) brightness(" + (1 - st * 0.45) + ") saturate(" + (1 - st * 0.3) + ")" : "";`,
    `  }`,
    // Holes cut in frame space, so a receding shell does not drag the gap away from what arrives in it.
    `  var holes = [];`,
    `  for (var i = 0; i < d.layers.length; i++) if (d.layers[i].knockout) { var hole = box(d.layers[i].rect); holes.push("M" + hole[0] + " " + hole[1] + "H" + (hole[0] + hole[2]) + "V" + (hole[1] + hole[3]) + "H" + hole[0] + "Z"); }`,
    `  document.getElementById(key + "-cutter").style.clipPath = holes.length ? 'path(evenodd, "M0 0H' + W + 'V' + H + 'H0Z ' + holes.join(" ") + '")' : "";`,
    `  for (var j = 0; j < d.layers.length; j++) {`,
    `    var L = d.layers[j], t = eased(L.curve, L.delay, L.duration), b = box(L.rect), ox = 0, oy = 0;`,
    // An emergence starts off its own edge by its own size, as the product draws it.
    `    if (L.motion === "emerge") { if (L.from === "below") oy = b[3] * 1.15 * (1 - t); if (L.from === "above") oy = -b[3] * 1.15 * (1 - t); if (L.from === "left") ox = -b[2] * 1.15 * (1 - t); if (L.from === "right") ox = b[2] * 1.15 * (1 - t); }`,
    `    if (L.motion === "parallax") ox = L.depth * H * 0.09 * (t - 0.5) * 2;`,
    `    var press = L.motion === "press" ? Math.sin(Math.min(1, t) * Math.PI) : 0, advance = L.motion === "advance" ? t : 0, lit = L.motion === "emerge" ? t : advance;`,
    `    var layer = document.getElementById(key + "-layer-" + (j + 1));`,
    `    layer.style.left = b[0] + "px"; layer.style.top = b[1] + "px"; layer.style.width = b[2] + "px"; layer.style.height = b[3] + "px";`,
    `    layer.style.transform = "translate3d(" + ox + "px, " + oy + "px, 0px) scale(" + (1 + advance * 0.06 - press * 0.05) + ")";`,
    `    layer.style.opacity = L.motion === "emerge" ? Math.min(1, t * 2.2) : 1;`,
    `    layer.style.boxShadow = L.motion === "emerge" || L.motion === "advance" ? "0 " + H * (0.012 + 0.014 * lit) + "px " + H * 0.05 + "px rgba(0,0,0," + 0.36 * lit + ")" : "";`,
    `    place(document.getElementById(key + "-layer-" + (j + 1) + "-image"), L.rect);`,
    `    var ring = document.getElementById(key + "-ring-" + (j + 1));`,
    `    if (!ring) continue;`,
    `    if (press > 0.02) { ring.style.display = "block"; ring.style.left = b[0] - b[3] * 0.5 + "px"; ring.style.top = b[1] - b[3] * 0.5 + "px"; ring.style.width = b[2] + b[3] + "px"; ring.style.height = b[3] * 2 + "px"; ring.style.opacity = (1 - Math.min(1, t)) * 0.75; ring.style.transform = "scale(" + (1 + Math.min(1, t) * 0.35) + ")"; }`,
    `    else ring.style.display = "none";`,
    `  }`,
    `}`,
  );
}

function layeredFraming(packet: ScenePacket, entry: FilmedFraming, token: string, picture: StagedAsset, parts: Parts): string[] {
  const { framing, key, number, start } = entry;
  const id = packet.frameId;
  const recipeEase = packet.recipe.easing;
  const shell = framing.layers.find((layer) => layer.role === 'shell') ?? null;
  const rest = framing.layers.filter((layer) => layer.role !== 'shell');
  const camera = cameraOf(framing, recipeEase);
  const data = {
    camera: [camera.curve, camera.delay, camera.seconds],
    from: rectValues(framing.from),
    to: rectValues(framing.to),
    shell: shell ? { motion: shell.motion, curve: layerCurve(shell.motion, recipeEase), delay: shell.delaySeconds, duration: shell.durationSeconds } : null,
    layers: rest.map((layer) => ({
      motion: layer.motion,
      curve: layerCurve(layer.motion, recipeEase),
      delay: layer.delaySeconds,
      duration: layer.durationSeconds,
      rect: rectValues(layer.rect),
      depth: layer.depth,
      from: layer.from,
      knockout: layer.knockout,
    })),
  };

  const layers = rest.map((layer, index) => {
    const name = `${key}-layer-${index + 1}`;
    const rounded = layer.role === 'overlay' || layer.role === 'control' ? ` ${id}-rounded` : '';
    const ring = layer.motion === 'press' ? `<div id="${key}-ring-${index + 1}" class="${id}-ring"></div>` : '';
    return `<div id="${name}" class="${id}-layer${rounded}"><img id="${name}-image" class="${id}-plate" src="${picture.path}" alt=""></div>${ring}`;
  });
  const markup = [
    `<div class="${id}-stage"><div id="${key}-cutter" class="${id}-cutter"><div id="${key}-shell" class="${id}-shell"><img id="${key}-plate" class="${id}-plate" src="${picture.path}" alt=""></div></div>${layers.join('')}</div>`,
    `<div class="${id}-vignette"></div>`,
  ];

  const state = `${token}F${number}`;
  parts.tweens.push(
    `var ${state} = { s: 0 };`,
    `var ${state}Data = ${JSON.stringify(data)};`,
    `var ${state}Draw = function () { ${token}Layered(${state}Data, ${JSON.stringify(key)}, ${state}.s); };`,
    `${state}Draw();`,
    `tl.fromTo(${state}, { s: 0 }, { s: ${num(entry.seconds)}, duration: ${num(entry.seconds)}, ease: "none", onUpdate: ${state}Draw }, ${num(start)});`,
  );
  // A cut lands on the whole shot here, words and all, as the Remotion wrapper scales everything it holds.
  if (framing.cut) parts.tweens.push(`tl.fromTo("#${key}-ground", { scale: 1.02 }, { scale: 1, duration: 0.22, ease: ActOne.ease("out_quint") }, ${num(start)});`);
  return markup;
}

/** How a layer moves: an emergence decelerates, a press is even, anything else follows the recipe. */
function layerCurve(motion: string, recipeEase: string): string {
  if (motion === 'emerge') return 'out_expo';
  if (motion === 'press') return 'linear';
  return recipeEase;
}

/**
 * Real interface in a constructed space: the Remotion `VolumeShot`.
 *
 * The environment is the brand's colour and the capture's own; the panels are
 * the product at its own proportions, up to three of them at three depths,
 * the far ones defocused, with a camera dollying past them.
 */
function volumeSetup(id: string, token: string, design: DesignTokens, sequence: FilmedSequence, parts: Parts): void {
  const { width: W, height: H } = design.frame;
  const accent = cssColour(design.accent);
  const { r, g, b } = sequence.background;
  const ground = `rgb(${Math.round(r * 0.16)}, ${Math.round(g * 0.16)}, ${Math.round(b * 0.2)})`;
  const display = design.type.display;
  const reflection = 'linear-gradient(to top, transparent 4%, rgba(0,0,0,0.9) 100%)';
  parts.styles.push(
    `.${id}-volume { position: absolute; inset: 0; overflow: hidden; background: var(--ao-canvas); }`,
    `.${id}-environment { position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 120%, ${accent}38 0%, transparent 62%),radial-gradient(90% 70% at 18% 8%, ${accent}22 0%, transparent 58%),linear-gradient(175deg, ${ground} 0%, var(--ao-canvas) 58%, ${ground} 100%); }`,
    `.${id}-bands { position: absolute; inset: -20%; background: linear-gradient(90deg, transparent 0%, ${accent}1f 22%, transparent 34%, transparent 62%, ${accent}14 74%, transparent 88%); filter: blur(38px); }`,
    // Sized to fit rather than to impress, and set back behind the panels: dimmed and slightly soft.
    `.${id}-behind { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: var(--ao-display-family); font-size: ${px(display.sizePx * 0.82)}; font-weight: ${display.weight}; letter-spacing: ${display.tracking}em; line-height: 1.06; text-align: center; color: var(--ao-primary); text-transform: none; max-width: ${px(design.grid.safe.width * 0.82)}; margin-inline: auto; overflow: hidden; filter: blur(1.5px); padding: 0 ${px(design.grid.safe.x)}; }`,
    `.${id}-lens { position: absolute; inset: 0; perspective: ${px(H * 1.9)}; perspective-origin: 50% 46%; }`,
    `.${id}-dolly { position: absolute; inset: 0; transform-style: preserve-3d; }`,
    `.${id}-panel { position: absolute; transform-style: preserve-3d; }`,
    `.${id}-surface { position: absolute; inset: 0; overflow: hidden; border-radius: ${px(design.radius.lg)}; box-shadow: 0 ${px(H * 0.035)} ${px(H * 0.09)} rgba(0,0,0,0.55); }`,
    // The floor takes the light back, which is what says "space".
    `.${id}-reflection { position: absolute; left: 0; overflow: hidden; transform: scaleY(-1); transform-origin: top; opacity: 0.16; mask-image: ${reflection}; -webkit-mask-image: ${reflection}; filter: blur(3px); }`,
    `.${id}-volume-vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(118% 108% at 50% 44%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.42) 100%); }`,
  );
  parts.tweens.push(
    `function ${token}Volume(d, key, s) {`,
    `  var W = ${W}, H = ${H}, t = ActOne.ease(d.curve)(Math.min(1, Math.max(0, s / d.seconds)));`,
    `  document.getElementById(key + "-bands").style.transform = "rotate(-18deg) translateX(" + (t - 0.5) * W * 0.06 + "px)";`,
    `  var behind = document.getElementById(key + "-behind");`,
    `  if (behind) { behind.style.opacity = 0.2 + t * 0.06; behind.style.transform = "scale(" + (1.04 - t * 0.04) + ")"; }`,
    // A dolly forward with a slight drift across: a move a person could have made, not a turntable.
    `  document.getElementById(key + "-camera").style.transform = "translate3d(" + (0.5 - t) * W * 0.08 + "px, " + (t - 0.5) * H * 0.02 + "px, " + t * H * 0.34 + "px) rotateY(" + (0.5 - t) * 5 + "deg)";`,
    `  for (var i = 0; i < d.panels.length; i++) {`,
    `    var P = d.panels[i], arrive = ActOne.ease("out_expo")(Math.min(1, Math.max(0, (s - P.delay) / Math.max(0.5, P.duration)))), panel = document.getElementById(key + "-panel-" + (i + 1));`,
    `    panel.style.transform = "translate3d(0, " + (1 - arrive) * H * 0.05 + "px, " + P.z + "px) rotateY(" + P.turn + "deg)";`,
    `    panel.style.opacity = arrive;`,
    `  }`,
    `}`,
  );
}

function volumeFraming(
  packet: ScenePacket,
  entry: FilmedFraming,
  token: string,
  design: DesignTokens,
  picture: StagedAsset,
  sequence: FilmedSequence,
  parts: Parts,
): string[] {
  const { framing, key, number, start } = entry;
  const id = packet.frameId;
  const { width: W, height: H } = design.frame;
  const planes = framing.layers.filter((layer) => layer.role !== 'shell').slice(0, 3);
  const words = packet.onScreenText.join(' ');

  const panels = planes.map((layer, index) => {
    const spread = index - (planes.length - 1) / 2;
    /*
     * A panel from another capture takes that capture's proportions; one whose
     * capture could not be staged falls back to the shot's own, as the
     * Remotion engine does with a source it could not resolve.
     */
    const source = layer.source ?? picture.path;
    const sw = layer.sourceWidth ?? sequence.sourceWidth;
    const sh = layer.sourceHeight ?? sequence.sourceHeight;
    const panelWidth = W * (index === 0 ? 0.58 : 0.46);
    const panelHeight = (panelWidth * (layer.rect.height * sh)) / (layer.rect.width * sw);
    const imageWidth = panelWidth / Math.max(0.02, layer.rect.width);
    const imageHeight = imageWidth * (sh / sw);
    const far = Math.max(0, -layer.depth);
    const name = `${key}-panel-${index + 1}`;
    const image = `left: ${px(-layer.rect.x * imageWidth)}; top: ${px(-layer.rect.y * imageHeight)}; width: ${px(imageWidth)}; height: ${px(imageHeight)};`;
    parts.styles.push(
      `#${name} { left: ${px(W / 2 - panelWidth / 2 + spread * panelWidth * 0.82)}; top: ${px(H / 2 - panelHeight / 2 + spread * H * 0.06)}; width: ${px(panelWidth)}; height: ${px(panelHeight)}; }`,
      // Only the planes behind the subject are defocused; the subject plane carries no filter at all.
      ...(far > 0 ? [`#${name}-surface { filter: blur(${num(far * 3.2)}px) brightness(${num(1 - far * 0.2)}); }`] : []),
      `#${name}-image, #${name}-mirror { ${image} }`,
      `#${name}-reflection { top: ${px(panelHeight)}; width: ${px(panelWidth)}; height: ${px(panelHeight * 0.5)}; }`,
    );
    return {
      markup: `<div id="${name}" class="${id}-panel"><div id="${name}-surface" class="${id}-surface"><img id="${name}-image" class="${id}-plate" src="${source}" alt=""></div><div id="${name}-reflection" class="${id}-reflection"><img id="${name}-mirror" class="${id}-plate" src="${source}" alt=""></div></div>`,
      data: { delay: layer.delaySeconds, duration: layer.durationSeconds, z: layer.depth * H * 0.55, turn: -spread * 13 },
    };
  });

  const behind = words && framing.wordsBehind ? `<div id="${key}-behind" class="${id}-behind">${escapeHtml(words)}</div>` : '';
  const markup = [
    `<div class="${id}-volume"><div class="${id}-environment"></div><div id="${key}-bands" class="${id}-bands"></div>${behind}<div class="${id}-lens"><div id="${key}-camera" class="${id}-dolly">${panels.map((panel) => panel.markup).join('')}</div></div><div class="${id}-volume-vignette"></div></div>`,
  ];

  const state = `${token}F${number}`;
  const data = { curve: packet.recipe.easing, seconds: framing.seconds, panels: panels.map((panel) => panel.data) };
  parts.tweens.push(
    `var ${state} = { s: 0 };`,
    `var ${state}Data = ${JSON.stringify(data)};`,
    `var ${state}Draw = function () { ${token}Volume(${state}Data, ${JSON.stringify(key)}, ${state}.s); };`,
    `${state}Draw();`,
    `tl.fromTo(${state}, { s: 0 }, { s: ${num(entry.seconds)}, duration: ${num(entry.seconds)}, ease: "none", onUpdate: ${state}Draw }, ${num(start)});`,
  );
  return markup;
}

/** A crop as the scripts take it, at full precision: a thousandth of a capture is pixels on a wide one. */
function rectValues(rect: Rect): [number, number, number, number] {
  return [rect.x, rect.y, rect.width, rect.height];
}

function rectArray(rect: Rect): string {
  return JSON.stringify(rectValues(rect));
}

/** A number written into a script exactly, as the Remotion engine computes with it. */
function exact(value: number): string {
  return JSON.stringify(value);
}

/** The scene's words in the quiet corner of a framing, over a scrim anchored to it: the Remotion `WordsInFrame`. */
function wordsInFrame(
  packet: ScenePacket,
  words: InFrameWords,
  design: DesignTokens,
  key: string,
  corner: Exclude<Framing['words'], 'none'>,
  start: number,
  clearsAt: number | null,
  parts: Parts,
): string {
  const H = design.frame.height;
  const top = corner === 'top_left' || corner === 'top_right';
  const leftSide = corner === 'top_left' || corner === 'bottom_left';
  const margin = words.marginPx;
  const blockWidth = words.widthPx;
  const lineHeight = words.fontSizePx * words.lineHeight;
  const at = (offset: number) => num(start + offset);

  parts.styles.push(
    `#${key}-scrim { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(84% 68% at ${leftSide ? '6%' : '94%'} ${top ? '8%' : '92%'}, rgba(6,6,10,0.86) 0%, rgba(6,6,10,0.62) 34%, rgba(6,6,10,0.18) 66%, rgba(6,6,10,0) 100%); }`,
    `#${key}-words { position: absolute; ${top ? 'top' : 'bottom'}: ${px(margin)}; ${leftSide ? 'left' : 'right'}: ${px(margin)}; width: ${px(blockWidth)}; display: flex; flex-direction: column; align-items: ${leftSide ? 'flex-start' : 'flex-end'}; gap: ${px(words.gapPx)}; }`,
    `#${key}-rule { width: ${px(words.ruleWidthPx)}; height: 3px; background: var(--ao-accent); border-radius: 2px; }`,
    `#${key}-shadow { text-shadow: 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.02)}px rgba(0,0,0,0.55); }`,
    `#${key}-lines { font-family: var(--ao-statement-family); font-size: ${px(words.fontSizePx)}; font-weight: ${words.weight}; line-height: ${words.lineHeight}; letter-spacing: ${words.trackingEm}em; color: #FFFFFF; text-align: ${leftSide ? 'left' : 'right'}; text-transform: none; font-kerning: normal; font-feature-settings: "kern" 1, "liga" 1, "calt" 1; text-rendering: geometricPrecision; margin: 0; }`,
    `.${key}-mask { overflow: hidden; height: ${px(lineHeight)}; }`,
  );
  parts.tweens.push(
    `tl.fromTo("#${key}-scrim", { opacity: 0 }, { opacity: 1, duration: 0.7, ease: ActOne.ease("out_quint") }, ${at(0.18)});`,
    `tl.fromTo("#${key}-words", { opacity: 0, y: ${num(H * 0.018)} }, { opacity: 1, y: 0, duration: 0.7, ease: ActOne.ease("out_quint") }, ${at(0.18)});`,
    ...words.lines.map(
      (_, index) =>
        `tl.fromTo("#${key}-line-${index + 1}", { y: ${num(lineHeight * 0.92)}, opacity: 0 }, { y: 0, opacity: 1, duration: 0.72, ease: ActOne.ease(${JSON.stringify(packet.recipe.easing)}) }, ${at(0.25 + index * 0.06)});`,
    ),
  );
  // The words clear with what holds them, as the Remotion WordReveal inside the framing does; a join carries them out whole.
  if (clearsAt !== null) {
    parts.tweens.push(`tl.fromTo("#${key}-lines", { opacity: 1 }, { opacity: 0, duration: ${DEFAULT_TAIL}, ease: "none", immediateRender: false }, ${num(Math.max(start, clearsAt - DEFAULT_TAIL))});`);
  }
  const lines = words.lines.map((line, index) => `<div class="${key}-mask"><div id="${key}-line-${index + 1}">${escapeHtml(line)}</div></div>`).join('');
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
