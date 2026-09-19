import {
  FILM_CUTS,
  FILM_FORMATS,
  TONE_LABELS,
  languageName,
  type BrandSystem,
  type FilmCut,
  type FilmFormat,
  type ProjectBrief,
} from '@act-one/core';

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

/**
 * Which of the two films this is, in the words every writing prompt gets.
 *
 * Told to the strategist and the director as well as the planner, because a
 * concept written around watching the product work cannot be rescued by a
 * storyboard that is forbidden to show it — it becomes a film narrating a
 * demonstration that never happens, which is worse than either format done
 * plainly.
 */
export function formatDirectionLines(format: FilmFormat): string[] {
  const spec = FILM_FORMATS[format];
  return [
    `The kind of film: ${spec.title}. ${spec.blurb}`,
    `What carries the picture: ${spec.carries}`,
    `What this film never does: ${spec.never}`,
  ];
}

/**
 * How this film is cut, in the words every writing prompt gets.
 *
 * The same reasoning as the format: a concept written as a sixty-second film
 * that builds cannot be rescued by a storyboard cutting it to twenty-two
 * seconds in a vertical frame. It arrives as a long film with its middle
 * missing, which is what a repurposed landscape film looks like and exactly
 * what choosing this was meant to avoid.
 */
export function cutDirectionLines(cut: FilmCut): string[] {
  const spec = FILM_CUTS[cut];
  return [
    `How it is cut: ${spec.title}, ${spec.aspect}, ${spec.seconds[0]}\u2013${spec.seconds[1]} seconds.`,
    spec.direction,
    `The opening has ${spec.hookSeconds} second${spec.hookSeconds === 1 ? '' : 's'} to earn the rest of the film.`,
    ...(cut === 'short'
      ? [
          'This is a different medium from a classic film, not a shorter one. Higher information',
          'density, shorter shots, a stronger hook, an earlier emotional peak and a tighter ending.',
          'And still premium: engineered for attention, never decorated for it. A cut on a',
          'metronome, a zoom on every beat and a caption on every word are what this format looks',
          'like when somebody confuses retention with noise.',
        ]
      : []),
  ];
}
