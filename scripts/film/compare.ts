/**
 * Our film beside a reference, and the one brutal question.
 *
 * WHY THIS IS NOT ANOTHER CRITIC. The craft judge scores our film against its
 * own idea of good, and the Screening Room asks five directors what they saw.
 * Neither can answer the question the work is actually measured by: put this
 * next to a film somebody excellent made, and where can a viewer still tell
 * instantly which one came from the weaker studio?
 *
 * A model that watches BOTH in one pass can answer it, and cannot answer it
 * from stills or from descriptions — the difference between a good film and a
 * very good one lives in movement, timing and sound. Both films go to the
 * Files API and both are watched.
 *
 * It is asked for GAPS, not for scores. A number here would invite the same
 * mistake this project has made repeatedly: reading a one-point move on a
 * noisy instrument as progress. What is wanted is the next problem, named
 * precisely enough to act on.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run compare -- ours.mp4 reference.mp4
 */
import { writeFileSync } from 'node:fs';
import { GeminiVideoAnalyst, httpRequest } from '@act-one/providers';
import { readModelJson } from '@act-one/qa';

const [ours, reference] = process.argv.slice(2).filter((a) => a.endsWith('.mp4'));
if (!ours || !reference) {
  console.error('Give me our film and a reference film.');
  process.exit(1);
}

const analyst = new GeminiVideoAnalyst({});
if (!analyst.isConfigured()) {
  console.error('No video analyst is configured, so nothing can watch these.');
  process.exit(1);
}
const context = { organizationId: 'org_platform' } as never;

console.log(`A: ${ours}\nB: ${reference}\n`);
/*
 * One retry on a processing failure, because the service loses a film
 * occasionally and the film is not at fault. A master that probes as valid
 * h264/aac locally came back as "could not decode" from an upload that had
 * accepted the same encoder's output minutes earlier; retrying it worked. The
 * error is marked non-retryable inside the provider, which is right for a real
 * decode failure and wrong for this, so the retry lives here where the
 * distinction can be made.
 */
async function put(file: string): Promise<{ uri: string; mimeType: string }> {
  try {
    return await analyst.putFilm(file, context);
  } catch (error) {
    console.log(`  ${file}: ${(error as Error).message.slice(0, 90)} — retrying once.`);
    return analyst.putFilm(file, context);
  }
}

const [a, b] = await Promise.all([put(ours), put(reference)]);

const QUESTION = [
  'You are shown two launch films. FILM A was made by an automated system. FILM B is a',
  'reference made by a strong creative studio.',
  '',
  'Watch both, with sound.',
  '',
  'Answer one question as precisely as you can: where can a viewer STILL TELL INSTANTLY that',
  'B was directed by the stronger studio?',
  '',
  'Do not compare their ideas or subject matter — they are different films about different',
  'things, and A is not trying to be B. Compare the level of DIRECTION: craft, intent,',
  'composition, product cinematography, typography, motion, editing, continuity, narration,',
  'sound, audiovisual synchronisation, memorable moments, finish.',
  '',
  'Name the places where A is genuinely comparable, too. A list that only finds faults is not',
  'a measurement, and this film has already lost things that were working.',
  '',
  'Return ONLY JSON:',
  '{"gaps":[{"dimension":"<one of the dimensions above>",',
  '          "atSecondsInA":<number>,"atSecondsInB":<number>,',
  '          "whatBDoes":"<what B does there, specifically>",',
  '          "whatADoes":"<what A does instead>",',
  '          "whyItReads":"<why a viewer notices, in one sentence>",',
  '          "severity":"obvious|noticeable|subtle"}],',
  ' "comparable":["<where A genuinely holds its own, with a second in A>"],',
  ' "theOneThing":"<if A fixed a single thing to close the distance, what>"}',
  '',
  'BANNED: premium, polished, professional, elevated, sleek, modern, clean, dynamic, engaging.',
].join('\n');

const answer = await httpRequest<any>(
  'gemini',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent',
  {
    method: 'POST',
    body: {
      contents: [{ parts: [
        { text: QUESTION },
        { text: 'FILM A — ours:' },
        { fileData: { fileUri: a.uri, mimeType: a.mimeType } },
        { text: 'FILM B — the reference:' },
        { fileData: { fileUri: b.uri, mimeType: b.mimeType } },
      ] }],
      generationConfig: { responseMimeType: 'application/json' },
    },
    timeoutMs: 600_000, attempts: 2,
  },
);

const said = answer?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') ?? '{}';
writeFileSync('.renders/compare-raw.txt', said);
const out: any = readModelJson(said);

const order = { obvious: 0, noticeable: 1, subtle: 2 } as const;
const gaps = (out.gaps ?? []).sort(
  (x: any, y: any) => (order[x.severity as keyof typeof order] ?? 3) - (order[y.severity as keyof typeof order] ?? 3),
);

console.log('=== WHERE THE REFERENCE IS STILL OBVIOUSLY BETTER ===');
for (const gap of gaps) {
  console.log(`\n[${gap.severity}] ${gap.dimension}   A@${gap.atSecondsInA}s  B@${gap.atSecondsInB}s`);
  console.log(`  B does:  ${gap.whatBDoes}`);
  console.log(`  A does:  ${gap.whatADoes}`);
  console.log(`  reads:   ${gap.whyItReads}`);
}
console.log('\n=== WHERE OURS HOLDS ITS OWN ===');
for (const line of out.comparable ?? []) console.log(`  ${line}`);
console.log(`\n=== THE ONE THING ===\n  ${out.theOneThing ?? '—'}`);

writeFileSync('.renders/compare.json', JSON.stringify({ ours, reference, ...out }, null, 2));
