/**
 * Sweeps model x voice x energy against the picture, in parallel, with two critics.
 *
 * WHY A SWEEP AND NOT A CHOICE. Three separate readings of this film have said
 * the narration is "synthetic", "rigid" and "disjointed", and each time the
 * obvious single cause turned out to be wrong: first the direction was too
 * energetic for the picture, then — after the picture itself got faster — too
 * flat for it, and underneath both, every line was being read as a cold start
 * because the model in use cannot take continuity at all. Those are three
 * different axes and arguing about them one at a time has cost several loops.
 * So all three move at once and the film decides.
 *
 * Each candidate is a REAL MIX: the same silent render, the same cue design,
 * the same master. The only difference between the files the critics watch is
 * the read. Synthesis within one candidate is sequential because continuity
 * depends on order; candidates run concurrently.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run sweep:voice
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { httpRequest } from '@act-one/providers';

const run = promisify(execFile);

type Candidate = { id: string; voiceId: string; voice: string; model: string; energy: string };

/** Named so a row in the output says what was actually varied. */
const CANDIDATES: Candidate[] = [
  { id: 'mv2-eric-med', voiceId: 'cjVigY5qzO86Huf0OWal', voice: 'Eric', model: 'eleven_multilingual_v2', energy: 'medium' },
  { id: 'mv2-eric-hi', voiceId: 'cjVigY5qzO86Huf0OWal', voice: 'Eric', model: 'eleven_multilingual_v2', energy: 'medium-high' },
  { id: 'mv2-brian-med', voiceId: 'nPczCjzI2devNBz1zQrb', voice: 'Brian', model: 'eleven_multilingual_v2', energy: 'medium' },
  { id: 'mv2-roger-med', voiceId: 'CwhRBWXzGAHq8TQ4Fs17', voice: 'Roger', model: 'eleven_multilingual_v2', energy: 'medium' },
  { id: 'mv2-chris-hi', voiceId: 'iP95p4xoKVk53GoZ742B', voice: 'Chris', model: 'eleven_multilingual_v2', energy: 'medium-high' },
  { id: 'v3-eric-med', voiceId: 'cjVigY5qzO86Huf0OWal', voice: 'Eric', model: 'eleven_v3', energy: 'medium' },
];

const CRITERIA = [
  'semanticAuthority', 'naturalness', 'emotionalFit', 'rhythmAgainstEdit',
  'intelligibilityOverMusic', 'pausesMatchEdit', 'emphasisMatchesTypography',
];

const SCHEMA =
  `Return ONLY JSON: {"scores":{${CRITERIA.map((c) => `"${c}":0-10`).join(',')},"soundsLikeAdvertising":0-10},` +
  `"weakestMoment":{"at":<seconds>,"why":"<12-20 words>"},` +
  `"verdict":"<20-35 words, specific. Never say premium, polished, professional or elevated.">}` +
  ` All 0-10 where 10 is best, EXCEPT soundsLikeAdvertising where 0 is best.`;

const BRIEF =
  'You are casting the narrator for this launch film. WATCH it: judge the READ against the CUT.\n' +
  'Does it sound like a person who knows this, or like a machine reading it? Do its pauses fall where the\n' +
  'cuts need them? Does the stressed word land on the frame its on-screen word lands on? Does it survive\n' +
  `the music at this level?\n\n${SCHEMA}`;

