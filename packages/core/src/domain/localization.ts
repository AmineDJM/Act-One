import { z } from 'zod';
import { nonEmpty } from '../zod-helpers.ts';
import { FILM_LANGUAGES, type FilmLanguage } from './project.ts';

/**
 * The film in another language.
 *
 * Not a subtitle track and not a dub laid over the finished mix: the script is
 * written again for the new language, read by a native voice, and the film is
 * rendered from the same picture with the same score. That is the difference
 * between a launch in a market and a launch translated into one.
 *
 * Two numbers govern the whole thing and they behave differently, which is why
 * they are kept apart here. Speech is bounded by the clock: languages trade
 * syllable rate against information density, so the same idea takes about the
 * same time to say whatever it is said in. Text is bounded by room: the same
 * idea written down is 10 to 35% longer in most European languages than in
 * English, and shorter strings expand worse than longer ones.
 */

/**
 * How much longer the same sentence runs, written down, against English.
 *
 * Published figures, and deliberately coarse: the honest statement is that
 * German runs about a third longer than English and Chinese about half as
 * long, not that either does so to two decimal places. What the number is for
 * is telling a writer how much tighter to write, and a writer cannot act on
 * two decimal places.
 *
 * The language list itself is FILM_LANGUAGES, which is what a customer picks
 * from. A second list here would be a second list to keep right.
 */
const EXPANSION: Partial<Record<FilmLanguage, number>> = {
  en: 1,
  fr: 1.2,
  de: 1.3,
  es: 1.25,
  it: 1.15,
  pt: 1.25,
  nl: 1.2,
  sv: 1.1,
  da: 1.1,
  nb: 1.1,
  fi: 1.3,
  pl: 1.25,
  tr: 1.1,
  ja: 0.6,
  ko: 0.7,
  zh: 0.55,
  ar: 1.25,
  hi: 1.2,
};

/** Fallback for a language nobody has measured here: a European average. */
const EXPANSION_UNKNOWN = 1.15;

/**
 * What to call a language when briefing a model.
 *
 * FILM_LANGUAGES holds the endonym, which is what a customer should see. A
 * model is instructed in English, and "write this in 日本語" is a worse
 * instruction than "write this in Japanese".
 */
const ENGLISH_NAMES: Partial<Record<FilmLanguage, string>> = {
  en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', sv: 'Swedish', da: 'Danish', nb: 'Norwegian',
  fi: 'Finnish', pl: 'Polish', tr: 'Turkish', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', ar: 'Arabic', hi: 'Hindi',
};

function codeOf(code: string | null | undefined): FilmLanguage | null {
  const wanted = (code ?? '').slice(0, 2).toLowerCase();
  return FILM_LANGUAGES.some((language) => language.code === wanted) ? (wanted as FilmLanguage) : null;
}

/** The English name, for a brief. Falls back to the code so a prompt is never empty. */
export function languageInEnglish(code: string | null | undefined): string {
  const known = codeOf(code);
  return (known && ENGLISH_NAMES[known]) || (code ?? 'the source language');
}

/** Whether a film can be produced in this language at all. */
export function isFilmLanguage(code: string | null | undefined): boolean {
  return codeOf(code) !== null;
}

/**
 * How much longer the same sentence gets, written down.
 *
 * Relative rather than absolute: a French line translated from German is not
 * 20% longer, it is slightly shorter. The figures are against English, so the
 * ratio between two of them is what a pair of languages does.
 */
export function expansionFactor(from: string | null | undefined, to: string | null | undefined): number {
  const source = EXPANSION[codeOf(from) ?? 'en'] ?? EXPANSION_UNKNOWN;
  const target = EXPANSION[codeOf(to) ?? 'en'] ?? EXPANSION_UNKNOWN;
  return target / source;
}

/**
 * How many characters a line may run after translation.
 *
 * Two allowances, and the larger wins. The first is the language's own: German
 * runs about a third longer than English whatever you give it. The second is
 * the one that actually bites, and it is the whole point of the W3C's guidance
 * — short strings expand far worse than long ones, because a headline has no
 * redundancy to lose. "One run" is seven characters and has no shorter French;
 * a factor of 1.2 gives it eight and there is no eight-character French for it.
 *
 * The bands are the published ones, stated as a minimum allowance rather than
 * an expectation: a line is not required to use its room, it is only allowed
 * to. What this budget exists to catch is the headline that came back three
 * times the length and broke the composition it was written for.
 */
export function roomForText(original: string, from: string | null, to: string | null): number {
  const language = expansionFactor(from, to);
  const shortString = SHORT_STRING_ALLOWANCE.find(([upTo]) => original.length <= upTo)?.[1] ?? 1.3;
  return Math.max(12, Math.round(original.length * Math.max(1, language, shortString)));
}

/**
 * The W3C's expansion table, as a minimum allowance by source length.
 *
 * Read as: a string of up to ten characters should be allowed to double.
 */
const SHORT_STRING_ALLOWANCE: readonly (readonly [number, number])[] = [
  [10, 2],
  [20, 1.8],
  [30, 1.6],
  [50, 1.4],
  [70, 1.3],
];

