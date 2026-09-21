/**
 * ROUND 4 -> ROUND 5, on the real film.
 *
 * Directors watch the actual MP4 independently, then argue about what they
 * saw, then the Executive works out what is CAUSING it and what three changes
 * would remove the causes. The plan is written to disk for the rebuild.
 *
 * Every input here is real: the film is the rendered master, the priors come
 * from the outcome memory of changes actually made to this film, the reference
 * mechanisms come from the corpus, and the journal is what was decided on
 * purpose. Nothing is summarised into prose the room has to take on trust.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run screen
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  CreativeJournal, OutcomeMemory, RevisionRoom, ScreeningRoom, converged, planBrief,
  Reaction, type DirectorId,
} from '@act-one/creative';
import { loadBenchmarkLab, mechanismsBrief, retrieveMechanisms, readModelJson } from '@act-one/qa';
import { OpenAiLlmProvider, httpRequest } from '@act-one/providers';

const FILM = process.env['ACT_ONE_JUDGE'] ?? '.renders/one-timeline.mp4';
const THESIS = (() => {
  try {
    return JSON.parse(readFileSync('.renders/council-round1.json', 'utf8')).thesis.thesis as string;
  } catch {
    return 'A launch film that makes a sceptical founder believe this is real work rather than a generated showreel.';
  }
})();

/**
 * What the engine can do, stated plainly.
 *
 * A revision room that does not know the vocabulary proposes things that cannot
 * be built, and the plan then gets quietly reinterpreted by whoever executes it
 * — which is exactly how creative intent goes missing between rooms.
 */
const CAPABILITIES = `
The film is compiled from BEATS: each beat is a spoken line (or deliberate silence), the word
the picture reacts to, and a reason. Voice is performed first; its real word timings drive the
cut, the typography and the sound cues. Typography is generated from the words actually said.

Visual kinds available per beat: statement (type on a field, optionally a colour field that
arrives on the emphasis word), mark (the wordmark with a rule), product (a real site capture,
windowed and travelled through), clip (generated or captured footage), fields (the frame divides
into colour panels), films (real rendered films shown as panels).

Camera: focal length and a scale push per beat. Motion: type rises and scales in on its phrase.
Sound: music bed with sidechain ducking under the voice, impact cues placed on emphasis words,
UI cues on phrase arrivals. The mix is metered so the voice leads the bed.

Changing a beat's line changes the voice, and therefore the cut and the subtitles, automatically.
Adding a NEW visual kind is real engine work and must be justified as such.
`.trim();

const llm = new OpenAiLlmProvider({});
const context = { organizationId: 'org_council', projectId: 'prj_council' } as never;

/*
 * One video-capable model, asked five different questions.
 *
 * Each director watches the same file with its own brief and sees nobody
 * else's answer, which is what makes the five readings independent. Sharing
 * one reading between five lenses would be cheaper and would be one opinion
 * with four endorsements.
 */
const video = readFileSync(FILM).toString('base64');
const SHAPE = `Return ONLY JSON:
{"readback":"<the film in one line, as you would describe it to a peer>",
 "worksBecause":["<up to 3, specific>"],
 "problems":[{"atSeconds":<number>,"what":"<what is wrong>","evidence":"<what on screen or in the sound makes this true>","severity":"note|medium|high|critical"}],
 "memorable":"<the one moment worth keeping>",
 "benchmarkGap":"<where a reference film is still plainly better, and why>"}`;

async function watch(id: DirectorId, brief: string): Promise<Reaction> {
  const answer = await httpRequest<any>(
    'gemini',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent',
    {
      method: 'POST',
      body: {
        contents: [{ parts: [{ text: `${brief}\n\n${SHAPE}` }, { inlineData: { mimeType: 'video/mp4', data: video } }] }],
        generationConfig: { responseMimeType: 'application/json' },
      },
      timeoutMs: 300_000, attempts: 3,
    },
  );
  const said = answer?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') ?? '{}';
  return Reaction.parse({ ...readModelJson(said), from: id });
}

console.log(`ROUND 4 — Screening Room. Watching ${FILM}\n`);
const screening = await new ScreeningRoom(llm).screen(FILM, THESIS, watch, context);

for (const r of screening.reactions) {
  console.log(`--- ${r.from} ---`);
  if (r.readback) console.log(`  SAW       ${r.readback}`);
  for (const w of r.worksBecause) console.log(`  WORKS     ${w}`);
  for (const p of r.problems) console.log(`  @${String(p.atSeconds).padStart(5)}s [${p.severity}] ${p.what}`);
  if (r.memorable) console.log(`  MEMORABLE ${r.memorable}`);
  if (r.benchmarkGap) console.log(`  GAP       ${r.benchmarkGap}`);
  console.log();
}
if (screening.absent.length) console.log(`did not report: ${screening.absent.join(', ')}\n`);

const clusters = converged(screening.reactions);
console.log('WHAT MORE THAN ONE DIRECTOR SAW');
for (const c of clusters) {
  console.log(`  @${c.atSeconds}s seen by ${c.seenBy.length} (${c.seenBy.join(', ')}) [${c.severity}]`);
  for (const w of c.what) console.log(`     ${w}`);
}

console.log('\nTHE ARGUMENT');
for (const n of screening.notes) {
  console.log(`  ${n.from} [${n.move}] ${n.text}`);
  console.log(`    DELTA: ${n.delta}`);
}

// --- ROUND 5 ---------------------------------------------------------------
const observations = [
  clusters.map((c) => `@${c.atSeconds}s, seen by ${c.seenBy.length} of ${screening.reactions.length} (${c.seenBy.join(', ')}), ${c.severity}: ${c.what.join(' | ')}`).join('\n'),
  '',
  'THE ARGUMENT AFTERWARDS:',
  screening.notes.map((n) => `${n.from} [${n.move}] ${n.text} -> ${n.delta}`).join('\n'),
  '',
  'WHAT THE ROOM SAID IS WORKING (do not break these):',
  screening.reactions.flatMap((r) => r.worksBecause).map((w) => `- ${w}`).join('\n'),
].join('\n');

const problemText = clusters.map((c) => c.what.join(' ')).join(' ');
const memory = new OutcomeMemory();
const lab = loadBenchmarkLab();
const mechanisms = mechanismsBrief(retrieveMechanisms(lab, { question: problemText }, { limit: 6 }));

console.log(`\nROUND 5 — Revision Room. ${lab.films.length} reference film(s), ${memory.all().length} prior outcome(s).`);
const plan = await new RevisionRoom(llm).plan({
  thesis: THESIS,
  observations,
  priors: memory.priorsBrief(problemText),
  mechanisms,
  capabilities: CAPABILITIES,
  journal: new CreativeJournal().brief(),
}, context);

console.log(`\n${planBrief(plan)}`);
console.log(`\ncost $${(screening.costUsd + plan.costUsd).toFixed(3)}`);

writeFileSync('.renders/council-revision.json', JSON.stringify({ thesis: THESIS, screening, clusters, plan }, null, 2));
const journal = new CreativeJournal();
for (const c of clusters.slice(0, 5)) {
  journal.record('criticism', `@${c.atSeconds}s: ${c.what[0]}`, `Seen independently by ${c.seenBy.join(', ')}.`, [FILM]);
}
for (const i of plan.interventions) journal.record('intervention', i.intervention, `${i.rootCause} (expected: ${i.expected})`);
console.log('plan -> .renders/council-revision.json');
