import { TONE_LABELS, languageName, type ProjectBrief } from '@act-one/core';

/**
 * What the customer asked for, in the words every writing prompt gets.
 *
 * Language and tone are decided once, in the brief, and every engine that
 * writes — concepts, storyboard, launch copy — is told the same thing. Left
 * unset, the film speaks the language of the product's own site and takes
 * its tone from the brand's own writing, and the prompt says so rather than
 * defaulting to English by silence.
 */
export function briefDirectionLines(brief: Pick<ProjectBrief, 'language' | 'tone'>): string[] {
  const language = brief.language
    ? `Language: write every line — on-screen text, narration, copy — in ${languageName(brief.language) ?? brief.language} (${brief.language}).`
    : "Language: write every line in the language of the product's own site, whatever it is.";
  const tone = brief.tone
    ? `Tone the customer asked for: ${TONE_LABELS[brief.tone]}.`
    : "Tone: take it from the brand's own writing.";
  return [language, tone];
}
