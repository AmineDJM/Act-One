import type { SpeechQuality, TakeVariant, VoiceDirection, VoiceGender } from '@act-one/core';
import type { CallContext, Provider } from '../types.ts';

export type VoicePersona = 'narrator_neutral' | 'narrator_warm' | 'narrator_low' | 'brand_custom';

/**
 * One line to be spoken.
 *
 * The direction is the contract: a complete, provider-agnostic description of
 * the performance, so two engines can be given the same brief and compared.
 * The persona, gender and tone fields are the older, flatter way of saying the
 * same thing and are still honoured when no direction is given.
 */
export type SpeechRequest = {
  text: string;
  persona: VoicePersona;
  /** Provider voice id for a brand/founder voice. Requires a consent record. */
  voiceId?: string;
  /** 0.7 slow and considered, 1.15 urgent. A last resort: copy is rewritten shorter first. */
  rate?: number;
  format?: 'mp3' | 'wav' | 'opus';
  /** ISO 639-1. The voice is chosen for it and told to speak it natively. */
  language?: string | null;
  /** Who narrates, when the customer said. */
  gender?: VoiceGender | null;
  /** The register the customer asked for, in words the voice can be directed with. */
  tone?: string | null;
  /** The full performance direction. Wins over persona, gender and tone. */
  direction?: VoiceDirection | null;
  /** Preview is fast and cheap for animatics; final is the studio voice. */
  quality?: SpeechQuality;
  /** The lines around this one, so a long piece is read as one performance. */
  continuity?: {
    previousText?: string | null;
    nextText?: string | null;
    /** Vendor request ids of the previous segments, newest last, when the engine can condition on them. */
    previousRequestIds?: string[];
  } | null;
  /** Reproducibility across takes: same seed, same read, on engines that honour it. */
  seed?: number | null;
  /** Which take this is, when several are asked for. */
  take?: TakeVariant;
};

/** Who reads when the customer did not say: the register decides. */
export function defaultGender(persona: VoicePersona): VoiceGender {
  return persona === 'narrator_low' ? 'male' : 'female';
}

/**
 * The direction in a sentence a voice model can be instructed with: the
 * structured direction when there is one, the flat fields otherwise.
 */
export function voiceDirection(
  request: Pick<SpeechRequest, 'persona' | 'language' | 'tone' | 'direction'>,
): string {
  if (request.direction) return directionPrompt(request.direction);
  const register =
    request.persona === 'narrator_warm'
      ? 'Warm, close and human, as if speaking to one person.'
      : request.persona === 'narrator_low'
        ? 'Low, measured and unhurried, with weight on the nouns.'
        : 'Clear, assured and even, without theatrical emphasis.';
  const language = request.language
    ? `Speak as a native speaker of the language of the text (${request.language}), with the natural accent of that language and never a foreign one.`
    : 'Speak as a native speaker of the language the text is written in, with its natural accent.';
  const tone = request.tone ? `The customer asked for this tone: ${request.tone}.` : '';
  return [
    'You are the voice-over of a premium product film for a studio.',
    language,
    register,
    tone,
    'Clean diction, natural pauses at punctuation, no smile in the voice unless the words call for it, no filler.',
  ]
    .filter(Boolean)
    .join(' ');
}

const PACE_WORDS = {
  slow: 'Unhurried; let the pauses breathe.',
  natural: 'A natural pace, neither hurried nor slow.',
  fast: 'Brisk and light, without rushing the ends of sentences.',
} as const;

const ENERGY_WORDS = {
  low: 'low energy, almost intimate',
  'medium-low': 'restrained energy',
  medium: 'even energy',
  'medium-high': 'lifted energy',
  high: 'high energy',
} as const;

/** A structured direction, written out for an engine that takes instructions. */
export function directionPrompt(direction: VoiceDirection): string {
  const where = direction.locale ? ` (${direction.locale})` : '';
  const curve = direction.emotionCurve
    .map((cue) => `${cue.section}: ${cue.emotion}`)
    .join('; ');
  return [
    `You are the narrator of a premium ${CONTEXT_WORDS[direction.context]} for a studio.`,
    `Speak as a native speaker of ${direction.language}${where}, with the natural accent of that language and never a foreign one.`,
    `Voice: ${direction.voiceProfile}. Tone: ${direction.tone}, ${ENERGY_WORDS[direction.energy]}.`,
    PACE_WORDS[direction.pace],
    curve ? `Arc: ${curve}.` : '',
    direction.avoid.length > 0 ? `Avoid: ${direction.avoid.join(', ')}.` : '',
    'Clean diction, natural pauses at punctuation, no filler.',
  ]
    .filter(Boolean)
    .join(' ');
}

