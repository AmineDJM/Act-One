import { z } from 'zod';

/**
 * The questions a model is asked about a film, one focused pass at a time.
 *
 * One giant prompt gets one diffuse answer; ten narrow ones each get the
 * model's full attention on one aspect, at the sampling that aspect needs —
 * a narrative reads at one frame a second, a camera move needs four. Every
 * pass returns a schema where each claim cites evidence, and says how sure
 * it is. The integrator then reads the measurements and the ten answers, not
 * the film, and writes the film's DNA.
 */
const Evidence = z
  .array(z.string().max(40))
  .max(16)
  .describe('Ids from the evidence list (shot.001, boundary.001, text.0001, obj.ui_panel.0001, camera.move.001, sfx.0001, silence.001, sync.0001, evt.0001, phrase.001, word.0001) or window:START-END in film seconds. Required; empty only when the claim is unknown.');
const Confidence = z.number().min(0).max(1).describe('0 = guess, 1 = certain. Use low values honestly.');
const Seconds = z.number().min(0).describe('Film time in seconds.');

const Claim = z.object({
  value: z.string().max(1200).nullable().describe('Null when the film does not show it.'),
  evidence: Evidence,
  confidence: Confidence,
});
export type Claim = z.infer<typeof Claim>;

const Inspect = z
  .array(
    z.object({
      startSeconds: Seconds,
      endSeconds: Seconds,
      question: z.string().max(400),
    }),
  )
  .max(3)
  .describe('Up to three short windows (≤1.5 s) you need to see at the film\'s own frame rate to answer precisely.');

export const BEAT_FUNCTIONS = ['hook', 'context', 'problem', 'tension', 'turn', 'reveal', 'demonstration', 'proof', 'benefit', 'emotion', 'brand', 'call_to_action', 'resolution', 'transition', 'other'] as const;
export const TEXT_CLASSES = ['narration_subtitle', 'editorial_copy', 'product_copy', 'decorative', 'unknown'] as const;
export const HANDOVERS = ['preservation', 'transformation', 'semantic_handover', 'motion_handover', 'attention_handover', 'sound_bridge', 'deliberate_rupture'] as const;
export const REGION_KINDS = ['window', 'panel', 'card', 'sidebar', 'toolbar', 'table', 'chart', 'form', 'modal', 'button', 'list', 'editor', 'unknown'] as const;

export const P01Holistic = z.object({
  summary: z.string().max(2000).describe('What happens in the film, plainly, in order.'),
  subject: Claim.describe('What the film is about: the product or idea, as the film itself names it.'),
  format: Claim.describe('The kind of film: product launch, feature explainer, brand film, tutorial, …'),
  language: Claim.describe('ISO 639-1 of the spoken or written language, if any.'),
  audience: Claim,
  structureOverview: z.string().max(1200),
});

export const P02Narrative = z.object({
  thesis: Claim.describe('The one thing the film argues, in a sentence.'),
  arc: Claim.describe('How the film moves from its start to its end.'),
  acts: z.array(z.object({ label: z.string().max(80), startSeconds: Seconds, endSeconds: Seconds, summary: z.string().max(600), evidence: Evidence, confidence: Confidence })).max(8),
  beats: z
    .array(
      z.object({
        startSeconds: Seconds,
        endSeconds: Seconds,
        function: z.enum(BEAT_FUNCTIONS),
        summary: z.string().max(400),
        shotIds: z.array(z.string()).max(12),
        evidence: Evidence,
        confidence: Confidence,
      }),
    )
    .max(60),
  scenes: z.array(z.object({ label: z.string().max(120), startSeconds: Seconds, endSeconds: Seconds, shotIds: z.array(z.string()).max(40), evidence: Evidence, confidence: Confidence })).max(20),
});

