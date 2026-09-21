/**
 * Characterises every preset voice the vendor offers, once, so the Director
 * can cast from a catalogue instead of from a list of first names.
 *
 * WHY THIS HAS TO BE EMPIRICAL. The vendor publishes 49 preset voices and
 * nothing about any of them — no gender, no age, no register, not even a
 * sentence of description. They appear only inside a validation error. So a
 * casting step that maps a VoiceDirection onto a preset cannot read a
 * catalogue; it has to LISTEN to one first and write it down.
 *
 * Each voice reads the same two sentences, chosen to expose the things casting
 * actually turns on: one declarative line that shows the speaking register, and
 * one shorter line that shows what the voice does with emphasis. A critic then
 * describes each take in the vocabulary `VoiceDirection` already uses, so the
 * result drops straight into the casting decision.
 *
 * The output is data, committed and reused. This is a slow, expensive job and
 * its answer does not change until the vendor's roster does.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run cast:voices
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PRESET_VOICES, RunwayAudioProvider } from '@act-one/providers';
import { httpRequest } from '@act-one/providers';

/* Long enough to hear a register, short enough that 49 of them are affordable. */
const AUDITION_LINE =
  'We read your product, direct three versions of the film, and deliver the one that works. ' +
  'Six weeks becomes one afternoon.';

const OUT = path.resolve('.renders/casting');
const CATALOGUE = path.resolve('packages/creative/src/narration/voice-catalogue.json');

const CONTEXT = { organizationId: 'org_casting', projectId: 'prj_casting' } as never;

async function read(voiceId: string): Promise<string | null> {
  const file = path.join(OUT, `${voiceId}.mp3`);
  if (existsSync(file)) return file;
  const provider = new RunwayAudioProvider({ voiceId });
  try {
    const result = await provider.synthesize(
      { text: AUDITION_LINE, persona: 'narrator_neutral', language: 'en', quality: 'final' },
      CONTEXT,
    );
    writeFileSync(file, result.audio);
    return file;
  } catch (error) {
    console.log(`  ${voiceId}: ${String(error).slice(0, 120)}`);
    return null;
  }
}

/** What a casting director would write on the card, in the terms the direction uses. */
const SCHEMA = `Return ONLY a JSON object, no prose, with exactly these keys:
{"gender":"male|female|ambiguous","ageImpression":"20s|30s|40s|50s|60s+","authority":0-10,
"warmth":0-10,"intimacy":0-10,"energy":0-10,"accent":"<short, e.g. General American, British RP, Australian>",
"texture":"<3-6 words: what the voice sounds like>","soundsLikeTts":0-10,
"bestFor":"<6-12 words: the kind of film this voice belongs in>"}
authority = how much the voice sounds like it knows. warmth = how close/friendly.
intimacy = how close-miked and confiding versus broadcast. energy = drive.
soundsLikeTts = 10 means obviously synthetic, 0 means indistinguishable from a person.`;

async function characterise(voiceId: string, file: string): Promise<Record<string, unknown> | null> {
  const audio = readFileSync(file).toString('base64');
  try {
    const response = await httpRequest<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent',
      {
        method: 'POST',
        body: {
          contents: [{ parts: [{ text: `Characterise this voice-over take.\n\n${SCHEMA}` }, { inlineData: { mimeType: 'audio/mpeg', data: audio } }] }],
          generationConfig: { responseMimeType: 'application/json' },
        },
        timeoutMs: 180_000,
        attempts: 2,
      },
    );
    const text = response?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
    return { voiceId, ...JSON.parse(text) };
  } catch (error) {
    console.log(`  ${voiceId} not characterised: ${String(error).slice(0, 120)}`);
    return null;
  }
}

mkdirSync(OUT, { recursive: true });
console.log(`=== casting call: ${PRESET_VOICES.length} voices ===`);

/* Eight at a time: enough to keep the vendor busy, few enough not to be throttled. */
const cards: Record<string, unknown>[] = [];
for (let i = 0; i < PRESET_VOICES.length; i += 8) {
  const batch = PRESET_VOICES.slice(i, i + 8);
  const files = await Promise.all(batch.map(async (v) => [v, await read(v)] as const));
  const read_ = files.filter((f): f is readonly [string, string] => f[1] !== null);
  const described = await Promise.all(read_.map(([v, f]) => characterise(v, f)));
  for (const card of described) if (card) cards.push(card);
  console.log(`  ${Math.min(i + 8, PRESET_VOICES.length)}/${PRESET_VOICES.length} — ${cards.length} cards`);
}

cards.sort((a, b) => String(a['voiceId']).localeCompare(String(b['voiceId'])));
writeFileSync(CATALOGUE, `${JSON.stringify({ line: AUDITION_LINE, builtAt: new Date().toISOString(), voices: cards }, null, 2)}\n`);
console.log(`wrote ${cards.length} cards -> ${CATALOGUE}`);
