import { z } from 'zod';

/**
 * How a product screenshot becomes shots.
 *
 * A screenshot is source material. It is not a shot, and the difference is
 * not a stylistic preference: a capture placed whole on a coloured canvas at
 * eighty per cent width with a four per cent push on it shows a customer's
 * interface at a size where nothing in it can be read, for the length of a
 * beat, with a camera move small enough to be a rendering artefact. Every
 * product in the world gets the same treatment and the film is a deck.
 *
 * What a film does instead is decide what the screen is *about* and point at
 * that: who this record is, what was done to it, what happened as a result.
 * All three are already in the pixels of one capture. This module is the plan
 * for finding them and moving the frame between them.
 *
 * Two rules constrain the whole thing.
 *
 * The first is fidelity. Every framing is a rectangle of the REAL capture.
 * Nothing here redraws, approximates, relights or regenerates any part of a
 * customer's interface, and a framing tighter than the source can support is
 * refused rather than upscaled into mush — the plan widens instead and says
 * so in its notes.
 *
 * The second is that intent and material are never inferred from each other.
 * When the source cannot carry the sequence that was planned, that is a note
 * on the plan — production fell short — and never a silent decision that this
 * film did not want product cinematography after all.
 */

const unit = z.number().min(0).max(1);

export const UiRegion = z.object({
  /** Normalised to the capture: 0..1 of its width and height. */
  x: unit,
  y: unit,
  width: unit,
  height: unit,
  /** How much of the capture's ink this region holds, 0..1. */
  weight: unit,
  /** Ink per unit area: a dense control panel scores higher than a sparse hero. */
  density: unit,
});
export type UiRegion = z.infer<typeof UiRegion>;

export const UiStructure = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** The colour the interface sits on, as the capture actually shows it. */
  background: z.object({ r: z.number(), g: z.number(), b: z.number() }),
  /** Regions, strongest first. */
  regions: z.array(UiRegion).default([]),
});
export type UiStructure = z.infer<typeof UiStructure>;

export const FramingRect = z.object({ x: unit, y: unit, width: unit, height: unit });
export type FramingRect = z.infer<typeof FramingRect>;

/**
 * What the camera does across one framing.
 *
 * `settle` is the arrival: the frame comes to rest, which is the only move
 * that may begin the sequence. `push` and `pull` change the size of the
 * subject, `lateral` holds the size and travels across the interface — the
 * move that connects two panels that sit side by side, and the one that makes
 * a screen read as a place rather than a picture. `hold` is a locked frame,
 * which a cut can land on without the shot feeling unfinished.
 */
export const FramingMove = z.enum(['settle', 'push', 'pull', 'lateral', 'hold']);
export type FramingMove = z.infer<typeof FramingMove>;

/**
 * What the framing is for, in the order a viewer needs it.
 *
 * Interfaces are built the same way stories are. Something is the subject of
 * the screen, something was done, something came of it. Naming the roles is
 * what lets a sequence be cut rather than merely ordered.
 */
export const FramingRole = z.enum(['establish', 'subject', 'action', 'result', 'context']);
export type FramingRole = z.infer<typeof FramingRole>;

/** Where the scene's words sit inside this frame — chosen from the picture, not a template. */
export const WordCorner = z.enum(['none', 'top_left', 'top_right', 'bottom_left', 'bottom_right']);
export type WordCorner = z.infer<typeof WordCorner>;

export const UiFraming = z.object({
  role: FramingRole,
  move: FramingMove,
  /** Crop of the source the frame holds at the start and at the end of the beat. */
  from: FramingRect,
  to: FramingRect,
  seconds: z.number().min(0.2).max(12),
  /** True when the sequence cuts into this framing rather than moving into it. */
  cut: z.boolean().default(true),
  /**
   * A rectangle of the source lifted off the interface.
   *
   * Same pixels, separated in depth: the plate behind it recedes a little and
   * softens, this stays sharp and carries a shadow. It is what a compositor
   * does to point at part of a still without drawing an arrow on it.
   */
  lift: FramingRect.nullable().default(null),
  words: WordCorner.default('none'),
  /** Which source region this framing was built around, for tracing and QA. */
  around: FramingRect.nullable().default(null),
});
export type UiFraming = z.infer<typeof UiFraming>;

