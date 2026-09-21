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
// Lives in @act-one/qa so it can be tested: it was wrong twice while it was
// in here, and a parser that loses a critic's judgement cannot be untested.
import { readModelJson as readJson } from '@act-one/qa';

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

/*
 * Each critic is settled separately.
 *
 * They were sequential and unguarded, so a malformed answer from the second
 * one threw before the first one's judgement was ever printed — a full render
 * judged, and nothing to show for it. They are independent opinions and they
 * should fail independently.
 *
 * That was only half done: `readJson` was made forgiving, but the REQUEST was
 * still bare. A 502 from one vendor — a gateway, nothing to do with the film —
 * threw out of the top level and took the other critic with it, and the other
 * critic listens to the audio and had no opinion about the thing that failed.
 * `settle` is what the comment above always claimed: each critic returns its
 * judgement or its reason, and the run prints whatever came back.
 */
async function settle<T>(who: string, work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; why: string }> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { ok: false, why };
  }
}
const video = readFileSync(file).toString('base64');
const watched = await settle('gemini', async () => {
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
  const said = gem?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') ?? '{}';
  writeFileSync('.renders/quality-gemini.txt', said);
  return readJson(said);
});
const g: any = watched.ok ? watched.value : {};

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
const heard = await settle('openai', async () => {
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
  /*
   * Written down BEFORE it is parsed. A parse failure used to report only the
   * position it gave up at, and the text that caused it was gone — so the
   * repair was guessed at twice against evidence nobody had.
   */
  const said = String(oai?.choices?.[0]?.message?.content ?? '');
  writeFileSync('.renders/quality-openai.txt', said);
  return readJson(said);
});
const o: any = heard.ok ? heard.value : {};

console.log('\n=== GEMINI — watched the film, with its sound ===');
if (!watched.ok) console.log(`  DID NOT ANSWER: ${watched.why}`);
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
if (!heard.ok) console.log(`  DID NOT ANSWER: ${heard.why}`);
for (const c of SOUND) {
  const k = c.split(':')[0]!;
  console.log(`  ${k.padEnd(22)} ${o.scores?.[k] ?? '—'}`);
}
if (o.worstMoment) console.log(`  WORST @${o.worstMoment.at}s  ${o.worstMoment.why}`);
if (o.tell) console.log(`  TELL  ${o.tell}`);
if (o.oneChange) console.log(`  DO    ${o.oneChange}`);

/*
 * What failed is written down too. A judgement file with an empty `film` in it
 * reads exactly like a film that scored nothing, and the next loop would have
 * had no way to tell "the critic did not answer" from "the critic was damning".
 */
writeFileSync('.renders/quality-judgement.json', JSON.stringify({
  film: g, sound: o,
  ...(watched.ok ? {} : { filmUnanswered: watched.why }),
  ...(heard.ok ? {} : { soundUnanswered: heard.why }),
}, null, 2));

// A run where neither critic spoke is not a pass.
if (!watched.ok && !heard.ok) process.exitCode = 1;