export const P03Composition = z.object({
  textBlocks: z
    .array(
      z.object({
        id: z.string().describe('text.NNNN from the list.'),
        classification: z.enum(TEXT_CLASSES),
        role: z.string().max(80).describe('headline, supporting line, label, caption, UI copy, logo text, …'),
        reading: z.string().max(400).nullable().describe('What the text actually says, if the OCR reading in the list is wrong; null if it is right.'),
        fontCategory: z.string().max(60).nullable().describe('A category only (geometric sans, grotesque, serif, monospace, script). Never a family name.'),
        confidence: Confidence,
      }),
    )
    .max(120),
  productShown: Claim.describe('"yes" or "no": is a software product\'s interface shown?'),
  productRegions: z.array(z.object({ objectId: z.string().nullable(), kind: z.enum(REGION_KINDS), label: z.string().max(160), evidence: Evidence, confidence: Confidence })).max(40),
  productMoments: z.array(z.object({ startSeconds: Seconds, endSeconds: Seconds, description: z.string().max(400), evidence: Evidence, confidence: Confidence })).max(20),
  shots: z.array(z.object({ id: z.string(), composition: z.string().max(600), evidence: Evidence, confidence: Confidence })).max(80),
});

export const P04CameraMotion = z.object({
  cameraMoves: z.array(z.object({ id: z.string().nullable().describe('camera.move.NNN, or null for a move the measurements did not list.'), interpretation: z.string().max(400), agent: z.enum(['camera', 'layer', 'unknown']), evidence: Evidence, confidence: Confidence })).max(40),
  objectMotion: z.array(z.object({ subject: z.string().max(120), startSeconds: Seconds, endSeconds: Seconds, description: z.string().max(400), evidence: Evidence, confidence: Confidence })).max(60),
  depth: z.array(z.object({ shotId: z.string(), description: z.string().max(400), parallax: z.boolean().nullable(), evidence: Evidence, confidence: Confidence })).max(40),
  motionPhilosophy: Claim,
  cameraPhilosophy: Claim,
  inspect: Inspect,
});

export const P05Audio = z.object({
  transcript: z.object({ text: z.string().max(20000).nullable(), language: z.string().max(10).nullable(), confidence: Confidence }),
  speakers: z.array(z.object({ description: z.string().max(300), evidence: Evidence, confidence: Confidence })).max(6),
  music: z.object({ present: z.boolean().nullable(), description: z.string().max(800).nullable(), instrumentation: z.array(z.string().max(60)).max(12), evidence: Evidence, confidence: Confidence }),
  musicSections: z.array(z.object({ startSeconds: Seconds, endSeconds: Seconds, label: z.string().max(120), evidence: Evidence, confidence: Confidence })).max(16),
  soundEffects: z.array(z.object({ id: z.string().nullable().describe('sfx.NNNN if it matches a listed transient.'), atSeconds: Seconds, label: z.string().max(120), evidence: Evidence, confidence: Confidence })).max(80),
  ambience: Claim,
  silence: Claim.describe('How silence and space are used, if at all.'),
  soundPhilosophy: Claim,
});

export const P06Sync = z.object({
  clusters: z.array(z.object({ id: z.string().describe('sync.NNNN'), interpretation: z.string().max(400), deliberate: z.boolean().nullable(), evidence: Evidence, confidence: Confidence })).max(80),
  relationships: z.array(z.object({ description: z.string().max(400), startSeconds: Seconds, evidence: Evidence, confidence: Confidence })).max(40),
  inspect: Inspect,
});

export const P07Transitions = z.object({
  boundaries: z.array(z.object({ id: z.string().describe('boundary.NNN'), handover: z.array(z.enum(HANDOVERS)).max(4), technique: z.string().max(200), description: z.string().max(400), evidence: Evidence, confidence: Confidence })).max(80),
  continuousChanges: z.array(z.object({ startSeconds: Seconds, endSeconds: Seconds, technique: z.string().max(200), handover: z.array(z.enum(HANDOVERS)).max(4), description: z.string().max(400), evidence: Evidence, confidence: Confidence })).max(60),
  continuity: Claim,
  transitionPhilosophy: Claim,
  inspect: Inspect,
});

