/**
 * Judges the film as a film: look, invention, motion, sound, tone.
 *
 * WHY THE MEASURED BAND IS NOT THE JUDGE. The profile — cuts per minute, static
 * share, distinct hues — was built to FIND faults and it found real ones: nine
 * frozen shots, a palette that never changed, a voice that was not there. It
 * cannot say whether a film is any good. The references run at 2.5, 7.7 and
 * 16.3 cuts per minute; there is no target rate, and matching one proves
 * nothing.
 *
 * WHY STILLS ARE NOT THE JUDGE EITHER, which is the harder lesson. A second
 * critic was scoring this film from eight frames, and its numbers were being
 * reported beside the one that watched it — including scores for MOTION
 * DESIGN, which a still cannot show, and SOUND AND PICTURE, which it cannot
 * hear. A film is pictures and sound and a narrative and a tone unfolding over
 * time. Asking what a frame looks like is a different question, and a useful
 * one, but it is not this question.
 *
 * So the film is judged by the model that can actually watch it, with its
 * audio, end to end. The second opinion listens to the MIX — a real
 * independent ear on one dimension it can genuinely assess — and is scoped to
 * sound and tone rather than dressed up as a verdict on the whole. Stills stay
 * in the toolkit for what they are good at: confirming a specific defect in a
 * specific frame, which is how the deformed hand and the colliding captions
 * were found.
 *
 * Vague praise is refused: "make it more premium" has told you nothing you can
 * act on, and this project has wasted loops on exactly that.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { httpRequest } from '@act-one/providers';

const run = promisify(execFile);

/**
 * JSON out of a model that was asked for JSON and nearly obliged.
 *
 * The audio critic returned a valid object with one spurious brace in the
 * middle — `..."tell":"..."},"oneChange":"..."}` — and a strict parse threw,
 * which killed the whole run and took the OTHER critic's answer with it. A
 * judgement that is unreadable is a judgement lost; a judgement that is
 * readable after removing a brace nobody meant to type is not.
 *
 * Two repairs, both narrow: a closing brace immediately before a new key, and
 * a trailing comma. Anything else still throws, because silently accepting
 * arbitrary malformed output is how a critic starts agreeing with you.
 */
function readJson(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
  const body = text.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    const repaired = body.replace(/\}\s*,\s*"/g, ',"').replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(repaired);
  }
}
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

/*
 * Each critic is settled separately.
 *
 * They were sequential and unguarded, so a malformed answer from the second
 * one threw before the first one's judgement was ever printed — a full render
 * judged, and nothing to show for it. They are independent opinions and they
 * should fail independently.
 */
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
const g: any = readJson(gem?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') ?? '{}');

/*
 * A second EAR, not a second pair of eyes on stills.
 *
 * This asked a vision model to score eight frames on motion design and on how
 * sound sits with picture. It can see neither. Those scores were noise wearing
 * the shape of a second opinion, and averaging them against a model that had
 * actually watched the film would have been worse than having one critic.
 *
 * It hears the finished mix now — narration, music, effects, the master — and
 * is asked only about what is audible: whether the read sounds like a person,
 * whether the tone matches what the film is claiming, whether the sound feels
 * authored with the picture or laid over it. That is a genuine independent
 * judgement on one dimension, which is worth more than a synthetic one on six.
 */
const SOUND = [
  'soundsHuman: does the narration sound like a person, or like a machine reading',
  'toneMatchesClaim: does the delivery suit a film claiming craft and speed, or does it oversell',
  'authoredTogether: do music, effects and voice feel composed as one thing',
  'wouldYouKeepListening: would you still be listening at fifty seconds',
];
const SOUND_SCHEMA = `Return ONLY JSON:
{"scores":{${SOUND.map((c) => `"${c.split(':')[0]}":0-10`).join(',')}},
 "worstMoment":{"at":<seconds>,"why":"<15-25 words, specific>"},
 "tell":"<the strongest sign this audio was generated, 15-25 words>",
 "oneChange":"<the one change that would most improve the SOUND, concrete>"}
BANNED WORDS: premium, polished, professional, elevated, sleek, modern, clean, dynamic, engaging.`;

const mp3 = `/tmp/claude-0/-home-user-Act-One/98b63347-0537-52c4-b822-8136998c416b/scratchpad/judge-audio.mp3`;
await run('node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg',
  ['-y', '-v', 'error', '-i', file, '-vn', '-b:a', '96k', mp3], { maxBuffer: 32e6 });
const oai = await httpRequest<any>('openai', 'https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  body: {
    model: 'gpt-audio-1.5',
    modalities: ['text'],
    messages: [{ role: 'user', content: [
      { type: 'text', text: `The finished audio of a ${Math.round(50)}-second product launch film: narration over music and effects.\nJudge only what you can HEAR.\n\n${SOUND.map((c) => `- ${c}`).join('\n')}\n\n${SOUND_SCHEMA}` },
      { type: 'input_audio', input_audio: { data: readFileSync(mp3).toString('base64'), format: 'mp3' } },
    ] }],
  },
  timeoutMs: 300_000, attempts: 3,
});
const o: any = readJson(String(oai?.choices?.[0]?.message?.content ?? ''));

console.log('\n=== GEMINI — watched the film, with its sound ===');
for (const c of CRAFT) {
  const k = c.split(':')[0]!;
  console.log(`  ${k.padEnd(20)} ${g.scores?.[k] ?? '—'}`);
}
if (g.bestFrame) console.log(`  BEST  @${g.bestFrame.at}s  ${g.bestFrame.why}`);
if (g.worstFrame) console.log(`  WORST @${g.worstFrame.at}s  ${g.worstFrame.why}`);
if (g.cutThis) console.log(`  CUT   @${g.cutThis.at}s  ${g.cutThis.what}`);
if (g.looksGenerated) console.log(`  TELL  ${g.looksGenerated}`);
if (g.oneChange) console.log(`  DO    ${g.oneChange}`);

console.log('\n=== OPENAI — heard the mix (sound and tone only) ===');
for (const c of SOUND) {
  const k = c.split(':')[0]!;
  console.log(`  ${k.padEnd(22)} ${o.scores?.[k] ?? '—'}`);
}
if (o.worstMoment) console.log(`  WORST @${o.worstMoment.at}s  ${o.worstMoment.why}`);
if (o.tell) console.log(`  TELL  ${o.tell}`);
if (o.oneChange) console.log(`  DO    ${o.oneChange}`);

writeFileSync('.renders/quality-judgement.json', JSON.stringify({ film: g, sound: o }, null, 2));
