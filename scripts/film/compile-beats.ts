/**
 * Compiles timed beats into scene graphs: one timeline, four dimensions.
 *
 * THE RULE THIS ENFORCES. Every word on screen is a word that is spoken, at the
 * second it is spoken, because both come from the same measured reading. There
 * is no second copy of the script to drift out of step with the first, and no
 * schedule for the typography that does not know what the voice is doing.
 *
 * The emphasis word is where the dimensions meet. The picture reacts on it —
 * the field arrives, the mark lands — and the impact cue is placed at its
 * measured time rather than at the top of the shot. That is the whole
 * difference between sound that is synchronised and sound that is merely
 * present.
 */
import { SceneGraph, Transform, type SceneObject } from '@act-one/core';
import { performanceFor, type TimedBeat } from '@act-one/creative';

export type Palette = {
  ink: string;
  paper: string;
  accent: string;
  amber: string;
  ember: string;
};

/** What a beat looks like. The narration says what it MEANS; this says what it IS. */
export type BeatVisual =
  | { kind: 'statement'; field: string | null }
  | { kind: 'mark' }
  | { kind: 'product'; assetId: string; window: { x: number; width: number; fromY: number; toY: number }; holdIndex?: number }
  | { kind: 'clip'; assetId: string; sourceInSeconds?: number; crop?: { x: number; y: number; width: number; height: number } }
  | { kind: 'fields'; colours: readonly string[]; assetIds?: readonly string[] }
  | { kind: 'films'; assetIds: readonly string[]; colours: readonly string[]; verdicts?: readonly ('pass' | 'fail')[] }
  /**
   * THE AUDIT: a real page with the system's own verbs performed on it.
   *
   * Every director in the screening room went for the opening, and the
   * diagnosis they converged on from five different lenses was one sentence:
   * the film describes its mechanism instead of showing it operate.
   *
   * MARKS ARE PLACED BY ARITHMETIC, NOT BY EYE. The first version aimed bars
   * at a scrolling screenshot and hoped; they landed near text rather than on
   * it, cut through words at the wrong height, and stopped mid-word because
   * the width was a guess. The page is now a plate of KNOWN aspect at a known
   * position, so every line in it has a computed frame coordinate and a mark
   * can be told exactly where a line starts, where it ends, and where its
   * baseline is. Annotating an image by eye is a thing that looks nearly right
   * once and wrong every time the image changes.
   *
   * THE THREE MARKS MEAN THREE DIFFERENT THINGS AND MUST NOT LOOK ALIKE. The
   * first version drew the underline and the strike in the same accent, so
   * "this is verified" and "this cannot be proved" were the same gesture in
   * the same colour — the film's two most important verbs, indistinguishable.
   * Kept is a fine white rule. Evidence is an amber tag in the margin.
   * Rejected is the accent, and the accent is spent on nothing else here.
   */
  | {
      kind: 'audit';
      assetId: string;
      /**
       * The page as a plate: how wide, and where its centre sits.
       *
       * `width` above 1 is an evidence-close — the plate is wider than the
       * frame, so the film is reading part of the page rather than looking at
       * all of it. `centreX` then matters, because a zoomed plate centred on
       * the image is rarely centred on the text column.
       */
      plate: { width: number; centreY: number; centreX?: number };
      /**
       * The marks, in FRAME coordinates computed from the plate's geometry.
       *
       * A LIST RATHER THAN THREE NAMED FIELDS, because the grammar is supposed
       * to recur. The first version hard-coded one underline, one pin and one
       * strike, which made the audit a shot rather than a vocabulary — and the
       * whole argument for it was that the same verbs come back when the film
       * talks about checking things. A beat that names three checks needs three
       * rules; a beat that names one needs one.
       */
      marks: readonly AuditMark[];
    };

/**
 * One mark the system makes on a page.
 *
 * Three kinds, three meanings, three colours, and they must never look alike:
 * a `rule` is what was read and kept, a `tag` is the evidence pinned beside it,
 * a `strike` is what could not be proved. An earlier version drew the rule and
 * the strike in the same accent, so the film's two most important verbs were
 * the same gesture in the same colour.
 */
export type AuditMark = {
  kind: 'rule' | 'tag' | 'strike';
  x: number;
  y: number;
  /** Ignored by `tag`, which is a fixed small mark. */
  width?: number;
  /** When it lands, as a fraction of the beat rather than in seconds. */
  at: number;
};

export type CompileOptions = {
  palette: Palette;
  visuals: Record<string, BeatVisual>;
  assets: Record<string, string>;
};

type Graph = ReturnType<typeof SceneGraph.parse>;

export function compileBeats(beats: readonly TimedBeat[], options: CompileOptions): Graph[] {
  return beats.map((beat, index) => compileBeat(beat, index, beats, options));
}