const CONTEXT_WORDS: Record<VoiceDirection['context'], string> = {
  launch_film: 'product launch film',
  social_cut: 'short social film',
  explainer: 'product explainer',
  audio_edition: 'audio edition of a written piece',
  executive_update: 'executive update',
  community: 'community piece',
};

export type SpeechResult = {
  audio: Uint8Array;
  contentType: string;
  durationSecondsEstimate: number;
  costUsd: number;
  model: string;
  /** The voice that read it, in the vendor's terms; recorded with the asset. */
  voiceId?: string;
  /** Characters billed. */
  characters?: number;
  /** The vendor's id for this generation, when it can be conditioned on later. */
  requestId?: string | null;
};

/**
 * Consent is a hard precondition, not a checkbox.
 *
 * A founder's voice may only be used when we hold a recorded, revocable consent
 * grant naming the person and the project. The provider refuses without it —
 * there is no code path that clones a voice on a model's say-so.
 */
export type VoiceConsent = {
  subjectName: string;
  grantedByUserId: string;
  organizationId: string;
  grantedAt: string;
  revokedAt: string | null;
  scope: 'project' | 'organization';
  projectId: string | null;
};

export function consentCovers(
  consent: VoiceConsent | null | undefined,
  params: { organizationId: string; projectId: string },
): boolean {
  if (!consent) return false;
  if (consent.revokedAt) return false;
  if (consent.organizationId !== params.organizationId) return false;
  if (consent.scope === 'organization') return true;
  return consent.projectId === params.projectId;
}

export interface SpeechProvider extends Provider {
  readonly kind: 'speech';
  synthesize(request: SpeechRequest, context: CallContext): Promise<SpeechResult>;
  /** Cloned/custom voices require consent; personas do not. */
  synthesizeWithVoice(
    request: SpeechRequest & { voiceId: string },
    consent: VoiceConsent,
    context: CallContext,
  ): Promise<SpeechResult>;
}

// ---------------------------------------------------------------------------
// Recognition: what was actually said, for QA
// ---------------------------------------------------------------------------

export type TranscriptWord = { word: string; start: number; end: number };

export type Transcript = {
  text: string;
  /** ISO 639-1 the recogniser heard, or null when it could not tell. */
  language: string | null;
  /** 0..1 when the recogniser says how sure it is. */
  languageConfidence: number | null;
  durationSeconds: number | null;
  words: TranscriptWord[];
  /**
   * Segments, when the recogniser returns them, with its own estimate that a
   * segment holds no speech at all. Recognisers write plausible sentences over
   * music; this is the signal that tells a heard sentence from an invented one.
   */
  segments?: TranscriptSegment[];
  model: string;
};

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  /** 0..1: the recogniser's probability that there is no speech here. */
  noSpeechProbability: number | null;
  averageLogProbability: number | null;
};

export type TranscribeRequest = {
  audio: Uint8Array;
  contentType: string;
  /** The language the audio is supposed to be in. A hint, never an instruction to the QA. */
  language?: string | null;
};

/**
 * Listens back. Used by voice QA to check that the language, the words and
 * the numbers that came out are the ones that went in; a speech engine is
 * never trusted to grade its own work, so the recogniser is chosen separately.
 */
export interface SpeechRecognizer extends Provider {
  readonly kind: 'speech';
  transcribe(request: TranscribeRequest, context: CallContext): Promise<Transcript>;
}

export function isSpeechRecognizer(provider: unknown): provider is SpeechRecognizer {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    typeof (provider as SpeechRecognizer).transcribe === 'function'
  );
}

// ---------------------------------------------------------------------------
// Voice library: casting and cloning
// ---------------------------------------------------------------------------

export type LibraryVoice = {
  id: string;
  name: string;
  /** Set for a voice in the vendor's shared library that is not yet in the account. */
  publicOwnerId: string | null;
  language: string | null;
  locale: string | null;
  accent: string | null;
  gender: VoiceGender | null;
  age: string | null;
  useCase: string | null;
  description: string | null;
  previewUrl: string | null;
  /** Vendor-specific: premade, professional, cloned, generated. */
  category: string | null;
};