export const P08Moments = z.object({
  moments: z.array(z.object({ title: z.string().max(160), startSeconds: Seconds, endSeconds: Seconds, description: z.string().max(600), whyItWorks: z.string().max(600), evidence: Evidence, confidence: Confidence })).max(12),
  creativeIntent: Claim,
  openingStrategy: Claim,
  heroStrategy: Claim,
  resolutionStrategy: Claim,
});

export const P09Reconstruction = z.object({
  strategy: Claim.describe('How an executor would rebuild the observable behaviour: layers, techniques, order.'),
  shots: z.array(z.object({ id: z.string(), layers: z.array(z.string().max(200)).max(12), techniques: z.array(z.string().max(120)).max(12), evidence: Evidence, confidence: Confidence })).max(80),
  notes: z.array(z.string().max(400)).max(20),
});

export const P10Grammar = z.object({
  mechanisms: z
    .array(
      z.object({
        context: z.string().max(600),
        observedDecision: z.string().max(600),
        likelyEffect: z.string().max(600),
        transferablePrinciple: z.string().max(600),
        doNotCopy: z.array(z.string().max(200)).min(1).max(8),
        evidence: Evidence,
        confidence: Confidence,
      }),
    )
    .max(16),
  signatures: z.array(z.object({ description: z.string().max(600), whyNotTransferable: z.string().max(600), evidence: Evidence, confidence: Confidence })).max(10),
});

const Dna = z.object({
  thesis: Claim,
  narrativeArc: Claim,
  mood: Claim,
  brandPosture: Claim,
  visualPhilosophy: Claim,
  typographyPhilosophy: Claim,
  motionPhilosophy: Claim,
  cameraPhilosophy: Claim,
  soundPhilosophy: Claim,
  productCinematographyPhilosophy: Claim,
  transitionPhilosophy: Claim,
  attentionStrategy: Claim,
  openingStrategy: Claim,
  heroStrategy: Claim,
  resolutionStrategy: Claim,
});

export const Integrator = z.object({
  dna: Dna,
  choices: z
    .array(
      z.object({
        title: z.string().max(160),
        what: z.string().max(800).describe('What happened: facts only.'),
        how: z.string().max(800),
        startSeconds: Seconds,
        endSeconds: Seconds,
        howMuch: z.array(z.object({ quantity: z.string().max(120), value: z.number().nullable(), unit: z.string().max(40), ref: z.string().max(40) })).max(8).describe('Measured quantities, each citing the id it was measured on.'),
        relativeTo: z.string().max(400),
        why: z.string().max(800).describe('Why it appears to work: interpretation, kept apart from the facts.'),
        evidence: Evidence,
        confidence: Confidence,
      }),
    )
    .max(20),
  curves: z.object({
    narrativeTension: z.array(z.number().min(0).max(1).nullable()).describe('One value per second of film, 0..1.'),
    emotionalIntensity: z.array(z.number().min(0).max(1).nullable()),
    informationDensity: z.array(z.number().min(0).max(1).nullable()),
  }),
  conflicts: z.array(z.object({ description: z.string().max(600), passes: z.array(z.string()).max(6), resolution: z.string().max(400) })).max(20),
});

export const Inspection = z.object({
  answer: z.string().max(1200),
  observations: z.array(z.object({ frame: z.number().int().nonnegative(), observation: z.string().max(300) })).max(48),
  confidence: Confidence,
});

export type PassId = 'p01_holistic' | 'p02_narrative' | 'p03_composition' | 'p04_camera_motion' | 'p05_audio' | 'p06_sync' | 'p07_transitions' | 'p08_moments' | 'p09_reconstruction' | 'p10_grammar';

export type PassDefinition = {
  id: PassId;
  title: string;
  fps: number;
  mediaResolution: 'low' | 'medium';
  schema: z.ZodTypeAny;
  task: string;
};