function compileBeat(beat: TimedBeat, index: number, all: readonly TimedBeat[], options: CompileOptions): Graph {
  const visual = options.visuals[beat.id] ?? { kind: 'statement' as const, field: null };
  const { palette } = options;
  /*
   * HOW MANY OF THIS KIND HAVE ALREADY BEEN SEEN.
   *
   * The frame rotation was `frames[index % 4]` over the BEAT number, and the
   * statement beats in this film are 1, 4, 9 and 11 — so b2 and b10 both
   * landed on frame 1 and the inspector reported them 97% the same picture.
   * Four frames were written to stop exactly that and the modulo handed two
   * of them to the same layout anyway, because it was counting the wrong
   * thing: the eye does not see beat nine, it sees the third time the film
   * has done this.
   *
   * Counting beats of the SAME KIND is what the rotation always meant. The
   * mark beats are the same fault with no modulo at all — b4 and b14 returned
   * one hard-coded frame, and came back 96% identical.
   */
  const variant = all.slice(0, index).filter((b) => (options.visuals[b.id]?.kind ?? 'statement') === visual.kind).length;
  /*
   * Product beats stand on paper; audit beats do not.
   *
   * The captures in an audit beat are of a dark interface, and a cream field
   * behind them left a pale strip above and below the plate that reads as a
   * light leak rather than as a margin. On ink the plate and the frame are one
   * continuous dark surface, which is also what lets the three marks be the
   * only bright things in the shot.
   */
  const onPaper = visual.kind === 'product';
  const background = onPaper ? palette.paper : palette.ink;

  const objects: SceneObject[] = [];
  const audio: Record<string, unknown>[] = [];

  // --- the light every frame stands on -------------------------------------
  objects.push({
    kind: 'gradient', id: `${beat.id}_light`, shape: 'radial',
    /*
     * NEUTRAL, NOT BROWN.
     *
     * This was the ember — a warm near-black — and two separate readings went
     * for it in the same words: the orange type "vibrates against the dark
     * reddish-brown vignette", and then the field itself was the worst moment
     * in the film, "murky", "muddy", "entirely devoid of art direction", with
     * the instruction to "replace all muddy gradient backgrounds with absolute
     * black to force stark, decisive typographic contrast".
     *
     * A warm glow behind cold white type is the muddiness: neither colour is
     * doing anything and together they grey each other out. A neutral lift off
     * black gives the frame depth without giving it a hue, and it is what lets
     * the accent mean something when it does arrive — on a field, a strike or
     * a rejected lane, and nowhere else.
     */
    from: onPaper ? '#FFEADC' : '#15171E', to: background,
    centre: { x: { from: 0.42, to: 0.58, curve: 'in_out_cubic' }, y: 0.5 },
    radius: 0.9, role: 'atmosphere',
    reason: 'The source the frame is lit by. Nothing here sits on a flat field.',
    transform: Transform.parse({ x: 0.5, y: 0.5, z: 1, anchor: { x: 0.5, y: 0.5 } }),
  } as SceneObject);

  // --- the visual consequence of the idea ----------------------------------
  objects.push(...visualObjects(beat, visual, options, audio, variant));

  /*
   * --- the words, exactly as they are said ---------------------------------
   *
   * One text object per phrase, entering at the second its first word is
   * spoken. The phrase carrying the emphasis is treated differently — larger,
   * in the accent — because that is the word the picture is reacting to, and a
   * viewer who cannot see which word that is gets a field arriving for no
   * visible reason.
   */
  /*
   * Where the type sits, and it is not the same place every time.
   *
   * Every beat laid its phrases down the same left margin at the same
   * spacing, which is a template rather than a composition — "overuse of
   * centre-weighted text on static backgrounds", as the second critic put it.
   * The block shifts with the beat, and a beat over footage sits low so the
   * picture keeps its light.
   */
  const composition = compositionFor(beat, variant, visual);

  /*
   * The accent is not always the loudest thing available.
   *
   * On ink it is; on the amber field it is orange on orange, and the word the
   * whole beat turns on goes quiet exactly when the frame gets loud. So the
   * emphasis takes whichever of ink or accent stands furthest from what is
   * behind it, which on a light field is ink.
   */
  const fieldColour = visual.kind === 'statement' ? visual.field : null;
  /*
   * On panels, the words are white.
   *
   * The accent caption ran across green, blue and orange — and on the orange
   * third it would have been orange on orange, invisible exactly where the
   * emphasis lands. Paper reads on all three.
   */
  const onPanels = visual.kind === 'films' || visual.kind === 'fields' || visual.kind === 'product' || visual.kind === 'audit';
  /*
   * THE HERO PHRASE IS NOT ORANGE, and it should never have been.
   *
   * Three sources, independently. The art director said it in the creative
   * room and it was never implemented: "no orange emphasis words in running
   * sentences — accent is reserved for evidence marks and the split, not
   * rhetoric." A craft reading said the same from the other end: "vary
   * typographic scale and weight to emphasise key phrases, rather than just
   * changing their text colour to orange." And then it became a legible
   * defect rather than a preference — "the bright orange text 'Only the
   * calendar.' vibrates uncomfortably and lacks sufficient contrast against
   * the dark reddish-brown vignette", which is exactly what a saturated orange
   * does over an ember glow.
   *
   * So the emphasis is carried by what it always should have been: size,
   * weight and the beat it lands on. The display token is two modular steps
   * above the statement token and a heavier cut of the same family, the box
   * settles as it arrives, and the words stagger in. That is more emphasis
   * than a colour change, not less.
   *
   * The accent now appears only where something HAPPENS: the strike on a page,
   * the field that takes the frame on the turn, the mark on a rejected lane.
   * Spending it on every stressed phrase is what made it ordinary.
   */
  const heroColour = onPanels ? palette.paper : fieldColour && luminance(fieldColour) > 0.45 ? palette.ink : palette.paper;
  const restColour = onPanels ? palette.paper : fieldColour && luminance(fieldColour) > 0.45 ? palette.ember : (onPaper ? palette.ink : palette.paper);

  /*
   * PHRASES REPLACE EACH OTHER. They do not stack.
   *
   * Stacking is what put "Only" through the "h" of "cheaper" — a caption
   * reads as a rendering error, which is exactly what a critic called it.
   * Each phrase was given a slot one line-gap below the last, and a phrase
   * that wraps to two or three lines walks straight into the next slot. No
   * gap fixes that, because the gap would have to know how the text wrapped.
   *
   * The reference does not stack either. A model reading the strongest of
   * them recorded its boundaries as "text changes from '60 secondes' to
   * 'C'est le temps'" — replacement, one thing at a time, each phrase holding
   * the frame until the voice moves on. That is also why its type can be
   * large: it never has to leave room for the line after it.
   */
  /*
   * A ground under words that sit on a screenshot.
   *
   * The worst moment a model found in the finished film was "'fails itself
   * first' awkwardly overlaps smaller background text, creating illegible
   * visual clutter" — a caption over a product page, competing with the
   * page's own type. White on a screenshot is not a colour problem that a
   * different white fixes; the words need something to sit on.
   *
   * A soft band, only where the picture underneath has type in it.
   */
  const bandAtTop = visual.kind === 'audit' && variant > 0;
  if ((visual.kind === 'product' || visual.kind === 'audit') && beat.phrases.length) {
    /*
     * IN FRONT of the page, not behind it.
     *
     * The first attempt put this at z 0.1, which is further back in the
     * painter's sort, so the screenshot covered the band the words were
     * supposed to sit on — and the words, coloured ink because a product beat
     * stands on paper, ended up dark type on a dark interface. Legibly worse
     * than the clutter it was meant to fix.
     *
     * The band is at the same depth as everything else and pushed after the
     * page, so it paints over it, and the words on it are paper.
     */
    objects.push({
      kind: 'shape', id: `${beat.id}_ground`, shape: 'rect',
      width: 1.4, height: 0.36,
      fill: palette.ink, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
      role: 'structure', enterAt: 0,
      reason: 'The words sit on this rather than on the interface behind them.',
      // Bottom edge off-frame, top edge high enough that the words on it sit
      // inside the title-safe area — a player's chrome lives in that last 5%.
      // Centred at y 1.0 so the band spans 0.82 to 1.18: its top edge is above
      // the caption at 0.88, and its bottom runs off the frame. Sized to the
      // words rather than guessed — the first attempt left the band entirely
      // below the line it was supposed to be carrying.
      // Follows the words. A band at the bottom under a caption at the top is
      // not a ground, it is a stripe.
      transform: Transform.parse({ x: 0.5, y: bandAtTop ? 0.0 : 1.0, anchor: { x: 0.5, y: 0.5 }, opacity: 0.88 }),
    } as SceneObject);
  }

  beat.phrases.forEach((phrase, i) => {
    const hero = phrase.carriesEmphasis;
    const next = beat.phrases[i + 1];
    // Out as the next one arrives, with a breath of overlap so the frame is
    // never empty between two things being said.
    const exitAt = next ? next.atSeconds + 0.06 : beat.durationSeconds;
    const place = { x: composition.x, y: composition.top, anchor: composition.anchor };
    objects.push({
      kind: 'text', id: `${beat.id}_say_${i}`, content: phrase.text,
      token: hero ? 'display' : 'statement',
      color: hero ? heroColour : restColour,
      align: composition.anchor === 1 ? 'right' : composition.anchor === 0.5 ? 'center' : 'left',
      /*
       * The box is the FINISHED width divided back out.
       *
       * `maxWidth` is measured before the transform scales it, and the camera
       * scales it again on top of that, so a 0.68 box at hero scale 1.5 is
       * 102% of the frame and the inspector refuses it — which it did, three
       * times. Dividing by the scale and by the camera's own reach means the
       * number in `composition` is what you actually see.
       */
      maxWidth: (hero ? composition.width : composition.width * 0.9) / ((hero ? composition.heroScale : 1) * 1.07),
      /*
       * Three lines, because dividing the box by the scale made it narrow
       * enough that two were not always enough — and a phrase that does not
       * fit is not wrapped, it is CUT. The film shipped "before you see"
       * without its "it", and "Nothing about the work gets" without its
       * "cheaper": the caption stopped matching the voice mid-sentence, which
       * is the one failure this whole architecture exists to make impossible.
       */
      maxLines: 3,
      // Heard, not read: this text is the reading it was generated from.
      spoken: true,
      /*
       * WORD BY WORD, which this engine has always been able to do and has
       * never once done.
       *
       * The renderer has had a per-word entrance — each word rising 0.35em on
       * out_quint behind its own fade — sitting unused behind `staggerBy:
       * 'none'` on every text object in the film. A line that arrives all at
       * once is a line that faded in, and "opacity fade instead of motion" is
       * what a director watching this film wrote down.
       *
       * The hero phrase staggers wider than the rest: it is the event of the
       * beat and it should take fractionally longer to land. Both are small —
       * at 0.05s a five-word line completes in a fifth of a second, which is
       * an arrival, not a performance.
       */
      /*
       * And the words assemble at the beat's own speed. A confided line puts
       * them up one at a time; a pressed one lands them almost together. This
       * is the same number that set the camera's travel and the engine's pace,
       * so the three dimensions are not three opinions about the same beat.
       */
      staggerBy: 'word',
      staggerSeconds: performanceFor(beat.intent).staggerSeconds * (hero ? 1 : 0.7),
      role: hero ? 'payload' : 'support',
      enterAt: phrase.atSeconds,
      exitAt,
      reason: hero
        ? `The word the beat turns on, on screen as it is said: "${phrase.text}".`
        : `Spoken at ${phrase.atSeconds.toFixed(2)}s, so it is on screen at ${phrase.atSeconds.toFixed(2)}s.`,
      /*
       * TYPE THAT ARRIVES, rather than type that fades up.
       *
       * Both critics, from different evidence, gave the same single note:
       * "animate the typography with spatial intent and scaling, rather than
       * relying entirely on default opacity fades over static backgrounds",
       * and "animate type and graphic transitions to build continuity". They
       * were describing this exact transform, which did nothing but ramp
       * opacity. Motion design scored 4 out of 10 from both.
       *
       * So a phrase rises into place, and the one carrying the emphasis rises
       * further and scales as it lands — it is the event of the beat and it
       * should arrive like one. The distances are small: this is a film about
       * certainty, and type that flies is type that is unsure.
       */
      /*
       * ONE ENTRANCE, NOT TWO. The words now rise and fade individually, so
       * the box must stop doing it as well — a block sliding up while its own
       * words slide up inside it is the mush that reads as "animated" rather
       * than designed. What the box keeps is the settle: a small scale on the
       * hero, so the line lands with weight the individual words cannot give
       * it.
       */
      transform: Transform.parse({
        x: place.x,
        y: place.y,
        anchor: { x: place.anchor, y: 0.5 },
        scale: hero
          ? { from: composition.heroScale * 0.965, to: composition.heroScale, curve: 'out_quint' }
          : composition.heroScale === 1 ? 1 : composition.heroScale,
      }),
    } as SceneObject);

    // A word arriving is an event, and an event has a sound.
    audio.push({
      at: phrase.atSeconds,
      kind: hero ? 'impact' : 'ui_click',
      intensity: hero ? 0.6 : 0.2,
      causedBy: `${beat.id}_say_${i}`,
      reason: hero ? 'The emphasis lands.' : 'A phrase arrives.',
    });
  });

  // Room tone under a wordless beat, so silence is a decision and not a hole.
  if (!beat.phrases.length) {
    audio.push({ at: 0.05, kind: 'texture', intensity: 0.45, causedBy: `${beat.id}_light`, reason: beat.reason });
  }

  const next = all[index + 1];
  return SceneGraph.parse({
    id: beat.id,
    durationSeconds: beat.durationSeconds,
    intent: `${beat.reason}${beat.line ? ` — "${beat.line}"` : ' — wordless.'}`,
    background,
    camera: cameraFor(beat, visual),
    objects,
    audio,
    handover: {
      // A beat that ends on its emphasis hands over hard; one that trails off
      // is carried. The voice decides, not a table.
      mechanism: beat.emphasisAtSeconds !== null && beat.emphasisAtSeconds > beat.durationSeconds - 1.2 ? 'cut' : 'camera_carry',
      carries: [],
      durationSeconds: 0.4,
      reason: next ? `Into ${next.id}: ${next.reason}` : 'The film ends here.',
    },
    macro: null,
  });
}