export type VoiceSearch = {
  language: string;
  locale?: string | null;
  gender?: VoiceGender | null;
  useCase?: string | null;
  limit?: number;
};

export type VoiceClone = {
  name: string;
  description?: string | null;
  /** Clean recordings of the person, 1 to 3 minutes in total. */
  samples: { data: Uint8Array; contentType: string; filename: string }[];
  language?: string | null;
  labels?: Record<string, string>;
};

/**
 * Optional capability: engines with a library to cast from and, under consent,
 * to clone into. The pipeline checks for it rather than assuming it.
 */
export interface VoiceLibrary {
  /** Voices in the account, and in the shared library when the vendor has one. */
  searchVoices(query: VoiceSearch, context: CallContext): Promise<LibraryVoice[]>;
  /** Copies a shared-library voice into the account, so it can be used. */
  addVoice(voice: Pick<LibraryVoice, 'id' | 'publicOwnerId' | 'name'>, context: CallContext): Promise<{ voiceId: string }>;
  /** Clones a person's voice. Refuses without a consent that covers the organisation. */
  cloneVoice(clone: VoiceClone, consent: VoiceConsent, context: CallContext): Promise<{ voiceId: string }>;
  deleteVoice(voiceId: string, context: CallContext): Promise<void>;
}

export function hasVoiceLibrary(provider: unknown): provider is SpeechProvider & VoiceLibrary {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    typeof (provider as VoiceLibrary).searchVoices === 'function' &&
    typeof (provider as VoiceLibrary).cloneVoice === 'function'
  );
}

/**
 * Composing music for one film, rather than choosing music that exists.
 *
 * The engine takes a plan: a sequence of movements, each with its own length
 * and its own direction. That is the whole reason to do this — a plan is how
 * the score learns where the film turns. A single prompt gets a track; a plan
 * gets a score.
 */
export type MusicMovement = {
  /** What plays here. The section name goes first in square brackets. */
  text: string;
  /** Between 3,000 and 120,000. The engine refuses anything shorter. */
  durationMs: number;
  positiveStyles: string[];
  negativeStyles: string[];
  /** How closely this follows its neighbours. */
  adherence: 'low' | 'medium' | 'high';
};

export type MusicPlan = {
  movements: MusicMovement[];
  /** Always true for a launch film: a sung track is an advertisement for itself. */
  instrumental: boolean;
  /** The same seed and plan compose the same score, so a re-run is not a surprise. */
  seed?: number | null;
};

export type ComposedMusic = {
  audio: Uint8Array;
  contentType: string;
  /** What was asked for; the engine is accurate to within a few hundred ms. */
  durationSeconds: number;
  model: string;
  costUsd: number;
};

export interface MusicComposer extends Provider {
  readonly kind: 'speech';
  compose(plan: MusicPlan, context: CallContext): Promise<ComposedMusic>;
}

/**
 * One sound, written from what the shot does.
 *
 * A library search asks which whoosh; this asks for the sound of this
 * particular thing happening, which is what a sound designer would build.
 */
export type EffectRequest = {
  brief: string;
  /** Null lets the engine choose; otherwise 0.5–22 seconds. */
  seconds: number | null;
  /** 0–1. High follows the brief exactly, low lets the engine be musical. */
  influence: number;
  /** A texture that has to run under a whole scene has to loop cleanly. */
  loop: boolean;
};

export type GeneratedEffect = { audio: Uint8Array; contentType: string; seconds: number; costUsd: number; model: string };

export interface SoundEffectEngine extends Provider {
  readonly kind: 'speech';
  effect(request: EffectRequest, context: CallContext): Promise<GeneratedEffect>;
}

/**
 * Where each word actually falls in a recording.
 *
 * Estimated timings drift within a few seconds and read as sloppy: a caption
 * that lands half a word late, a cut that misses the emphasis it was built
 * for. Alignment reads the audio and says when each word was spoken.
 */
export type AlignedWord = { word: string; start: number; end: number; confidence?: number };
export type Alignment = { words: AlignedWord[]; seconds: number; costUsd: number };

export interface SpeechAligner extends Provider {
  readonly kind: 'speech';
  align(audio: Uint8Array, text: string, context: CallContext): Promise<Alignment>;
}