export const UiSequence = z.object({
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
  background: z.object({ r: z.number(), g: z.number(), b: z.number() }),
  framings: z.array(UiFraming).default([]),
  /**
   * Where the plan fell short of what it wanted.
   *
   * Read by QA and by the director. A sequence that had to stay wide because
   * the capture is small is a production limit worth knowing about; it is not
   * evidence that the film wanted a wide shot.
   */
  notes: z.array(z.string()).default([]),
});
export type UiSequence = z.infer<typeof UiSequence>;

/**
 * How far a crop may be blown up to fill the frame.
 *
 * A capture taken at device-pixel-ratio 2 carries twice the detail of the
 * layout it shows, so a crop shown at 1.8x is roughly a 1:1 view of the
 * interface at its native size — soft at the edges of glyphs, the way a real
 * camera on a real screen is, and nothing like the smeared mess of pushing
 * into a 1x grab. Past that it stops being cinematography and starts being
 * evidence that we did not have the picture.
 */
export const MAX_UPSCALE = 1.8;

/**
 * How much wider a push starts than it ends.
 *
 * A third. Below about a quarter a push stops being a move and becomes a
 * rendering artefact — the thing every template does to every asset because
 * it has no reason to do anything in particular — and the viewer reads it as
 * a still image that is slightly unstable. The wide end is also the sharp
 * end, since less of the capture is being blown up, so the shot arrives soft
 * and resolves as it lands, which is what a lens does.
 */
const PUSH_FROM = 1.35;

/** Chrome: the application's own furniture, which is never the subject of a shot. */
const CHROME_BAND = 0.06;
/** A banner is short and near the top: a title bar, a record header, an identity block. */
const BANNER_HEIGHT = 0.16;
const BANNER_TOP = 0.28;
/** A result sits low and reads hot: a toast, a confirmation, a status line. */
const RESULT_TOP = 0.55;
const RESULT_HEIGHT = 0.2;

export type PlanUiOptions = {
  /** How long the whole shot runs. */
  seconds: number;
  /** Width over height of the film's frame. */
  frameAspect: number;
  /** Pixels across the frame actually being rendered. */
  renderWidth: number;
  /** True when the scene carries on-screen words that have to live in the picture. */
  hasWords?: boolean;
};

/**
 * The tightest crop this source can carry, as a share of its width.
 *
 * This is the whole fidelity budget in one number, and it drives the shot
 * sizes rather than the other way round: on a 2324px capture filling a 1920
 * frame it allows a crop of just under half the screen — a panel, a medium
 * shot — and on a 1200px one it allows almost nothing, so the plan stays wide
 * and says why. A director who insists on the close-up anyway gets a picture
 * the customer can see is broken.
 */
export function minCropWidth(sourceWidth: number, renderWidth: number): number {
  if (sourceWidth <= 0) return 1;
  return Math.min(1, renderWidth / (MAX_UPSCALE * sourceWidth));
}

/**
 * Plan the sequence.
 *
 * Deterministic, from the structure alone: no model call, no per-customer
 * code, nothing that can invent a region that is not in the capture. The
 * ordering is the argument — establish the screen, say who or what it is
 * about, show the work, land on what came of it — and each step is only
 * included when the capture actually holds a region that plays that part.
 */
