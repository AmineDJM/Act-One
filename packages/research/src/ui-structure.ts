import sharp from 'sharp';
import type { UiRegion, UiStructure } from '@act-one/core';

/**
 * What is actually in a product screenshot.
 *
 * A screenshot is source material, not a shot. Placed whole on a coloured
 * canvas at eighty per cent width with a four per cent push on it, the
 * customer's interface becomes a slide about their interface — legible,
 * inert, and indistinguishable from the same treatment of anybody else's
 * product. A film editor handed a screen grab does not show the screen. They
 * show the part that matters, big, and then the part that answers it.
 *
 * To do that automatically you have to know where the parts are. There is no
 * DOM here: a product image published on a marketing page arrives as pixels,
 * so the structure is recovered from the pixels, the way document layout
 * analysis has always done it — find the background, find where the ink is,
 * find the gutters between the columns of ink, and the panels fall out.
 *
 * Every region this returns is a rectangle of the REAL capture. Nothing here
 * invents, redraws or approximates any part of a customer's interface; the
 * only thing being decided is where to point the camera.
 */
export type { UiRegion, UiStructure } from '@act-one/core';

/** Below this share of the capture, a region is a button rather than a panel. */
const MIN_REGION_AREA = 0.012;
/** A gutter has to be this many analysis rows/columns wide to split anything. */
const MIN_GUTTER = 3;

