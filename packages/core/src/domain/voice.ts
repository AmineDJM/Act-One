import { z } from 'zod';
import type { Tone } from './project.ts';

/**
 * Speech as a creative medium.
 *
 * Not text → TTS but content → spoken adaptation → direction → performance →
 * QA → mastering. This file holds the direction: what a narrator is asked
 * to do before a word is synthesised, in terms a customer can choose from
 * (a woman's voice, warm, natural pace, a French accent) and a voice model
 * can be told (register, energy, emotion by section, what to avoid). No
 * vendor, model or parameter name appears here; the providers translate.
 */
export const VoiceGender = z.enum(['female', 'male']);
export type VoiceGender = z.infer<typeof VoiceGender>;

/** Where the voice is from, when the customer cares. */
export const VoiceAccent = z.enum(['auto', 'france', 'canada', 'us', 'british', 'international']);
export type VoiceAccent = z.infer<typeof VoiceAccent>;

export const VoiceStyle = z.enum([
  'cinematic',
  'professional',
  'warm',
  'editorial',
  'confident',
  'energetic',
  'minimal',
  'calm',
]);
export type VoiceStyle = z.infer<typeof VoiceStyle>;

export const VoicePace = z.enum(['slow', 'natural', 'fast']);
export type VoicePace = z.infer<typeof VoicePace>;

/** What is being narrated. The direction depends on it more than on anything else. */
export const NarrationContext = z.enum([
  'launch_film',
  'social_cut',
  'explainer',
  'audio_edition',
  'executive_update',
  'community',
]);
export type NarrationContext = z.infer<typeof NarrationContext>;

/** Draft or deliverable: what the customer hears in a preview, and what ships. */
export const SpeechQuality = z.enum(['preview', 'final']);
export type SpeechQuality = z.infer<typeof SpeechQuality>;

export const VOICE_STYLE_LABELS: Record<VoiceStyle, string> = {
  cinematic: 'Cinematic — restrained, weighty, film trailer without the shouting',
  professional: 'Professional — clear, even, businesslike',
  warm: 'Warm — close, human, on your side',
  editorial: 'Editorial — trustworthy, unhurried, like a good audio publication',
  confident: 'Confident — assured, plain, no hedging',
  energetic: 'Energetic — quick and bright, never exaggerated',
  minimal: 'Minimal — understated, few words, lots of air',
  calm: 'Calm — slow, spacious, reassuring',
};

export const VOICE_PACE_LABELS: Record<VoicePace, string> = {
  slow: 'Slow',
  natural: 'Natural',
  fast: 'Fast',
};

export const VOICE_ACCENT_LABELS: Record<VoiceAccent, string> = {
  auto: 'Auto',
  france: 'France',
  canada: 'Canada',
  us: 'US',
  british: 'British',
  international: 'International',
};

export type EmotionCue = { section: 'opening' | 'middle' | 'ending'; emotion: string };

/**
 * A complete direction for one performance. Serialisable, provider-agnostic,
 * and the same object every voice engine consumes, so two vendors can be
 * compared blind on the same brief.
 */
export const VoiceDirection = z.object({
  /** ISO 639-1. */
  language: z.string().min(2).max(12),
  /** BCP 47 with a region, when an accent was chosen or is implied: fr-FR, en-GB. */
  locale: z.string().nullable(),
  gender: VoiceGender,
  /** "premium female, 30-45" — how a casting director would put it. */
  voiceProfile: z.string(),
  /** Premium is the studio voice; warm is closer; neutral is for internal, calm work. */
  profile: z.enum(['premium', 'warm', 'neutral']),
  tone: z.string(),
  energy: z.enum(['low', 'medium-low', 'medium', 'medium-high', 'high']),
  pace: VoicePace,
  style: VoiceStyle,
  context: NarrationContext,
  emotionCurve: z.array(z.object({ section: z.enum(['opening', 'middle', 'ending']), emotion: z.string() })),
  avoid: z.array(z.string()),
  /** How closely to hold the voice: creative for range, robust for long consistency. */
  stability: z.enum(['creative', 'natural', 'robust']),
});
export type VoiceDirection = z.infer<typeof VoiceDirection>;

export type DirectionInput = {
  context: NarrationContext;
  language: string | null;
  accent?: VoiceAccent | null;
  gender?: VoiceGender | null;
  style?: VoiceStyle | null;
  pace?: VoicePace | null;
  /** The brief's tone, when the customer did not choose a voice style. */
  tone?: Tone | null;
  /** The brand's own tone of writing, for the wording of the direction. */
  brandTone?: string | null;
};

type ContextDefaults = {
  style: VoiceStyle;
  energy: VoiceDirection['energy'];
  pace: VoicePace;
  tone: string;
  curve: EmotionCue[];
  stability: VoiceDirection['stability'];
};