export const PASSES: PassDefinition[] = [
  {
    id: 'p01_holistic',
    title: 'Holistic understanding',
    fps: 1,
    mediaResolution: 'medium',
    schema: P01Holistic,
    task: 'Watch and listen to the whole film. Say what happens, what it is about and what kind of film it is. Describe; do not evaluate.',
  },
  {
    id: 'p02_narrative',
    title: 'Narrative, shots and beats',
    fps: 1,
    mediaResolution: 'low',
    schema: P02Narrative,
    task: 'Divide the film into beats: the units in which it changes idea, each with its function. Group shots into scenes where the world changes. Beat and scene times must line up with measured boundaries or text milestones wherever those exist; cite them.',
  },
  {
    id: 'p03_composition',
    title: 'Composition, product and typography',
    fps: 1,
    mediaResolution: 'medium',
    schema: P03Composition,
    task: 'For every text block in the list, classify it and give its role; correct the OCR reading only if it is wrong. Give a font category, never a family. Say whether a product interface is shown, label the tracked panels you can identify, and describe the composition of each shot.',
  },
  {
    id: 'p04_camera_motion',
    title: 'Camera, depth and motion',
    fps: 4,
    mediaResolution: 'low',
    schema: P04CameraMotion,
    task: 'Interpret the measured camera moves and say for each whether a camera or a single layer moves. Describe other motion, and depth and parallax per shot. Where a shot is "unobservable" do not invent a camera move. Ask for a window if you need the exact frames.',
  },
  {
    id: 'p05_audio',
    title: 'Narration, music, effects and silence',
    fps: 1,
    mediaResolution: 'low',
    schema: P05Audio,
    task: 'Listen. Transcribe any speech exactly (null if there is none — do not write words over music). Describe the music, its sections and instrumentation, label the listed transients you can identify, and describe ambience, silence and the sound\'s overall approach.',
  },
  {
    id: 'p06_sync',
    title: 'Audiovisual synchronisation',
    fps: 2,
    mediaResolution: 'low',
    schema: P06Sync,
    task: 'For each measured sync cluster, say what is synchronised with what and whether it looks deliberate. Add relationships between sound and picture the clusters miss (a word landing on a reveal, a hit on a cut), citing events.',
  },
  {
    id: 'p07_transitions',
    title: 'Transitions and continuity',
    fps: 4,
    mediaResolution: 'low',
    schema: P07Transitions,
    task: 'For each measured boundary say what it does (the handover kinds) and how. Then list changes of idea that happen without any boundary — a morph, a push into a new world, an object carried across — with their times. Describe continuity.',
  },
  {
    id: 'p08_moments',
    title: 'Memorable moments and intent',
    fps: 1,
    mediaResolution: 'medium',
    schema: P08Moments,
    task: 'Name the moments a viewer would remember and why they work. State the creative intent, and how the film opens, delivers its hero moment and resolves.',
  },
  {
    id: 'p09_reconstruction',
    title: 'Reconstruction logic',
    fps: 1,
    mediaResolution: 'low',
    schema: P09Reconstruction,
    task: 'Describe how an executor would rebuild the observable behaviour of each shot: the layers and the techniques. Do not claim which software was used or how it was actually made.',
  },
  {
    id: 'p10_grammar',
    title: 'Transferable and non-transferable grammar',
    fps: 1,
    mediaResolution: 'low',
    schema: P10Grammar,
    task: 'Extract mechanisms another film could learn from: context, decision, effect and the transferable principle, and for each what must not be copied (composition, wording, timing, geometry, motifs). Separately, list what is this film\'s own signature and cannot transfer.',
  },
];

export const SYSTEM = [
  'You are a forensic film analyst. You watch and listen to the film natively.',
  'You are also given measurements that software made on the exact frames and samples. They are more precise than your perception: never contradict a measurement without saying so and citing what you saw.',
  'Rules:',
  '1. Report only what you can see or hear in this film, or what the measurements show.',
  '2. Every claim cites evidence: ids from the evidence list, or window:START-END in film seconds.',
  '3. Never invent exact font families, software, focal lengths, Bézier curves, spring constants, layer hierarchies, camera coordinates or production methods. Use null and low confidence when you do not know.',
  '4. Times are film time in seconds; they will be checked against the measurements.',
  '5. Keep description and interpretation apart; "why" is interpretation.',
  '6. Describe mechanisms and principles, never instructions for copying this film.',
].join('\n');