export async function readUiStructure(
  bytes: Uint8Array,
  options: { analysisWidth?: number } = {},
): Promise<UiStructure> {
  const controls = await findControls(bytes).catch(() => [] as UiRegion[]);
  const width = options.analysisWidth ?? 260;
  /*
   * The size that is reported is the capture's, not the analysis raster's.
   *
   * Everything below works on a 260px reduction, because gutters and ink are
   * cheaper and cleaner to find at that size and the regions come back
   * normalised anyway. But the framing budget downstream asks how many real
   * pixels a crop of this thing would have, and answering 260 made every
   * capture look far too small to crop — a fidelity check computed against a
   * picture nobody is going to show.
   */
  const source = await sharp(Buffer.from(bytes)).metadata();
  const { data, info } = await sharp(Buffer.from(bytes))
    .resize({ width, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const channels = info.channels;
  const background = modalColour(data, w, h, channels);

  /*
   * Ink is where the picture changes, not where it differs from a colour.
   *
   * The first version of this called every pixel unlike the modal colour
   * "ink", which needs the modal colour to be right \u2014 and on a real capture
   * whose largest flat area is white while its commonest quantised bucket is
   * a mid grey from anti-aliased type, everything came back as ink and the
   * whole screen read as one region.
   *
   * Local gradient needs no such guess. Software is drawn as flat fields with
   * hard edges: type, borders, avatars, chart strokes and filled controls all
   * have edges, and the space between panels has none. That is the same
   * property the gutters below rely on, measured directly.
   */
  const ink = new Uint8Array(w * h);
  const grey = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p += 1) {
    const i = p * channels;
    grey[p] = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000;
  }
  for (let y = 0; y < h - 1; y += 1) {
    for (let x = 0; x < w - 1; x += 1) {
      const p = y * w + x;
      const edge = Math.abs(grey[p]! - grey[p + 1]!) + Math.abs(grey[p]! - grey[p + w]!);
      ink[p] = edge > 18 ? 1 : 0;
    }
  }

  const boxes = split({ ink, w, h, x0: 0, y0: 0, x1: w, y1: h }, 0);
  const totalInk = boxes.reduce((sum, box) => sum + box.ink, 0) || 1;

  const regions: UiRegion[] = boxes
    .map((box) => {
      const bw = (box.x1 - box.x0) / w;
      const bh = (box.y1 - box.y0) / h;
      return {
        x: Number((box.x0 / w).toFixed(4)),
        y: Number((box.y0 / h).toFixed(4)),
        width: Number(bw.toFixed(4)),
        height: Number(bh.toFixed(4)),
        weight: Number((box.ink / totalInk).toFixed(4)),
        density: Number((box.ink / Math.max(1, (box.x1 - box.x0) * (box.y1 - box.y0))).toFixed(4)),
      };
    })
    .filter((region) => region.width * region.height >= MIN_REGION_AREA)
    .sort((left, right) => right.weight - left.weight);

  return { width: source.width ?? info.width, height: source.height ?? info.height, background, regions, controls };
}

type Box = { ink: Uint8Array; w: number; h: number; x0: number; y0: number; x1: number; y1: number };
type Found = { x0: number; y0: number; x1: number; y1: number; ink: number };

/**
 * Recursive projection splitting, the oldest trick in layout analysis.
 *
 * Sum the ink along each row; a run of empty rows is a horizontal gutter, so
 * cut there and recurse on each half in the other direction. Interfaces are
 * built out of rectangles separated by whitespace, which is exactly the
 * assumption this makes, and it is why it finds a sidebar, a header and a
 * right-hand drawer without being told any of them exist.
 */
function split(box: Box, depth: number): Found[] {
  const trimmed = trim(box);
  if (!trimmed) return [];
  if (depth >= 3) return [measure(trimmed)];

  const horizontal = gutters(trimmed, 'rows');
  const vertical = gutters(trimmed, 'columns');
  // Cut along whichever axis separates the content more cleanly: the widest
  // gutter is the one a person would call the seam.
  const useRows = horizontal.widest >= vertical.widest && horizontal.widest >= MIN_GUTTER;
  const useColumns = !useRows && vertical.widest >= MIN_GUTTER;
  if (!useRows && !useColumns) return [measure(trimmed)];

  const cuts = useRows ? horizontal.cuts : vertical.cuts;
  const pieces: Found[] = [];
  let start = useRows ? trimmed.y0 : trimmed.x0;
  const end = useRows ? trimmed.y1 : trimmed.x1;
  for (const cut of [...cuts, end]) {
    if (cut - start < 4) {
      start = cut;
      continue;
    }
    pieces.push(
      ...split(
        useRows
          ? { ...trimmed, y0: start, y1: cut }
          : { ...trimmed, x0: start, x1: cut },
        depth + 1,
      ),
    );
    start = cut;
  }
  return pieces.length > 0 ? pieces : [measure(trimmed)];
}

/** Drop the empty margin around the ink, so a region is its content. */
function trim(box: Box): Box | null {
  let x0 = box.x1;
  let y0 = box.y1;
  let x1 = box.x0;
  let y1 = box.y0;
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      if (box.ink[y * box.w + x] === 0) continue;
      if (x < x0) x0 = x;
      if (x + 1 > x1) x1 = x + 1;
      if (y < y0) y0 = y;
      if (y + 1 > y1) y1 = y + 1;
    }
  }
  if (x1 <= x0 || y1 <= y0) return null;
  return { ...box, x0, y0, x1, y1 };
}

function measure(box: Box): Found {
  let ink = 0;
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) ink += box.ink[y * box.w + x]!;
  }
  return { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, ink };
}

/**
 * Where the quiet runs are along one axis, and how wide the widest is.
 *
 * Quiet rather than empty. Asked for rows holding no ink at all, a dense
 * application screenshot has none \u2014 every row from top to bottom crosses a
 * sidebar border or a row divider somewhere \u2014 and the whole screen comes back
 * as one region. What separates panels is not the absence of ink but a drop
 * in it, so a row counts as a gutter when it holds less than a small fraction
 * of the busiest row's.
 */
const QUIET_SHARE = 0.12;

function gutters(box: Box, along: 'rows' | 'columns'): { cuts: number[]; widest: number } {
  const outer = along === 'rows' ? { from: box.y0, to: box.y1 } : { from: box.x0, to: box.x1 };
  const inner = along === 'rows' ? { from: box.x0, to: box.x1 } : { from: box.y0, to: box.y1 };

  const profile: number[] = [];
  for (let a = outer.from; a < outer.to; a += 1) {
    let count = 0;
    for (let b = inner.from; b < inner.to; b += 1) {
      const index = along === 'rows' ? a * box.w + b : b * box.w + a;
      count += box.ink[index]!;
    }
    profile.push(count);
  }

  const busiest = Math.max(...profile, 1);
  const quiet = profile.map((count) => count <= busiest * QUIET_SHARE);

  const cuts: number[] = [];
  let widest = 0;
  let run = 0;
  for (let index = 0; index <= quiet.length; index += 1) {
    if (index < quiet.length && quiet[index]) {
      run += 1;
      continue;
    }
    if (run >= MIN_GUTTER) {
      // Cut through the middle of the gutter, which is where a person would.
      cuts.push(outer.from + index - Math.floor(run / 2));
      widest = Math.max(widest, run);
    }
    run = 0;
  }
  return { cuts, widest };
}

