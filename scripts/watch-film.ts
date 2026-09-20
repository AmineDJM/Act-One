/**
 * Watching a finished film, rather than reading about one.
 *
 * Point it at a master and it opens the file: what is measured out of the
 * bytes, which entries of the negative corpus it falls into, and a contact
 * sheet written to disk so the frames can actually be looked at. Nothing here
 * consults the database, the storyboard or the manifest — the whole reason it
 * exists is that every one of those was satisfied by a film that plays as
 * white text on a dark field in silence.
 *
 *   npm run watch:film -- path/to/master.mp4 [contact-sheet.png]
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildContactSheet, masterFloor, readContainer, readMasterFacts } from '@act-one/qa';
import { posterArgs, runFfmpeg } from '@act-one/sound';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run watch:film -- path/to/master.mp4 [contact-sheet.png]');
  process.exit(1);
}
const sheetPath = process.argv[3] ?? `${file.replace(/\.[^.]+$/, '')}-contact-sheet.png`;

const container = await readContainer(file);
const facts = await readMasterFacts(file, { sample: 16 });
const floor = masterFloor(facts);

console.log(`\n${path.basename(file)}`);
const fps = container.video && container.video.durationSeconds > 0
  ? container.video.sampleCount / container.video.durationSeconds
  : 0;
console.log(`  ${facts.durationSeconds.toFixed(1)}s · ${facts.width}×${facts.height} · ${fps ? fps.toFixed(1) : '?'} fps`);
console.log(`  video: ${container.video ? `${container.video.codec} profile ${container.video.profile} level ${container.video.level}` : 'none'}`);
console.log(`  audio: ${container.audio ? `${container.audio.codec}, audible ${Math.round(facts.audibleShare * 100)}% of the running time` : 'NONE'}`);
console.log(`  picture: ${facts.sampled} moments sampled, ${facts.flatFrames} of them a flat field, ${facts.distinctFrames} distinct images`);
console.log(`\n  FLOOR: ${floor.verdict}`);
for (const reason of floor.reasons) console.log(`    ✗ ${reason}`);
if (floor.reasons.length === 0) console.log('    nothing in the negative corpus matches this film.');

/*
 * One frame per second of film, up to sixteen, as a single sheet. A reviewer
 * shown one frame at a time can only say whether that frame is sound; rhythm,
 * repetition and a palette that drifts exist only across the whole cut.
 */
const work = await mkdtemp(path.join(tmpdir(), 'act-one-watch-'));
try {
  const count = Math.max(4, Math.min(16, Math.round(facts.durationSeconds)));
  const frames: { sceneId: string; timecodeStart: number; data: Uint8Array }[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = facts.durationSeconds * ((index + 0.5) / count);
    const framePath = path.join(work, `frame-${index}.jpg`);
    const extracted = await runFfmpeg(posterArgs(file, at, framePath), { timeoutMs: 60_000 });
    if (!extracted.ok) continue;
    frames.push({ sceneId: `t${index}`, timecodeStart: at, data: new Uint8Array(await readFile(framePath)) });
  }
  if (frames.length === 0) {
    console.error('\n  No frame could be read out of this file.');
    process.exit(1);
  }
  const sheet = await buildContactSheet(frames, { tileWidth: 360, columns: 4 });
  await writeFile(sheetPath, sheet.png);
  console.log(`\n  contact sheet: ${sheetPath} (${frames.length} frames)`);
} finally {
  await rm(work, { recursive: true, force: true });
}
