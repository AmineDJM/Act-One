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
  | { kind: 'product'; assetId: string; window: { x: number; width: number; fromY: number; toY: number } }
  | { kind: 'clip'; assetId: string; sourceInSeconds?: number; crop?: { x: number; y: number; width: number; height: number } }
  | { kind: 'fields'; colours: readonly string[]; assetIds?: readonly string[] };

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
  const onPaper = visual.kind === 'product';
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
  objects.push(...visualObjects(beat, visual, options, audio));

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
  const composition = compositionFor(beat, index, visual);

  beat.phrases.forEach((phrase, i) => {
    const hero = phrase.carriesEmphasis;
    const place = {
      x: composition.x,
      y: composition.top + i * composition.lineGap,
      anchor: composition.anchor,
    };
    objects.push({
      kind: 'text', id: `${beat.id}_say_${i}`, content: phrase.text,
      token: hero ? 'display' : 'statement',
      color: hero ? palette.accent : (onPaper ? palette.ink : palette.paper),
      align: 'left', maxWidth: hero ? 0.62 : 0.52, maxLines: 2,
      // Heard, not read: this text is the reading it was generated from.
      spoken: true,
      staggerBy: 'none', staggerSeconds: 0,
      role: hero ? 'payload' : 'support',
      enterAt: phrase.atSeconds,
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
        scale: hero ? { from: 0.9, to: 1, curve: 'out_expo' } : { from: 0.98, to: 1, curve: 'out_expo' },
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
function compositionFor(beat: TimedBeat, index: number, visual: BeatVisual): {
  x: number; top: number; lineGap: number; anchor: number;
} {
  const lines = Math.max(1, beat.phrases.length);
  const lineGap = 0.115;
  if (visual.kind === 'clip' || visual.kind === 'product') {
    // Low and left: the footage is the subject and the words are under it.
    return { x: 0.07, top: 0.62 - (lines - 1) * lineGap * 0.5, lineGap, anchor: 0 };
  }
  if (visual.kind === 'mark') {
    return { x: 0.09, top: 0.44 - (lines - 1) * lineGap * 0.5, lineGap, anchor: 0 };
  }
  // A typographic beat gets the frame. Alternating the margin stops a run of
  // them reading as one long slide.
  const left = index % 2 === 0;
  return { x: left ? 0.08 : 0.5, top: 0.5 - (lines - 1) * lineGap * 0.5, lineGap, anchor: left ? 0 : 0.5 };
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
  if (visual.kind === 'product') {
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

  if (visual.kind === 'product' && options.assets[visual.assetId]) {
    return [{
      kind: 'ui_layer', id: `${beat.id}_page`, assetId: visual.assetId, semantic: 'page',
      crop: {
        x: visual.window.x, width: visual.window.width, height: visual.window.width / 1.111,
        y: { from: visual.window.fromY, to: visual.window.toY, curve: 'in_out_cubic' },
      },
      width: 1.08, cornerRadiusPx: 0, shadow: false,
      role: 'support', enterAt: 0,
      reason: 'The real interface, travelled through rather than held up as a card.',
      transform: Transform.parse({ x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 } }),
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

  if (visual.kind === 'mark') {
    return [{
      kind: 'shape', id: `${beat.id}_rule`, shape: 'rect',
      width: { from: 0, to: 0.22, curve: 'out_expo' }, height: 0.004,
      fill: palette.accent, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
      role: 'structure', enterAt: Math.max(0.2, beat.voiceSeconds * 0.6),
      reason: 'The rule the film has used throughout.',
      transform: Transform.parse({ x: 0.09, y: 0.66, anchor: { x: 0, y: 0.5 } }),
    } as SceneObject];
  }

  return [];
}