/** The colour the interface is drawn on, coarsely quantised so a gradient is one colour. */
function modalColour(
  data: Uint8Array | Buffer,
  w: number,
  h: number,
  channels: number,
): { r: number; g: number; b: number } {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 2 < w * h * channels; i += channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const entry = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    entry.n += 1;
    entry.r += r;
    entry.g += g;
    entry.b += b;
    counts.set(key, entry);
  }
  let best = { n: 0, r: 255, g: 255, b: 255 };
  for (const entry of counts.values()) if (entry.n > best.n) best = entry;
  return {
    r: Math.round(best.r / Math.max(1, best.n)),
    g: Math.round(best.g / Math.max(1, best.n)),
    b: Math.round(best.b / Math.max(1, best.n)),
  };
}

/**
 * The product's own primary actions.
 *
 * Everything above finds panels — areas of the screen with work in them. A
 * panel is not a thing you can press, and a shot that wants to show software
 * being operated needs the thing that takes the action, not the region it
 * lives in.
 *
 * Those are findable without a DOM, because of a convention every modern
 * interface follows: the primary action is a solid block of the brand's
 * colour, and nothing else on a working screen is a solid block of anything
 * saturated. Charts are thin, avatars are photographic, badges are pale,
 * type is not solid. So: quantise, keep the chromatic pixels, join them into
 * components, and keep the ones that are filled rectangles of button size and
 * button proportion.
 *
 * What comes back is a rectangle of the REAL capture, like everything else
 * here. It is never drawn over, recoloured or replaced; the only thing being
 * decided is where a shot may say "this is the thing that acts".
 */

/** Below this, a colour is interface grey rather than a brand. */
const CHROMA = 42;
/** A control is at least this fraction of the capture, and at most this. */
const MIN_CONTROL_AREA = 0.0004;
const MAX_CONTROL_AREA = 0.045;
/** Buttons are wider than tall, and not endlessly so. */
const MIN_ASPECT = 1.2;
const MAX_ASPECT = 9;
/**
 * What actually distinguishes a button: its rim.
 *
 * Two wrong tests came before this one and both are worth keeping a note of.
 * "Mostly the colour" found nothing, because a filled button carries a white
 * label, so the coloured component is a ring with a word-shaped hole and
 * fills about two fifths of its own box. "The box is entirely colour or
 * white" found nothing either, because at analysis scale a third of the box
 * is the anti-aliased blend between the two and is neither.
 *
 * The rim is immune to both. A filled control is a solid block, so its
 * outline is unbroken colour the whole way round whatever is written on it,
 * and nothing else on a working screen has that property: a chart is open, an
 * avatar is photographic, a badge is pale, a heading is letters.
 */
const MIN_RIM = 0.72;
/** And enough of the box is the colour that it is a block rather than an outline. */
const MIN_COLOUR = 0.4;

