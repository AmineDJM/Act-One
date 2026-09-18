import { z } from 'zod';
import {
  LOCALIZATION_STANDARDS,
  Localisation,
  doNotTranslate,
  droppedTerms,
  estimateNarrationSeconds,
  figureDrift,
  languageInEnglish,
  spellsOutNumbers,
  roomForText,
  standardsBrief,
  type BrandSystem,
  type Localisation as LocalisationType,
  type ProductUnderstanding,
  type Storyboard,
} from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';

/**
 * The localiser.
 *
 * A film translated line by line is a film that no longer fits: the French
 * narration runs a fifth longer than the English it came from and arrives
 * after the shot has cut, the German headline breaks to three lines in a
 * composition built for one, and the register slides from a colleague to a
 * bank because nobody decided which one it was.
 *
 * So this agent is not a translator. It is a writer working in the target
 * language, given the same brief the original writer had plus three hard
 * constraints per line: the seconds the shot runs, the room the composition
 * has, and the terms that cross unchanged. It writes what a native writer
 * would write for that shot, in that time — which is often not what the
 * source line says, and is always what the source line means.
 *
 * The one thing it may never do is change a claim. Figures and product names
 * are checked afterwards, digit for digit, because a mistranslated number is a
 * false statement made in the customer's name on their launch day.
 */
const SYSTEM_PROMPT = [
  'You are a senior copywriter working in the target language, on launch films for software',
  'companies. You are not translating. You are writing the film again, for a viewer in your',
  'market, from a brief that happens to be in another language.',
  '',
  'What you know that a translator does not:',
  '',
  `- ${LOCALIZATION_STANDARDS.sameClock.rule} A line has the seconds its shot runs and not one`,
  '  more. Languages trade syllable rate against density, so the same idea takes about the same',
  '  time to say in any of them — but rarely the same number of words. Write to the clock.',
  '- A line that will not fit in the time is rewritten shorter, never spoken faster. A hurried',
  '  read sounds hurried in every language.',
  '- On-screen text has room rather than time, and it is usually less room than the original had.',
  '  A headline that ran one line in English and runs three in German has broken the composition',
  '  it was designed for, and nobody will look at the product because of it.',
  '- Register is a decision, not an accident. Where the language distinguishes formal and',
  '  informal address, pick the one this brand would use and hold it for the whole film.',
  '- Idiom does not survive the crossing. A phrase that only works in the source language is',
  '  replaced by one that works in yours, carrying the same argument.',
  '- Names, addresses and figures are not yours to change. A translated product name is a',
  '  product nobody can search for. A figure keeps its value and takes your locale’s',
  '  separators: 1.5 may become 1,5 and must never become 1,6 or disappear.',
  '',
  'You never add a claim, soften one, or make one that the source did not make. If a line makes',
  'a specific promise, your line makes the same specific promise.',
].join('\n');

const Written = z.object({
  scenes: z
    .array(
      z.object({
        sceneId: z.string(),
        narration: z.string().max(600).default(''),
        onScreenText: z.array(z.string().max(160)).max(6).default([]),
      }),
    )
    .max(60),
  tagline: z.string().max(200).default(''),
  notes: z.string().max(1200).default(''),
});

export type LocaliseInput = {
  storyboard: Storyboard;
  brand: BrandSystem;
  understanding: ProductUnderstanding | null;
  /** ISO 639-1. Null means the film's own language was never recorded. */
  from: string | null;
  to: string;
  /** The end card's line, which is the company's own words about itself. */
  tagline: string;
  companyName: string;
  websiteUrl: string;
};

export type LocaliseResult = {
  localisation: LocalisationType;
  /** Lines that came back wrong, with what was wrong. Reported, never silently kept. */
  problems: { sceneId: string; problem: string }[];
};

/**
 * Writes the film again in another language.
 *
 * Every line comes back with the two budgets it was written against, so the
 * checks below can be exact rather than impressionistic: this line had 3.2
 * seconds and the read is estimated at 3.9, that headline had 38 characters of
 * room and came back at 61. A line that fails is reported rather than
 * substituted, because the source line in the wrong language is worse than a
 * line that needs another pass.
 */
