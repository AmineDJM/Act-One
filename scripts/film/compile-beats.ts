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
import { performanceFor, subtitlesFollow, subtitlesFor, type TimedBeat } from '@act-one/creative';
/*
 * The WCAG ratio, from the design package, because this file's own
 * `luminance` at the bottom is not gamma-corrected and is only ever asked
 * whether something is light or dark. That is enough for a headline's colour
 * and not enough for a caption's: "readable" is a measurement.
 */
import { contrastRatio } from '@act-one/design';

export type Palette = {
  ink: string;
  paper: string;
  accent: string;
  amber: string;
  ember: string;
};

/** What a beat looks like. The narration says what it MEANS; this says what it IS. */
export type BeatVisual = {
  receipt?: Receipt;
  /**
   * What the SCREEN says, when the turn of the beat is not the best thing to
   * show. Editorial copy, free to differ from the spoken line — never a
   * subtitle, and never labelled as one.
   */
  editorial?: string;
} & (
  | { kind: 'statement'; field: string | null }
  | { kind: 'mark' }
  | { kind: 'product'; assetId: string; window: { x: number; width: number; fromY: number; toY: number }; holdIndex?: number }
  | { kind: 'clip'; assetId: string; sourceInSeconds?: number; crop?: { x: number; y: number; width: number; height: number } }
  | {
      kind: 'fields';
      colours: readonly string[];
      assetIds?: readonly string[];
      /**
       * What each field IS, set in that direction's own typographic register.
       *
       * Four directors of five called this beat critical in the same words: a
       * film that says "three creative directions" and shows three coloured
       * rectangles has "replaced promised proof with abstract representation",
       * "a placeholder presented as an idea". They are right, and the single
       * craft reading that keeps calling this the best moment in the film is
       * judging it relatively — it breaks the dark monotony, which is not the
       * same as being an idea.
       *
       * A thumbnail cannot fix it: three dense renders at a third of the frame
       * are illegible, which is the lesson from the beat after this one. What
       * CAN be shown at panel size is the thing that actually differs between
       * three creative directions — how each one sets type. So each field
       * carries its own name in its own treatment, and the difference between
       * the three is the difference between the three.
       */
      labels?: readonly { text: string; token: 'display' | 'statement' | 'mono'; scale: number }[];
    }
  | {
      kind: 'films';
      assetIds: readonly string[];
      colours: readonly string[];
      verdicts?: readonly ('pass' | 'fail')[];
      /**
       * Show ONE of them, at a size a person can actually judge.
       *
       * Three dense interface renders side by side are three grey rectangles
       * at any frame size that fits three — "illegibly small", "too small to
       * read or appreciate", said by four directors and then again by a craft
       * reading after they had already been enlarged once. The arithmetic does
       * not work: a third of the frame is six hundred pixels for a picture
       * that was 960 wide and full of interface.
       *
       * The three directions are already established by the beat before this
       * one, which every reading names as the best moment in the film. This
       * beat's line is "each one rendered, watched, and scored" — so it shows
       * one render at a size that can be inspected, and a row of three marks
       * underneath saying that three were judged and one did not pass. The
       * count is carried by the scoreboard; the evidence is carried by the
       * one you can see.
       */
      focus?: number;
      /**
       * Show them ONE AT A TIME, full frame, in the time the beat has.
       *
       * Five directors of five marked this beat critical — "claim without
       * visual proof", "a total failure of visual consequence" — after two
       * attempts to fix it with type. Three colour columns did not prove three
       * creative directions; three columns with the directions NAMED in them
       * did not either, and made it worse, because "Paper" and "Depth" are our
       * words and mean nothing to somebody watching. The room does not want a
       * label for the claim, it wants to see the claim.
       *
       * Three renders side by side are illegible — that is the lesson from the
       * beat after this one, measured twice. Three renders in SEQUENCE are
       * full-frame and legible, and the count is carried by the rhythm of
       * three cuts rather than by a word. A 2.7-second beat has room for
       * exactly this and nothing else.
       */
      sequence?: boolean;
      /**
       * The scoreboard alone, with no render behind it.
       *
       * Once the beat before this one shows all three films, showing another
       * film here is the same picture twice — the inspector said so the moment
       * both beats carried one. The progression that earns its two beats is
       * THREE FILMS, then THE VERDICT on them: rendered and watched, then
       * scored. This beat is the second half of that and needs no picture of
       * its own.
       */
      verdictOnly?: boolean;
    }
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
    });

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

/**
 * ONE CLAIM, CARRIED THROUGH THE WHOLE MIDDLE OF THE FILM.
 *
 * The Screening Room converged on this twice, four directors of five each
 * time, and the diagnosis was not about any single shot: "the cut treats whole
 * screens and panels as evidence. No single receipt is selected and carried
 * forward, so each thesis beat restarts as a new small graphic instead of
 * showing the same claim being read, rendered, judged, failed and repaired."
 *
 * That is the difference between a film that ASSERTS an audit and one that
 * performs it. A viewer cannot follow proof that changes subject every four
 * seconds. So a real phrase is lifted off the real page, pinned, and then it
 * stays on screen — through the three directions, through the scoring, and
 * into the beat where the system rejects it. Muted, you can track one claim
 * from the site to the render that failed it.
 *
 * It is deliberately small and in the same place every time. A receipt that
 * moved or grew would be another graphic; one that sits still is a fact the
 * film is holding onto.
 */