export function planUiSequence(structure: UiStructure, options: PlanUiOptions): UiSequence {
  const notes: string[] = [];
  const { frameAspect, renderWidth } = options;
  const wanted = minCropWidth(structure.width, renderWidth);
  const full = fitRect({ x: 0, y: 0, width: 1, height: 1 }, structure, frameAspect);

  if (wanted >= 0.92) {
    notes.push(
      `capture is ${structure.width}px across, which cannot carry a crop tighter than ` +
        `${Math.round(wanted * 100)}% of its width at this frame size; the sequence stays wide`,
    );
  }
  /*
   * The widest shot this capture has is the whole of it, cropped to the
   * frame's shape — and on a small capture that is already a blow-up. There
   * is no framing that fixes it, so the floor becomes what is achievable and
   * the shortfall is written down. Silently exempting the establishing frame
   * from the budget would have been the easy move and the wrong one: the
   * picture is soft either way, and the only question is whether anything
   * downstream is ever told.
   */
  const floor = Math.min(wanted, full.width);
  if (full.width < wanted - 0.001) {
    const across = Math.round(full.width * structure.width);
    notes.push(
      `even the whole capture is ${across}px across at this frame's shape, a ` +
        `${(renderWidth / Math.max(1, across)).toFixed(1)}× blow-up: no framing of it will look sharp`,
    );
  }

  const usable = structure.regions.filter(
    (region) => region.y + region.height > CHROME_BAND && region.width * region.height >= 0.01,
  );
  if (usable.length === 0) {
    notes.push('no panels were recoverable from this capture; the shot is a single held frame');
    return UiSequence.parse({
      sourceWidth: structure.width,
      sourceHeight: structure.height,
      background: structure.background,
      framings: [
        {
          role: 'establish',
          move: 'settle',
          from: inset(full, 1.04),
          to: full,
          seconds: options.seconds,
          cut: true,
          words: options.hasWords ? 'bottom_left' : 'none',
        },
      ],
      notes,
    });
  }

  const subject = pickSubject(usable);
  const result = pickResult(usable, subject);
  const action = pickAction(usable, [subject, result]);
  const context = pickContext(usable, [subject, result, action]);

  /*
   * Which beats the shot has room for.
   *
   * Four framings in three seconds is not an edit, it is a strobe. The beat
   * count comes off the running time first and the available regions second,
   * so a short scene gets two good shots rather than four unreadable ones.
   */
  const beats: { role: FramingRole; region: UiRegion | null }[] = [{ role: 'establish', region: null }];
  const room = Math.floor(options.seconds / 1.5);
  const candidates: { role: FramingRole; region: UiRegion | null }[] = [
    { role: 'subject', region: subject },
    { role: 'action', region: action },
    { role: 'result', region: result },
    { role: 'context', region: context },
  ];
  for (const candidate of candidates) {
    if (beats.length >= Math.max(2, Math.min(4, room))) break;
    if (!candidate.region) continue;
    beats.push(candidate);
  }
  if (beats.length === 1) {
    notes.push('the capture held no region tight enough to cut to; the shot is one move');
  }

  /*
   * Time.
   *
   * The establishing frame is the shortest: it is orientation, and holding it
   * is exactly the mistake that makes a product film feel like a slide. What
   * the viewer is meant to read gets the room.
   */
  const shares = beats.map((beat) => (beat.role === 'establish' ? 0.8 : 1.15));
  const total = shares.reduce((sum, share) => sum + share, 0);

  const framings: UiFraming[] = [];
  let previous: FramingRect | null = null;
  beats.forEach((beat, index) => {
    const seconds = Math.max(0.6, (options.seconds * shares[index]!) / total);
    if (!beat.region) {
      /*
       * The establishing frame is locked.
       *
       * The obvious thing is to drift it a few per cent, and the few per cent
       * is precisely the tell: a move too small to be read as a move is read
       * instead as a template that zooms everything slightly because it does
       * not know what else to do. A wide frame held for a beat and then cut
       * away from is ordinary film grammar and reads as confidence. The shot
       * gets its movement from the pushes and the travel that follow, where
       * there is something to move toward.
       */
      framings.push(
        UiFraming.parse({
          role: 'establish',
          move: 'hold',
          from: full,
          to: full,
          seconds: Math.min(seconds, 1.4),
          cut: true,
          words: 'none',
          around: null,
        }),
      );
      previous = full;
      return;
    }

    const target = frameOn(beat.region, structure, frameAspect, floor);
    /*
     * Move or cut.
     *
     * Two panels at the same size on the same band are connected by travelling
     * between them — the move says they are parts of one screen. Anything else
     * cuts, because a camera that crawls from a header to a toast at the other
     * end of the interface is a screen recording, not an edit.
     */
    const lateral = previous !== null && sameBand(previous, target);
    const openWide = widen(target, floor, frameAspect, structure, PUSH_FROM);
    framings.push(
      UiFraming.parse({
        role: beat.role,
        move: lateral ? 'lateral' : beat.role === 'result' ? 'hold' : 'push',
        from: lateral ? previous! : beat.role === 'result' ? target : openWide,
        to: target,
        seconds,
        cut: !lateral,
        /*
         * Depth, only where it means something. The result is the one part of
         * a screen a film is allowed to lift off the interface, because that
         * is what the interface itself is doing: the toast is already on top.
         */
        lift: beat.role === 'result' ? clampRect(beat.region) : null,
        words: options.hasWords && index === 1 ? quietCorner(structure, target) : 'none',
        around: clampRect(beat.region),
      }),
    );
    previous = target;
  });

  const tightest = Math.min(...framings.map((framing) => framing.to.width));
  if (tightest > 0.85 && framings.length > 1) {
    notes.push(
      `every framing in this sequence is wider than 85% of the capture, so the cuts will read as ` +
        `repetition rather than as shots`,
    );
  }

  return UiSequence.parse({
    sourceWidth: structure.width,
    sourceHeight: structure.height,
    background: structure.background,
    framings,
    notes,
  });
}

