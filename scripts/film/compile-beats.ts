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
import type { TimedBeat } from '@act-one/creative';

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
   * the film describes its mechanism instead of showing it operate. The opener
   * was an atmosphere clip, so "it opens your site" arrived as a claim over a
   * mood, and the audit premise was never visible before the copy explained it.
   *
   * Two atmosphere shots have now been tried there and both were called generic
   * stock — the second one commissioned to a written brief specifically to
   * avoid that. A third would be the same experiment. This is not another
   * atmosphere shot: it is the page, and the marks the system actually makes on
   * a page. Underline what is there, pin it as evidence, strike what cannot be
   * proved. The same three verbs recur later in the film, which is what makes
   * them a grammar rather than an effect.
   */
  | { kind: 'audit'; assetId: string; window: { x: number; width: number; fromY: number; toY: number }; marks: { underlineAt: number; pinAt: number; strikeAt: number } };

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
  const onPaper = visual.kind === 'product' || visual.kind === 'audit';
  const background = onPaper ? palette.paper : palette.ink;

  const objects: SceneObject[] = [];
  const audio: Record<string, unknown>[] = [];

  // --- the light every frame stands on -------------------------------------
  objects.push({
    kind: 'gradient', id: `${beat.id}_light`, shape: 'radial',
    from: onPaper ? '#FFEADC' : palette.ember, to: background,
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
  const heroColour = onPanels ? palette.paper : fieldColour && luminance(fieldColour) > 0.45 ? palette.ink : palette.accent;
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
      transform: Transform.parse({ x: 0.5, y: 1.0, anchor: { x: 0.5, y: 0.5 }, opacity: 0.88 }),
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
      staggerBy: 'none', staggerSeconds: 0,
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
      transform: Transform.parse({
        x: place.x,
        y: {
          from: place.y + (hero ? 0.05 : 0.03),
          to: place.y,
          curve: 'out_expo',
        },
        anchor: { x: place.anchor, y: 0.5 },
        scale: hero
          ? { from: composition.heroScale * 0.9, to: composition.heroScale, curve: 'out_expo' }
          : { from: 0.98, to: 1, curve: 'out_expo' },
        opacity: { keyframes: [{ t: 0, value: 0 }, { t: 0.08, value: 1, curve: 'out_cubic' }, { t: 1, value: 1 }], curve: 'out_cubic' },
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

  if (visual.kind === 'clip' || visual.kind === 'product' || visual.kind === 'audit') {
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
  const travel = Math.min(0.3, 0.05 * beat.durationSeconds);
  const curve = 'linear' as const;
  if (visual.kind === 'product' || visual.kind === 'audit') {
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
     * The page, and three marks made ON it, in the order the system works.
     *
     * The marks are placed as fractions of the beat rather than at fixed
     * seconds, because the beat's length is the length of the reading and the
     * reading changes whenever the line does. A mark at 1.2s would drift off
     * its word the first time the voice came back a little faster.
     */
    const at = (fraction: number) => Math.max(0, Math.min(0.96, fraction));
    const objects: SceneObject[] = [{
      kind: 'ui_layer', id: `${beat.id}_page`, assetId: visual.assetId, semantic: 'page',
      crop: {
        x: visual.window.x, width: visual.window.width, height: visual.window.width / 1.111,
        y: { from: visual.window.fromY, to: visual.window.toY, curve: 'in_out_cubic' },
      },
      width: 1.04, cornerRadiusPx: 0, shadow: false,
      /*
       * SUPPORT, not payload — and that is a statement about the beat, not a
       * way past the inspector.
       *
       * Marking it payload put three things on screen asking to be read at
       * once (the page, the caption, the marks) and the inspector said so. It
       * was right, and the fix is the honest one: the payload of this beat is
       * the ACT OF MARKING, not the page. The page is what the marking happens
       * to — the ground. A beat whose payload is a wall of somebody else's
       * body copy is the "screenshot with a camera move" the whole revision
       * was meant to get away from.
       */
      role: 'support', enterAt: 0,
      reason: 'The real page, square-on: the ground the marks are made on.',
      transform: Transform.parse({ x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 } }),
    } as SceneObject];

    // UNDERLINE: drawn left to right, the way a person reads.
    objects.push({
      kind: 'shape', id: `${beat.id}_underline`, shape: 'rect',
      width: { keyframes: [
        { t: 0, value: 0 },
        { t: at(visual.marks.underlineAt), value: 0, curve: 'linear' },
        { t: at(visual.marks.underlineAt + 0.14), value: 0.34, curve: 'out_expo' },
        { t: 1, value: 0.34 },
      ], curve: 'out_expo' },
      height: 0.006,
      fill: palette.accent, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
      role: 'structure', enterAt: 0,
      reason: 'One line on the page, underlined: the system reading what is actually there.',
      transform: Transform.parse({ x: 0.13, y: 0.54, anchor: { x: 0, y: 0.5 } }),
    } as SceneObject);
    audio.push({
      at: beat.durationSeconds * at(visual.marks.underlineAt), kind: 'ui_click', intensity: 0.28,
      causedBy: `${beat.id}_underline`, reason: 'The underline is drawn.',
    });

    // PIN: the evidence kept, as a small solid mark at the end of the line.
    objects.push({
      kind: 'shape', id: `${beat.id}_pin`, shape: 'rect',
      /*
       * IN THE MARGIN, beside the line it refers to.
       *
       * It was at x 0.49 in the middle of the text column, where it landed
       * inside a sentence — "what ▪ does" — and read as a redaction block or a
       * rendering fault rather than as a mark somebody made. A pin belongs
       * where a person would put one: in the margin, level with the line it
       * points at, touching nothing.
       */
      width: 0.016, height: 0.03,
      fill: palette.amber, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 2,
      role: 'structure', enterAt: beat.durationSeconds * at(visual.marks.pinAt),
      reason: 'Pinned as evidence, in the margin: the verbatim excerpt kept behind the fact.',
      transform: Transform.parse({ x: 0.082, y: 0.54, anchor: { x: 0, y: 0.5 }, opacity: 0.95 }),
    } as SceneObject);
    audio.push({
      at: beat.durationSeconds * at(visual.marks.pinAt), kind: 'ui_click', intensity: 0.34,
      causedBy: `${beat.id}_pin`, reason: 'The excerpt is pinned.',
    });

    /*
     * STRIKE: the verb that makes this film different from a screenshot tour.
     * Something on the page is crossed out, because the system reports what it
     * cannot trace rather than repeating it.
     */
    objects.push({
      kind: 'shape', id: `${beat.id}_strike`, shape: 'rect',
      width: { keyframes: [
        { t: 0, value: 0 },
        { t: at(visual.marks.strikeAt), value: 0, curve: 'linear' },
        { t: at(visual.marks.strikeAt + 0.08), value: 0.4, curve: 'out_expo' },
        { t: 1, value: 0.4 },
      ], curve: 'out_expo' },
      /*
       * Thicker than the underline, and ON the words rather than beneath them.
       *
       * At the same weight and the same offset, the strike read as a second
       * underline — the frame had two orange rules under two lines of text and
       * no sense that anything had been rejected. A strike has to cross the
       * thing it cancels, and it has to be heavier than the mark that means
       * "kept", or the film's two most important verbs look identical.
       */
      height: 0.014,
      fill: palette.accent, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
      role: 'payload', enterAt: 0,
      reason: 'Struck out: a claim the system could not trace to the page.',
      transform: Transform.parse({ x: 0.13, y: 0.617, anchor: { x: 0, y: 0.5 }, opacity: 0.92 }),
    } as SceneObject);
    audio.push({
      at: beat.durationSeconds * at(visual.marks.strikeAt), kind: 'impact', intensity: 0.5,
      causedBy: `${beat.id}_strike`, reason: 'The claim is struck out. This is the film performing its own thesis.',
    });

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
        width: share * 0.86,
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
        role: failed ? 'payload' : 'structure', enterAt: 0,
        reason: failed
          ? 'This direction was scored and rejected, struck across its own frame.'
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
