import { z } from 'zod';
import type { CallContext, Provider } from '../types.ts';

/**
 * What a film is observed to do, on the clock.
 *
 * Two kinds of statement live in this package and they are never mixed. A
 * MEASUREMENT is a number a program read off the file: an optical-flow peak at
 * 12.42s, an audio onset 70ms after a visual one, a boundary at 4.10s. It is
 * reproducible, it has no opinion, and it is wrong only if the code is wrong.
 * An INTERPRETATION is a sentence about what that means: three cards
 * accelerate into the hero transition, the impact resolves the movement rather
 * than anticipating it. It is a reading, it can be wrong while every number
 * behind it is right, and it is worth having precisely because no measurement
 * contains it.
 *
 * The distinction is structural rather than advisory. Interpretations carry
 * `confidence` and `evidence`; measurements carry neither, because a measured
 * number that needs a confidence score is a measurement that was not made.
 * Anything downstream can therefore ask "what is actually known" and get an
 * answer that does not quietly include a model's guess.
 *
 * The reason for the care: what comes out of here becomes instructions to a
 * director. A film grammar assembled from confident-sounding inventions is
 * worse than no film grammar, because it is followed.
 */

/**
 * Seconds from the start of the film.
 *
 * Coerced, because a model asked for a time writes one the way a person would:
 * `12.4`, `"12.4"`, `"12.4s"`, `"00:12.4"`, `"1:06"`. All five mean the same
 * moment and only the first is a number. A live pass over a 67-second film was
 * lost in its entirety — every boundary, beat and cue correct — because one
 * field came back as a string.
 *
 * Only forms whose meaning is unambiguous are accepted. Anything else stays
 * invalid rather than being guessed into a plausible timestamp, because a
 * boundary at the wrong second is worse than a boundary that was dropped.
 */
export const Timecode = z.preprocess((input) => {
  if (typeof input === 'number') return input;
  if (typeof input !== 'string') return input;
  const text = input.trim().toLowerCase().replace(/\s+/g, '');
  // mm:ss(.sss) or hh:mm:ss(.sss)
  const clock = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text);
  if (clock) {
    const hours = Number(clock[1] ?? 0);
    return hours * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  }
  const plain = /^(\d+(?:\.\d+)?)(?:s|sec|secs|seconds)?$/.exec(text);
  if (plain) return Number(plain[1]);
  const ms = /^(\d+(?:\.\d+)?)ms$/.exec(text);
  if (ms) return Number(ms[1]) / 1000;
  return input;
}, z.number().min(0));

/** A closed interval on the film's clock. */
export const Span = z.object({
  start: Timecode,
  end: Timecode,
});
export type Span = z.infer<typeof Span>;

/**
 * How much weight a reading carries.
 *
 * `observed` is the model saying it saw the thing happen at that time.
 * `inferred` is the model concluding it from something it saw. `uncertain` is
 * the model saying it may be reading this wrong — which is a useful answer and
 * must survive into the output rather than being rounded up.
 */
export const Confidence = z.enum(['observed', 'inferred', 'uncertain']);
export type Confidence = z.infer<typeof Confidence>;

/**
 * A closed vocabulary that does not throw away an observation over a synonym.
 *
 * The first version of this schema used plain enums, and a live pass lost
 * seven typography events, three beats, a camera move and a transition —
 * every one of them because the analyst wrote `heading` where the schema said
 * `label`, or `zoom` where it said `push`. The timecode, the subject and the
 * evidence were all correct and all discarded on the spelling.
 *
 * That trade is backwards. The enum exists so downstream code can switch on a
 * small set of cases, not so a reading can be refused. So the word is
 * normalised, looked up in a synonym table, and failing both is filed under
 * the vocabulary's neutral member — and the analyst's own word is kept in
 * `reportedAs` either way, so nothing it actually said is lost and a reader
 * can see when a fallback happened.
 *
 * What this deliberately does NOT do is invent. An absent value stays absent
 * and lands on the neutral member; it never becomes a confident category.
 */
export function vocabulary<T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
  synonyms: Record<string, T[number]> = {},
) {
  const canonical = new Set<string>(values);
  return z.preprocess((input) => {
    if (typeof input !== 'string') return fallback;
    const normalised = input
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (canonical.has(normalised)) return normalised;
    return synonyms[normalised] ?? fallback;
  }, z.enum(values));
}

/** The analyst's own word, kept whenever a vocabulary had to fall back. */
const reportedAs = z.string().max(80).optional();

