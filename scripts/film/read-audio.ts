/**
 * What the reference films actually do with sound.
 *
 * The picture has been measured to death; the audio has only been measured as
 * energy. These films are NARRATED, and a voice changes everything about how
 * a film is cut — it carries the detail so the screen can carry a label, it
 * sets the pace, and it is why their shots can hold. Reading their sound
 * properly is the difference between adding narration and adding a voice
 * reading our captions aloud.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GeminiVideoAnalyst } from '@act-one/providers';

const CONTEXT = { organizationId: 'org_quality_sprint' };
const FOCUS = [
  'Read this film for its SOUND, as a sound designer who must reproduce it.',
  'Is there narration? Describe the voice: gender, age, pace in words per minute, tone, accent,',
  'how close it is miked, whether it is processed, and how much of the runtime it covers.',
  'Quote the first and last lines of narration verbatim.',
  'Describe the music: genre, tempo, instrumentation, whether it has a beat, where it enters,',
  'where it changes, where it drops out, and how loud it sits relative to the voice.',
  'List the sound effects and what each one is attached to on screen.',
  'Say where there is silence and what it is doing.',
  'Say how the voice, music and effects are balanced against each other.',
  'Name the three things about this sound design that would be hardest to reproduce.',
].join(' ');

const slug = process.env['ACT_ONE_TARGET'] ?? 'target1';
const analyst = new GeminiVideoAnalyst({});
const analysis = await analyst.analyse(
  { source: path.resolve(`.renders/ref/${slug}.mp4`), depth: 'deep', fps: 2, focus: FOCUS },
  CONTEXT,
);

console.log(`\n=== ${slug} sound ===`);
console.log(`  model=${analysis.model}`);
for (const v of analysis.voice.slice(0, 10)) console.log(`  VOICE ${JSON.stringify(v).slice(0, 260)}`);
for (const m of analysis.music.slice(0, 8)) console.log(`  MUSIC ${JSON.stringify(m).slice(0, 260)}`);
for (const s of analysis.sfx.slice(0, 12)) console.log(`  SFX   ${JSON.stringify(s).slice(0, 200)}`);
for (const a of analysis.audio.slice(0, 10)) console.log(`  AUDIO ${JSON.stringify(a).slice(0, 200)}`);
for (const s of analysis.sync.slice(0, 6)) console.log(`  SYNC  ${JSON.stringify(s).slice(0, 200)}`);
for (const l of analysis.limitations) console.log(`  note: ${l}`);

await writeFile(path.resolve(`.renders/ref/${slug}.sound.json`), JSON.stringify(analysis, null, 2));