/**
 * Where a beat's words sit on the frame.
 *
 * Three places rather than one, chosen by what the beat is doing: type over
 * footage drops low and left so the picture keeps its own light; a beat that
 * is only type can take the middle of the frame; and the block alternates its
 * margin so consecutive beats do not stack identically.
 */
function compositionFor(beat: TimedBeat, variant: number, visual: BeatVisual): {
  x: number; top: number; lineGap: number; anchor: number; width: number; heroScale: number;
} {

  if (visual.kind === 'audit') {
    /*
     * The two audits are the same GRAMMAR, not the same SHOT.
     *
     * With both plates locked off on ink and both captions low, the inspector
     * put them at 94% the same picture — and it was right: a vocabulary that
     * recurs is the point, a framing that recurs is a repeat. The opening is a
     * wide read of a whole page with the line beneath it; the second is an
     * evidence-close, and its caption goes ABOVE the plate, out of the way of
     * marks that live in the lower two thirds and into the space a closer
     * crop opens up at the top.
     */
    return variant === 0
      ? { x: 0.5, top: 0.88, lineGap: 0.1, anchor: 0.5, width: 0.78, heroScale: 1.05 }
      : { x: 0.5, top: 0.115, lineGap: 0.1, anchor: 0.5, width: 0.72, heroScale: 1.1 };
  }
  if (visual.kind === 'clip' || visual.kind === 'product') {
    // Low and left: the footage is the subject and the words are under it.
    /*
     * Centred on the band rather than left-anchored.
     *
     * A left-anchored caption kept losing its first letter: the camera scales
     * about the centre, so the box's left edge walks outward as the shot
     * pushes in, and chasing it with the x margin fixed one render and broke
     * the next. Centring is invariant under that scale — the box grows
     * symmetrically and the first letter stays on screen — and on a full-width
     * band it reads as a deliberate lower third rather than a margin somebody
     * guessed.
     */
    return { x: 0.5, top: 0.88, lineGap: 0.1, anchor: 0.5, width: 0.78, heroScale: 1.05 };
  }
  if (visual.kind === 'mark') {
    /*
     * The two mark beats are not the same beat.
     *
     * b4 is "This is Act One." — the film naming itself, and the shortest
     * line in it. b14 is the sign-off. They were returning one frame between
     * them and came back 96% the same picture, which made the last shot in
     * the film look like a reprise of the title card rather than an ask.
     *
     * So the title takes the middle of the frame at its largest, and the
     * sign-off sits low and left where every other closing line in this film
     * sits. Same vocabulary, opposite weight.
     */
    return variant === 0
      ? { x: 0.5, top: 0.44, lineGap: 0.12, anchor: 0.5, width: 0.62, heroScale: 1.45 }
      : { x: 0.09, top: 0.56, lineGap: 0.11, anchor: 0, width: 0.56, heroScale: 1.1 };
  }
  if (visual.kind === 'films') {
    /*
     * Under the panels, across the frame: the films are the subject.
     *
     * The line count has to come off the top or a three-phrase caption walks
     * out of the bottom of the safe area — which it did, at y 1.05. The
     * statement branch already did this and this one did not, which is what a
     * fixed number rather than a computed one buys you.
     */
    /*
     * Wider and higher than it was. At 0.62 the hero phrase "before you see
     * it." lost its last word off the end, and at 0.84 a second line had
     * nowhere to go. A caption that spans three colour panels also needs the
     * room to sit ON one of them rather than across a seam.
     */
    return { x: 0.5, top: 0.78, lineGap: 0.085, anchor: 0.5, width: 0.9, heroScale: 1 };
  }
  if (visual.kind === 'fields') {
    // Inside the first field, and narrow enough to stay in it. The earlier
    // version centred a 54%-wide box at a sixth of the frame and put the line
    // off the left edge — the inspector refused it, correctly.
    const share = 1 / visual.colours.length;
    return { x: share * 0.5, top: 0.5, lineGap: 0.13, anchor: 0.5, width: share * 0.82, heroScale: 1.1 };
  }

  /*
   * Typographic beats, deliberately unalike.
   *
   * The inspector found b12 to be 99% the same picture as b2, b8 95% the same
   * as b6, b14 92% the same as b4 — five pairs in a fourteen-beat film. It is
   * the same fault a critic scored as visual invention 3 out of 10: fourteen
   * beats generated from five templates look like five beats shown three
   * times. A compiler that lays every statement out identically has not
   * composed anything, it has filled a slot.
   *
   * So a statement beat takes one of four frames in rotation, and they differ
   * in the things an eye actually notices: which margin, how big, how high.
   */
  const frames = [
    { x: 0.08, top: 0.34, lineGap: 0.13, anchor: 0, width: 0.56, heroScale: 1.3 },
    { x: 0.94, top: 0.58, lineGap: 0.11, anchor: 1, width: 0.5, heroScale: 1 },
    { x: 0.5, top: 0.46, lineGap: 0.14, anchor: 0.5, width: 0.68, heroScale: 1.5 },
    { x: 0.08, top: 0.62, lineGap: 0.1, anchor: 0, width: 0.56, heroScale: 1.15 },
  ];
  return frames[variant % frames.length]!;
}

