import { z } from 'zod';
import type { SoundCue } from './storyboard.ts';

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
  /**
   * Filled, saturated blocks: the product's own primary actions.
   *
   * A panel is where work happens; a control is the thing that takes the
   * action. Knowing the difference is what lets a shot press a button rather
   * than gesture at the area a button is somewhere inside, and it is
   * recoverable because every modern interface draws its primary action as a
   * solid block of the brand's colour and nothing else on the screen looks
   * like that.
   */
  controls: z.array(UiRegion).default([]),
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


/**
 * What a layer of an interface is.
 *
 * The first version of this module moved a camera across a still. That is a
 * real improvement on showing the whole still, and it is still one object:
 * whatever the camera does, every pixel on screen moves together, which is
 * the tell that what you are watching is a photograph of software rather than
 * software.
 *
 * An interface is not one object. It is a shell with things on it, and the
 * product itself already treats them as separate — a drawer slides, a toast
 * arrives, a modal comes forward and pushes the page back. Those are the
 * product's own motion semantics, and they are recoverable, because the
 * structure pass already found where the parts are.
 *
 * So a shot can hold the same capture several times over, each copy masked to
 * one part, each moving on its own. Every pixel is still the customer's real
 * interface at its real scale. Nothing is redrawn. What changes is that the
 * interface stops being a picture and starts being a set of objects, which is
 * the whole difference between a camera move and motion design.
 */
export const LayerRole = z.enum([
  /** The interface itself: the ground everything else sits on. */
  'shell',
  /** A working region — the part of the screen the shot is about. */
  'panel',
  /** Something the product draws on top of itself: a toast, a drawer, a modal. */
  'overlay',
  /** A control that is acted on: a filled button, a primary action. */
  'control',
  /** The application's own furniture. */
  'navigation',
]);
export type LayerRole = z.infer<typeof LayerRole>;

export const LayerMotion = z.enum([
  /** Locked to the shell: part of the picture. */
  'hold',
  /** Falls back in depth, softens and darkens, so something else can be read. */
  'recede',
  /** Comes forward and takes the frame. */
  'advance',
  /** Arrives the way the product draws it, from its own edge. */
  'emerge',
  /** Travels at a different rate to the shell, which is what makes depth read as depth. */
  'parallax',
  /** Is pressed: the real control takes the action, briefly and physically. */
  'press',
]);
export type LayerMotion = z.infer<typeof LayerMotion>;

/** Which edge a layer arrives from — the product's own direction, not a default. */
export const LayerFrom = z.enum(['below', 'above', 'left', 'right', 'behind']);
export type LayerFrom = z.infer<typeof LayerFrom>;

export const UiLayer = z.object({
  role: LayerRole,
  motion: LayerMotion,
  /** The rectangle of the SOURCE this layer is, normalised to the capture. */
  rect: FramingRect,
  /** Where it sits in depth: negative is behind the shell, positive in front. */
  depth: z.number().min(-1).max(1).default(0),
  /** Seconds into the framing before it moves. What makes choreography rather than a cue. */
  delaySeconds: z.number().min(0).max(10).default(0),
  durationSeconds: z.number().min(0.1).max(10).default(0.8),
  from: LayerFrom.default('below'),
  /**
   * Which capture this layer is cut from, when it is not the shot's own.
   *
   * A volume can hold panels from several captures at once — four product
   * surfaces at four depths is the film showing the four things it just
   * claimed, rather than setting their names in type. Null means the shot's
   * own capture, which is every other case.
   */
  assetId: z.string().nullable().default(null),
  sourceWidth: z.number().int().positive().nullable().default(null),
  sourceHeight: z.number().int().positive().nullable().default(null),
  /**
   * True when the shell must be cut away where this layer sits.
   *
   * An overlay that arrives is already drawn in the capture underneath it, so
   * without the hole the toast is on screen before it slides in — the shot
   * shows the result, then shows it arriving. The hole is what makes an
   * emergence honest rather than a duplicate.
   */
  knockout: z.boolean().default(false),
});
export type UiLayer = z.infer<typeof UiLayer>;

/**
 * Where the shot happens.
 *
 * `flat` is the frame filled by the interface, which is the right answer
 * almost always. `volume` puts the real panels in a constructed space with a
 * camera that moves through them — the one place this system builds an
 * environment rather than finding one. Everything in the environment is
 * generated from the brand and the capture's own colour; everything that is
 * the product is the product, at its own scale, unfiltered.
 */
