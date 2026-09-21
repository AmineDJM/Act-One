/**
 * ROUND 1 — the Creative Room. What film should we make?
 *
 * WHY THIS IS BEING ASKED AGAIN, rather than another beat being tuned. The
 * convergence loop has been answering one question — "what is wrong with the
 * film we have" — and it has taken that film a long way. It cannot answer the
 * question underneath it. Three readings in a row named the opening as the
 * worst thing in the film; three times it was fixed by choosing a different
 * stock image, twice by me and once by a video model, and the third reading
 * said of the replacement exactly what the first said of the original. That is
 * the shape of a concept problem being treated as an execution problem, and
 * the escalation for it is this room.
 *
 * The room is given what the loop has already established as constraints, so
 * it spends its budget on the open question rather than re-deciding the parts
 * that are working. It is NOT given the current beat sheet: a room shown the
 * existing film will edit it, and the point is to find out whether a different
 * film is available.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run council
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { CreativeJournal, CreativeRoom, type RoomBrief } from '@act-one/creative';
import { OpenAiLlmProvider } from '@act-one/providers';

const PRODUCT_TRUTH = `
Act One turns a company's public website into a finished launch film, without a brief or a
kickoff call. It opens the site the way a customer would, reads what is actually there — the
real copy, the real interface, the measured brand: colours ranked by painted area, type by ink
weight, the corner radius the site actually uses rather than the average of its outliers — and
it keeps the verbatim excerpt behind every fact. Anything it cannot trace to the site is
dropped and reported back rather than repeated, including any figure that appears nowhere on
the site.

It then develops three distinct creative directions rather than one safe one, renders each,
and judges them before the customer sees anything: contrast, loudness, safe areas, reading
speed, colour, timing. It fails its own work first and repairs it. The claim it is making is
not that the work gets cheaper or easier. It is that the six weeks of calendar between deciding
to make a film and seeing one — most of which is waiting, not working — can be removed.
`.trim();

const AUDIENCE = `
Founders and heads of marketing at companies that have a product worth a film and no realistic
route to one: agency quotes in the tens of thousands, six-week timelines, and a brief nobody has
time to write. They have seen a great deal of AI marketing and discount it automatically. They
are sceptical of speed claims specifically, because speed usually means worse. They will watch
this on a laptop, often muted at first, and they decide in the first six seconds whether this is
another generated showreel.
`.trim();

const BENCHMARKS = `
Three reference launch films. What they have in common: a narrated spine where the voice carries
information the picture cannot, and the picture does something deliberate on the stressed word
rather than running alongside it; a cut rate that VARIES — they are not uniformly fast, they buy
their fast passages with slow ones; type that is an image rather than a caption; and a sound
design where music turns with the narrative rather than playing under it. Their cut rates differ
wildly (2.5, 7.7 and 16.3 cuts per minute), so there is no rate to copy. What is worth copying is
that in every one of them, the sound and the picture appear to have been designed by the same
person at the same time.
`.trim();

const CONSTRAINTS = [
  'The film is built voice-first: narration is performed, its word timings measured, and the cut, typography and sound cues laid out FROM those timings. Do not propose a film that requires the picture to be designed first.',
  'Subtitles are generated from the performed audio and match it word for word. Editorial on-screen copy may say something different, but it is never called subtitles.',
  'No invented interface. The product may only appear as real captures of the real site. A convincing invented dashboard is the worst thing this system could ship.',
  'Every claim must be traceable to the site. "Six weeks" is the calendar claim and it is the one the film argues with.',
  'About 50 seconds, 1920x1080, one narrator, English.',
  'The palette is ink #0B0C10, paper #F4F2EC, accent #FF4D1F, amber #FFB03A. The accent is the only saturated colour and it is spent sparingly.',
];

const OPEN_QUESTIONS = `
WHAT THE CURRENT FILM CANNOT SOLVE ON ITS OWN, from readings of the actual renders:

- The opening is the worst thing in the film and has been in three consecutive readings. Two
  different generated shots have been tried — a lamplit desk with cold coffee, and a blank
  cinema screen with the projector running. Both were called generic stock and the last reading
  said to cut the opening entirely and start on type. An opening is not a shot to be swapped; it
  is a decision this room has to make.
- Visual invention scores 3-4 out of 10 in every reading and it is the lowest score. It is not a
  parameter. The film is fourteen beats built from five templates, and it looks like it.
- Typography: "font sizes jump arbitrarily", "lock to a strict grid", "vary scale and weight to
  emphasise rather than changing colour". The film currently signals its emphasis word mostly by
  turning it orange.
- What IS working, and should not be thrown away: the voice-first spine (sound scores 8-9 out of
  10 on every criterion), the three real renders shown at the beat that claims the work is
  rendered and scored, and the one moment every reading names as the best in the film — the
  frame splitting into three colour fields on the word "Three."
`.trim();

const brief: RoomBrief = {
  productTruth: `${PRODUCT_TRUTH}\n\n${OPEN_QUESTIONS}`,
  audience: AUDIENCE,
  objective:
    'A launch film that makes a sceptical founder believe this is real work rather than a generated showreel, and ask for one. The bar is the reference films, on craft — not on any measured rate.',
  durationSeconds: 50,
  brandEssence:
    'Measured, exact and unshowy. It states what it did and shows the evidence. It never oversells, and it would rather report a failure than repeat an unverified claim. Its accent colour is the only loud thing about it.',
  benchmarks: BENCHMARKS,
  constraints: CONSTRAINTS,
};

const room = new CreativeRoom(new OpenAiLlmProvider({}));
const journal = new CreativeJournal();

console.log('ROUND 1 — Creative Room. Seven directors, private ideation first.\n');
const result = await room.creativeRoom(brief, { organizationId: 'org_council', projectId: 'prj_council' } as never);

console.log(`Proposals: ${result.proposals.length}${result.absent.length ? ` (absent: ${result.absent.join(', ')})` : ''}`);
for (const p of result.proposals) console.log(`  ${p.from.padEnd(15)} ${p.thesis}`);

console.log(`\nConfrontation: ${result.notes.length} notes over ${result.cycles} cycle(s)`);
for (const n of result.notes) {
  console.log(`  ${n.from} [${n.move}${n.at.length ? ' -> ' + n.at.join(',') : ''}]`);
  console.log(`    ${n.text}`);
  console.log(`    DELTA: ${n.delta}`);
}

const t = result.thesis;
console.log('\n=== EXECUTIVE CREATIVE DIRECTOR — the call ===');
console.log(`THESIS            ${t.thesis}`);
console.log(`VIEWER EXPERIENCE ${t.viewerExperience}`);
console.log(`ARC               ${t.narrativeArc.join(' -> ')}`);
console.log(`HOOK              ${t.hook}`);
console.log(`HERO              ${t.heroMoment}`);
console.log(`ENDING            ${t.ending}`);
console.log(`VISUAL            ${t.visualPrinciple}`);
console.log(`SOUND             ${t.soundPrinciple}`);
console.log(`PRODUCT           ${t.productPrinciple}`);
console.log(`MEMORABLE         ${t.memorableMoments.join(' | ')}`);
console.log(`DISTINCTIVE       ${t.distinctive.join(' | ')}`);
if (t.rejected.length) {
  console.log('REJECTED');
  for (const r of t.rejected) console.log(`  ${r.from}: ${r.idea}\n    because ${r.why}`);
}
if (t.unresolved.length) {
  console.log('STILL ARGUED');
  for (const u of t.unresolved) console.log(`  ${u}`);
}
console.log(`\ncost $${result.costUsd.toFixed(3)}`);

mkdirSync('.renders', { recursive: true });
writeFileSync('.renders/council-round1.json', JSON.stringify(result, null, 2));

journal.record('thesis', t.thesis, t.viewerExperience, ['.renders/council-round1.json']);
journal.record('av_strategy', t.soundPrinciple, t.visualPrinciple);
for (const r of t.rejected) journal.record('rejected', r.idea, `${r.why} (proposed by ${r.from})`);
for (const u of t.unresolved) journal.record('design_decision', `Left unresolved: ${u}`, 'The Executive chose to keep this argument live rather than settle it.');
console.log('journal -> .renders/creative-journal.json');