const CONTEXT_DEFAULTS: Record<NarrationContext, ContextDefaults> = {
  launch_film: {
    style: 'cinematic',
    energy: 'medium-low',
    pace: 'natural',
    tone: 'confident and restrained',
    curve: [
      { section: 'opening', emotion: 'calm and inviting' },
      { section: 'middle', emotion: 'clear and engaging' },
      { section: 'ending', emotion: 'confident and concise' },
    ],
    stability: 'natural',
  },
  social_cut: {
    style: 'energetic',
    energy: 'medium-high',
    pace: 'natural',
    tone: 'bright and direct, never exaggerated',
    curve: [
      { section: 'opening', emotion: 'quick, a hook, not a shout' },
      { section: 'middle', emotion: 'clear diction, momentum' },
      { section: 'ending', emotion: 'concise, one line, done' },
    ],
    stability: 'natural',
  },
  explainer: {
    style: 'professional',
    energy: 'medium',
    pace: 'natural',
    tone: 'clear and helpful',
    curve: [
      { section: 'opening', emotion: 'curious and welcoming' },
      { section: 'middle', emotion: 'patient and precise' },
      { section: 'ending', emotion: 'assured and brief' },
    ],
    stability: 'natural',
  },
  audio_edition: {
    style: 'editorial',
    energy: 'medium-low',
    pace: 'natural',
    tone: 'editorial, trustworthy, natural',
    curve: [
      { section: 'opening', emotion: 'calm and inviting' },
      { section: 'middle', emotion: 'even, clear, easy to follow over minutes' },
      { section: 'ending', emotion: 'settled and warm' },
    ],
    stability: 'robust',
  },
  executive_update: {
    style: 'calm',
    energy: 'low',
    pace: 'natural',
    tone: 'calm, authoritative, precise',
    curve: [
      { section: 'opening', emotion: 'composed' },
      { section: 'middle', emotion: 'precise and even' },
      { section: 'ending', emotion: 'understated and certain' },
    ],
    stability: 'robust',
  },
  community: {
    style: 'warm',
    energy: 'medium',
    pace: 'natural',
    tone: 'warm and approachable',
    curve: [
      { section: 'opening', emotion: 'friendly and open' },
      { section: 'middle', emotion: 'conversational, close' },
      { section: 'ending', emotion: 'warm and encouraging' },
    ],
    stability: 'natural',
  },
};

const STYLE_TONE: Record<VoiceStyle, { tone: string; energy: VoiceDirection['energy']; profile: VoiceDirection['profile'] }> = {
  cinematic: { tone: 'confident and restrained, with weight on the nouns', energy: 'medium-low', profile: 'premium' },
  professional: { tone: 'clear, even and businesslike', energy: 'medium', profile: 'premium' },
  warm: { tone: 'warm, close and human, as if to one person', energy: 'medium', profile: 'warm' },
  editorial: { tone: 'editorial and trustworthy, unhurried', energy: 'medium-low', profile: 'neutral' },
  confident: { tone: 'assured and plain, no hedging', energy: 'medium', profile: 'premium' },
  energetic: { tone: 'bright and quick, never exaggerated', energy: 'medium-high', profile: 'premium' },
  minimal: { tone: 'understated, spare, letting the words sit', energy: 'low', profile: 'neutral' },
  calm: { tone: 'calm, slow and reassuring', energy: 'low', profile: 'neutral' },
};

/** The brief's tone of writing, as a voice style when none was chosen. */
const TONE_STYLE: Record<Tone, VoiceStyle> = {
  confident: 'confident',
  warm: 'warm',
  playful: 'energetic',
  bold: 'cinematic',
  calm: 'calm',
  technical: 'professional',
};

const AVOID_ALWAYS = [
  'robotic cadence',
  'radio advertising voice',
  'excessive enthusiasm',
  'unnatural pauses',
  'a smile in the voice the words do not call for',
  'a foreign accent',
];

/**
 * The direction for one narration, from what the customer chose and what
 * the content is. Every choice has a default that is defensible on its own,
 * and the context decides those defaults, not the vendor.
 */
export function directVoice(input: DirectionInput): VoiceDirection {
  const base = CONTEXT_DEFAULTS[input.context];
  const style = input.style ?? (input.tone ? TONE_STYLE[input.tone] : base.style);
  const styled = STYLE_TONE[style];
  const language = (input.language ?? 'en').toLowerCase();
  const locale = localeFor(language, input.accent ?? 'auto');
  const gender = input.gender ?? defaultGenderFor(style);
  const pace = input.pace ?? base.pace;
  const profile = styled.profile;
  const energy = input.style ? styled.energy : base.energy;
  const stability: VoiceDirection['stability'] =
    style === 'energetic' ? 'creative' : base.stability === 'robust' ? 'robust' : 'natural';

  return {
    language,
    locale,
    gender,
    profile,
    voiceProfile: `${profile} ${gender}, 30-45${locale ? `, ${localeName(locale)}` : ''}`,
    tone: input.style || input.tone ? styled.tone : base.tone,
    energy,
    pace,
    style,
    context: input.context,
    emotionCurve: base.curve,
    avoid: [...AVOID_ALWAYS, ...(style === 'minimal' || style === 'calm' ? ['emphasis'] : [])],
    stability,
  };
}