/**
 * Every interpretation carries the same two fields.
 *
 * `evidence` is what in the film supports the claim, in the analyst's own
 * words. A reading with nothing behind it is the failure mode this whole
 * schema exists to make visible.
 *
 * REQUIRED IS NOT THE SAME AS ENFORCED BY DELETION, and that distinction cost
 * a whole reading. These were strictly required, so an entry the model wrote
 * without them failed to parse and was DROPPED — fifteen scene boundaries and
 * eight beats vanished out of one reference film, and the reading that came
 * back reported zero boundaries in a film that plainly cuts. Insisting on
 * evidence and then discarding the observation when it is missing does not
 * produce better-evidenced readings; it produces emptier ones, and it hides
 * exactly the parts the model was least sure about.
 *
 * So an entry with no stated confidence is `uncertain` rather than absent, and
 * missing evidence says so in words a reader cannot mistake for a finding. The
 * prompt still asks for both, and a pass full of "the analyst stated no
 * evidence" is itself a signal about that pass.
 */
const interpreted = {
  // Unstated confidence is `uncertain`, never `observed`: the one direction a
  // default must never guess in is towards more certainty than was claimed.
  confidence: vocabulary(['observed', 'inferred', 'uncertain'], 'uncertain'),
  evidence: z
    .string()
    .max(600)
    .default('The analyst stated no evidence for this.')
    .catch('The analyst stated no evidence for this.'),
};

// ---------------------------------------------------------------------------
// Structure: where the film changes, and what kind of change it is.
// ---------------------------------------------------------------------------

/**
 * The four kinds of boundary, which are four different decisions.
 *
 * Counting only hard cuts is what reported a seventy-second motion-design film
 * as three shots. A film of this class changes its idea many times without
 * cutting once, so the cut is not the unit.
 */
export const BOUNDARY_KINDS = [
  /** The picture is replaced between one frame and the next. */
  'shot',
  /** The world changes: new field, new place, new register. Often with no cut. */
  'scene',
  /** Same world, new idea: elements replaced, line changed, layout reorganised. */
  'creative_beat',
  /** Material becomes other material: a morph, a scale handoff, an object carried across. */
  'transformation',
] as const;
export const BoundaryKind = z.enum(BOUNDARY_KINDS);
export type BoundaryKind = z.infer<typeof BoundaryKind>;

export const SceneBoundary = z.object({
  at: Timecode,
  kind: vocabulary(BOUNDARY_KINDS, 'creative_beat', {
    cut: 'shot',
    hard_cut: 'shot',
    shot_change: 'shot',
    new_shot: 'shot',
    scene_change: 'scene',
    chapter: 'scene',
    world_change: 'scene',
    section: 'scene',
    beat: 'creative_beat',
    idea: 'creative_beat',
    moment: 'creative_beat',
    morph: 'transformation',
    handoff: 'transformation',
    carry: 'transformation',
    transform: 'transformation',
  }),
  reportedKind: reportedAs,
  /** How the film got from one side to the other. */
  mechanism: z.string().max(200),
  ...interpreted,
});
export type SceneBoundary = z.infer<typeof SceneBoundary>;

export const CreativeBeat = z.object({
  span: Span,
  /** The idea this stretch of film is making, in one sentence. */
  idea: z.string().max(300),
  /** What the viewer is being asked to do here. */
  primaryCognitiveJob: vocabulary(
    ['read', 'watch', 'recognise', 'understand_a_mechanism', 'feel', 'remember', 'act'],
    'watch',
    {
      recognize: 'recognise',
      identify: 'recognise',
      absorb: 'watch',
      observe: 'watch',
      comprehend: 'understand_a_mechanism',
      understand: 'understand_a_mechanism',
      learn: 'understand_a_mechanism',
      evaluate: 'understand_a_mechanism',
      react: 'feel',
      emote: 'feel',
      anticipate: 'feel',
      recall: 'remember',
      retain: 'remember',
      decide: 'act',
      convert: 'act',
    },
  ).default('watch'),
  reportedCognitiveJob: reportedAs,
  ...interpreted,
});
export type CreativeBeat = z.infer<typeof CreativeBeat>;

export const NarrativeProgression = z.object({
  /** The film's argument in order, one entry per movement. */
  movements: z.array(z.object({ span: Span, claim: z.string().max(300) })).max(40),
  /** Whether each movement needs the one before it, or whether the order is arbitrary. */
  dependency: vocabulary(['cumulative', 'parallel', 'mixed', 'unclear'], 'unclear', {
    sequential: 'cumulative',
    linear: 'cumulative',
    building: 'cumulative',
    independent: 'parallel',
    modular: 'parallel',
  }).default('unclear'),
  ...interpreted,
});

