import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_LIBRARY, type SoundLibrary } from './library.ts';
import { renderMusic, renderSfx } from './scores.ts';
import { encodeWav } from './synthesis.ts';
import { levelShortSample, masterLoudness } from './master.ts';

/**
 * Builds Act One's sound library from its scores.
 *
 * Synthesis gets the material right; FFmpeg gets the level right. Those are
 * genuinely different problems — peak normalisation in the synthesiser is
 * arithmetic, while the LUFS figure the manifest declares is a BS.1770
 * measurement that only a meter can deliver. So every file is rendered, then
 * measured and normalised to the loudness its manifest entry promises, which is
 * what lets the Sound Director reason about levels before mixing anything.
 */
export type BuildProgress = (message: string, done: number, total: number) => void;

export async function buildSoundLibrary(options: {
  storageDir: string;
  library?: SoundLibrary;
  onProgress?: BuildProgress;
  /** Rebuilds files that already exist. Off by default: a build is slow. */
  force?: boolean;
  exists?: (absolutePath: string) => Promise<boolean>;
}): Promise<{ written: string[]; skipped: string[] }> {
  const library = options.library ?? DEFAULT_LIBRARY;
  const items = [
    ...library.music.map((track) => ({ kind: 'music' as const, track })),
    ...library.sfx.map((sample) => ({ kind: 'sfx' as const, sample })),
  ];

  const written: string[] = [];
  const skipped: string[] = [];
  let done = 0;

  for (const item of items) {
    const entry = item.kind === 'music' ? item.track : item.sample;
    const target = path.join(options.storageDir, entry.storageKey);
    const label = item.kind === 'music' ? item.track.title : item.sample.kind;

    if (!options.force && options.exists && (await options.exists(target))) {
      skipped.push(entry.storageKey);
      done += 1;
      continue;
    }

    options.onProgress?.(`Rendering ${label}`, done, items.length);

    const buffer = item.kind === 'music' ? renderMusic(item.track) : renderSfx(item.sample);
    await mkdir(path.dirname(target), { recursive: true });

    // Written next to the target and moved into place by FFmpeg, so a crashed
    // build never leaves a half-written file that validation would accept.
    const raw = `${target}.raw.wav`;
    await writeFile(raw, encodeWav(buffer));

    options.onProgress?.(`Mastering ${label} to ${entry.lufs} ${item.kind === 'music' ? 'LUFS' : 'dB RMS'}`, done, items.length);
    if (item.kind === 'music') {
      await masterLoudness({ source: raw, target, lufs: entry.lufs });
    } else {
      // The manifest's figure for an effect is an RMS level; see SfxSample.
      await levelShortSample({ source: raw, target, rmsDb: entry.lufs });
    }
    await rm(raw, { force: true });

    written.push(entry.storageKey);
    done += 1;
  }

  options.onProgress?.('Done', items.length, items.length);
  return { written, skipped };
}

