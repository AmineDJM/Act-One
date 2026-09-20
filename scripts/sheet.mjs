import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const run = promisify(execFile);
const FF = 'node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg';
const FP = 'node_modules/@remotion/compositor-linux-x64-gnu/ffprobe';

const [video, out, colsArg, rowsArg] = process.argv.slice(2);
const cols = Number(colsArg ?? 4), rows = Number(rowsArg ?? 3), n = cols * rows;

const { stdout } = await run(FP, ['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1', video]);
const duration = Number(stdout.trim());

const dir = await mkdtemp(path.join(tmpdir(), 'sheet-'));
const W = 480, H = Math.round(W * 9 / 16);
const tiles = [];
for (let i = 0; i < n; i += 1) {
  const t = (duration * (i + 0.5)) / n;
  const still = path.join(dir, `${i}.png`);
  await run(FF, ['-y','-v','error','-ss', t.toFixed(3), '-i', video, '-frames:v','1', still]);
  tiles.push({ input: await sharp(still).resize(W, H, { fit: 'cover' }).toBuffer(),
               left: (i % cols) * W, top: Math.floor(i / cols) * H });
}
await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#222' } })
  .composite(tiles).png().toFile(out);
await rm(dir, { recursive: true, force: true });
console.log(`${out}  ${duration.toFixed(1)}s  ${n} frames`);
