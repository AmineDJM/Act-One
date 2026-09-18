import { TONE_LABELS, languageName, type BrandSystem, type ProjectBrief } from '@act-one/core';

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

/**
 * How the brand speaks, in the words every writing prompt gets.
 *
 * Read from the site itself: the names it uses, the line it leads with, the
 * words it reaches for and the ones it never says. A film that names the
 * product the way its own site does, and never reaches for a word the brand
 * avoids, reads as the company's; one that does not reads as ours.
 */
export function brandDirectionLines(brand: Pick<BrandSystem, 'communication' | 'name'>): string[] {
  const words = brand.communication;
  const lines: string[] = [];
  if (words.naming) lines.push(`Naming, as the brand does it: ${words.naming}`);
  if (words.tagline) lines.push(`The brand's own line: "${words.tagline}" — echo it, do not repeat it verbatim unless the beat asks for it.`);
  if (words.positioning) lines.push(`How the brand positions itself: ${words.positioning}`);
  if (words.vocabulary.length > 0) lines.push(`Words the brand uses: ${words.vocabulary.join(', ')}.`);
  if (words.wordsToAvoid.length > 0) lines.push(`Words the brand never uses — never write them: ${words.wordsToAvoid.join(', ')}.`);
  return lines;
}