export async function localiseFilm(
  llm: LlmProvider,
  input: LocaliseInput,
  call: CallContext,
): Promise<LocaliseResult> {
  const target = languageInEnglish(input.to);
  const source = languageInEnglish(input.from);
  const terms = doNotTranslate({
    companyName: input.companyName,
    productName: input.understanding?.name ?? null,
    websiteUrl: input.websiteUrl,
  });

  const spoken = input.storyboard.scenes.map((scene) => ({
    sceneId: scene.id,
    purpose: scene.purpose,
    seconds: Math.round(scene.duration * 100) / 100,
    narration: scene.narration,
    onScreenText: scene.onScreenText,
    /** The room each on-screen line has, in characters of the new language. */
    textRoom: scene.onScreenText.map((line) => roomForText(line, input.from, input.to)),
  }));

  const user = [
    `Write this film in ${target}. It is currently in ${source}.`,
    '',
    `The company: ${input.companyName}${input.understanding ? ` — ${input.understanding.oneLiner}` : ''}`,
    `Brand tone: ${input.brand.tone}`,
    terms.length > 0 ? `Cross unchanged, exactly as written: ${terms.join(', ')}` : '',
    input.tagline ? `The end card currently reads: ${input.tagline}` : '',
    '',
    'Each shot below gives you its narration with the seconds it runs, and its on-screen text',
    'with the characters of room each line has. Return one entry per shot, keeping sceneId.',
    'A shot with no narration keeps none. A shot with no on-screen text keeps none.',
    '',
    JSON.stringify(spoken, null, 1),
    '',
    standardsBrief('localization'),
    '',
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n');

  const { value } = await llm.completeJson(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    { schema: Written, schemaName: 'Localisation', tier: 'deep', temperature: 0.4 },
    call,
  );

  const byId = new Map(input.storyboard.scenes.map((scene) => [scene.id, scene]));
  const problems: { sceneId: string; problem: string }[] = [];
  const scenes = [];

  for (const written of value.scenes) {
    const scene = byId.get(written.sceneId);
    if (!scene) continue;

    const narration = written.narration.trim();
    const lines = written.onScreenText.map((line) => line.trim()).filter(Boolean);

    if (scene.narration.trim() && !narration) {
      problems.push({ sceneId: scene.id, problem: 'came back with no narration' });
    }

    // The clock. Estimated the same way the narration engine estimates it, so
    // a line that passes here is a line that will not be shortened later.
    if (narration) {
      const estimate = estimateNarrationSeconds(narration);
      if (estimate > scene.duration * 1.12) {
        problems.push({
          sceneId: scene.id,
          problem: `the read is about ${estimate.toFixed(1)}s in a shot that runs ${scene.duration.toFixed(1)}s`,
        });
      }
      const drift = driftIn(scene.narration, narration);
      if (drift) problems.push({ sceneId: scene.id, problem: drift });
    }

    // The room. Measured against what the original line had, expanded for the
    // language, because that is the budget the writer was given.
    for (const [index, line] of lines.entries()) {
      const original = scene.onScreenText[index];
      if (original === undefined) continue;
      const room = roomForText(original, input.from, input.to);
      if (line.length > room) {
        problems.push({
          sceneId: scene.id,
          problem: `an on-screen line runs ${line.length} characters against ${room} of room`,
        });
      }
      if (driftIn(original, line)) {
        problems.push({ sceneId: scene.id, problem: 'a figure on screen changed' });
      }
    }

    // Names that should have crossed and did not appear anywhere in the shot.
    const whole = [narration, ...lines].join(' ');
    const sourceWhole = [scene.narration, ...scene.onScreenText].join(' ');
    const expected = terms.filter((term) => sourceWhole.toLowerCase().includes(term.toLowerCase()));
    const lost = droppedTerms(whole, expected);
    if (lost.length > 0) {
      problems.push({ sceneId: scene.id, problem: `translated a name that crosses unchanged: ${lost.join(', ')}` });
    }

    scenes.push({ sceneId: scene.id, narration, onScreenText: lines });
  }

  return {
    localisation: Localisation.parse({
      language: input.to,
      scenes,
      tagline: value.tagline.trim(),
      notes: value.notes.trim(),
    }),
    problems,
  };
}

/**
 * A figure that actually changed, as a sentence, or null.
 *
 * A figure that went missing is always reported: a claim the source made and
 * the translation did not is the failure this whole check exists for. A figure
 * that only appeared is softer, because a source that spelled its numbers out
 * has no digits for the comparison to match — "four hundred teams" becoming
 * "400 équipes" is correct, not invented. So an appearance on its own is
 * reported only when the source wrote nothing numeric in words; an appearance
 * beside a disappearance is a change, and is always reported.
 */
function driftIn(original: string, translated: string): string | null {
  const drift = figureDrift(original, translated);
  const lost = drift.missing;
  const gained = lost.length === 0 && spellsOutNumbers(original) ? [] : drift.added;
  if (lost.length === 0 && gained.length === 0) return null;
  return (
    `figures changed: ${lost.length > 0 ? `lost ${lost.join(', ')}` : ''}` +
    `${lost.length > 0 && gained.length > 0 ? '; ' : ''}` +
    `${gained.length > 0 ? `invented ${gained.join(', ')}` : ''}`
  );
}
