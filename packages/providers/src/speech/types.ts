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
};

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
