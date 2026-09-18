import { z } from 'zod';
import { languageName, type ProductUnderstanding, type Storyboard } from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';
import { numbersOf } from './fit.ts';

/**
 * The audio edition's script: the film's argument, written again for the ear.
 *
 * A film's narration is written against pictures; read alone it has holes
 * where the screen used to be. The audio edition says what the screen said,
 * in the same language, with the same claims and no others — and it is
 * written to be listened to: short sentences, one idea at a time, the
 * product named early and the address said once at the end.
 *
 * The model writes it; the figures are checked deterministically. A figure
 * the film never made is a claim we cannot stand behind, so a draft that
 * adds one is refused and the narration itself is read instead.
 */
export type AudioEditionScript = {
  title: string;
  paragraphs: string[];
  /** True when the model's draft was refused and the film's own narration stood in. */
  fallback: boolean;
};

const Draft = z.object({
  title: z.string().min(1).max(120),
  paragraphs: z.array(z.string().min(1).max(900)).min(2).max(10),
});

export async function writeAudioEdition(
  llm: LlmProvider,
  params: {
    storyboard: Storyboard;
    understanding: ProductUnderstanding | null;
    language: string | null;
    websiteHost: string;
    /** Roughly how long it should run, in seconds. */
    targetSeconds?: number;
  },
  call: CallContext,
): Promise<AudioEditionScript> {
  const spoken = params.storyboard.scenes
    .map((scene) => scene.narration.trim())
    .filter(Boolean);
  const shown = params.storyboard.scenes.flatMap((scene) => scene.onScreenText.map((line) => line.trim()).filter(Boolean));
  const facts = [
    ...(params.understanding?.keyBenefits ?? []).map((claim) => claim.text),
    ...(params.understanding?.proofPoints ?? []).map((claim) => claim.text),
    ...(params.understanding?.differentiators ?? []).map((claim) => claim.text),
  ];
  const fallback: AudioEditionScript = {
    title: params.understanding?.name ?? params.websiteHost,
    paragraphs: spoken.length > 0 ? spoken : shown,
    fallback: true,
  };
  if (spoken.length === 0 && shown.length === 0) return { ...fallback, paragraphs: [] };

  const language = params.language ? (languageName(params.language) ?? params.language) : null;
  const targetWords = Math.round(((params.targetSeconds ?? 75) * 2.3) / 10) * 10;
  try {
    const { value } = await llm.completeJson(
      [
        {
          role: 'system',
          content:
            'You write audio editions: a short piece to be listened to, not watched. Rules: use only the ' +
            'claims and figures in the material given, word for word where they are figures; add no new claim, ' +
            'number, name or promise; keep the language of the material' +
            (language ? ` (${language})` : '') +
            '; short sentences, one idea at a time; name the product in the first sentence; say the web address ' +
            'once, plainly, at the end; no headings, no lists, no stage directions, no emojis. ' +
            `About ${targetWords} words, in 3 to 6 paragraphs. Answer with JSON: {"title": "...", "paragraphs": ["...", "..."]}.`,
        },
        {
          role: 'user',
          content:
            `Product: ${params.understanding?.name ?? params.websiteHost}\n` +
            (params.understanding?.oneLiner ? `In one line: ${params.understanding.oneLiner}\n` : '') +
            `Address: ${params.websiteHost}\n\n` +
            `The film says:\n${spoken.map((line) => `- ${line}`).join('\n')}\n\n` +
            (shown.length > 0 ? `On screen:\n${shown.map((line) => `- ${line}`).join('\n')}\n\n` : '') +
            (facts.length > 0 ? `Verified facts:\n${facts.map((line) => `- ${line}`).join('\n')}\n` : ''),
        },
      ],
      { schema: Draft, schemaName: 'AudioEditionScript', tier: 'balanced', temperature: 0.4 },
      call,
    );
    const allowed = new Set(numbersOf([...spoken, ...shown, ...facts, params.websiteHost].join('\n')));
    const paragraphs = value.paragraphs.map((paragraph) => paragraph.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const invented = numbersOf(paragraphs.join('\n')).filter((figure) => !allowed.has(figure));
    if (invented.length > 0 || paragraphs.length < 2) return fallback;
    return { title: value.title.trim(), paragraphs, fallback: false };
  } catch {
    return fallback;
  }
}