/**
 * What a translated film is made of.
 *
 * Scene by scene, because a line belongs to a shot: it has that shot's
 * seconds, and the picture underneath it does not change.
 */
export const LocalisedScene = z.object({
  sceneId: z.string(),
  /** Read aloud. Written to the seconds the shot has, not to the source's words. */
  narration: z.string().max(600).default(''),
  /** On the frame. Written to the room the composition has. */
  onScreenText: z.array(z.string().max(160)).default([]),
});
export type LocalisedScene = z.infer<typeof LocalisedScene>;

export const Localisation = z.object({
  language: nonEmpty(12),
  scenes: z.array(LocalisedScene).max(60),
  /** The end card's line about the company. Empty when the film has none. */
  tagline: z.string().max(200).default(''),
  /** What the localiser decided and why, for the console and for the record. */
  notes: z.string().max(1200).default(''),
});
export type Localisation = z.infer<typeof Localisation>;

/**
 * Figures, as a check can compare them.
 *
 * A translated line must carry the same numbers as the original, and may write
 * them the way the locale writes them: 1,5 in French is 1.5 in English and is
 * the same number. So the comparison strips the separators and keeps the
 * digits, which catches the failure that matters — a figure that changed, was
 * dropped, or was invented — without failing on correct formatting.
 */
export function figuresIn(text: string): string[] {
  // Thin and non-breaking spaces are grouping separators in French and in
  // several other locales, so they are part of a figure rather than a break
  // between two of them.
  return (text.match(/\d[\d.,\u00a0\u202f ]*\d|\d/g) ?? [])
    .map((figure) => figure.replace(/[.,\u00a0\u202f\s]/g, ''))
    .filter((figure) => figure.length > 0);
}

/** Figures the original had and the translation lost, or invented. */
export function figureDrift(original: string, translated: string): { missing: string[]; added: string[] } {
  const before = figuresIn(original);
  const after = figuresIn(translated);
  const count = (list: string[]) => {
    const tally = new Map<string, number>();
    for (const item of list) tally.set(item, (tally.get(item) ?? 0) + 1);
    return tally;
  };
  const source = count(before);
  const target = count(after);
  const missing: string[] = [];
  const added: string[] = [];
  for (const [figure, times] of source) {
    const short = times - (target.get(figure) ?? 0);
    for (let i = 0; i < short; i += 1) missing.push(figure);
  }
  for (const [figure, times] of target) {
    const extra = times - (source.get(figure) ?? 0);
    for (let i = 0; i < extra; i += 1) added.push(figure);
  }
  return { missing, added };
}

/**
 * Whether a line writes any of its numbers as words.
 *
 * This exists because of one honest false alarm. "Four hundred finance teams"
 * has no digits in it; its French, "400 équipes financières", has one — and a
 * figure comparison reads that as a number invented in translation, when it is
 * a number written the way the target language writes it. Spelling a figure out
 * or not is a writer's choice and both are correct.
 *
 * So it is a detector rather than a parser: it does not work out that "four
 * hundred" is 400, only that the source said something numeric in words. The
 * caller uses that to soften an added figure — never a missing one, because a
 * figure that disappeared is a claim that disappeared whatever the reason.
 *
 * The vocabulary is pooled across the languages a film can be written in. A
 * word that is numeric in one of them and not another costs nothing here: the
 * worst case is that one weak signal is not raised.
 */
const NUMBER_WORDS =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|z[ée]ro|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|vingt|trente|quarante|cinquante|soixante|cent|cents|mille|milliard|eins|zwei|drei|vier|f[üu]nf|sechs|sieben|acht|neun|zehn|zwanzig|drei[ßs]ig|vierzig|hundert|tausend|million(?:en)?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cien|ciento|mil|mill[oó]n(?:es)?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|venti|trenta|quaranta|cento|mille|milione|milioni)\b/i;

export function spellsOutNumbers(text: string): boolean {
  return NUMBER_WORDS.test(text);
}

/**
 * Words that cross unchanged.
 *
 * The company, the product and the address. Built from what the project
 * already knows rather than asked for, because a do-not-translate list the
 * customer has to maintain is a list that is wrong by the second film.
 */
export function doNotTranslate(params: {
  companyName?: string | null;
  productName?: string | null;
  websiteUrl?: string | null;
  extra?: readonly string[];
}): string[] {
  const terms = new Set<string>();
  for (const term of [params.companyName, params.productName, ...(params.extra ?? [])]) {
    const trimmed = (term ?? '').trim();
    if (trimmed.length > 1) terms.add(trimmed);
  }
  const url = (params.websiteUrl ?? '').trim();
  if (url) {
    try {
      terms.add(new URL(url).hostname.replace(/^www\./, ''));
    } catch {
      // A malformed address is not a term; it is a bad field, and the research
      // stage has already said so.
    }
  }
  return [...terms];
}

/** A term that should have crossed unchanged and did not appear at all. */
export function droppedTerms(translated: string, terms: readonly string[]): string[] {
  const haystack = translated.toLowerCase();
  return terms.filter((term) => !haystack.includes(term.toLowerCase()));
}