export const ShotSpace = z.enum(['flat', 'volume']);
export type ShotSpace = z.infer<typeof ShotSpace>;

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
  /**
   * The interface taken apart.
   *
   * Empty means the shot is the camera on a still, which is what every
   * framing was until layers existed and is still right for an establishing
   * frame. Non-empty means the parts move independently, and the renderer
   * draws the capture once per layer rather than once.
   */
  layers: z.array(UiLayer).default([]),
  space: ShotSpace.default('flat'),
  /**
   * Whether the type is set behind the product rather than over it.
   *
   * Only in a volume, where there is a behind. A word the interface passes in
   * front of is a word that is part of the scene rather than a caption on it.
   */
  wordsBehind: z.boolean().default(false),
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

/**
 * How much of the interface this shot is allowed to move.
 *
 * Not a quality setting. A film in which every product shot takes the
 * interface apart is as templated as one in which none of them does, and it
 * is worse, because the trick stops being a trick the second time. The
 * ambition is assigned by where the shot sits in the film: plain while the
 * film is still establishing what it is looking at, layered once the language
 * is earned, expanded once — at the place the film is building toward.
 */
export const ShotAmbition = z.enum(['plain', 'layered', 'expanded']);
export type ShotAmbition = z.infer<typeof ShotAmbition>;

