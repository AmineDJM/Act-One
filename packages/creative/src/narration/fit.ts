import { z } from 'zod';
import { estimateNarrationSeconds, languageName, type NarrationContext } from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';

/**
 * Fitting a line to the room it has.
 *
 * A line written for 2.4 seconds must not run 3, and the honest fix is
 * shorter copy, not a faster voice: past a small margin a hurried read
 * sounds hurried. So the plan is, in order, leave it alone; rewrite it
 * shorter, keeping every fact; and only then nudge the speed, never past
 * ten percent.
 */
export type TimingPlan = {
  estimateSeconds: number;
  roomSeconds: number;
  fits: boolean;
  /** The length to rewrite to, in words, when the line does not fit. */
  targetWords: number | null;
};

/** Tolerance before a line counts as long: a few percent is a breath, not a problem. */
const TOLERANCE = 0.06;
/** The most the voice is ever hurried. */
export const MAX_SPEED_UP = 1.1;

export function timingFor(text: string, roomSeconds: number | null | undefined): TimingPlan {
  const estimateSeconds = estimateNarrationSeconds(text);
  if (!roomSeconds || roomSeconds <= 0) {
    return { estimateSeconds, roomSeconds: roomSeconds ?? 0, fits: true, targetWords: null };
  }
  if (estimateSeconds <= roomSeconds * (1 + TOLERANCE)) {
    return { estimateSeconds, roomSeconds, fits: true, targetWords: null };
  }
  const words = countWords(text);
  // Five percent under the room, so the read lands inside it with a breath to spare.
  const targetWords = Math.max(2, Math.floor((words * roomSeconds) / estimateSeconds / 1.05));
  return { estimateSeconds, roomSeconds, fits: false, targetWords };
}

/** The speed for a line that still runs long after being shortened: a nudge, capped. */
export function speedUpFor(text: string, roomSeconds: number | null | undefined): number {
  if (!roomSeconds || roomSeconds <= 0) return 1;
  const estimate = estimateNarrationSeconds(text);
  if (estimate <= roomSeconds * (1 + TOLERANCE)) return 1;
  return Math.min(MAX_SPEED_UP, Math.round((estimate / roomSeconds) * 100) / 100);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** The figures in a line, as written: what a rewrite must keep to the character. */
export function numbersOf(text: string): string[] {
  return (text.match(/\d[\d.,]*(?:\s?%)?/g) ?? []).map((n) => n.replace(/[.,]$/, '').replace(/\s/g, ''));
}

const Shortened = z.object({ text: z.string().min(1).max(1200) });

const CONTEXT_WORDS: Record<NarrationContext, string> = {
  launch_film: 'a product launch film',
  social_cut: 'a short social film',
  explainer: 'a product explainer',
  audio_edition: 'an audio edition of a written piece',
  executive_update: 'an executive update',
  community: 'a community piece',
};

/**
 * Rewrites a line shorter for the time it has, keeping what it says.
 *
 * The model is a copy editor here, not a writer: the same claims, the same
 * figures to the character, the same language, fewer words. Anything it
 * returns that drops a figure or runs longer than asked is discarded and
 * the original stands, so a bad rewrite can never put a claim in the film
 * that the fact checker did not see.
 */
export async function shortenForTime(
  llm: LlmProvider,
  params: {
    text: string;
    language: string | null;
    targetWords: number;
    roomSeconds: number;
    context: NarrationContext;
  },
  call: CallContext,
): Promise<{ text: string; changed: boolean }> {
  const original = params.text.trim();
  const words = countWords(original);
  if (params.targetWords >= words) return { text: original, changed: false };
  const language = params.language ? (languageName(params.language) ?? params.language) : null;
  try {
    const { value } = await llm.completeJson(
      [
        {
          role: 'system',
          content:
            `You are the copy editor for the narration of ${CONTEXT_WORDS[params.context]}. ` +
            'Shorten the line so it can be read aloud in the time it has. Rules: keep every claim and every ' +
            'figure exactly as written; add nothing; keep the same language' +
            (language ? ` (${language})` : '') +
            '; keep the voice and the rhythm of the original; prefer cutting qualifiers, repetition and ' +
            'connective phrases; keep it one or two sentences. Answer with JSON: {"text": "..."}.',
        },
        {
          role: 'user',
          content:
            `Room: ${params.roomSeconds.toFixed(1)} seconds, about ${params.targetWords} words at most ` +
            `(the line is ${words} words now).\n\n${original}`,
        },
      ],
      { schema: Shortened, schemaName: 'ShortenedNarration', tier: 'fast', temperature: 0.2 },
      call,
    );
    const rewritten = value.text.replace(/\s+/g, ' ').trim();
    if (!rewritten || rewritten === original) return { text: original, changed: false };
    // Shorter, and every figure still there, or it is not a rewrite we accept.
    if (countWords(rewritten) > Math.max(params.targetWords * 1.15, params.targetWords + 2)) {
      return { text: original, changed: false };
    }
    if (countWords(rewritten) >= words) return { text: original, changed: false };
    const kept = new Set(numbersOf(rewritten));
    if (numbersOf(original).some((figure) => !kept.has(figure))) return { text: original, changed: false };
    return { text: rewritten, changed: true };
  } catch {
    return { text: original, changed: false };
  }
}