export type Receipt = {
  /** Verbatim from the page. Inventing this would be inventing product truth. */
  text: string;
  /** The beat where the system rejects its own pinned claim. */
  struck?: boolean;
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
  // How far the ground travels on this beat: the beat's own register, the same
  // number that scales the camera and the speed the words assemble at.
  const drift = performanceFor(beat.intent).cameraEnergy;

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
    /*
     * A GROUND THAT MOVES, because the reference does and we did not.
     *
     * Shown our film beside one, a model watching both named two gaps as
     * OBVIOUS and they were the same gap twice: "B integrates typography with
     * shifting backgrounds and continuous momentum, A cuts to flat text on
     * static backgrounds", and "B builds depth with illuminated objects
     * responding to an animated light source, A pans linearly across a 2D text
     * layout". Our light drifted 0.16 across the frame in x and did nothing
     * else, which at this scale is indistinguishable from still.
     *
     * So it travels in both axes and its radius breathes, and a SECOND, wider
     * and dimmer source sits behind it moving the other way. Two sources at
     * different rates is parallax, and parallax is the only depth a flat frame
     * can have honestly — nothing here is pretending to be 3D.
     *
     * IT IS CAUSED, not decorative. The distance both sources travel is scaled
     * by the beat's own register, the same number that sets the camera's
     * travel and the speed the words assemble at. A confided beat's ground is
     * nearly still; a pressed beat's moves. Motion that happens because motion
     * looks expensive is the thing this film has been accused of often enough.
     */
    centre: {
      x: { from: 0.5 - 0.1 * drift, to: 0.5 + 0.12 * drift, curve: 'in_out_cubic' },
      y: { from: 0.46 + 0.05 * drift, to: 0.54 - 0.04 * drift, curve: 'in_out_cubic' },
    },
    radius: { from: 0.82, to: 0.82 + 0.16 * drift, curve: 'in_out_cubic' },
    role: 'atmosphere',
    reason: 'The source the frame is lit by. Nothing here sits on a flat field.',
    transform: Transform.parse({ x: 0.5, y: 0.5, z: 1, anchor: { x: 0.5, y: 0.5 } }),
  } as SceneObject);

  /*
   * A SECOND LIGHT SOURCE WAS TRIED HERE AND TAKEN OUT.
   *
   * Two radials at low contrast over near-black produced visible concentric
   * banding — rings that read as compression artifacting, which is a worse
   * fault than the flatness they were meant to cure. Parallax from two
   * gradients is not the depth the reference has; its depth comes from real
   * objects lit by a real source, and two overlapping glows are a cheap
   * impression of it that this frame cannot carry.
   *
   * The single source travels in both axes and breathes now, which is the part
   * of the change that survived.
   */

  // --- the visual consequence of the idea ----------------------------------
  objects.push(...visualObjects(beat, visual, options, audio, variant));

  /*
   * THE RECEIPT, in the same corner of the frame on every beat that holds it.
   *
   * An amber tag and the claim itself, small, in mono — the register the rest
   * of this film uses for machine output rather than for speech. It does not
   * animate in beyond a fade, because a receipt that performed an entrance
   * every four seconds would be a fifth graphic rather than a constant.
   *
   * On the beat where it is struck, the accent goes through it. That is the
   * film rejecting the claim it pinned: "it fails itself first" is not a thing
   * said over a page, it is this.
   */
  if (visual.receipt) {
    /*
     * Bottom left, not top left.
     *
     * At the top it sat in the same band as the caption on every audit beat
     * that puts its line above the plate, and two small things competing in
     * one corner read as clutter rather than as a constant. A receipt is a
     * footnote: it belongs at the foot, where nothing else in this film lives.
     */
    /*
     * 0.93, and no lower. At 0.955 the inspector refused the film outright:
     * that is inside the last five percent, where a player's chrome sits. The
     * crowding it was nudged away from was never a real overlap — the caption
     * is centred and this is at the left margin — so the nudge bought nothing
     * and cost the render.
     */
    const y = 0.93;
    objects.push({
      kind: 'shape', id: `${beat.id}_receipt_tag`, shape: 'rect',
      width: 0.009, height: 0.026,
      fill: palette.amber, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 1,
      role: 'structure', enterAt: 0,
      reason: 'The pinned claim, still pinned.',
      transform: Transform.parse({ x: 0.055, y, anchor: { x: 0, y: 0.5 }, opacity: 0.95 }),
    } as SceneObject);
    objects.push({
      kind: 'text', id: `${beat.id}_receipt_text`, content: visual.receipt.text,
      // Mono rather than caption: caption is the smallest step in the scale and
      // it rendered as a grey smudge. This has to be readable or it is decoration.
      token: 'mono', color: palette.paper,
      align: 'left', maxWidth: 0.5, maxLines: 1,
      staggerBy: 'none', staggerSeconds: 0,
      role: 'structure', enterAt: 0,
      reason: 'The verbatim excerpt the film is holding onto.',
      transform: Transform.parse({
        x: 0.072, y, anchor: { x: 0, y: 0.5 },
        opacity: { keyframes: [{ t: 0, value: 0 }, { t: 0.06, value: 0.85, curve: 'out_cubic' }, { t: 1, value: 0.85 }], curve: 'out_cubic' },
      }),
    } as SceneObject);

    if (visual.receipt.struck) {
      const at = beat.emphasisAtSeconds ?? beat.voiceAtSeconds;
      const lands = Math.min(0.92, at / Math.max(0.01, beat.durationSeconds));
      objects.push({
        kind: 'shape', id: `${beat.id}_receipt_struck`, shape: 'rect',
        width: { keyframes: [
          { t: 0, value: 0 },
          { t: lands, value: 0, curve: 'linear' },
          { t: Math.min(0.97, lands + 0.06), value: 0.3, curve: 'out_quint' },
          { t: 1, value: 0.3 },
        ], curve: 'out_quint' },
        height: 0.0068,
        fill: palette.accent, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
        role: 'payload', enterAt: 0,
        reason: 'The system rejects the claim it pinned. This is "it fails itself first".',
        transform: Transform.parse({ x: 0.055, y, anchor: { x: 0, y: 0.5 } }),
      } as SceneObject);
      audio.push({
        at, kind: 'impact', intensity: 0.5,
        causedBy: `${beat.id}_receipt_struck`,
        reason: 'The pinned claim is struck, on the word that says so.',
      });
    }
  }

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
  const shownCount = visual.editorial === ''
    ? 0
    : beat.phrases.filter((phrase) => phrase.carriesEmphasis).length || (beat.phrases.length > 0 ? 1 : 0);
  if ((visual.kind === 'product' || visual.kind === 'audit') && shownCount > 0) {
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
      /*
       * OPAQUE AT THE TOP, translucent at the bottom.
       *
       * Three directors reported the caption on the audit close as "obscuring
       * the website text in a way that looks accidental". A band at 0.88 over
       * a page's own headline is exactly that: you can see the type
       * underneath, so it reads as two things colliding rather than as one
       * lying over the other. At the foot the page has already run out and the
       * translucency is a grace note; at the head it has to be a decision.
       */
      transform: Transform.parse({ x: 0.5, y: bandAtTop ? 0.0 : 1.0, anchor: { x: 0.5, y: 0.5 }, opacity: bandAtTop ? 1 : 0.88 }),
    } as SceneObject);
  }

  /*
   * THE SCREEN IS NOT THE SUBTITLE TRACK.
   *
   * Three directors of five called this critical, from three different
   * lenses, at the very first second: "the film acts as a subtitle track to
   * the voiceover rather than utilising the visual medium", "the visuals
   * duplicate the audio rather than complementing it". They are right, and
   * the fault is mine rather than the architecture's.
   *
   * Building the typography from the measured performance was the correct fix
   * for a real problem — captions used to drift from what was said, and they
   * cannot now. But the brief that asked for it also asked for three separate
   * things: NARRATION, SUBTITLES, and ON-SCREEN EDITORIAL COPY, with the
   * editorial layer free to say something the voice does not. I built the
   * first two and never built the third, so every word on screen was the
   * sentence being spoken, at the second it was spoken. A film that shows you
   * what you are already hearing has spent its typography on nothing.
   *
   * So the screen carries the TURN of the beat and the voice carries the
   * sentence. It is the reference grammar — one phrase large while the read
   * does the rest — and it costs nothing structurally: the phrase that
   * remains is still the one the performance measured, so it still lands on
   * the word it lands on. The redundancy goes; the coupling stays.
   *
   * `editorial` overrides it where the turn is not the best thing to show.
   */
  const editorial = visual.editorial;
  /*
   * An EMPTY editorial string means the screen says nothing on this beat, and
   * that is a decision rather than an omission. Where the picture already IS
   * the answer to the line, repeating the line is the duplication the whole
   * editorial layer exists to stop.
   */
  const hero = beat.phrases.filter((phrase) => phrase.carriesEmphasis);
  const shown = editorial === ''
    ? []
    : editorial
      ? hero.map((phrase) => ({ ...phrase, text: editorial }))
      : hero;

  /*
   * EDITORIAL COPY ARRIVES WITH THE BEAT, not with its word.
   *
   * Showing only the turning phrase was right and left a hole: that phrase is
   * spoken late in its beat, so the screen was empty for the seconds before
   * it — on a statement beat that is a black frame with a voice over it, and
   * the room reported exactly that as dead air and attention drops.
   *
   * The hole was the last piece of subtitle thinking. A subtitle must appear
   * when the word is said; editorial copy must not. It can be on screen first
   * and let the voice arrive AT it, which is the stronger relationship — the
   * film states, then says. The word still gets its event, because the
   * picture reacts on the emphasis regardless: the field opens, the mark
   * lands, the strike goes through.
   *
   * A short lead rather than zero, so the cut and the type are not one event.
   */
  /*
   * NOTHING ON SCREEN LEADS THE VOICE. NOTHING.
   *
   * This led the editorial phrase to fill the seconds before it was spoken,
   * and it was solving a real problem the wrong way: with only the turn phrase
   * shown, the frame sat empty until late in the beat. But the biggest text on
   * screen IS what a viewer reads as the caption, and leading it by two
   * seconds means the film shows you "not made yet." while the narrator is
   * still on "Every company has a film". That is the subtitles not following
   * the voice, however the layer is labelled internally.
   *
   * The dead air is the subtitle track's job and it now has one. So the
   * editorial arrives on its own word, like everything else.
   */
  const shownFrom = (phrase: { atSeconds: number }) => phrase.atSeconds;

  (shown.length > 0 || editorial === '' ? shown : beat.phrases.slice(-1)).forEach((phrase, i) => {
    const hero = phrase.carriesEmphasis;
    /*
     * A HERO PHRASE THAT IS ONE WORD EARNS IMAGE SCALE.
     *
     * "Three." is a word the whole beat exists for, and it was set at the same
     * size as a nine-word sentence. A craft reading asked for exactly this —
     * "synchronise the typography scale and weight to the spoken emphasis,
     * specifically enlarging the word 'Three'" — and it is the move the
     * references keep making: one word taken to the size of an image.
     *
     * Only when it is genuinely short. Scaling a long phrase this way would
     * wrap it to three lines and lose the very thing that makes it land.
     */
    const words = phrase.text.trim().split(/\s+/).filter(Boolean).length;
    const heroScale = hero && words <= 2
      ? composition.heroScale * 1.9
      : composition.heroScale;
    const next = shown[i + 1];
    // Out as the next one arrives, with a breath of overlap so the frame is
    // never empty between two things being said.
    /*
     * A BREATH OF OVERLAP, EXCEPT INTO A WORD THIS BIG.
     *
     * Phrases normally hand over with 60ms of overlap so the frame is never
     * empty between two things being said. At image scale that stops being a
     * breath and becomes a collision: "Three." at nearly twice the size landed
     * on top of "Not one safe idea." and both were unreadable for a sixth of a
     * second. When the next phrase is the big one, this one is gone before it
     * arrives.
     */
    const nextWords = next ? next.text.trim().split(/\s+/).filter(Boolean).length : 0;
    const nextIsImageScale = next ? next.carriesEmphasis && nextWords <= 2 : false;
    const exitAt = next ? next.atSeconds + (nextIsImageScale ? -0.04 : 0.06) : beat.durationSeconds;
    /*
     * A single word at image scale is not inside one panel, it is across them.
     *
     * The fields composition sets its line inside the FIRST colour field,
     * which is right for a sentence. At image scale the word is wider than any
     * one field and crossed the seam into the next — so it reads as
     * mis-positioned rather than as a decision. Centred, it spans all three,
     * which is the stronger frame anyway: the word the whole picture just
     * divided itself for should sit over the division rather than beside it.
     */
    const spansFrame = hero && words <= 2 && visual.kind === 'fields';
    const place = spansFrame
      ? { x: 0.5, y: composition.top, anchor: 0.5 }
      : { x: composition.x, y: composition.top, anchor: composition.anchor };
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
      maxWidth: ((hero ? (spansFrame ? 0.92 : composition.width) : composition.width * 0.9)) / ((hero ? heroScale : 1) * 1.07),
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
      enterAt: shownFrom(phrase),
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
          ? { from: heroScale * 0.965, to: heroScale, curve: 'out_quint' }
          : composition.heroScale === 1 ? 1 : composition.heroScale,
      }),
    } as SceneObject);

    /*
     * REVEALED THROUGH A MASK, not faded into place.
     *
     * Three consecutive comparisons against a reference named typography as an
     * OBVIOUS gap and described the same difference each time: "B reveals text
     * through masks with kinetic scaling", "A cuts to static white text". A
     * fade is what type does when nobody decided anything; a wipe has an edge,
     * and the edge is the event.
     *
     * The engine has had referential masks since the scene language was
     * written and this film has never used one. The mask opens upward from the
     * line's own baseline, so the words appear to rise out of the frame rather
     * than to materialise on top of it — which is also the direction the
     * staggered words are already travelling, so the two agree instead of
     * fighting.
     *
     * Sized generously in width: a mask that clips the line horizontally would
     * be a wipe, and a wipe across a sentence reads as a lower third.
     */
    objects.push({
      kind: 'mask', id: `${beat.id}_reveal_${i}`, masks: [`${beat.id}_say_${i}`],
      shape: 'rect',
      width: 2,
      height: {
        keyframes: [
          { t: 0, value: 0 },
          { t: Math.max(0.001, shownFrom(phrase) / Math.max(0.01, beat.durationSeconds)), value: 0, curve: 'linear' },
          { t: Math.min(0.98, (shownFrom(phrase) + 0.5) / Math.max(0.01, beat.durationSeconds)), value: 1.2, curve: 'in_out_cubic' },
          { t: 1, value: 1.2 },
        ],
        // in_out_cubic for the same reason the scene transition needed it:
        // out_quint is ninety percent done two fifths of the way through, so
        // the edge that is supposed to BE the event passes before the eye
        // finds it. A reveal has to be visible for the time it was given.
        curve: 'in_out_cubic',
      },
      invert: false,
      // A little softness on the edge: a hard clip on a glyph's baseline reads
      // as a rendering error rather than as a reveal.
      featherPx: 2,
      role: 'structure', enterAt: 0,
      reason: 'The line is revealed by an opening edge rather than faded up.',
      transform: Transform.parse({
        x: place.x, y: place.y + 0.16, anchor: { x: place.anchor, y: 1 },
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

  /*
   * THE SUBTITLE TRACK. Every spoken phrase, on its own measured second.
   *
   * THIS WAS DELETED BY ACCIDENT AND IT IS THE ONE THING THAT MUST NOT DRIFT.
   * Building the editorial layer, I filtered the on-screen text down to the
   * turning phrase and pulled it EARLIER than it is spoken, so the words a
   * viewer reads stopped being the words being said. That was right for the
   * editorial layer and it silently removed the other one: the brief has
   * always asked for three separate things — narration, subtitles, editorial
   * copy — and I collapsed three into one rather than building the third
   * alongside.
   *
   * So this is the subtitle layer, and it is literal. Every phrase the reading
   * produced, at `phrase.atSeconds`, gone at the next one. Not the emphasis
   * only. Not led. Not styled. It comes from the word timings of the
   * performance itself, so it cannot say anything the voice did not say, or
   * say it at a second the voice did not say it.
   *
   * It is deliberately subordinate: small, centred, in the same place on every
   * beat. A subtitle that competes with the editorial line is a second
   * headline; a subtitle nobody notices until they need it is doing its job.
   * The reference film does exactly this — enormous editorial type with a
   * quiet burnt-in caption beneath it.
   *
   * `spoken: true` keeps the reading-speed check off it: this text is heard,
   * not read, and it is paced by a performance rather than by a designer.
   */
  /*
   * The rows come from `subtitlesFor`, not from a loop written here.
   *
   * That function is in `@act-one/creative` with tests that encode BOTH ways
   * this has broken — the emphasis-only filter and the early lead — and it
   * takes no argument that could reintroduce either. Building the rows inline
   * again is how the rule got lost the first two times: the code read as care
   * taken by whoever was editing, and care is not a contract. This file now
   * only decides how a row LOOKS; what it says and when is decided upstream
   * and is checked by `subtitlesFollow` before anything is drawn.
   */
  const subtitleRows = subtitlesFor(beat.phrases, beat.durationSeconds);
  const subtitlesAreHonest = subtitlesFollow(subtitleRows, beat.phrases);
  if (!subtitlesAreHonest.ok) {
    // Loud on purpose. A silent subtitle fault survived two full renders.
    throw new Error(`Beat ${beat.id}: subtitles do not follow the voice — ${subtitlesAreHonest.why}`);
  }

  /*
   * WHAT IS BEHIND THE CAPTION CHANGES DURING THE BEAT, AND IT WAS COLOURED
   * FOR ONE OF THE TWO.
   *
   * A statement beat with a field spends its first half on ink and its second
   * half on colour: the field grows from the centre on the emphasis word. The
   * caption took its colour from the field for the WHOLE beat, so on b3 —
   * where the field is #F4F2EC, a near-white — the subtitle was near-black
   * type on a near-black frame for three seconds, and then correct. Nothing
   * was mistimed and nothing was mislabelled; the words were simply not
   * visible, which from a seat is indistinguishable from not being there.
   *
   * So the surface is asked for at a moment rather than assumed for a beat,
   * and a row that straddles the change is drawn twice — same words, same
   * clock, one colour each side. The viewer sees one continuous caption that
   * stays legible through a full-frame colour change.
   */
  const fieldArrivesAt = fieldColour
    /*
     * When the colour reaches the BOTTOM of the frame, not when it finishes.
     *
     * The field opens at `at + 0.16` and is full at `at + 0.42`, growing to
     * 180% of the height from the centre on an out_expo — which covers y=0.905
     * about a fifth of the way through that window. Flipping the caption at
     * the end of the growth would leave it wrong-on-colour for a quarter of a
     * second; flipping it at the start would leave it wrong-on-ink for the
     * same. This is where the ground under the words actually changes.
     */
    ? (beat.emphasisAtSeconds ?? beat.voiceAtSeconds) + 0.19
    : Number.POSITIVE_INFINITY;

  /** The colour of whatever the caption is sitting on at a given second. */
  const surfaceAt = (seconds: number): string =>
    seconds >= fieldArrivesAt && fieldColour ? fieldColour : background;

  /**
   * Whichever of the two brand colours can actually be READ on that surface.
   *
   * MEASURED, not thresholded. Everything else in this film picks its colour
   * with `luminance(surface) > 0.45`, which asks "is this light or dark" — a
   * fine question for a headline, and the wrong one here. The accent field is
   * L=0.267, so that test calls it dark and puts paper on it at a contrast of
   * 2.96:1; ink on the same orange measures 5.90:1. The threshold picked the
   * less readable of the two options for the one element in the frame whose
   * entire job is to be readable.
   *
   * The headline keeps the threshold on purpose: it is enormous, it is the
   * beat's voice, and paper on accent is the look. A caption is not making a
   * statement, so it takes the contrast instead — which also stops it reading
   * as a second headline in the same colour underneath the first.
   */
  const legibleOn = (surface: string): string =>
    contrastRatio(palette.ink, surface) >= contrastRatio(palette.paper, surface)
      ? palette.ink
      : palette.paper;

  /**
   * Whether this beat's ground is a colour I chose or a picture I did not.
   *
   * Choosing the caption's colour only works where the thing behind it is a
   * flat colour this file put there. On b7 the frame is three real renders
   * cutting full-bleed, and one of them is nearly white — so the caption was
   * white type on a white film for two seconds, and no colour rule could have
   * known, because what is under the words is a video.
   *
   * The switch is exhaustive on purpose. A new visual kind will not compile
   * until somebody says which of the two it is, which is the only way this
   * stops being a thing I have to remember.
   */
  const groundIsPicture = ((): boolean => {
    switch (visual.kind) {
      // A colour this file painted: measure it and pick type that reads on it.
      case 'statement':
      case 'mark':
        return false;
      // Photography, screenshots, video, panels: unknowable at compile time.
      case 'product':
      case 'clip':
      case 'fields':
      case 'films':
      case 'audit':
        return true;
      default: {
        const unreachable: never = visual;
        throw new Error(`No caption ground declared for ${JSON.stringify(unreachable)}`);
      }
    }
  })();

  /*
   * A pool of dark under the words, and only where the picture is unknowable.
   *
   * This is the oldest device in subtitling and it is here for the oldest
   * reason: the caption cannot be allowed to depend on what the shot happens
   * to contain. It is radial rather than a bar so it has no edge to notice —
   * a band across the bottom of a frame is a lower third, and this is not
   * announcing anything — and it sits at the caption's own z so the camera
   * moves the two together instead of sliding one over the other.
   *
   * On the dark beats it is very nearly invisible, which is correct: it costs
   * nothing where it is not needed and saves the two beats where it is.
   */
  if (groundIsPicture && subtitleRows.length) {
    objects.push({
      kind: 'gradient', id: `${beat.id}_caption_ground`, shape: 'radial',
      from: 'rgba(11,12,16,0.80)', to: 'rgba(11,12,16,0)',
      centre: { x: 0.5, y: 1.04 }, radius: 0.36,
      role: 'structure',
      enterAt: subtitleRows[0]!.atSeconds,
      reason: 'Ground for the caption, because what is behind it is a picture rather than a colour.',
      transform: Transform.parse({ x: 0.5, y: 0.5, z: -0.5, anchor: { x: 0.5, y: 0.5 } }),
    } as SceneObject);
  }

  // A row becomes one drawn caption, or two when the ground moves under it.
  const drawn = subtitleRows.flatMap((row, i) => {
    const straddles = row.atSeconds < fieldArrivesAt && row.untilSeconds > fieldArrivesAt;
    if (!straddles) {
      return [{ row, id: `${beat.id}_sub_${i}`, from: row.atSeconds, to: row.untilSeconds,
        colour: legibleOn(surfaceAt(row.atSeconds)) }];
    }
    return [
      { row, id: `${beat.id}_sub_${i}`, from: row.atSeconds, to: fieldArrivesAt,
        colour: legibleOn(surfaceAt(row.atSeconds)) },
      { row, id: `${beat.id}_sub_${i}_on_field`, from: fieldArrivesAt, to: row.untilSeconds,
        colour: legibleOn(surfaceAt(fieldArrivesAt)) },
    ];
  });

  drawn.forEach(({ row, id, from, to, colour }) => {
    objects.push({
      kind: 'text', id, content: row.text,
      /*
       * Body rather than caption, and ink on a light field.
       *
       * At the smallest step in the scale it rendered as a grey smudge along
       * the bottom edge — present, and unreadable, which is the worst of both.
       * A subtitle has one job. It also has to survive the one beat whose
       * frame fills with paper, where white on white is nothing at all.
       */
      // Body: readable, and clearly subordinate to the editorial line. The
      // smallest step in the scale rendered as a smudge; the statement step
      // competes with the headline.
      token: 'body',
      color: colour,
      align: 'center', maxWidth: 0.7, maxLines: 2,
      staggerBy: 'none', staggerSeconds: 0,
      spoken: true,
      role: 'structure',
      enterAt: from,
      exitAt: to,
      reason: `Subtitle: "${row.text}", at the second it is spoken.`,
      transform: Transform.parse({
        /*
         * NEGATIVE z, AND THIS IS THE SECOND TIME THIS TRAP HAS BEEN WALKED
         * INTO. Painter's order sorts by z DESCENDING — furthest first — so a
         * POSITIVE z is further back. At 0.05 the subtitle sorted ahead of the
         * page at 0, which means the page was drawn over it: the text was
         * rendered, correctly timed, and then covered, arriving as a dim grey
         * smear that looked like a colour or opacity fault and was neither.
         *
         * The caption band did exactly this once before, at z 0.1, and the
         * comment recording it is a few hundred lines above. A subtitle is the
         * one thing in the frame that must never be behind anything.
         */
        x: 0.5, y: 0.905, z: -0.5, anchor: { x: 0.5, y: 0.5 },
        /*
         * The second half of a straddled row does NOT fade in: it is the same
         * caption continuing, and fading it would blink the words at exactly
         * the moment the frame changes colour under them.
         */
        opacity: from === row.atSeconds
          ? { keyframes: [{ t: 0, value: 0 }, { t: 0.05, value: 0.95, curve: 'out_cubic' }, { t: 1, value: 0.95 }], curve: 'out_cubic' }
          : { keyframes: [{ t: 0, value: 0.95 }, { t: 1, value: 0.95 }], curve: 'linear' },
      }),
    } as SceneObject);
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
    /*
     * HOW THIS BEAT BECOMES THE NEXT ONE.
     *
     * Put beside a reference twice, the same answer came back twice in
     * different words: "choreographed spatial sequences" against our
     * "slideshow format", and then "introduce continuous camera motion between
     * scenes to eliminate the slideshow". We were emitting two mechanisms —
     * cut, or a small lateral carry — and the renderer has had a third the
     * whole time whose own comment describes it as "the zoom into the white
     * space the reference films use to change scene without cutting". It had
     * never once been asked for.
     *
     * It is also the move the Benchmark Lab retrieved from five of seven
     * references independently: an element expands until it IS the next scene.
     * The one beat that can do it honestly is the one that has just filled the
     * frame with a colour — the field the picture became opens into what
     * follows, so the cut has an author.
     *
     * Three mechanisms, each with a reason:
     *   scale_through  this beat ended as a full-frame field; it opens.
     *   cut            the emphasis lands at the very end; the word cuts.
     *   camera_carry   the beat trails off, so the move continues through it.
     */
    handover: {
      mechanism: visual.kind === 'statement' && visual.field
        ? 'scale_through'
        : beat.emphasisAtSeconds !== null && beat.emphasisAtSeconds > beat.durationSeconds - 1.2
          ? 'cut'
          : 'camera_carry',
      /*
       * What survives the boundary, named rather than left empty.
       *
       * The receipt is on screen across four beats and is the one object the
       * middle of this film is built to let you follow; a handover that does
       * not declare it is a handover that does not know what it is carrying.
       */
      carries: visual.receipt ? [`${beat.id}_receipt_tag`, `${beat.id}_receipt_text`] : [],
      // Long enough to be seen. A scene opening out of the frame the last one
      // pushed into is the slowest thing this film does on purpose, and at
      // half a second it was over before the eye had started following it.
      durationSeconds: visual.kind === 'statement' && visual.field ? 0.95 : 0.4,
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
      ? { x: 0.5, top: 0.80, lineGap: 0.1, anchor: 0.5, width: 0.78, heroScale: 1.05 }
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
    return { x: 0.5, top: 0.80, lineGap: 0.1, anchor: 0.5, width: 0.78, heroScale: 1.05 };
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
    /*
     * A focused render is 16:9 in a 16:9 frame, so its height fraction equals
     * its width fraction: at 0.62 it reaches from 0.13 to 0.75, and a caption
     * at 0.78 lands on its bottom edge along with the scoreboard. The line
     * goes under all of it.
     */
    if (visual.focus !== undefined) {
      return { x: 0.5, top: 0.82, lineGap: 0.08, anchor: 0.5, width: 0.82, heroScale: 1 };
    }
    return { x: 0.5, top: 0.72, lineGap: 0.085, anchor: 0.5, width: 0.9, heroScale: 1 };
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

    /*
     * IT GROWS FROM A POINT, rather than wiping up from the bottom.
     *
     * This came out of the reference corpus rather than out of my head, and it
     * is the first thing retrieval has found that I would not have. Asked what
     * excellent films do for premium motion, five of the seven independently
     * reach for the same move: an element expands until it IS the next scene.
     * target1 scales a text block up from centre until it replaces everything;
     * target3 expands a button's colour from its own centre to fill the frame;
     * target7 grows a glowing line vertically until the screen is that colour;
     * target4 flies cards past the lens so the thing you were looking at
     * becomes the thing you are now in.
     *
     * At seven films that is worth noticing rather than calling typical — but
     * what they share is not a shape, it is a principle: the transition is
     * CAUSED by something already in the frame, so the cut has an author. A
     * field that wipes up from off-screen arrives from nowhere; one that opens
     * from the middle of the frame, where the word just landed, is the word
     * doing it.
     *
     * The execution is ours. No reference's element, timing or composition is
     * reproduced — only the move.
     */
    const opens = Math.min(0.9, (at + 0.16) / beat.durationSeconds);
    const filled = Math.min(0.95, (at + 0.42) / beat.durationSeconds);
    const grow = (to: number) => ({
      keyframes: [
        { t: 0, value: 0 },
        { t: opens, value: 0, curve: 'linear' as const },
        { t: filled, value: to, curve: 'out_expo' as const },
        { t: 1, value: to },
      ],
      curve: 'out_expo' as const,
    });

    return [{
      kind: 'shape', id: `${beat.id}_field`, shape: 'rect',
      // Both axes, from nothing, about the centre: the frame opens rather than
      // being covered.
      width: grow(1.6), height: grow(1.8),
      fill: visual.field, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
      role: 'support', enterAt: 0,
      reason: `The frame opens on "${beat.emphasis ?? beat.line}" — the word is what causes it.`,
      transform: Transform.parse({ x: 0.5, y: 0.5, z: 0.7, anchor: { x: 0.5, y: 0.5 } }),
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
    const fields = visual.colours.map((fill, i) => ({
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

    /*
     * Each direction's name, in its own register, arriving after its field.
     *
     * Three different tokens and three different scales, because that IS the
     * difference between three art directions — one sets a word huge, one sets
     * it as a quiet label, one sits between. Three colours differ in hue and
     * nothing else, which is why they read as a placeholder.
     */
    for (const [i, label] of (visual.labels ?? []).entries()) {
      if (i >= visual.colours.length) break;
      fields.push({
        kind: 'text', id: `${beat.id}_label_${i}`, content: label.text,
        token: label.token, color: palette.paper,
        align: 'center', maxWidth: (1 / visual.colours.length) * 0.84 / label.scale, maxLines: 1,
        staggerBy: 'none', staggerSeconds: 0,
        role: 'support', enterAt: 0,
        reason: `What direction ${i + 1} is, set the way that direction sets things.`,
        /*
         * CENTRED IN THEIR COLUMN AND LARGE, because they are the subject.
         *
         * Set small at the foot they were captions under three colour blocks,
         * and four directors of five reported exactly that twice running:
         * "claims three creative directions but displays flat color blocks".
         * The label is not a caption for the field — it IS the direction, and
         * three columns each setting one word its own way is the only thing
         * that can be shown at this size that actually differs between three
         * art directions.
         *
         * They arrive almost immediately. At a third of the way in, the first
         * second of a 2.7-second beat was three empty blocks, which is what
         * the room was looking at when it said so.
         */
        transform: Transform.parse({
          x: (i + 0.5) / visual.colours.length, y: 0.5, z: 0.5,
          anchor: { x: 0.5, y: 0.5 }, scale: label.scale,
          opacity: { keyframes: [
            { t: 0, value: 0 },
            { t: 0.03 + i * 0.045, value: 0, curve: 'linear' },
            { t: 0.13 + i * 0.045, value: 0.94, curve: 'out_quint' },
            { t: 1, value: 0.94 },
          ], curve: 'out_quint' },
        }),
      } as SceneObject);
    }

    return fields;
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

    if (visual.verdictOnly) {
      const verdicts = visual.verdicts ?? [];
      const count = Math.max(available.length, verdicts.length) || 3;
      for (let i = 0; i < count; i += 1) {
        const failed = (verdicts[i] ?? 'pass') === 'fail';
        objects.push({
          kind: 'shape', id: `${beat.id}_verdict_${i}`, shape: 'rect',
          width: { keyframes: [
            { t: 0, value: 0 },
            { t: 0.1 + i * 0.13, value: 0, curve: 'linear' },
            { t: 0.22 + i * 0.13, value: failed ? 0.3 : 0.14, curve: 'out_quint' },
            { t: 1, value: failed ? 0.3 : 0.14 },
          ], curve: 'out_quint' },
          height: failed ? 0.012 : 0.006,
          fill: failed ? palette.accent : palette.paper,
          stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
          role: failed ? 'payload' : 'structure', enterAt: 0,
          reason: failed
            ? 'The direction that did not pass, struck at the width of a rejection.'
            : 'A direction that passed its checks.',
          // A column, not a row: three verdicts read down the frame the way a
          // report does, and the struck one is twice as wide as the others.
          transform: Transform.parse({
            x: 0.5, y: 0.38 + i * 0.12, z: 0.2,
            anchor: { x: 0.5, y: 0.5 }, opacity: failed ? 1 : 0.8,
          }),
        } as SceneObject);
        audio.push({
          at: beat.durationSeconds * (0.22 + i * 0.13),
          kind: failed ? 'impact' : 'ui_click',
          intensity: failed ? 0.5 : 0.26,
          causedBy: `${beat.id}_verdict_${i}`,
          reason: failed ? 'The system fails its own work before anybody else sees it.' : 'A direction is scored.',
        });
      }
      return objects;
    }

    if (visual.sequence && available.length > 0) {
      /*
       * One cut per film, evenly across the beat. Each is full frame, so each
       * is legible; each sits on its own direction's colour so the three are
       * distinguishable at the edges even while they are cutting.
       */
      const slice = 1 / available.length;
      available.forEach((assetId, i) => {
        const from = i * slice;
        const to = (i + 1) * slice;
        // A hard cut, not a fade: opacity is 1 across the slot and 0 outside
        // it, with a single frame of overlap so the frame is never empty.
        const visible = {
          keyframes: [
            { t: 0, value: i === 0 ? 1 : 0 },
            ...(i === 0 ? [] : [{ t: Math.max(0, from - 0.004), value: 0, curve: 'linear' as const }]),
            { t: from, value: 1, curve: 'linear' as const },
            { t: Math.min(1, to - 0.004), value: 1, curve: 'linear' as const },
            ...(i === available.length - 1 ? [] : [{ t: Math.min(1, to), value: 0, curve: 'linear' as const }]),
            { t: 1, value: i === available.length - 1 ? 1 : 0 },
          ],
          curve: 'linear' as const,
        };
        objects.push({
          kind: 'shape', id: `${beat.id}_seqfield_${i}`, shape: 'rect',
          width: 1.5, height: 1.8,
          fill: visual.colours[i] ?? palette.ember,
          stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
          role: 'structure', enterAt: 0,
          reason: `Direction ${i + 1}, as its own colour behind its own film.`,
          transform: Transform.parse({ x: 0.5, y: 0.5, z: 0.7, anchor: { x: 0.5, y: 0.5 }, opacity: visible }),
        } as SceneObject);
        objects.push({
          kind: 'clip', id: `${beat.id}_seqfilm_${i}`, assetId,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          /*
           * FULL BLEED. Inset on its colour, each render read as a screenshot
           * laid on a coloured card rather than as a film. The colour survives
           * as the single-frame flash between cuts, which is punctuation; a
           * border around the evidence is just a frame nobody asked for.
           */
          width: 1.02, sourceInSeconds: 1.4 + i * 1.1, playbackRate: 1, generated: true,
          role: i === 0 ? 'payload' : 'support', enterAt: 0,
          reason: 'One of the three directions, whole and legible.',
          transform: Transform.parse({ x: 0.5, y: 0.5, z: 0.2, anchor: { x: 0.5, y: 0.5 }, opacity: visible }),
        } as SceneObject);
        audio.push({
          at: beat.durationSeconds * from,
          kind: i === 0 ? 'ui_click' : 'impact',
          intensity: i === 0 ? 0.3 : 0.4,
          causedBy: `${beat.id}_seqfilm_${i}`,
          reason: 'A direction arrives. Three cuts are the three.',
        });
      });
      return objects;
    }

    if (visual.focus !== undefined && available[visual.focus]) {
      const assetId = available[visual.focus]!;
      const verdicts = visual.verdicts ?? [];
      // The field behind it, in that direction's own colour.
      objects.push({
        kind: 'shape', id: `${beat.id}_focus_field`, shape: 'rect',
        width: 1.5,
        height: { keyframes: [{ t: 0, value: 0 }, { t: 0.1, value: 1.6, curve: 'out_expo' }, { t: 1, value: 1.6 }], curve: 'out_expo' },
        /*
         * INK, not the direction's colour.
         *
         * Two reasons and both matter. The lane worth inspecting happens to be
         * the one whose colour is the accent, and a full accent field here
         * would spend on a scoring beat what the film needs at its turn — the
         * accent is loud precisely because it appears once. And the direction
         * identities were established by the beat before this one, which every
         * reading calls the best moment; this beat's subject is the VERDICT,
         * not which of the three it was. A dark plate lets the render be the
         * brightest thing in frame, which is what makes it evidence.
         */
        fill: palette.ink,
        stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
        role: 'structure', enterAt: 0,
        reason: 'A dark plate, so the render is the brightest thing in the frame.',
        transform: Transform.parse({ x: 0.5, y: 0.5, z: 0.7, anchor: { x: 0.5, y: 0.5 } }),
      } as SceneObject);
      // The render itself, big enough to be evidence.
      objects.push({
        kind: 'clip', id: `${beat.id}_focus_film`, assetId,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        width: 0.62, sourceInSeconds: 1.6, playbackRate: 1, generated: true,
        role: 'payload', enterAt: 0.08,
        reason: 'One of the three directions, at a size a person can judge.',
        transform: Transform.parse({
          x: 0.5, y: 0.44, z: 0.2, anchor: { x: 0.5, y: 0.5 },
          scale: { from: 0.97, to: 1, curve: 'out_quint' },
          opacity: { keyframes: [{ t: 0, value: 0 }, { t: 0.16, value: 1, curve: 'out_cubic' }, { t: 1, value: 1 }], curve: 'out_cubic' },
        }),
      } as SceneObject);
      /*
       * THE SCOREBOARD: three marks for three judgements, one of them struck.
       * This is what carries "each one" now that only one is shown — and it is
       * legible in a way three thumbnails never were.
       */
      available.forEach((_, i) => {
        const failed = (verdicts[i] ?? 'pass') === 'fail';
        objects.push({
          kind: 'shape', id: `${beat.id}_score_${i}`, shape: 'rect',
          width: { keyframes: [
            { t: 0, value: 0 },
            { t: 0.42 + i * 0.09, value: 0, curve: 'linear' },
            { t: 0.52 + i * 0.09, value: failed ? 0.11 : 0.05, curve: 'out_quint' },
            { t: 1, value: failed ? 0.11 : 0.05 },
          ], curve: 'out_quint' },
          height: failed ? 0.0072 : 0.0038,
          fill: failed ? palette.accent : palette.paper,
          stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
          role: 'structure', enterAt: 0,
          reason: failed ? 'The direction that did not pass.' : 'A direction that passed its checks.',
          // Under the render, above the line: a scoreboard reads as a row.
          transform: Transform.parse({ x: 0.5 + (i - 1) * 0.14, y: 0.815, z: 0.15, anchor: { x: 0.5, y: 0.5 }, opacity: failed ? 1 : 0.82 }),
        } as SceneObject);
        if (failed) {
          audio.push({
            at: beat.durationSeconds * (0.52 + i * 0.09), kind: 'impact', intensity: 0.45,
            causedBy: `${beat.id}_score_${i}`,
            reason: 'The system fails its own work, audibly, before anybody else sees it.',
          });
        }
      });
      return objects;
    }

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