/**
 * The subject: what this screen is about.
 *
 * A record header, a candidate's name, a document title. Short, near the top
 * but below the application's own bars, and dense because it is set large.
 * Falling back to the heaviest region is wrong here — the heaviest region on
 * a working screen is the work, which is the next beat, not this one.
 */
function pickSubject(regions: UiRegion[]): UiRegion | null {
  const banners = regions.filter(
    (region) => region.height <= BANNER_HEIGHT && region.y <= BANNER_TOP && region.y >= CHROME_BAND * 0.5,
  );
  if (banners.length === 0) return null;
  return banners.sort((left, right) => left.y - right.y || right.density - left.density)[0] ?? null;
}

/** The result: small, low, and hot — a toast, a confirmation, a status. */
function pickResult(regions: UiRegion[], exclude: UiRegion | null): UiRegion | null {
  const found = regions.filter(
    (region) =>
      region !== exclude &&
      region.y >= RESULT_TOP &&
      region.height <= RESULT_HEIGHT &&
      region.width <= 0.55 &&
      region.density >= 0.3,
  );
  if (found.length === 0) return null;
  return found.sort((left, right) => right.density - left.density)[0] ?? null;
}

/** The action: the busiest substantial panel — where the product is doing its work. */
function pickAction(regions: UiRegion[], exclude: (UiRegion | null)[]): UiRegion | null {
  const found = regions.filter(
    (region) => !exclude.includes(region) && region.height > BANNER_HEIGHT * 0.6 && region.width * region.height >= 0.03,
  );
  if (found.length === 0) return null;
  return found.sort((left, right) => right.weight * right.density - left.weight * left.density)[0] ?? null;
}

/** Whatever carries the most of the screen's remaining substance. */
function pickContext(regions: UiRegion[], exclude: (UiRegion | null)[]): UiRegion | null {
  const found = regions.filter((region) => !exclude.includes(region));
  if (found.length === 0) return null;
  return found.sort((left, right) => right.weight - left.weight)[0] ?? null;
}

/**
 * A frame built around a region.
 *
 * The region is centred and the crop is opened out to the frame's aspect and
 * to the fidelity floor, then slid back inside the capture. Opening out is
 * not a compromise: a panel photographed with nothing around it has no
 * context, and a little of the neighbouring interface is what tells the
 * viewer they are still on the same screen.
 */
function frameOn(region: UiRegion, structure: UiStructure, frameAspect: number, floor: number): FramingRect {
  const width = Math.min(1, Math.max(floor, region.width * 1.28));
  const height = cropHeight(width, structure, frameAspect);
  return slideInside(
    {
      x: region.x + region.width / 2 - width / 2,
      y: region.y + region.height / 2 - height / 2,
      width,
      height,
    },
    height > 1 ? 1 : undefined,
  );
}

/** The same frame, opened out — where a push begins. */
function widen(
  rect: FramingRect,
  floor: number,
  frameAspect: number,
  structure: UiStructure,
  by: number,
): FramingRect {
  const width = Math.min(1, Math.max(floor, rect.width * by));
  const height = cropHeight(width, structure, frameAspect);
  return slideInside({
    x: rect.x + rect.width / 2 - width / 2,
    y: rect.y + rect.height / 2 - height / 2,
    width,
    height,
  });
}