/** Who reads when the customer did not say: the style decides. */
export function defaultGenderFor(style: VoiceStyle): VoiceGender {
  return style === 'cinematic' || style === 'confident' ? 'male' : 'female';
}

/** BCP 47 for a language and an accent choice; null when nothing narrows it. */
export function localeFor(language: string, accent: VoiceAccent): string | null {
  const lang = language.toLowerCase();
  if (accent === 'france') return lang === 'fr' ? 'fr-FR' : null;
  if (accent === 'canada') return lang === 'fr' ? 'fr-CA' : lang === 'en' ? 'en-CA' : null;
  if (accent === 'us') return lang === 'en' ? 'en-US' : lang === 'es' ? 'es-US' : null;
  if (accent === 'british') return lang === 'en' ? 'en-GB' : null;
  if (accent === 'international') return null;
  // Auto: the language's home region, which is what "a native voice" means
  // by default and what a library search needs to find one.
  const home: Record<string, string> = {
    fr: 'fr-FR',
    en: 'en-US',
    de: 'de-DE',
    es: 'es-ES',
    it: 'it-IT',
    pt: 'pt-BR',
    nl: 'nl-NL',
    sv: 'sv-SE',
    da: 'da-DK',
    nb: 'nb-NO',
    fi: 'fi-FI',
    pl: 'pl-PL',
    tr: 'tr-TR',
    ja: 'ja-JP',
    ko: 'ko-KR',
    zh: 'zh-CN',
    ar: 'ar-SA',
    hi: 'hi-IN',
  };
  return home[lang] ?? null;
}

export function localeName(locale: string): string {
  const names: Record<string, string> = {
    'fr-FR': 'French from France',
    'fr-CA': 'Canadian French',
    'en-US': 'American English',
    'en-GB': 'British English',
    'en-CA': 'Canadian English',
    'de-DE': 'German',
    'es-ES': 'Castilian Spanish',
    'es-US': 'Latin American Spanish',
    'it-IT': 'Italian',
    'pt-BR': 'Brazilian Portuguese',
  };
  return names[locale] ?? locale;
}

/**
 * A take is the same direction with one thing turned: how much it holds
 * back. Premium output may ask for two or three and keep the best.
 */
export const TakeVariant = z.enum(['as_directed', 'restrained', 'warmer', 'energetic']);
export type TakeVariant = z.infer<typeof TakeVariant>;

export function directionForTake(direction: VoiceDirection, take: TakeVariant): VoiceDirection {
  switch (take) {
    case 'restrained':
      return { ...direction, energy: lower(direction.energy), tone: `${direction.tone}; more held back`, stability: 'robust' };
    case 'warmer':
      return { ...direction, tone: `${direction.tone}; warmer and closer`, profile: 'warm', stability: 'natural' };
    case 'energetic':
      return { ...direction, energy: raise(direction.energy), tone: `${direction.tone}; a touch more energy`, stability: 'creative' };
    default:
      return direction;
  }
}

const ENERGIES: VoiceDirection['energy'][] = ['low', 'medium-low', 'medium', 'medium-high', 'high'];
function lower(energy: VoiceDirection['energy']): VoiceDirection['energy'] {
  return ENERGIES[Math.max(0, ENERGIES.indexOf(energy) - 1)]!;
}
function raise(energy: VoiceDirection['energy']): VoiceDirection['energy'] {
  return ENERGIES[Math.min(ENERGIES.length - 1, ENERGIES.indexOf(energy) + 1)]!;
}

/**
 * A pronunciation the organisation insists on: their own name, a product,
 * a person. Applied before any engine sees the text.
 */
export const PronunciationRule = z.object({
  term: z.string().trim().min(1).max(80),
  say: z.string().trim().min(1).max(160),
  /** Null: every language. */
  language: z.string().nullable().default(null),
});
export type PronunciationRule = z.infer<typeof PronunciationRule>;

/**
 * A reusable voice for an organisation: the same narrator across every film,
 * cut and audio piece, chosen once. A cloned voice carries the consent it
 * was made under; without one it cannot exist.
 */
export const BrandVoice = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string().trim().min(1).max(80),
  provider: z.string(),
  voiceId: z.string(),
  language: z.string().min(2).max(12),
  locale: z.string().nullable().default(null),
  gender: VoiceGender,
  profile: z.enum(['premium', 'warm', 'neutral']).default('premium'),
  style: VoiceStyle.nullable().default(null),
  pace: VoicePace.nullable().default(null),
  /** Where it may be used. Empty means everywhere. */
  useCases: z.array(NarrationContext).default([]),
  /** Set when the voice was cloned; the consent record it was cloned under. */
  consentId: z.string().nullable().default(null),
  /** A short sample in our storage, so the customer can hear it. */
  sampleAssetId: z.string().nullable().default(null),
  isDefault: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BrandVoice = z.infer<typeof BrandVoice>;

export const NARRATION_CONTEXT_LABELS: Record<NarrationContext, string> = {
  launch_film: 'Launch films',
  social_cut: 'Social cuts',
  explainer: 'Explainers',
  audio_edition: 'Audio versions',
  executive_update: 'Executive updates',
  community: 'Community pieces',
};