async function mix(c: Candidate): Promise<string> {
  const out = path.resolve(`.renders/audition-${c.id}.mp4`);
  if (existsSync(out)) return out;
  await run('npx', ['vite-node', 'scripts/film/launch.ts'], {
    env: {
      ...process.env,
      ACT_ONE_VOICE: c.voiceId, ACT_ONE_VOICE_MODEL: c.model, ACT_ONE_VOICE_ENERGY: c.energy,
      ACT_ONE_AUDITION: c.id, NODE_USE_ENV_PROXY: '1',
    },
    timeout: 25 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return out;
}

/** Gemini, watching the film. */
async function gemini(file: string): Promise<unknown> {
  const r = await httpRequest<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
    'gemini',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent',
    {
      method: 'POST',
      body: {
        contents: [{ parts: [{ text: BRIEF }, { inlineData: { mimeType: 'video/mp4', data: readFileSync(file).toString('base64') } }] }],
        generationConfig: { responseMimeType: 'application/json' },
      },
      timeoutMs: 300_000, attempts: 3,
    },
  );
  return JSON.parse(r?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? '{}');
}

/**
 * OpenAI, listening rather than watching.
 *
 * It takes the MIXED audio, not the video: the point of a second critic is a
 * different ear, and two models fed the identical file agreeing tells you less
 * than one of them disagreeing on its own evidence.
 */
async function openai(file: string): Promise<unknown> {
  const wav = `${file}.audio.mp3`;
  await run('node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg', ['-y', '-v', 'error', '-i', file, '-vn', '-b:a', '96k', wav], { maxBuffer: 32 * 1024 * 1024 });
  const r = await httpRequest<any>('openai', 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    body: {
      model: 'gpt-4o-audio-preview',
      modalities: ['text'],
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `This is the finished audio of a 61-second product launch film: narration over music and effects.\n${SCHEMA}\nFor pausesMatchEdit and emphasisMatchesTypography, judge from the music and effect hits, which land on the cuts.` },
          { type: 'input_audio', input_audio: { data: readFileSync(wav).toString('base64'), format: 'mp3' } },
        ],
      }],
      response_format: { type: 'json_object' },
    },
    timeoutMs: 300_000, attempts: 3,
  });
  return JSON.parse(r?.choices?.[0]?.message?.content ?? '{}');
}

const only = (process.env['ACT_ONE_SWEEP'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const chosen = only.length ? CANDIDATES.filter((c) => only.includes(c.id)) : CANDIDATES;

console.log(`=== sweeping ${chosen.length} candidates ===`);
for (const c of chosen) console.log(`  ${c.id.padEnd(16)} ${c.voice.padEnd(7)} ${c.model.padEnd(24)} energy=${c.energy}`);

// Mixes run concurrently; each one is a separate process reading its own lines.
const mixed = await Promise.allSettled(chosen.map(async (c) => ({ c, file: await mix(c) })));
const ready = mixed.flatMap((m) => (m.status === 'fulfilled' ? [m.value] : []));
for (const m of mixed) {
  if (m.status === 'rejected') console.log(`  MIX FAILED: ${String(m.reason).slice(0, 300)}`);
}

const judged = await Promise.allSettled(
  ready.map(async ({ c, file }) => {
    const [g, o] = await Promise.allSettled([gemini(file), openai(file)]);
    return {
      id: c.id, voice: c.voice, model: c.model, energy: c.energy,
      gemini: g.status === 'fulfilled' ? g.value : { error: String(g.reason).slice(0, 200) },
      openai: o.status === 'fulfilled' ? o.value : { error: String(o.reason).slice(0, 200) },
    };
  }),
);

const results = judged.flatMap((j) => (j.status === 'fulfilled' ? [j.value] : []));

/** One number per critic, with the advertising score inverted before it counts. */
function overall(r: any): number | null {
  const s = r?.scores;
  if (!s) return null;
  const positives = CRITERIA.map((k) => Number(s[k])).filter((n) => Number.isFinite(n));
  if (!positives.length) return null;
  const ad = Number.isFinite(Number(s.soundsLikeAdvertising)) ? 10 - Number(s.soundsLikeAdvertising) : null;
  const all = ad === null ? positives : [...positives, ad];
  return all.reduce((a, b) => a + b, 0) / all.length;
}

console.log('\n=== scored against the picture ===');
console.log(`${'candidate'.padEnd(16)} ${'gemini'.padEnd(8)} ${'openai'.padEnd(8)} gap`);
for (const r of results as any[]) {
  const g = overall(r.gemini); const o = overall(r.openai);
  const gap = g !== null && o !== null ? Math.abs(g - o).toFixed(2) : '—';
  console.log(`${r.id.padEnd(16)} ${(g?.toFixed(2) ?? 'fail').padEnd(8)} ${(o?.toFixed(2) ?? 'fail').padEnd(8)} ${gap}`);
}

console.log('\n=== what each critic said ===');
for (const r of results as any[]) {
  console.log(`\n${r.id}  (${r.voice}, ${r.model}, ${r.energy})`);
  for (const [who, v] of [['gemini', r.gemini], ['openai', r.openai]] as const) {
    if (v?.error) { console.log(`  ${who}: FAILED ${v.error}`); continue; }
    console.log(`  ${who}: ${v.verdict ?? '(no verdict)'}`);
    if (v.weakestMoment) console.log(`     weakest @${v.weakestMoment.at}s: ${v.weakestMoment.why}`);
  }
}

writeFileSync(path.resolve('.renders/voice-sweep.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log('\nwrote .renders/voice-sweep.json');
