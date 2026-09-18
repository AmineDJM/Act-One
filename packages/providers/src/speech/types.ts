import type { CallContext, Provider } from '../types.ts';

export type VoicePersona = 'narrator_neutral' | 'narrator_warm' | 'narrator_low' | 'brand_custom';

export type SpeechRequest = {
  text: string;
  persona: VoicePersona;
  /** Provider voice id for a brand/founder voice. Requires a consent record. */
  voiceId?: string;
  /** 0.7 slow and considered, 1.15 urgent. */
  rate?: number;
  format?: 'mp3' | 'wav' | 'opus';
  /** ISO 639-1. The voice is chosen for it and told to speak it natively. */
  language?: string | null;
  /** Who narrates, when the customer said. */
  gender?: 'female' | 'male' | null;
  /** The register the customer asked for, in words the voice can be directed with. */
  tone?: string | null;
};

/** Who reads when the customer did not say: the register decides. */
export function defaultGender(persona: VoicePersona): 'female' | 'male' {
  return persona === 'narrator_low' ? 'male' : 'female';
}

/** The voice's register, in a sentence a voice model can be directed with. */
export function voiceDirection(
  request: Pick<SpeechRequest, 'persona' | 'language' | 'tone'>,
): string {
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

export type SpeechResult = {
  audio: Uint8Array;
  contentType: string;
  durationSecondsEstimate: number;
  costUsd: number;
  model: string;
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