export const ViewerState = z.object({
  at: Timecode,
  /** What a first-time viewer now knows that they did not a moment ago. */
  knows: z.string().max(300),
  /** What they are still waiting to be told. */
  openQuestion: z.string().max(300).default(''),
  ...interpreted,
});

// ---------------------------------------------------------------------------
// Picture
// ---------------------------------------------------------------------------

export const VisualHierarchy = z.object({
  at: Timecode,
  /** What the eye lands on first, then second. */
  order: z.array(z.string().max(120)).max(8),
  ...interpreted,
});

export const TypographyEvent = z.object({
  span: Span,
  /** Verbatim only where it is legible; empty rather than guessed. */
  text: z.string().max(300).default(''),
  treatment: z.string().max(200),
  /** Whether the type is the picture or sits on one. */
  role: vocabulary(['the_picture', 'label', 'caption', 'lockup', 'supporting'], 'supporting', {
    headline: 'the_picture',
    heading: 'the_picture',
    hero: 'the_picture',
    statement: 'the_picture',
    display: 'the_picture',
    title: 'the_picture',
    primary: 'the_picture',
    subtitle: 'caption',
    subhead: 'caption',
    body: 'supporting',
    paragraph: 'supporting',
    eyebrow: 'label',
    kicker: 'label',
    tag: 'label',
    metric: 'label',
    stat: 'label',
    logo: 'lockup',
    wordmark: 'lockup',
    signature: 'lockup',
    endcard: 'lockup',
  }).default('supporting'),
  reportedRole: reportedAs,
  ...interpreted,
});

export const UiEvent = z.object({
  span: Span,
  /** What the interface is seen to do: a panel opens, a cursor crosses, a row fills. */
  action: z.string().max(240),
  /** Whether a real interface is being driven, or a capture is being moved through. */
  liveness: vocabulary(['driven', 'held', 'decomposed', 'unclear'], 'unclear', {
    live: 'driven',
    interactive: 'driven',
    animated: 'driven',
    static: 'held',
    screenshot: 'held',
    still: 'held',
    rebuilt: 'decomposed',
    reconstructed: 'decomposed',
  }).default('unclear'),
  ...interpreted,
});

export const ObjectTransformation = z.object({
  span: Span,
  subject: z.string().max(120),
  /** scale handoff, morph, carried across a boundary, replaced in place… */
  mechanism: z.string().max(200),
  ...interpreted,
});

export const CameraBehavior = z.object({
  span: Span,
  move: vocabulary(
    ['static', 'push', 'pull', 'pan', 'tilt', 'orbit', 'handheld', 'rack', 'other'],
    'other',
    {
      zoom: 'push',
      zoom_in: 'push',
      push_in: 'push',
      dolly_in: 'push',
      punch_in: 'push',
      scale_up: 'push',
      zoom_out: 'pull',
      pull_back: 'pull',
      dolly_out: 'pull',
      pull_out: 'pull',
      scale_down: 'pull',
      locked: 'static',
      locked_off: 'static',
      fixed: 'static',
      none: 'static',
      still: 'static',
      track: 'pan',
      truck: 'pan',
      slide: 'pan',
      lateral: 'pan',
      whip_pan: 'pan',
      crane: 'tilt',
      pedestal: 'tilt',
      rotate: 'orbit',
      arc: 'orbit',
      parallax: 'orbit',
      shake: 'handheld',
      drift: 'handheld',
      focus_pull: 'rack',
      rack_focus: 'rack',
    },
  ),
  reportedMove: reportedAs,
  /** Whether the frame moved or the things in it did. The distinction is the point. */
  attribution: vocabulary(['camera', 'objects', 'both', 'unclear'], 'unclear', {
    frame: 'camera',
    viewport: 'camera',
    elements: 'objects',
    content: 'objects',
    subject: 'objects',
    mixed: 'both',
  }).default('unclear'),
  ...interpreted,
});

export const MotionBehavior = z.object({
  span: Span,
  subject: z.string().max(120),
  /** The easing family as the analyst reads it; the measured fit is the authority. */
  easing: z.string().max(80).default(''),
  /** Siblings entering apart, in milliseconds, where a stagger is visible. */
  staggerMs: z.number().min(0).max(5000).nullable().default(null),
  ...interpreted,
});