/** A crop of this width, at the frame's aspect, measured in the source's own coordinates. */
function cropHeight(width: number, structure: UiStructure, frameAspect: number): number {
  const pixelsWide = width * structure.width;
  const pixelsHigh = pixelsWide / frameAspect;
  return pixelsHigh / structure.height;
}

/** The whole capture, letterboxed or pillarboxed into the frame's aspect. */
function fitRect(rect: FramingRect, structure: UiStructure, frameAspect: number): FramingRect {
  const height = cropHeight(rect.width, structure, frameAspect);
  if (height <= 1) {
    return slideInside({ ...rect, height, y: rect.y + rect.height / 2 - height / 2 });
  }
  const width = (1 * structure.height * frameAspect) / structure.width;
  return slideInside({ ...rect, width: Math.min(1, width), height: 1, y: 0, x: rect.x + rect.width / 2 - Math.min(1, width) / 2 });
}

/** Push a crop back inside the capture without resizing it — panning, not cropping further. */
function slideInside(rect: FramingRect, capHeight?: number): FramingRect {
  const width = Math.min(1, Math.max(0.02, rect.width));
  const height = Math.min(capHeight ?? 1, Math.max(0.02, rect.height));
  return {
    x: Number(Math.min(1 - width, Math.max(0, rect.x)).toFixed(4)),
    y: Number(Math.min(1 - height, Math.max(0, rect.y)).toFixed(4)),
    width: Number(width.toFixed(4)),
    height: Number(height.toFixed(4)),
  };
}

function inset(rect: FramingRect, by: number): FramingRect {
  const width = Math.min(1, rect.width * by);
  const height = Math.min(1, rect.height * by);
  return slideInside({
    x: rect.x + rect.width / 2 - width / 2,
    y: rect.y + rect.height / 2 - height / 2,
    width,
    height,
  });
}

function clampRect(region: UiRegion): FramingRect {
  return slideInside({ x: region.x, y: region.y, width: region.width, height: region.height });
}

/** Two frames the same size, overlapping vertically: a travel, not a cut. */
function sameBand(a: FramingRect, b: FramingRect): boolean {
  if (Math.abs(a.width - b.width) > 0.06) return false;
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const apart = Math.abs(a.x - b.x);
  return overlap > Math.min(a.height, b.height) * 0.45 && apart > 0.04;
}

/**
 * Where the words can go without covering the interface.
 *
 * The four quadrants of the crop are scored by how much of the capture's ink
 * each one holds, and the quietest wins. This is the whole of "typography
 * integrated into the scene": the type responds to the picture underneath it
 * instead of the picture being pushed aside to make room for a card.
 */
export function quietCorner(structure: UiStructure, crop: FramingRect): WordCorner {
  const corners: { name: WordCorner; rect: FramingRect }[] = [
    { name: 'top_left', rect: { x: crop.x, y: crop.y, width: crop.width / 2, height: crop.height / 2 } },
    { name: 'top_right', rect: { x: crop.x + crop.width / 2, y: crop.y, width: crop.width / 2, height: crop.height / 2 } },
    { name: 'bottom_left', rect: { x: crop.x, y: crop.y + crop.height / 2, width: crop.width / 2, height: crop.height / 2 } },
    {
      name: 'bottom_right',
      rect: { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2, width: crop.width / 2, height: crop.height / 2 },
    },
  ];
  let best: { name: WordCorner; ink: number } = { name: 'bottom_left', ink: Number.POSITIVE_INFINITY };
  for (const corner of corners) {
    let ink = 0;
    for (const region of structure.regions) {
      const w = Math.max(0, Math.min(corner.rect.x + corner.rect.width, region.x + region.width) - Math.max(corner.rect.x, region.x));
      const h = Math.max(0, Math.min(corner.rect.y + corner.rect.height, region.y + region.height) - Math.max(corner.rect.y, region.y));
      ink += w * h * region.density;
    }
    if (ink < best.ink) best = { name: corner.name, ink };
  }
  return best.name;
}