/** The camera, scaled to how long the beat actually runs. */
function cameraFor(beat: TimedBeat, visual: BeatVisual): Record<string, unknown> {
  /*
   * A short beat gets a small move and a long one gets a large one, so the
   * rate of travel is roughly constant across the film. A fixed move over a
   * variable duration is what makes some shots feel hurried and others dead,
   * and beat lengths now vary with the reading rather than being chosen.
   */
  /*
   * THE CAMERA ANSWERS TO THE SAME INTENT AS THE VOICE.
   *
   * A line that is confided over a frame that travels like any other line is a
   * performance with nothing behind it. The beat's register scales the travel:
   * a confided beat barely moves, a pressed one moves half again as far, and
   * the turn slows down because the voice does.
   */
  const travel = Math.min(0.3, 0.05 * beat.durationSeconds) * performanceFor(beat.intent).cameraEnergy;
  /*
   * NOT LINEAR, which every camera move in this film was.
   *
   * A constant-velocity push is the one move no camera operator makes and no
   * design system ships: it starts at full speed on the cut, holds one speed
   * throughout, and stops dead on the next cut. That reads as a value being
   * interpolated, which is exactly what it was. in_out_cubic gives the move a
   * beginning and an end — it takes up and sets down — so the frame looks
   * driven rather than animated.
   */
  const curve = 'in_out_cubic' as const;
  if (visual.kind === 'audit') {
    /*
     * LOCKED OFF, and it has to be.
     *
     * Every mark in an audit beat is placed by arithmetic off the plate's
     * geometry, and a camera scale invalidates that arithmetic the instant it
     * moves: the frame magnifies about its centre, so a rule computed to sit
     * under a headline drifts upward through it as the shot pushes in. The
     * first version of this beat drew three rules THROUGH the lines they were
     * supposed to underline, and the cause was not the coordinates — those
     * were right — but a camera nobody had accounted for.
     *
     * It is also the correct shot. An audit is a held inspection, and the
     * cinematography director asked for exactly this in the room: "one held
     * inspection vantage, no push-ins, no parallax, no camera drift". The
     * motion in these beats is the marks being made. That is enough.
     */
    return { focalLengthMm: 50, scale: 1 };
  }
  if (visual.kind === 'product') {
    /*
     * The full push, kept.
     *
     * This shot lost its caption's first letters — the film shipped "ast,
     * loudness, timing." — and the scale was the mechanism: it magnifies
     * about the centre, so a LEFT-anchored box walks its left edge outward
     * until the line's own bearing clears the frame. The cause was the anchor,
     * not the push, and the caption is centred now: at this travel its edges
     * reach 0.063 and 0.937, both comfortably inside. Slowing the camera as
     * well would have been a second fix for a problem that already has one,
     * paid for in the only movement these shots have.
     */
    return { focalLengthMm: 60, scale: { from: 1.0, to: 1.0 + travel * 0.4, curve } };
  }
  if (visual.kind === 'films' || visual.kind === 'fields') {
    /*
     * A COMPARISON IS HELD, NOT PANNED.
     *
     * These beats put three things side by side and ask the viewer to weigh
     * them. The default camera pans horizontally — travel*0.18 to -travel*0.12
     * — which slides the whole triptych sideways, so the three panels are not
     * presented equally and the outer ones walk off the edge. The inspector
     * reported the left film 2% past the frame and a model watching it went
     * straight there: "the UI screenshot is cut off awkwardly on the left
     * edge, making the composition feel messy and unresolved."
     *
     * A small scale keeps the frame alive without moving the comparison.
     */
    return { focalLengthMm: 50, scale: { from: 1.0, to: 1.0 + travel * 0.09, curve } };
  }
  if (visual.kind === 'mark') {
    return { focalLengthMm: 85, scale: { from: 1.0 + travel * 0.5, to: 1.0, curve } };
  }
  return {
    focalLengthMm: 55,
    scale: { from: 1.0 - travel * 0.2, to: 1.0 + travel * 0.2, curve },
    x: { from: travel * 0.18, to: -travel * 0.12, curve },
  };
}