export const TransitionMechanism = z.object({
  at: Timecode,
  kind: vocabulary(
    [
      'hard_cut',
      'fade',
      'crossfade',
      'camera_move',
      'mask',
      'object_carry',
      'match_move',
      'morph',
      'shape_continuation',
      'sound_bridge',
      'other',
    ],
    'other',
    {
      cut: 'hard_cut',
      straight_cut: 'hard_cut',
      jump_cut: 'hard_cut',
      fade_in: 'fade',
      fade_out: 'fade',
      fade_to_black: 'fade',
      dip_to_black: 'fade',
      dissolve: 'crossfade',
      cross_dissolve: 'crossfade',
      blend: 'crossfade',
      mix: 'crossfade',
      push: 'camera_move',
      zoom: 'camera_move',
      whip: 'camera_move',
      swipe: 'camera_move',
      wipe: 'mask',
      reveal: 'mask',
      clip: 'mask',
      iris: 'mask',
      carry: 'object_carry',
      handoff: 'object_carry',
      persistence: 'object_carry',
      match: 'match_move',
      match_cut: 'match_move',
      transform: 'morph',
      metamorphosis: 'morph',
      shape: 'shape_continuation',
      continuity: 'shape_continuation',
      audio_bridge: 'sound_bridge',
      j_cut: 'sound_bridge',
      l_cut: 'sound_bridge',
    },
  ).default('other'),
  reportedKind: reportedAs,
  /** What survives the boundary, when anything does. */
  carriedAcross: z.string().max(200).default(''),
  ...interpreted,
});

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

export const AudioEvent = z.object({
  at: Timecode,
  layer: vocabulary(['voice', 'music', 'sfx', 'ambience', 'silence'], 'sfx', {
    vo: 'voice',
    narration: 'voice',
    dialogue: 'voice',
    speech: 'voice',
    score: 'music',
    track: 'music',
    sound_effect: 'sfx',
    sound_effects: 'sfx',
    foley: 'sfx',
    ui_sound: 'sfx',
    whoosh: 'sfx',
    impact: 'sfx',
    atmosphere: 'ambience',
    ambient: 'ambience',
    room_tone: 'ambience',
    pad: 'ambience',
    silent: 'silence',
    none: 'silence',
  }),
  reportedLayer: reportedAs,
  description: z.string().max(240),
  ...interpreted,
});

export const VoiceEvent = z.object({
  span: Span,
  /** Only where clearly audible. Empty rather than invented. */
  text: z.string().max(600).default(''),
  delivery: z.string().max(160).default(''),
  ...interpreted,
});

export const MusicEvent = z.object({
  span: Span,
  /** What the cue is doing to the film, not what genre it is. */
  function: z.string().max(240),
  /** Where the music changes state: enters, lifts, drops out, resolves. */
  change: z.string().max(160).default(''),
  ...interpreted,
});

export const SfxEvent = z.object({
  at: Timecode,
  description: z.string().max(200),
  /** What on screen it belongs to. */
  attachedTo: z.string().max(160).default(''),
  ...interpreted,
});

/**
 * Sound against picture, which is where most of the craft is.
 *
 * `offsetMs` is signed: negative means the sound leads the picture and is
 * therefore anticipating it; positive means it follows and is resolving it.
 * Where a measurement exists for the same moment it is the authority and this
 * is the reading of it.
 */
export const AudioVisualSync = z.object({
  at: Timecode,
  visualEvent: z.string().max(200),
  audioEvent: z.string().max(200),
  offsetMs: z.number().min(-4000).max(4000).nullable().default(null),
  relationship: vocabulary(['anticipates', 'coincides', 'resolves', 'unrelated'], 'coincides', {
    leads: 'anticipates',
    precedes: 'anticipates',
    early: 'anticipates',
    synchronous: 'coincides',
    simultaneous: 'coincides',
    locked: 'coincides',
    hit: 'coincides',
    on_frame: 'coincides',
    follows: 'resolves',
    trails: 'resolves',
    late: 'resolves',
    settles: 'resolves',
    lands: 'resolves',
    independent: 'unrelated',
    none: 'unrelated',
  }).default('coincides'),
  ...interpreted,
});

// ---------------------------------------------------------------------------
// The viewer
// ---------------------------------------------------------------------------

export const CognitiveLoad = z.object({
  span: Span,
  /** How much is being asked of the viewer here. */
  level: vocabulary(['low', 'moderate', 'high', 'overloaded'], 'moderate', {
    minimal: 'low',
    light: 'low',
    easy: 'low',
    medium: 'moderate',
    normal: 'moderate',
    heavy: 'high',
    dense: 'high',
    demanding: 'high',
    excessive: 'overloaded',
    saturated: 'overloaded',
    too_much: 'overloaded',
  }),
  reportedLevel: reportedAs,
  /** What is competing for attention, when something is. */
  competingFor: z.array(z.string().max(120)).max(8).default([]),
  ...interpreted,
});

