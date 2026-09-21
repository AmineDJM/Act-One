/**
 * Judges the film as a film: look, invention, motion.
 *
 * WHY THIS REPLACES THE BAND. The measured profile — cuts per minute, static
 * share, distinct hues — was built to FIND faults, and it found real ones: nine
 * frozen shots, a palette that never changed, a voice that was not there. It
 * cannot say whether a film is any good. Matching a reference's cutting rate
 * proves nothing; a film can sit inside every band and still be lifeless, and
 * the references themselves disagree wildly with each other (2.5, 7.7 and 16.3
 * cuts per minute), which is the clearest possible evidence that the number was
 * never the thing.
 *
 * So this asks about craft instead, and asks for specifics: what is the single
 * best frame and why, what would a director cut, where does the motion look
 * generated rather than designed. Vague praise is explicitly refused — a
 * critique that says "make it more premium" has told you nothing you can act
 * on, and this project has wasted loops on exactly that.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { httpRequest } from '@act-one/providers';

const run = promisify(execFile);
const file = process.env['ACT_ONE_JUDGE'] ?? '.renders/one-timeline.mp4';

const CRAFT = [
  'visualInvention: is there an idea here somebody had, or is it defaults arranged competently',
  'motionDesign: does the movement have intent and weight, or does it drift and ease because that is what motion does',
  'typography: is the type doing work — scale, contrast, rhythm — or is it just legible',
  'colour: does the palette mean something across the film, or is it one look repeated',
  'soundAndPicture: do they feel authored together or mixed afterwards',
  'wouldAClientApprove: would a good studio send this to a paying customer',
];

const SCHEMA = `Return ONLY JSON:
{"scores":{${CRAFT.map((c) => `"${c.split(':')[0]}":0-10`).join(',')}},
 "bestFrame":{"at":<seconds>,"why":"<15-25 words: what is good about it, specifically>"},
 "worstFrame":{"at":<seconds>,"why":"<15-25 words: what is wrong, specifically>"},
 "cutThis":{"at":<seconds>,"what":"<what a director would remove, and why>"},
 "looksGenerated":"<the single strongest tell that a machine made this, 15-25 words>",
 "oneChange":"<the one change that would most improve the film, concrete enough to execute>"}
BANNED WORDS in every field: premium, polished, professional, elevated, sleek, modern, clean, dynamic, engaging.
Name shots, words, colours and seconds. A note that cannot be executed is worthless.`;

const BRIEF =
  'You are a creative director reviewing a 50-second product launch film before it goes to a client.\n' +
  'You are not scoring it against a template. Judge the CRAFT: the look, the invention, the motion, the type.\n' +
  `Be specific and be hard on it.\n\n${CRAFT.map((c) => `- ${c}`).join('\n')}\n\n${SCHEMA}`;

const video = readFileSync(file).toString('base64');
const gem = await httpRequest<any>(
  'gemini',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent',
  {
    method: 'POST',
    body: { contents: [{ parts: [{ text: BRIEF }, { inlineData: { mimeType: 'video/mp4', data: video } }] }],
      generationConfig: { responseMimeType: 'application/json' } },
    timeoutMs: 300_000, attempts: 3,
  },
);
const g = JSON.parse(gem?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') ?? '{}');

/* A second eye, on stills rather than on the video: a different kind of look. */
const stills: string[] = [];
for (const at of [2, 9, 13, 21, 27, 34, 41, 47]) {
  const png = `/tmp/claude-0/-home-user-Act-One/98b63347-0537-52c4-b822-8136998c416b/scratchpad/q${at}.png`;
  await run('node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg',
    ['-y', '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=760:-1', png], { maxBuffer: 32e6 });
  stills.push(png);
}
const oai = await httpRequest<any>('openai', 'https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  body: {
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: [
      { type: 'text', text: `Eight frames from a 50-second product launch film, in order.\nJudge the CRAFT as a creative director would.\n\n${SCHEMA}` },
      ...stills.map((p) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${readFileSync(p).toString('base64')}` } })),
    ] }],
    response_format: { type: 'json_object' },
  },
  timeoutMs: 300_000, attempts: 3,
});
const o = JSON.parse(oai?.choices?.[0]?.message?.content ?? '{}');

for (const [who, v] of [['GEMINI — watched the film', g], ['OPENAI — read eight frames', o]] as const) {
  console.log(`\n=== ${who} ===`);
  for (const c of CRAFT) {
    const k = c.split(':')[0]!;
    console.log(`  ${k.padEnd(20)} ${v.scores?.[k] ?? '—'}`);
  }
  if (v.bestFrame) console.log(`  BEST  @${v.bestFrame.at}s  ${v.bestFrame.why}`);
  if (v.worstFrame) console.log(`  WORST @${v.worstFrame.at}s  ${v.worstFrame.why}`);
  if (v.cutThis) console.log(`  CUT   @${v.cutThis.at}s  ${v.cutThis.what}`);
  if (v.looksGenerated) console.log(`  TELL  ${v.looksGenerated}`);
  if (v.oneChange) console.log(`  DO    ${v.oneChange}`);
}
writeFileSync('.renders/quality-judgement.json', JSON.stringify({ gemini: g, openai: o }, null, 2));
