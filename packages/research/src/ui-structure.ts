import sharp from 'sharp';

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
export type UiRegion = {
  /** Normalised to the capture: 0..1 of its width and height. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** How much of the capture's ink this region holds, 0..1. */
  weight: number;
  /** Ink per unit area: a dense control panel scores higher than a sparse hero. */
  density: number;
};

export type UiStructure = {
  width: number;
  height: number;
  /** The colour the interface sits on, as the capture actually shows it. */
  background: { r: number; g: number; b: number };
  /** Regions, strongest first. */
  regions: UiRegion[];
};

/** Below this share of the capture, a region is a button rather than a panel. */
const MIN_REGION_AREA = 0.012;
/** A gutter has to be this many analysis rows/columns wide to split anything. */
const MIN_GUTTER = 3;

export async function readUiStructure(
  bytes: Uint8Array,
  options: { analysisWidth?: number } = {},
): Promise<UiStructure> {
  const width = options.analysisWidth ?? 260;
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

  return { width: info.width, height: info.height, background, regions };
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