export const HeroMoment = z.object({
  span: Span,
  /** What the film is spending its peak on. */
  subject: z.string().max(200),
  /** How the film prepared for it. */
  setup: z.string().max(300).default(''),
  ...interpreted,
});

export const Memorability = z.object({
  /** The one or two images somebody would still describe a day later. */
  images: z.array(z.object({ at: Timecode, description: z.string().max(240) })).max(6),
  ...interpreted,
});

export const FirstTimeViewerComprehension = z.object({
  /** What the product does, as the film actually communicates it. */
  understoodProposition: z.string().max(500).default(''),
  /** Where a first-time viewer would lose the thread. */
  confusions: z
    .array(z.object({ at: Timecode, problem: z.string().max(300) }))
    .max(12)
    .default([]),
  /** The second at which somebody could say what this is. */
  clearBy: Timecode.nullable().default(null),
  ...interpreted,
});

// ---------------------------------------------------------------------------
// The whole reading
// ---------------------------------------------------------------------------

/**
 * A pass over one film.
 *
 * `depth` records which pass produced it, because a broad pass and a deep pass
 * disagree in predictable ways and a reader that cannot tell them apart will
 * average them.
 */
export const VideoAnalysis = z.object({
  source: z.object({
    /** Whatever identifies the film to the caller: a path, an id, a name. */
    reference: z.string().max(400),
    durationSeconds: z.number().min(0).nullable().default(null),
  }),
  depth: z.enum(['broad', 'deep']),
  /** The model that produced it, so a reading can be re-derived or distrusted. */
  model: z.string().max(120),
  analysedAt: z.string(),

  boundaries: z.array(SceneBoundary).max(400).default([]),
  beats: z.array(CreativeBeat).max(200).default([]),
  narrative: NarrativeProgression.nullable().default(null),
  viewerStates: z.array(ViewerState).max(100).default([]),

  visualHierarchy: z.array(VisualHierarchy).max(100).default([]),
  typography: z.array(TypographyEvent).max(200).default([]),
  ui: z.array(UiEvent).max(200).default([]),
  objectTransformations: z.array(ObjectTransformation).max(200).default([]),
  camera: z.array(CameraBehavior).max(200).default([]),
  motion: z.array(MotionBehavior).max(300).default([]),
  transitions: z.array(TransitionMechanism).max(300).default([]),

  audio: z.array(AudioEvent).max(300).default([]),
  voice: z.array(VoiceEvent).max(200).default([]),
  music: z.array(MusicEvent).max(100).default([]),
  sfx: z.array(SfxEvent).max(300).default([]),
  sync: z.array(AudioVisualSync).max(200).default([]),

  cognitiveLoad: z.array(CognitiveLoad).max(100).default([]),
  heroMoments: z.array(HeroMoment).max(20).default([]),
  memorability: Memorability.nullable().default(null),
  comprehension: FirstTimeViewerComprehension.nullable().default(null),

  /**
   * What the analyst could not see, in its own words.
   *
   * Required and frequently non-empty. A pass at low frame rate cannot speak
   * to a two-frame stagger, and a reading that does not say so invites a
   * director to follow a number nobody measured.
   */
  limitations: z.array(z.string().max(300)).max(20).default([]),
});
export type VideoAnalysis = z.infer<typeof VideoAnalysis>;

export type AnalysisDepth = 'broad' | 'deep';

export type VideoAnalysisRequest = {
  /** A local file path, or a URL the analyst can reach. */
  source: string;
  /** Broad passes are cheap and cover the whole film; deep passes read closely. */
  depth?: AnalysisDepth;
  /** Restrict the reading to part of the film. */
  window?: { startSeconds: number; endSeconds: number };
  /**
   * Frames per second the analyst should sample at. Higher reads fast motion
   * and costs more; the analyst records what it used under `limitations`.
   */
  fps?: number;
  /** Extra direction for this pass, appended to the standing instructions. */
  focus?: string;
};

/**
 * A model that watches a film rather than reading a description of one.
 *
 * Kept apart from `LlmProvider` on purpose. Handing frames to a chat model is
 * a different capability from native temporal understanding, and a caller that
 * cannot tell them apart will ask a model that only saw six stills when a
 * shot's easing was the question.
 */
export interface VideoAnalyst extends Provider {
  readonly kind: 'analysis';
  analyse(request: VideoAnalysisRequest, context: CallContext): Promise<VideoAnalysis>;
  /** Models this account can currently use for video, best first. */
  availableModels(): Promise<string[]>;
}
