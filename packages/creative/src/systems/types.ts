import type {
  CameraMove,
  CreativeSystemId,
  EasingName,
  MotionRecipeName,
  SoundCueType,
  VisualType,
} from '@act-one/core';

/**
 * A creative system is a language, not a template.
 *
 * A template says "put the headline here, then the product shot, then the
 * logo". Every film made from it has the same shape, and that shape is what
 * people recognise as automated.
 *
 * A system instead supplies *grammar*: which openings are legal, which scene
 * archetypes exist and what each one is for, how type behaves, which
 * transitions belong together, how the cut breathes, and what the sound does
 * underneath. The Creative Director composes a film from that grammar guided
 * by the concept — so two films in the same system share a sensibility and
 * share no structure.
 */
export type TypeScale = {
  /** Display size as a fraction of frame height. Typography is set optically. */
  displayRatio: number;
  bodyRatio: number;
  /** Maximum line length in characters. Beyond this, type stops reading as design. */
  maxLineLength: number;
  maxLines: number;
  tracking: number;
  lineHeight: number;
  case: 'sentence' | 'upper' | 'title';
  align: 'left' | 'center';
};

export type OpeningStyle = {
  id: string;
  name: string;
  /** What the first frame does. Used by the director to pick against the hook. */
  description: string;
  visualType: VisualType;
  motion: MotionRecipeName;
  camera: CameraMove;
  durationRange: [number, number];
  /** Opens on silence, a single impact, or music already running. */
  soundEntry: 'silence' | 'impact' | 'music_in' | 'riser';
  /** Suits hooks that are questions, statements, or demonstrations. */
  suitsHook: ('question' | 'statement' | 'demonstration' | 'metaphor')[];
};

export type SceneArchetype = {
  id: string;
  /** The job this scene does in the film. */
  purpose: string;
  visualType: VisualType;
  motion: MotionRecipeName;
  camera: CameraMove;
  durationRange: [number, number];
  /** How many words of on-screen text this archetype can carry. */
  maxWords: number;
  /** Whether this archetype needs real product capture to be legal. */
  requiresProductAsset: boolean;
  soundCues: SoundCueType[];
};

export type TransitionRule = {
  from: VisualType[];
  to: VisualType[];
  motion: MotionRecipeName;
  durationSeconds: number;
  /** Used to avoid repeating the same transition twice in a row. */
  weight: number;
};

export type EndingStyle = {
  id: string;
  name: string;
  motion: MotionRecipeName;
  durationRange: [number, number];
  /** Whether the logo sits on the CTA card or gets its own beat. */
  logoSeparate: boolean;
  soundCues: SoundCueType[];
};

export type PacingProfile = {
  /** Average scene length. The single biggest determinant of how a film feels. */
  averageSceneSeconds: number;
  /** Shortest and longest a scene may be in this system. */
  sceneRange: [number, number];
  /**
   * Films need dynamics. This is the ratio of long scenes to short ones — a
   * film cut entirely at one rhythm reads as a slideshow no matter how good
   * each frame is.
   */
  longShortRatio: number;
  defaultEasing: EasingName;
  /** Deliberate silence, in seconds, somewhere in the film. */
  silenceBudget: number;
};

export type PalettePolicy = {
  /** Which canvas this system lives on. */
  canvas: 'dark' | 'light' | 'both';
  /** Permitted uses of the brand accent. Restraint is the point. */
  accentUsage: 'sparing' | 'structural' | 'dominant';
  allowGradient: boolean;
  allowGlow: boolean;
};

export type SoundBehaviour = {
  musicCharacter: string;
  /** Does the film open on music or earn it? */
  openOnMusic: boolean;
  /** UI sounds sell product scenes; overdone they read as a tutorial. */
  uiSoundDensity: 'none' | 'sparse' | 'rhythmic';
  impactsOnCuts: boolean;
  endWithSting: boolean;
};

export type CreativeSystem = {
  id: CreativeSystemId;
  name: string;
  /** One line a creative director would actually say about it. */
  essence: string;
  /** When to reach for this system, and when not to. */
  suitsWhen: string[];
  avoidWhen: string[];
  productionReady: boolean;
  palette: PalettePolicy;
  typeScale: { display: TypeScale; statement: TypeScale; caption: TypeScale };
  openings: OpeningStyle[];
  archetypes: SceneArchetype[];
  transitions: TransitionRule[];
  endings: EndingStyle[];
  pacing: PacingProfile;
  sound: SoundBehaviour;
  /** Things this system must never do. Enforced by the storyboard validator. */
  prohibitions: string[];
};
