/**
 * Installs Blender for the worker, at build time.
 *
 *   npm run blender
 *
 * Every 3D shot in this platform goes through Blender: the product's own
 * capture staged as an object in space, and the spatial transitions between
 * beats. Without it `isBlenderAvailable` answers false and those scenes
 * silently degrade to a flat screenshot, which is a quieter failure than it
 * sounds — the film still renders, and it looks like a film made by somebody
 * who did not have the technique.
 *
 * The host cannot be asked to install it. A managed Node build runs without
 * root, so there is no package manager to reach for, which is the same
 * constraint the browsers are under and the same answer: fetch the official
 * self-contained build once, here, and point the renderer at it. Doing it at
 * run time would charge a 350MB download to the first customer who asks for a
 * 3D shot, and on a host with no egress at run time it would simply never
 * happen.
 *
 * ACT_ONE_BLENDER_PATH overrides everything, for a host that ships its own.
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The series and the point release, kept apart because the download path
 * carries the series and the filename carries the release.
 *
 * Pinned rather than "latest" on purpose: a build that quietly changes its
 * renderer between deploys produces two films from one storyboard, and the
 * difference turns up as a customer asking why their re-render looks
 * different. Moving it is a commit somebody reviews.
 */
const SERIES = '4.2';
const VERSION = '4.2.9';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
/** Beside the other downloaded binaries, and inside what the deploy carries. */
const HOME = path.join(ROOT, 'node_modules', '.blender');
const BINARY = path.join(HOME, 'blender');

const URL_FOR = (platform: string) =>
  `https://download.blender.org/release/Blender${SERIES}/blender-${VERSION}-${platform}.tar.xz`;

function step(label: string): void {
  console.log(`\x1b[1m${label}\x1b[0m`);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Whether this binary actually runs here, which is the only useful question. */
function runs(binary: string): boolean {
  const result = spawnSync(binary, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

step(`Blender ${VERSION} (3D shots)`);

if (process.env.ACT_ONE_BLENDER_PATH) {
  console.log(`  using ACT_ONE_BLENDER_PATH=${process.env.ACT_ONE_BLENDER_PATH}`);
  process.exit(0);
}

if (await exists(BINARY)) {
  if (runs(BINARY)) {
    console.log(`  already installed at ${BINARY}`);
    process.exit(0);
  }
  console.log('  present but will not run; fetching again');
  await rm(HOME, { recursive: true, force: true });
}

/*
 * Only Linux is fetched. A developer on macOS installs Blender however they
 * install anything else and the renderer finds it on PATH; the build host is
 * Linux, and that is the one that cannot ask a package manager.
 */
if (process.platform !== 'linux') {
  if (runs('blender')) {
    console.log('  using the blender already on PATH');
    process.exit(0);
  }
  console.log(`  ${process.platform} is not fetched automatically. Install Blender and put it on PATH,`);
  console.log('  or set ACT_ONE_BLENDER_PATH. 3D shots degrade to a flat capture without it.');
  process.exit(0);
}

const platform = process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
const url = URL_FOR(platform);
console.log(`  fetching ${url}`);

await mkdir(HOME, { recursive: true });
const archive = path.join(HOME, 'blender.tar.xz');

const response = await fetch(url);
if (!response.ok || !response.body) {
  console.error(`  download failed: HTTP ${response.status}`);
  /*
   * Not a build failure. A worker without Blender still renders every film,
   * with the 3D shots staged flat — which is exactly what happens today and
   * is worth far more than a deploy that will not start.
   */
  process.exit(0);
}
await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(archive));

console.log('  extracting');
// `--strip-components=1` drops the versioned directory the archive wraps
// everything in, so the binary lands at a path that does not move with the
// version.
const extracted = spawnSync('tar', ['-xJf', archive, '-C', HOME, '--strip-components=1'], { stdio: 'inherit' });
await rm(archive, { force: true });

if (extracted.status !== 0 || !(await exists(BINARY))) {
  console.error('  extraction failed; 3D shots will be staged flat.');
  process.exit(0);
}

if (!runs(BINARY)) {
  console.error('  installed but will not run here; 3D shots will be staged flat.');
  process.exit(0);
}

console.log(`  ready at ${BINARY}`);