export async function findControls(
  bytes: Uint8Array,
  options: { analysisWidth?: number } = {},
): Promise<UiRegion[]> {
  const width = options.analysisWidth ?? 420;
  const { data, info } = await sharp(Buffer.from(bytes))
    .resize({ width, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const channels = info.channels;

  /*
   * Colour identity, not colour value.
   *
   * Two pixels of the same button differ by a few units from anti-aliasing
   * and from whatever gradient the designer used, so joining on exact colour
   * finds a hundred one-pixel components. Quantising to a coarse bucket makes
   * a button one colour and keeps it distinct from a different brand colour
   * eighty units away.
   */
  const key = new Int16Array(w * h).fill(-1);
  for (let p = 0; p < w * h; p += 1) {
    const i = p * channels;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (chroma < CHROMA) continue;
    key[p] = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
  }

  type Found = { colour: number; x0: number; y0: number; x1: number; y1: number; count: number };
  const seen = new Uint8Array(w * h);
  const parts: Found[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start += 1) {
    if (seen[start] || key[start] === -1) continue;
    const colour = key[start]!;
    const part: Found = { colour, x0: w, y0: h, x1: 0, y1: 0, count: 0 };
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p / w) | 0;
      part.count += 1;
      if (px < part.x0) part.x0 = px;
      if (px + 1 > part.x1) part.x1 = px + 1;
      if (py < part.y0) part.y0 = py;
      if (py + 1 > part.y1) part.y1 = py + 1;
      /*
       * Eight-connected, because a one-pixel diagonal is what a rounded
       * corner is at this scale, and four-connectivity cuts a button into
       * four pieces at its corners.
       */
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (seen[n] || key[n] !== colour) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (part.count > 2) parts.push(part);
  }

  /*
   * A label splits the ring.
   *
   * "Schedule" in white across a purple button leaves the colour above the
   * word and below it as two components that a person would never call two
   * things. Same colour, touching boxes, one control.
   */
  const merged: Found[] = [];
  for (const part of parts.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const host = merged.find(
      (other) =>
        other.colour === part.colour &&
        part.x0 <= other.x1 + 2 &&
        other.x0 <= part.x1 + 2 &&
        part.y0 <= other.y1 + 2 &&
        other.y0 <= part.y1 + 2,
    );
    if (!host) {
      merged.push({ ...part });
      continue;
    }
    host.x0 = Math.min(host.x0, part.x0);
    host.y0 = Math.min(host.y0, part.y0);
    host.x1 = Math.max(host.x1, part.x1);
    host.y1 = Math.max(host.y1, part.y1);
    host.count += part.count;
  }

  const found: UiRegion[] = [];
  for (const part of merged) {
    const bw = part.x1 - part.x0;
    const bh = part.y1 - part.y0;
    if (bw <= 0 || bh <= 0) continue;
    const area = (bw * bh) / (w * h);
    const aspect = bw / bh;
    if (area < MIN_CONTROL_AREA || area > MAX_CONTROL_AREA) continue;
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) continue;

    let colour = 0;
    for (let y = part.y0; y < part.y1; y += 1) {
      for (let x = part.x0; x < part.x1; x += 1) {
        if (key[y * w + x] === part.colour) colour += 1;
      }
    }
    if (colour / (bw * bh) < MIN_COLOUR) continue;

    /*
     * The outline, one pixel in from the box, so a rounded corner and the
     * half-pixel the resize smeared do not count against a solid control.
     */
    let rim = 0;
    let edge = 0;
    for (let x = part.x0; x < part.x1; x += 1) {
      for (const y of [part.y0, part.y1 - 1, part.y0 + 1, part.y1 - 2]) {
        if (y < part.y0 || y >= part.y1) continue;
        edge += 1;
        if (key[y * w + x] === part.colour) rim += 1;
      }
    }
    for (let y = part.y0; y < part.y1; y += 1) {
      for (const x of [part.x0, part.x1 - 1]) {
        if (x < part.x0 || x >= part.x1) continue;
        edge += 1;
        if (key[y * w + x] === part.colour) rim += 1;
      }
    }
    if (edge === 0 || rim / edge < MIN_RIM) continue;

    found.push({
      x: Number((part.x0 / w).toFixed(4)),
      y: Number((part.y0 / h).toFixed(4)),
      width: Number((bw / w).toFixed(4)),
      height: Number((bh / h).toFixed(4)),
      // A control's weight is how much of the screen it claims; its density
      // is one, because being solid is the property that found it.
      weight: Number(area.toFixed(4)),
      density: 1,
    });
  }

  // Biggest first: the primary action is drawn bigger than the secondary one,
  // which is the same convention that made it findable at all.
  return found.sort((left, right) => right.width * right.height - left.width * left.height).slice(0, 12);
}