export type PlanUiOptions = {
  /** How long the whole shot runs. */
  seconds: number;
  /** Width over height of the film's frame. */
  frameAspect: number;
  /** Pixels across the frame actually being rendered. */
  renderWidth: number;
  /** True when the scene carries on-screen words that have to live in the picture. */
  hasWords?: boolean;
  /**
   * How long those words take a first-time viewer to read.
   *
   * The beat that carries them gets at least this much, taken out of the
   * establishing frame. A line that is gone before it has been finished was
   * not communicated, and the film paid for it in running time anyway.
   */
  wordSeconds?: number;
  ambition?: ShotAmbition;
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

  const ambition = options.ambition ?? 'plain';
  /*
   * Cause, action, result — in one shot rather than three.
   *
   * When the capture holds a real control and a real result, the strongest
   * thing the film can do with it is not to cut between them. It is to frame
   * both, press the control, and let the confirmation arrive: the viewer
   * watches the software do the thing instead of being shown the before and
   * the after. That only works when the two are close enough to share a
   * frame at the fidelity the capture can carry, so it is a question with an
   * answer rather than a preference.
   */
  const control = pickControl(structure, action ?? subject);
  const operable =
    ambition !== 'plain' && control !== null && result !== null
      ? actionFrame(control, result, structure, frameAspect, floor)
      : null;

  /*
   * Which beats the shot has room for.
   *
   * Four framings in three seconds is not an edit, it is a strobe. The beat
   * count comes off the running time first and the available regions second,
   * so a short scene gets two good shots rather than four unreadable ones.
   */
  const beats: { role: FramingRole; region: UiRegion | null }[] = [{ role: 'establish', region: null }];
  /*
   * A spatial shot is one idea and needs the whole shot to be it.
   *
   * Cut into four beats, the volume gets two seconds — three panels arriving
   * in sequence in the time it takes to notice the first one, which the
   * blind viewer reported back as "visually interesting, did not know where
   * to look". So when the film is opening out here, it opens out: one wide
   * frame to arrive on, and then the space.
   */
  const expanding = (options.ambition ?? 'plain') === 'expanded' && volumePanels(usable).length >= 3;
  const room = expanding ? 2 : Math.floor(options.seconds / 1.5);
  const candidates: { role: FramingRole; region: UiRegion | null }[] = operable
    ? [
        { role: 'subject', region: subject },
        { role: 'action', region: action },
        { role: 'context', region: context },
      ]
    : [
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

  /*
   * The beat carrying the words is the one that has to be readable.
   *
   * Everything else here divides the shot by rhythm, which is right until
   * there is something on screen a person has to finish reading. Then the
   * rhythm gives way: the beat gets the reading time it needs and the
   * establishing frame, which communicates the least, pays for it.
   */
  /*
   * The words go on the quietest beat, not on the second one.
   *
   * Reading and looking compete, and the beat that asks least of the eye is
   * the one that can afford to carry a line. In practice that is the widest,
   * flattest framing — the establishing frame if the shot has one that is
   * long enough, because the viewer is orienting there rather than reading
   * an interface. Putting the line on the beat where the interface comes
   * apart asks for both at once, which is the note the first-time viewer
   * keeps writing.
   */
  const wordsOn = options.hasWords ? quietestBeat(beats) : -1;
  const needed = options.wordSeconds ?? 0;
  const seconds_ = beats.map((_, index) => Math.max(0.6, (options.seconds * shares[index]!) / total));
  // Nothing to buy when the words are already on the frame that would pay.
  if (wordsOn > 0 && needed > seconds_[wordsOn]!) {
    const owed = Math.min(needed, options.seconds * 0.7) - seconds_[wordsOn]!;
    const payable = Math.max(0, seconds_[0]! - 0.9);
    const paid = Math.min(owed, payable);
    seconds_[wordsOn] = seconds_[wordsOn]! + paid;
    seconds_[0] = seconds_[0]! - paid;
  }

  const framings: UiFraming[] = [];
  let previous: FramingRect | null = null;
  beats.forEach((beat, index) => {
    const seconds = seconds_[index]!;
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
          seconds: Math.min(seconds, wordsOn === 0 ? seconds : 1.4),
          cut: true,
          /*
           * The establishing frame carries the line when it is the quietest
           * place for it — which it usually is. Nothing is moving, the
           * viewer is orienting rather than reading an interface, and the
           * frame is wide enough that a corner of it is genuinely empty.
           */
          words: wordsOn === 0 ? quietCorner(structure, full) : 'none',
          around: null,
        }),
      );
      previous = full;
      return;
    }

    /*
     * The one shot where the film's language opens out.
     *
     * Three real panels in a constructed space, with the words behind them.
     * It is reserved for a single beat because it is the only shot here that
     * builds an environment rather than finding one, and a film that reached
     * for it twice would have made it a template the second time.
     */
    /*
     * A volume needs room. Three panels arriving in sequence in two seconds
     * is a flash of something interesting that nobody had time to look at,
     * and the first-time viewer's report of the last cut said exactly that:
     * visually interesting, did not know where to look.
     */
    if (
      ambition === 'expanded' &&
      beat.role === 'subject' &&
      seconds >= 2.6 &&
      volumePanels(usable).length >= 3
    ) {
      const panels = volumePanels(usable).map((region) => ({ rect: clampRect(region) }));
      framings.push(
        UiFraming.parse({
          role: 'subject',
          move: 'hold',
          from: { x: 0, y: 0, width: 1, height: 1 },
          to: { x: 0, y: 0, width: 1, height: 1 },
          seconds,
          cut: true,
          space: 'volume',
          /*
           * And it carries no words at all.
           *
           * One attention target at a time. Three real panels moving through
           * a built space IS the thing to look at; a line over it, or even
           * behind it, is a second thing asking for the same two seconds. The
           * words go to another beat, which is what the rest of the shot is
           * for.
           */
          wordsBehind: false,
          words: 'none',
          around: clampRect(beat.region),
          layers: volumeLayers(panels, seconds),
        }),
      );
      previous = full;
      return;
    }

    const operating = operable !== null && beat.role === 'action';
    const target = operating ? operable! : frameOn(beat.region, structure, frameAspect, floor);
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
    /*
     * What moves inside the frame.
     *
     * Plain shots move the camera and nothing else, which is right while the
     * film is still saying what it is looking at. Once the language is
     * earned, the interface comes apart: the shell falls back and softens so
     * the panel the shot is about can hold the eye at its own scale, and
     * where the capture supports it the control takes the action and the
     * confirmation arrives out of a hole cut in the shell.
     */
    const layers: UiLayer[] =
      operating && control && result
        ? operateLayers(control, result, seconds)
        : ambition === 'plain' || beat.role === 'context'
          ? []
          : isolateLayers(beat.region, seconds);

    framings.push(
      UiFraming.parse({
        role: beat.role,
        move: operating
          ? 'pull'
          : lateral
            ? 'lateral'
            : beat.role === 'result'
              ? 'hold'
              : 'push',
        /*
         * The frame finds the confirmation.
         *
         * The shot opens framed above the result, on the control, and drops
         * onto the result once the press has happened. A camera that already
         * knew where to look would be a camera that had seen the outcome
         * before it occurred, which is how every automated product film
         * shoots this and why none of them feel like anything is happening.
         */
        from: operating
          ? aboveResult(target, result!, structure, frameAspect)
          : lateral
            ? previous!
            : beat.role === 'result'
              ? target
              : openWide,
        to: target,
        seconds,
        cut: !lateral,
        /*
         * Depth, only where it means something. The result is the one part of
         * a screen a film is allowed to lift off the interface, because that
         * is what the interface itself is doing: the toast is already on top.
         * Superseded by layers when there are any — a lifted still and a
         * moving one are two answers to the same question.
         */
        lift: layers.length === 0 && beat.role === 'result' ? clampRect(beat.region) : null,
        words: index === wordsOn ? quietCorner(structure, target) : 'none',
        around: clampRect(beat.region),
        layers,
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
 * The shell falls back so one panel can be read.
 *
 * Two copies of the same pixels: the whole interface, receding and softening,
 * and the panel, holding its scale and its sharpness. Nothing is redrawn and
 * nothing is invented; what changes is that the interface stops being one
 * object, which is the difference between a camera move and motion design.
 */
export function isolateLayers(region: UiRegion, seconds: number): UiLayer[] {
  return [
    UiLayer.parse({
      role: 'shell',
      motion: 'recede',
      rect: { x: 0, y: 0, width: 1, height: 1 },
      depth: -0.5,
      delaySeconds: 0.1,
      durationSeconds: Math.min(1.5, seconds * 0.6),
    }),
    UiLayer.parse({
      role: 'panel',
      motion: 'advance',
      rect: clampRect(region),
      depth: 0.35,
      delaySeconds: 0.1,
      durationSeconds: Math.min(1.6, seconds * 0.7),
      /*
       * Cut out of the shell, and safe to cut.
       *
       * A shell that recedes takes its own copy of this panel with it, and
       * the two separate: the sharp one stays where the eye is and the soft
       * one drifts up behind it, which reads as a printing error rather than
       * as depth. The hole fixes it, and here the hole can never be seen —
       * the panel scales about its own centre and so covers its own gap for
       * every frame it exists. That is exactly the property an arriving
       * overlay does not have, which is why this one is allowed and that one
       * is not.
       */
      knockout: true,
    }),
  ];
}

/**
 * The software doing the thing.
 *
 * Cause, action, result, in one shot: the screen, the control taking the
 * press, and the confirmation. What it does NOT do is slide the confirmation
 * in, and the reason is worth writing down because it took building the slide
 * to see it.
 *
 * A capture is one moment. The confirmation is burned into it, sitting on top
 * of whatever it covers — a table row, a list, we have no idea. To animate it
 * arriving you have to hide it first, and hiding it means painting something
 * where it was. Every arrangement of that ends in the same place: either a
 * rectangle of invented interface, or a hole that sits in the picture for a
 * third of a second waiting to be filled. Both are lies, and one of them is
 * also ugly. (The type still carries `emerge` and `knockout`, because with
 * two captures of the same screen — one before, one after — the arrival is
 * real and this is exactly how to shoot it.)
 *
 * What is true of one capture: the camera does not know where the
 * confirmation is until it looks, and the confirmation is on top of the
 * interface rather than in it. So the frame starts above it, the control is
 * pressed, the frame opens down onto the result, and as it lands the
 * interface falls back and the confirmation lifts off it. Nothing is invented
 * and it still reads as software responding — because that is what the
 * camera and the compositor are for.
 */
export function operateLayers(control: UiRegion, result: UiRegion, seconds: number): UiLayer[] {
  const press = Math.min(seconds * 0.32, 1.0);
  const land = press + 0.28;
  return [
    UiLayer.parse({
      role: 'shell',
      motion: 'recede',
      rect: { x: 0, y: 0, width: 1, height: 1 },
      depth: -0.35,
      delaySeconds: land,
      durationSeconds: Math.max(0.5, Math.min(1.1, seconds - land)),
    }),
    UiLayer.parse({
      role: 'control',
      motion: 'press',
      rect: clampRect(control),
      depth: 0.1,
      delaySeconds: press,
      durationSeconds: 0.55,
      // A press returns to where it started, so it covers its own hole too.
      knockout: true,
    }),
    UiLayer.parse({
      role: 'overlay',
      motion: 'advance',
      rect: clampRect(result),
      depth: 0.55,
      delaySeconds: land,
      durationSeconds: Math.max(0.4, Math.min(0.9, seconds - land)),
      knockout: true,
    }),
  ];
}

/**
 * The product's own primary action, where the shot is looking.
 *
 * Prefers a control inside the region the shot is about, because a button
 * somewhere else on the screen is a button in another story. Falls back to
 * the biggest one on the capture, and to nothing at all — a screen with no
 * filled action cannot be shown being operated, and saying so is better than
 * pressing a panel.
 */
export function pickControl(structure: UiStructure, within: UiRegion | null): UiRegion | null {
  if (structure.controls.length === 0) return null;
  if (within) {
    const inside = structure.controls.filter(
      (control) =>
        control.x + control.width / 2 >= within.x &&
        control.x + control.width / 2 <= within.x + within.width &&
        control.y + control.height / 2 >= within.y &&
        control.y + control.height / 2 <= within.y + within.height,
    );
    if (inside.length > 0) return inside[0]!;
  }
  return structure.controls[0]!;
}

/**
 * The beat that asks least of the eye, and can therefore carry the words.
 *
 * Establishing frames first: nothing is moving and the viewer is orienting
 * anyway. Then whichever remaining beat has the fewest things happening in
 * it. Never the beat where a control is pressed — that one is a story on its
 * own and a line over it is a second one.
 */
function quietestBeat(beats: readonly { role: FramingRole; region: UiRegion | null }[]): number {
  const establish = beats.findIndex((beat) => beat.role === 'establish');
  if (establish >= 0 && beats.length > 1) return establish;
  const preference: Record<FramingRole, number> = {
    establish: 0,
    context: 1,
    subject: 2,
    result: 3,
    action: 4,
  };
  let best = 0;
  for (let index = 1; index < beats.length; index += 1) {
    if (preference[beats[index]!.role] < preference[beats[best]!.role]) best = index;
  }
  return best;
}

/**
 * Which regions can stand up as objects in a space.
 *
 * Not the heaviest three. A volume shows panels as things, and a thing has to
 * have proportions: the widest and shortest region on a screen is a header
 * strip, and hung in space at an angle it reads as a ruler. Anything too
 * small to carry its own content at panel size is out for the same reason —
 * the shot would be three postage stamps floating in a room.
 */
export function volumePanels(regions: readonly UiRegion[]): UiRegion[] {
  return regions
    .filter((region) => {
      const aspect = region.width / Math.max(1e-6, region.height);
      return region.width * region.height >= 0.03 && aspect >= 0.45 && aspect <= 3.6;
    })
    .slice(0, 3);
}

/**
 * Real panels, in a constructed space.
 *
 * Three at most: beyond that it stops reading as depth and starts reading as
 * clutter, which is the failure mode of every "spatial UI" template ever
 * made. They arrive in order, nearest first, so the shot builds rather than
 * appearing assembled — and each one may come from a different capture, which
 * is what lets a beat that would otherwise have set four module names in type
 * show the four modules instead.
 */
export function volumeLayers(
  panels: readonly { rect: FramingRect; assetId?: string; sourceWidth?: number; sourceHeight?: number }[],
  seconds: number,
): UiLayer[] {
  const depths = [0.25, -0.3, -0.72];
  return panels.slice(0, 3).map((panel, index) =>
    UiLayer.parse({
      role: 'panel',
      motion: 'advance',
      rect: panel.rect,
      depth: depths[index] ?? -0.8,
      delaySeconds: Math.min(seconds * 0.4, index * 0.28),
      durationSeconds: Math.max(0.6, Math.min(1.4, seconds * 0.5)),
      assetId: panel.assetId ?? null,
      sourceWidth: panel.sourceWidth ?? null,
      sourceHeight: panel.sourceHeight ?? null,
    }),
  );
}

/** The same frame, raised so the result sits just under its bottom edge. */
function aboveResult(
  seated: FramingRect,
  result: UiRegion,
  structure: UiStructure,
  frameAspect: number,
): FramingRect {
  // A touch tighter as well as higher, so the move reads as the camera
  // opening out rather than as a straight pan down.
  const width = Math.max(0.02, seated.width * 0.94);
  const height = cropHeight(width, structure, frameAspect);
  return slideInside({
    x: seated.x + seated.width / 2 - width / 2,
    y: result.y - height,
    width,
    height,
  });
}

/**
 * The frame that holds the action and its result — with the result on the floor.
 *
 * Centring both would be the obvious composition and it is wrong, for a
 * reason that only appears once you render it. The confirmation has to be cut
 * out of the shell, or the shot shows the result and then shows it arriving;
 * and a hole in the middle of a screen is a bright rectangle of nothing
 * sitting in the picture for the third of a second before the toast fills it.
 *
 * Put the result flush against the bottom of the frame and the hole is not a
 * hole any more, it is the edge — the toast rises into shot from under the
 * frame line, which is both invisible as a trick and exactly how you would
 * shoot it with a camera.
 */
export function actionFrame(
  a: UiRegion,
  b: UiRegion,
  structure: UiStructure,
  frameAspect: number,
  floor: number,
): FramingRect | null {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  const width = Math.min(1, Math.max(floor, (x1 - x0) * 1.18));
  const height = cropHeight(width, structure, frameAspect);
  // Both have to actually fit, or the shot promises an action whose result is
  // off screen. Wider is not an option: the frame is already at the aspect.
  if (x1 - x0 > width + 0.001 || y1 - y0 > height + 0.001) return null;
  const sit = Math.max(0.004, height * 0.012);
  const rect = slideInside({
    x: x0 + (x1 - x0) / 2 - width / 2,
    y: b.y + b.height + sit - height,
    width,
    height,
  });
  // Sliding the frame down to seat the result must not push the control out
  // of it; when it would, there is no shot here and the beats stay separate.
  if (a.y < rect.y - 0.001 || a.y + a.height > rect.y + rect.height + 0.001) return null;
  return rect;
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


/**
 * The sound the picture is already making.
 *
 * Every cue here comes off a decision the picture has already taken: a cut, a
 * control being pressed, a panel landing, a camera opening into a space. That
 * is the whole design. Sound written from the storyboard's words lands near
 * the edit and misses it; sound written from the edit lands on it, because it
 * is reading the same numbers the renderer is.
 *
 * Deliberately sparse. A cue on every event is a cartoon, so the cuts get the
 * quietest marks, the press gets the only literal one, and the landing of the
 * thing the shot is about gets the weight.
 */
export function cuesFor(sequence: UiSequence, startTime: number): SoundCue[] {
  const cues: SoundCue[] = [];
  let at = startTime;
  for (const [index, framing] of sequence.framings.entries()) {
    if (index > 0 && framing.cut) {
      cues.push({ time: round(at), type: 'impact', assetId: null, intensity: 0.28, durationSeconds: null });
    }
    if (framing.move === 'lateral' || framing.move === 'pull') {
      cues.push({ time: round(at), type: 'whoosh', assetId: null, intensity: 0.3, durationSeconds: null });
    }
    if (framing.space === 'volume') {
      // A riser under the move into the space, so the opening out is heard
      // as well as seen, and it resolves on the beat the panels have landed.
      cues.push({
        time: round(at),
        type: 'riser',
        assetId: null,
        intensity: 0.5,
        durationSeconds: Number((framing.seconds * 0.7).toFixed(2)),
      });
    }
    for (const layer of framing.layers) {
      if (layer.motion === 'press') {
        // Where the press bottoms out, not where it starts.
        cues.push({
          time: round(at + layer.delaySeconds + layer.durationSeconds * 0.45),
          type: 'ui_click',
          assetId: null,
          intensity: 0.62,
          durationSeconds: null,
        });
      }
      if ((layer.motion === 'advance' || layer.motion === 'emerge') && layer.role === 'overlay') {
        cues.push({
          time: round(at + layer.delaySeconds + layer.durationSeconds * 0.35),
          type: 'impact',
          assetId: null,
          intensity: 0.55,
          durationSeconds: null,
        });
      }
    }
    at += framing.seconds;
  }
  return cues.sort((left, right) => left.time - right.time);
}

function round(value: number): number {
  return Number(Math.max(0, value).toFixed(3));
}


/**
 * What a shot actually does, in a line a director can read.
 *
 * The other half of the invariant. A panel told only what a scene was written
 * as judges the intention; told what production made of it, it judges the
 * film. "Screenshot motion" and "the shell falls back while the schedule
 * panel comes forward, then the control is pressed and the confirmation
 * lifts" are the same visual type and are not the same shot, and the
 * difference is precisely what everyone watching has been complaining about.
 */
export function describeSequence(sequence: UiSequence): string {
  if (sequence.framings.length === 0) return 'not filmed';
  const parts = sequence.framings.map((framing) => {
    if (framing.space === 'volume') {
      return `${framing.layers.length} real panels held in a built space, camera through them`;
    }
    if (framing.layers.length === 0) {
      return framing.move === 'hold'
        ? `held at ${Math.round(framing.to.width * 100)}%`
        : `${framing.move} to ${Math.round(framing.to.width * 100)}% of the capture`;
    }
    const moves = framing.layers
      .filter((layer) => layer.motion !== 'hold')
      .map((layer) => `${layer.role} ${layer.motion}s`);
    return moves.length > 0 ? moves.join(', ') : `held at ${Math.round(framing.to.width * 100)}%`;
  });
  return parts.join(' → ');
}