function visualObjects(
  beat: TimedBeat,
  visual: BeatVisual,
  options: CompileOptions,
  audio: Record<string, unknown>[],
  variant: number,
): SceneObject[] {
  const { palette } = options;

  if (visual.kind === 'statement' && visual.field) {
    /*
     * The field arrives ON the emphasis word.
     *
     * This is the reference's move, and the reason it reads: a full-frame
     * colour change is the loudest thing a film can do, so it has to be
     * spent on the word the sentence is about rather than on the top of a
     * shot. When there is no emphasis it arrives with the first phrase.
     */
    const at = beat.emphasisAtSeconds ?? beat.voiceAtSeconds;
    audio.push({ at, kind: 'sub_drop', intensity: 0.5, causedBy: `${beat.id}_field`, reason: 'The colour takes the frame on the word.' });
    return [{
      kind: 'shape', id: `${beat.id}_field`, shape: 'rect',
      width: 1.5,
      height: { keyframes: [{ t: 0, value: 0 }, { t: Math.min(0.9, (at + 0.16) / beat.durationSeconds), value: 0, curve: 'linear' }, { t: Math.min(0.95, (at + 0.3) / beat.durationSeconds), value: 1.6, curve: 'out_expo' }, { t: 1, value: 1.6 }], curve: 'out_expo' },
      fill: visual.field, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
      role: 'support', enterAt: 0,
      reason: `The frame reacts to "${beat.emphasis ?? beat.line}".`,
      transform: Transform.parse({ x: 0.5, y: 1.2, z: 0.7, anchor: { x: 0.5, y: 1 } }),
    } as SceneObject];
  }

  if (visual.kind === 'audit' && options.assets[visual.assetId]) {
    /*
     * The page as a plate, and three marks made ON it, in the order the system
     * works. Every mark's position is arithmetic off the plate's geometry, so
     * a rule under a headline is under THAT headline rather than near it.
     *
     * Times are fractions of the beat, not seconds: the beat is as long as its
     * reading, and a mark fixed at 1.2s drifts off its word the moment the
     * voice comes back faster.
     */
    const at = (fraction: number) => Math.max(0, Math.min(0.96, fraction));
    const objects: SceneObject[] = [{
      kind: 'ui_layer', id: `${beat.id}_page`, assetId: visual.assetId, semantic: 'page',
      crop: { x: 0, width: 1, height: 1, y: 0 },
      width: visual.plate.width, cornerRadiusPx: 0, shadow: false,
      /*
       * SUPPORT, not payload. The payload of this beat is the ACT OF MARKING;
       * the page is what the marking happens to. Calling the page the payload
       * put three things on screen asking to be read at once and the inspector
       * said so — and a beat whose payload is a wall of body copy is the
       * "screenshot with a camera move" this revision exists to get away from.
       */
      role: 'support', enterAt: 0,
      reason: 'The real page, square-on: the ground the marks are made on.',
      transform: Transform.parse({
        x: visual.plate.centreX ?? 0.5, y: visual.plate.centreY, anchor: { x: 0.5, y: 0.5 },
        /*
         * Settles rather than arrives. A two-percent scale on out_quint reads
         * as a plate being set down; anything larger reads as a transition and
         * this beat is not a transition, it is the film starting to look at
         * something.
         */
        scale: { from: 1.02, to: 1, curve: 'out_quint' },
        opacity: { keyframes: [{ t: 0, value: 0 }, { t: 0.1, value: 1, curve: 'out_cubic' }, { t: 1, value: 1 }], curve: 'out_cubic' },
      }),
    } as SceneObject];

    /*
     * THE MARKS, in the order the system works.
     *
     * Each kind is a different verb and reads as one: a fine white rule for
     * what was read and kept, an amber tag in the margin for the evidence
     * behind it, the accent through the line for what could not be proved.
     * The accent appears nowhere else in this beat, so a strike cannot be
     * mistaken for emphasis.
     */
    for (const [index, mark] of visual.marks.entries()) {
      const lands = at(mark.at);
      const id = `${beat.id}_${mark.kind}_${index}`;

      if (mark.kind === 'tag') {
        // In the margin: a mark inside a sentence reads as a redaction.
        objects.push({
          kind: 'shape', id, shape: 'rect',
          width: 0.008, height: 0.026,
          fill: palette.amber, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 1,
          role: 'structure', enterAt: beat.durationSeconds * lands,
          reason: 'Pinned as evidence: the verbatim excerpt kept behind the fact.',
          transform: Transform.parse({
            x: mark.x, y: mark.y, anchor: { x: 0, y: 0.5 },
            scale: { from: 0.4, to: 1, curve: 'out_quint' },
          }),
        } as SceneObject);
        audio.push({
          at: beat.durationSeconds * lands, kind: 'ui_click', intensity: 0.3,
          causedBy: id, reason: 'The excerpt is pinned.',
        });
        continue;
      }

      const struck = mark.kind === 'strike';
      const width = mark.width ?? 0.3;
      objects.push({
        kind: 'shape', id, shape: 'rect',
        // Drawn left to right, the way a person reads, over a fixed share of
        // the beat rather than a fixed number of seconds.
        width: { keyframes: [
          { t: 0, value: 0 },
          { t: lands, value: 0, curve: 'linear' },
          { t: at(mark.at + (struck ? 0.07 : 0.1)), value: width, curve: 'out_quint' },
          { t: 1, value: width },
        ], curve: 'out_quint' },
        height: struck ? 0.0072 : 0.0038,
        fill: struck ? palette.accent : palette.paper,
        stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
        role: struck ? 'payload' : 'structure',
        enterAt: 0,
        reason: struck
          ? 'Struck out: a claim the system could not trace to the page.'
          : 'Underlined: what the system read and kept.',
        transform: Transform.parse({ x: mark.x, y: mark.y, anchor: { x: 0, y: 0.5 }, opacity: struck ? 1 : 0.92 }),
      } as SceneObject);
      audio.push({
        at: beat.durationSeconds * lands,
        kind: struck ? 'impact' : 'ui_click',
        intensity: struck ? 0.5 : 0.24,
        causedBy: id,
        reason: struck
          ? 'The claim is struck out. This is the film performing its own thesis.'
          : 'A line is read.',
      });
    }

    return objects;
  }

  if (visual.kind === 'product' && options.assets[visual.assetId]) {
    /*
     * Three product beats were 95-99% the same picture as each other: same
     * crop shape, same full-bleed placement, same camera. A film that shows
     * the interface three times should be showing three different things
     * about it, and the window in the page is only half of that — the FRAME
     * has to change too, or the viewer sees one shot repeated.
     *
     * So the page is held differently each time: full-bleed, then inset with
     * the frame breathing around it, then pushed off-centre so the type has
     * the other half.
     */
    const holds = [
      { width: 1.08, x: 0.5, y: 0.5 },
      { width: 0.82, x: 0.56, y: 0.44 },
      { width: 0.92, x: 0.62, y: 0.54 },
    ] as const;
    const hold = holds[(visual.holdIndex ?? 0) % holds.length]!;
    return [{
      kind: 'ui_layer', id: `${beat.id}_page`, assetId: visual.assetId, semantic: 'page',
      crop: {
        x: visual.window.x, width: visual.window.width, height: visual.window.width / 1.111,
        y: { from: visual.window.fromY, to: visual.window.toY, curve: 'in_out_cubic' },
      },
      width: hold.width, cornerRadiusPx: 0, shadow: false,
      role: 'support', enterAt: 0,
      reason: 'The real interface, travelled through rather than held up as a card.',
      transform: Transform.parse({ x: hold.x, y: hold.y, anchor: { x: 0.5, y: 0.5 } }),
    } as SceneObject];
  }

  if (visual.kind === 'clip' && options.assets[visual.assetId]) {
    return [{
      kind: 'clip', id: `${beat.id}_clip`, assetId: visual.assetId,
      crop: visual.crop ?? { x: 0, y: 0, width: 1, height: 1 },
      width: 1.12, sourceInSeconds: visual.sourceInSeconds ?? 0, playbackRate: 1, generated: true,
      role: 'payload',
      reason: beat.reason,
      transform: Transform.parse({ x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 } }),
    } as SceneObject];
  }

  if (visual.kind === 'fields') {
    return visual.colours.map((fill, i) => ({
      kind: 'shape', id: `${beat.id}_field_${i}`, shape: 'rect',
      width: 1 / visual.colours.length + 0.02,
      height: { keyframes: [{ t: 0, value: 0 }, { t: 0.12 + i * 0.05, value: 1.6, curve: 'out_expo' }, { t: 1, value: 1.6 }], curve: 'out_expo' },
      fill, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
      role: 'support', enterAt: 0,
      reason: 'One of the directions, as a field of its own colour.',
      transform: Transform.parse({
        x: (i + 0.5) / visual.colours.length, y: 0.5, z: 0.6, anchor: { x: 0.5, y: 0.5 },
      }),
    }) as SceneObject);
  }

  if (visual.kind === 'films') {
    /*
     * THE FILMS THEMSELVES, at the beat that says they are made.
     *
     * This beat's line is "Each one rendered, watched, and scored before you
     * see it", and it was showing a page of our own website — a picture of
     * the place you order from, under a sentence about the things that come
     * back. These are three real renders this system made while choosing the
     * look of this very film, so the claim is literal rather than
     * illustrated.
     *
     * It also breaks the run: three product beats had identical ingredients —
     * a page and a caption, three times — and the inspector said so. Varying
     * where the page sits does not change what the beat is MADE of.
     */
    const available = visual.assetIds.filter((id) => options.assets[id]);
    const objects: SceneObject[] = [];
    available.forEach((assetId, i) => {
      const share = 1 / available.length;
      objects.push({
        kind: 'shape', id: `${beat.id}_panel_${i}`, shape: 'rect',
        width: share + 0.01,
        height: { keyframes: [{ t: 0, value: 0 }, { t: 0.1 + i * 0.04, value: 1.6, curve: 'out_expo' }, { t: 1, value: 1.6 }], curve: 'out_expo' },
        fill: visual.colours[i] ?? palette.ember, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
        role: 'structure', enterAt: 0,
        reason: 'The panel the film sits on, in the colour of its direction.',
        transform: Transform.parse({ x: (i + 0.5) * share, y: 0.5, z: 0.7, anchor: { x: 0.5, y: 0.5 } }),
      } as SceneObject);
      objects.push({
        kind: 'clip', id: `${beat.id}_film_${i}`, assetId,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        /*
         * BIGGER, because four of five directors could not read them.
         *
         * "Visual evidence is too small to read or appreciate." "The claim of
         * rendering, scoring and failing is not proven." At a quarter of the
         * frame each, three dense interface renders are three grey rectangles,
         * and a beat whose entire job is to be EVIDENCE cannot be evidence at
         * a size nobody can inspect. The inset is now the thinnest margin that
         * still reads as a frame rather than a seam.
         */
        width: share * 0.94,
        // Each starts at a different second so three films at once do not cut
        // in step and read as one image in three panels.
        sourceInSeconds: 1.2 + i * 2.4, playbackRate: 1, generated: true,
        role: 'support', enterAt: 0.12 + i * 0.05,
        reason: 'One of the three directions, as the film it actually is.',
        /*
         * A rejected direction loses its confidence.
         *
         * A mark alone says "scored"; the picture going quiet under it says
         * "and this one did not pass". The other two hold, so the beat reads
         * as a judgement between three things rather than as an effect applied
         * to all of them.
         */
        transform: Transform.parse({
          x: (i + 0.5) * share, y: 0.44, z: 0.2, anchor: { x: 0.5, y: 0.5 },
          opacity: (visual.verdicts?.[i] ?? 'pass') === 'fail'
            ? { keyframes: [
                { t: 0, value: 0 },
                { t: 0.14, value: 1, curve: 'out_cubic' },
                { t: 0.6 + i * 0.07, value: 1, curve: 'linear' },
                { t: 0.72 + i * 0.07, value: 0.42, curve: 'out_cubic' },
                { t: 1, value: 0.42 },
              ], curve: 'out_cubic' }
            : { keyframes: [{ t: 0, value: 0 }, { t: 0.14, value: 1, curve: 'out_cubic' }, { t: 1, value: 1 }], curve: 'out_cubic' },
        }),
      } as SceneObject);

      /*
       * THE VERDICT, which is what makes this a scoring beat rather than a
       * gallery.
       *
       * Three directors watching the film independently said the same thing
       * about this passage: it counts to three, and counting is not proving.
       * "Not one safe idea. Three." was answered by three coloured panels,
       * which — as one of them put it — could belong to any company with three
       * brand colours. A mark per panel, and one of them struck, is the
       * difference between enumerating options and showing them judged.
       *
       * The struck lane is the film's own claim about itself: it fails its
       * work before the customer sees it. Deliberately ONE lane, because a
       * system that rejected everything would not be a system anybody would
       * buy.
       */
      const verdict = visual.verdicts?.[i] ?? 'pass';
      const failed = verdict === 'fail';

      /*
       * A REJECTION HAS TO BE VISIBLE AT A GLANCE.
       *
       * A thin rule in a verdict row and a dimmed panel were not enough: the
       * room still reported the failure as unproven. So the struck lane also
       * gets the accent through the film ITSELF, at the weight of the strike
       * in the audit beats — the same verb, in the same colour, doing the same
       * thing to a render that it does to a page. That is what makes it a
       * grammar rather than two unrelated effects.
       */
      if (failed) {
        objects.push({
          kind: 'shape', id: `${beat.id}_struck_${i}`, shape: 'rect',
          width: { keyframes: [
            { t: 0, value: 0 },
            { t: 0.6 + i * 0.07, value: 0, curve: 'linear' },
            { t: 0.7 + i * 0.07, value: share * 0.94, curve: 'out_quint' },
            { t: 1, value: share * 0.94 },
          ], curve: 'out_quint' },
          height: 0.0072,
          fill: palette.accent, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
          role: 'payload', enterAt: 0,
          reason: 'The rejected direction, struck through the render itself.',
          transform: Transform.parse({ x: (i + 0.5) * share, y: 0.44, z: 0.1, anchor: { x: 0.5, y: 0.5 } }),
        } as SceneObject);
      }
      objects.push({
        kind: 'shape', id: `${beat.id}_verdict_${i}`, shape: 'rect',
        width: { keyframes: [
          { t: 0, value: 0 },
          { t: 0.52 + i * 0.07, value: 0, curve: 'linear' },
          { t: 0.6 + i * 0.07, value: failed ? share * 0.62 : share * 0.16, curve: 'out_expo' },
          { t: 1, value: failed ? share * 0.62 : share * 0.16 },
        ], curve: 'out_expo' },
        height: failed ? 0.01 : 0.008,
        fill: failed ? palette.accent : palette.paper,
        stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
        /*
         * The row is STRUCTURE, even for the failed lane. The payload of this
         * beat is the strike through the render; a second payload in the
         * verdict row put three things on screen asking to be read at once and
         * the inspector said so. A scoreboard is a scoreboard, not a headline.
         */
        role: 'structure', enterAt: 0,
        reason: failed
          ? 'The mark on a lane that did not pass.'
          : 'This direction passed its checks.',
        /*
         * ALL THREE ON ONE LINE, which is what makes them a verdict row.
         *
         * The failed mark was struck across the middle of its own panel, and
         * at that position it read as part of that film's graphics rather than
         * as a judgement passed on it — the two passing lanes had their marks
         * in a row below, and the third was somewhere else entirely. Three
         * marks on one line, two short and pale, one long and accent, is a
         * scoreboard. One mark in the middle of a picture is a lower third.
         */
        transform: Transform.parse({
          x: (i + 0.5) * share, y: 0.7,
          z: 0.2, anchor: { x: 0.5, y: 0.5 }, opacity: failed ? 1 : 0.8,
        }),
      } as SceneObject);
      if (failed) {
        audio.push({
          at: beat.durationSeconds * (0.6 + i * 0.07), kind: 'impact', intensity: 0.45,
          causedBy: `${beat.id}_verdict_${i}`,
          reason: 'The system fails its own work, audibly, before anybody else sees it.',
        });
      }
    });
    return objects;
  }

  if (visual.kind === 'mark') {
    // The rule sits under the words, so it goes where the words went: centred
    // under the title, left under the sign-off. A rule anchored at 0.09 while
    // the type it underlines is centred is not a rule, it is a stray line.
    const centred = variant === 0;
    return [{
      kind: 'shape', id: `${beat.id}_rule`, shape: 'rect',
      width: { from: 0, to: centred ? 0.16 : 0.22, curve: 'out_expo' }, height: 0.004,
      fill: palette.accent, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
      role: 'structure', enterAt: Math.max(0.2, beat.voiceSeconds * 0.6),
      reason: 'The rule the film has used throughout.',
      transform: Transform.parse(
        centred
          ? { x: 0.5, y: 0.62, anchor: { x: 0.5, y: 0.5 } }
          : { x: 0.09, y: 0.72, anchor: { x: 0, y: 0.5 } },
      ),
    } as SceneObject];
  }

  return [];
}

/** Rough perceived brightness of a hex colour, 0 to 1. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
