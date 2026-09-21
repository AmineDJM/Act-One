/**
 * Auditions a shortlist of voices AGAINST THE PICTURE, and scores what it sees.
 *
 * WHY NOT AGAINST WAV FILES. A voice judged on its own is judged on timbre, and
 * timbre is the least important thing about a narration. What decides a read is
 * whether its pauses fall where the cut needs them, whether the emphasis lands
 * on the frame the typography lands on, and whether it survives the music bed
 * at the level the master leaves it. None of that exists in an isolated file —
 * it only exists once the read is mixed against the picture it has to carry.
 *
 * So each candidate is run through the real pipeline: the same silent render,
 * the same cue design, the same mix and the same master. The only difference
 * between the files a critic watches is who is reading. Then a model watches
 * them as films and scores them on the eight things casting actually turns on.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run audition
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { httpRequest } from '@act-one/providers';
import { castingTarget, shortlist, type VoiceCard } from '@act-one/creative';

const CATALOGUE = path.resolve('packages/creative/src/narration/voice-catalogue.json');

/**
 * The direction this film is cast to.
 *
 * Written from the film rather than from a preference: a launch film that opens
 * on a room at dusk and argues about six weeks of wasted calendar wants somebody
 * who sounds like they have run the process, not somebody selling it. Premium
 * rather than warm, high energy rather than measured, fast rather than natural —
 * the reference read is 160 words a minute and that is a decision about
 * confidence as much as about pace.
 */
const DIRECTION = {
  language: 'en',
  locale: 'en-US',
  gender: 'male' as const,
  voiceProfile: 'assured male, 30-45, founder rather than announcer',
  profile: 'premium' as const,
  tone: 'Direct, certain, unhurried in delivery but fast in pace.',
  energy: 'high' as const,
  pace: 'fast' as const,
  style: 'professional' as const,
  context: 'launch_film' as const,
  emotionCurve: [
    { section: 'opening' as const, emotion: 'recognition' },
    { section: 'middle' as const, emotion: 'certainty' },
    { section: 'ending' as const, emotion: 'invitation' },
  ],
  avoid: ['announcer polish', 'upward inflection', 'smiling delivery'],
  stability: 'natural' as const,
};

const CRITERIA = [
  'semanticAuthority: does the voice sound like it knows this, rather than reading it',
  'naturalness: does it sound like a person',
  'emotionalFit: does the register match what the picture is doing',
  'rhythmAgainstEdit: does the read breathe with the cuts or fight them',
  'intelligibilityOverMusic: is every word clear at this mix level',
  'soundsLikeAdvertising: 10 means it sounds like a TTS advert read, 0 means it does not',
  'pausesMatchEdit: do the pauses land on the cuts that need them',
  'emphasisMatchesTypography: does the stressed word land on the frame its on-screen word lands on',
];

const SCHEMA = `Return ONLY JSON:
{"scores":{${CRITERIA.map((c) => `"${c.split(':')[0]}":0-10`).join(',')}},
"strongestMoment":{"at":<seconds>,"why":"<10-20 words>"},
"weakestMoment":{"at":<seconds>,"why":"<10-20 words>"},
"verdict":"<20-35 words, specific. Never say premium, polished, professional or elevated.>"}
All scores 0-10 where 10 is best, EXCEPT soundsLikeAdvertising where 0 is best.`;

function render(voiceId: string): string {
  const out = path.resolve(`.renders/audition-${voiceId}.mp4`);
  if (existsSync(out)) return out;
  console.log(`  mixing ${voiceId}...`);
  execFileSync('npx', ['vite-node', 'scripts/film/launch.ts'], {
    env: { ...process.env, ACT_ONE_VOICE: voiceId, ACT_ONE_AUDITION: voiceId, NODE_USE_ENV_PROXY: '1' },
    stdio: 'pipe',
    timeout: 20 * 60_000,
  });
  return out;
}

async function watch(voiceId: string, file: string): Promise<unknown> {
  const video = readFileSync(file).toString('base64');
  const response = await httpRequest<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
    'gemini',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent',
    {
      method: 'POST',
      body: {
        contents: [{ parts: [
          { text:
            'You are casting the narrator for this launch film. WATCH it — the picture matters as much as the voice.\n' +
            `Judge the READ against the CUT on these:\n${CRITERIA.map((c) => `- ${c}`).join('\n')}\n\n${SCHEMA}` },
          { inlineData: { mimeType: 'video/mp4', data: video } },
        ] }],
        generationConfig: { responseMimeType: 'application/json' },
      },
      timeoutMs: 300_000,
      attempts: 2,
    },
  );
  const text = response?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
  return { voiceId, ...JSON.parse(text) };
}

if (!existsSync(CATALOGUE)) throw new Error(`No casting catalogue yet. Run: npm run cast:voices`);
const cards: VoiceCard[] = JSON.parse(readFileSync(CATALOGUE, 'utf8')).voices;
const target = castingTarget(DIRECTION as never);
/*
 * An explicit cast list overrides the shortlist.
 *
 * Two reasons. The vendor has a daily task limit and a four-voice audition is
 * 56 reads, so when the quota is gone the pipeline still has to be runnable
 * against a voice whose takes are already cached. And a director who has
 * already heard the candidates should be able to name them.
 */
const named = (process.env['ACT_ONE_AUDITION_VOICES'] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
const picked = named.length
  ? named.map((id) => cards.find((c) => c.voiceId === id) ?? ({ voiceId: id, texture: 'not in the catalogue' } as VoiceCard))
  : shortlist(cards, target, Number(process.env['ACT_ONE_SHORTLIST'] ?? 4));

console.log(`=== shortlist for "${DIRECTION.voiceProfile}" ===`);
for (const card of picked) {
  console.log(`  ${card.voiceId.padEnd(10)} auth ${card.authority} warm ${card.warmth} close ${card.intimacy} energy ${card.energy} tts ${card.soundsLikeTts}  ${card.texture}`);
}

const results: unknown[] = [];
for (const card of picked) {
  try {
    results.push(await watch(card.voiceId, render(card.voiceId)));
  } catch (error) {
    console.log(`  ${card.voiceId} not judged: ${String(error).slice(0, 160)}`);
  }
}

console.log('\n=== scored against the picture ===');
for (const r of results as { voiceId: string; scores: Record<string, number>; verdict: string }[]) {
  const positives = Object.entries(r.scores).filter(([k]) => k !== 'soundsLikeAdvertising');
  const mean = positives.reduce((sum, [, v]) => sum + v, 0) / positives.length;
  // The advertising score is inverted before it joins the others: it is the one
  // criterion where a high number is a fault.
  const overall = (mean * positives.length + (10 - r.scores['soundsLikeAdvertising']!)) / (positives.length + 1);
  console.log(`\n${r.voiceId}  overall ${overall.toFixed(2)}`);
  for (const [k, v] of Object.entries(r.scores)) console.log(`   ${k.padEnd(28)} ${v}`);
  console.log(`   verdict: ${r.verdict}`);
}
writeFileSync(path.resolve('.renders/audition.json'), `${JSON.stringify({ direction: DIRECTION, shortlist: picked, results }, null, 2)}\n`);
console.log('\nwrote .renders/audition.json');
