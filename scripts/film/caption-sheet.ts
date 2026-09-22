/**
 * A contact sheet of every caption the film shows, at the second it shows it.
 *
 * The subtitle track has broken three times and every time it was found by a
 * person watching the film, never by the build. The build now refuses a beat
 * whose captions do not match its performance — but "matches the performance"
 * is a claim about data, and the failures that survived longest were about
 * PIXELS: near-black type on a near-black frame, a caption behind the page,
 * five frames of text nobody can read. None of those is a timing fault and
 * none of them is visible in a JSON.
 *
 * So this takes the film that was actually rendered, samples it in the middle
 * of every caption's own window, and lays the frames out in order. One look
 * answers the only question that matters: is what the voice is saying on the
 * screen, and can you read it.
 *
 *   npm run captions -- .renders/one-timeline.mp4
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { layout, subtitlesFor, type SpokenWord } from '@act-one/creative';
import { BEATS } from './beats.ts';
import { analyseVoice } from '@act-one/sound';

const film = path.resolve(process.argv[2] ?? '.renders/one-timeline.mp4');
if (!existsSync(film)) throw new Error(`No film at ${film}.`);

const VO = path.resolve('.renders/vo-beats');
const out = path.resolve('.renders/captions');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/*
 * The readings are read off disk rather than re-synthesised: this tool looks
 * at a film that already exists, so paying a provider to rebuild the timings
 * it was cut from would be both slow and a chance to disagree with it.
 */
const readings = new Map<string, { durationSeconds: number; words: SpokenWord[] }>();
const { readdirSync, readFileSync } = await import('node:fs');
const cached = readdirSync(VO).filter((f) => f.endsWith('.mp3.json'));
for (const beat of BEATS) {
  if (!beat.line) continue;
  const file = cached.find((f) => f.startsWith(`${beat.id}-`));
  if (!file) throw new Error(`No cached reading for ${beat.id}; render the film first.`);
  const mp3 = path.join(VO, file.replace(/\.json$/, ''));
  const words: SpokenWord[] = JSON.parse(readFileSync(path.join(VO, file), 'utf8'));
  const heard = await analyseVoice(mp3, { loudness: false });
  readings.set(beat.id, { durationSeconds: heard?.durationSeconds ?? 0, words });
}

const timed = layout(BEATS, readings, { tailSeconds: 0.4, breathSeconds: 0.2, maxWords: 5 });

type Shot = { at: number; text: string; held: number; beat: string };
const shots: Shot[] = [];
for (const beat of timed) {
  for (const row of subtitlesFor(beat.phrases, beat.durationSeconds)) {
    shots.push({
      // The MIDDLE of the window, not the start: a frame grabbed on the edge
      // catches a fade and says nothing about whether the caption reads.
      at: beat.atSeconds + (row.atSeconds + row.untilSeconds) / 2,
      text: row.text,
      held: row.untilSeconds - row.atSeconds,
      beat: beat.id,
    });
  }
}

const bin = ffmpeg as unknown as string;
for (const [index, shot] of shots.entries()) {
  const file = path.join(out, `${String(index).padStart(2, '0')}-${shot.beat}.png`);
  execFileSync(bin, [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-ss', shot.at.toFixed(3), '-i', film, '-frames:v', '1',
    // Half size: the caption is still legible and a sheet of 30 fits in a look.
    '-vf', 'scale=960:-1', '-y', file,
  ]);
  console.log(`${shot.at.toFixed(2).padStart(6)}s  ${shot.held.toFixed(2)}s  ${shot.beat.padEnd(4)} "${shot.text}"`);
}

// Four across, so the sheet is read left to right like the film runs.
const sheet = path.join(out, 'sheet.png');
execFileSync(bin, [
  '-hide_banner', '-loglevel', 'error', '-nostdin',
  '-pattern_type', 'glob', '-i', path.join(out, '[0-9]*.png'),
  '-filter_complex', `tile=4x${Math.ceil(shots.length / 4)}:margin=8:padding=6:color=#222222`,
  '-frames:v', '1', '-y', sheet,
]);
console.log(`\n${shots.length} captions -> ${sheet}`);
