/**
 * A/B two voice models on the finished mix, several readings each.
 *
 * WHY NOT JUST RUN THE JUDGE TWICE. The craft critic has a measured noise
 * floor of about a point per criterion — a byte-identical picture once moved
 * three of them — and this project has already wasted loops reading a
 * one-point move as a result. A question about the VOICE is decided by the ear
 * that hears the mix, and that critic is cheap enough to ask more than once.
 * Three readings of each candidate, reported as a spread rather than a number,
 * is the difference between a measurement and a coin toss.
 *
 * Nothing here averages the two candidates together. They are two performances
 * and the point is to choose one.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all vite-node scripts/film/ab-voice.ts a.mp4 b.mp4
 */
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { httpRequest } from '@act-one/providers';
import { readModelJson } from '@act-one/qa';

const run = promisify(execFile);
const files = process.argv.slice(2).filter((a) => a.endsWith('.mp4'));
if (files.length < 2) {
  console.error('Give me two rendered films to compare.');
  process.exit(1);
}

const CRITERIA = ['soundsHuman', 'toneMatchesClaim', 'authoredTogether', 'wouldYouKeepListening'] as const;
const READINGS = Number(process.env['ACT_ONE_AB_READINGS'] ?? 3);

const BRIEF = [
  'The finished audio of a product launch film: narration over music and effects.',
  'Judge only what you can HEAR.',
  '',
  '- soundsHuman: does the narration sound like a person, or like a machine reading',
  '- toneMatchesClaim: does the delivery suit a film claiming craft and speed, or does it oversell',
  '- authoredTogether: do music, effects and voice feel composed as one thing',
  '- wouldYouKeepListening: would you still be listening at fifty seconds',
  '',
  'Return ONLY JSON:',
  '{"scores":{"soundsHuman":0-10,"toneMatchesClaim":0-10,"authoredTogether":0-10,"wouldYouKeepListening":0-10},',
  ' "tell":"<the strongest sign this narration was generated, 15-25 words>"}',
  'BANNED: premium, polished, professional, elevated, sleek, modern, clean, dynamic, engaging.',
].join('\n');

async function hear(file: string): Promise<{ scores: Record<string, number>; tell: string } | null> {
  const mp3 = `${file}.ab.mp3`;
  await run('node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg',
    ['-y', '-v', 'error', '-i', file, '-vn', '-b:a', '96k', mp3], { maxBuffer: 32e6 });
  try {
    const answer = await httpRequest<any>('openai', 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: {
        model: 'gpt-audio-1.5', modalities: ['text'],
        messages: [{ role: 'user', content: [
          { type: 'text', text: BRIEF },
          { type: 'input_audio', input_audio: { data: readFileSync(mp3).toString('base64'), format: 'mp3' } },
        ] }],
      },
      timeoutMs: 300_000, attempts: 3,
    });
    return readModelJson(String(answer?.choices?.[0]?.message?.content ?? '')) as never;
  } catch (error) {
    console.error(`  a reading failed: ${(error as Error).message.slice(0, 120)}`);
    return null;
  }
}

for (const file of files) {
  console.log(`\n=== ${file}`);
  const runs: Record<string, number>[] = [];
  const tells: string[] = [];
  for (let i = 0; i < READINGS; i += 1) {
    const heard = await hear(file);
    if (!heard) continue;
    runs.push(heard.scores);
    if (heard.tell) tells.push(heard.tell);
  }
  if (runs.length === 0) { console.log('  no reading survived.'); continue; }
  for (const key of CRITERIA) {
    const values = runs.map((r) => Number(r[key] ?? NaN)).filter(Number.isFinite);
    if (values.length === 0) { console.log(`  ${key.padEnd(22)} —`); continue; }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    /*
     * The spread is printed beside the mean, always. A mean of 8 from 7/8/9
     * and a mean of 8 from 8/8/8 are different facts, and only one of them
     * supports choosing anything.
     */
    console.log(`  ${key.padEnd(22)} ${mean.toFixed(1)}   [${values.join(', ')}]`);
  }
  for (const tell of tells) console.log(`  TELL  ${tell}`);
}
