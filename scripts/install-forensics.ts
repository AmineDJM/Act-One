/**
 * Installs the forensic analyzer's Python runtime for the worker, at build time.
 *
 *   npm run forensics
 *
 * The Benchmark Library reads reference films with a Python program — NumPy,
 * OpenCV, PyAV and RapidOCR, see packages/film-ir/forensics — because
 * frame-exact measurement needs them and nothing in JavaScript is their
 * equal. A managed Node build runs without root, so the packages go into a
 * virtual environment of their own under node_modules, which the deploy
 * carries and the analyzer finds without configuration. The versions are the
 * pinned ones it was validated with: a different OpenCV can move a
 * measurement.
 *
 * ACT_ONE_PYTHON overrides everything, for a host that ships its own.
 *
 * Not a build failure when it cannot be done. Customer films never touch the
 * analyzer, and a worker that refused to deploy over a reference-film tool
 * would take them down with it. The worker says at startup whether the
 * analyzer can run, and an analysis asked of a worker without it fails at
 * once, with the reason, rather than three times.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REQUIREMENTS = path.join(ROOT, 'packages', 'film-ir', 'forensics', 'requirements.txt');
/** Must match FORENSICS_PYTHON_HOME in packages/film-ir/src/forensics/run.ts. */
const HOME = path.join(ROOT, 'node_modules', '.forensics-python');
const PYTHON = path.join(HOME, 'bin', 'python');
/**
 * Written last, once the analyzer's imports work; the analyzer uses this
 * environment only when it is there, so a build that failed halfway leaves
 * nothing it would pick up.
 */
const READY = path.join(HOME, '.ready');
/**
 * NumPy 2.4 needs 3.11 or newer, RapidOCR 1.4.4 needs older than 3.13, and
 * the analyzer is validated on 3.11 — which is therefore asked for first.
 */
const SUPPORTED = { major: 3, minors: [11, 12] };
const CANDIDATES = ['python3.11', 'python3.12', 'python3'];
/** Everything the analyzer imports. */
const IMPORT_CHECK = 'import numpy, cv2, av, rapidocr_onnxruntime; print(cv2.__version__)';

function step(label: string): void {
  console.log(`\x1b[1m${label}\x1b[0m`);
}

function run(binary: string, args: string[], quiet = true): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(binary, args, { encoding: 'utf8', stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'] });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: `${result.stderr ?? ''}${result.error ? result.error.message : ''}` };
}

function version(binary: string): { major: number; minor: number } | null {
  const result = run(binary, ['-c', 'import sys; print(sys.version_info[0], sys.version_info[1])']);
  if (!result.ok) return null;
  const [major, minor] = result.stdout.trim().split(' ').map(Number);
  return Number.isInteger(major) && Number.isInteger(minor) ? { major: major!, minor: minor! } : null;
}

function supported(found: { major: number; minor: number } | null): boolean {
  return found !== null && found.major === SUPPORTED.major && SUPPORTED.minors.includes(found.minor);
}

const described = `Python ${SUPPORTED.minors.map((minor) => `${SUPPORTED.major}.${minor}`).join(' or ')}`;

function analyzerImports(binary: string): { ok: boolean; detail: string } {
  const result = run(binary, ['-c', IMPORT_CHECK]);
  return { ok: result.ok, detail: result.ok ? result.stdout.trim() : result.stderr.trim().split('\n').slice(-1)[0] ?? 'failed' };
}

function giveUp(reason: string): never {
  console.error(`  ${reason}`);
  console.error('  Benchmark analysis will fail on this worker, with this reason, until it is fixed. Nothing else is affected.');
  process.exit(0);
}

step('Python runtime (benchmark film forensics)');

if (process.env.ACT_ONE_PYTHON) {
  const check = analyzerImports(process.env.ACT_ONE_PYTHON);
  console.log(`  using ACT_ONE_PYTHON=${process.env.ACT_ONE_PYTHON}: ${check.ok ? `ready (OpenCV ${check.detail})` : `cannot run the analyzer: ${check.detail}`}`);
  process.exit(0);
}

// Trusted again only once this run has checked it.
await rm(READY, { force: true });

// An environment from an earlier build that no longer starts, or on a Python the packages do not support, is made again.
if (existsSync(HOME) && !supported(version(PYTHON))) {
  console.log('  the existing environment will not start or is on an unsupported Python; making it again');
  await rm(HOME, { recursive: true, force: true });
}

if (!existsSync(PYTHON)) {
  const base = CANDIDATES.find((candidate) => supported(version(candidate)));
  if (!base) giveUp(`no ${described} on this host (tried ${CANDIDATES.join(', ')}).`);
  console.log(`  making an environment with ${base} at ${HOME}`);
  const made = run(base, ['-m', 'venv', HOME]);
  if (!made.ok) giveUp(`${base} could not make a virtual environment: ${made.stderr.trim().split('\n').slice(-1)[0]}`);
}

console.log(`  installing the pinned packages from ${path.relative(ROOT, REQUIREMENTS)}`);
const installed = run(PYTHON, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', REQUIREMENTS], false);
if (!installed.ok) giveUp('pip could not install the analyzer\'s packages (see above).');

/*
 * RapidOCR declares a dependency on the desktop OpenCV build, which installs
 * into the same `cv2` directory as the headless build the analyzer pins and
 * needs the host's OpenGL library (libGL.so.1) to import at all. A managed
 * host has none, so whichever build pip wrote last decides whether the
 * analyzer starts. The desktop build is removed and the pinned headless one
 * written again over the directory they shared; RapidOCR only ever imports
 * `cv2`, which the headless build provides in full.
 */
const headless = /^opencv-python-headless==\S+/m.exec(readFileSync(REQUIREMENTS, 'utf8'))?.[0];
if (!headless) giveUp('requirements.txt no longer pins opencv-python-headless; this script needs updating with it.');
if (run(PYTHON, ['-m', 'pip', 'show', 'opencv-python']).ok) {
  console.log('  replacing the desktop OpenCV RapidOCR pulled in with the pinned headless build');
  const removed = run(PYTHON, ['-m', 'pip', 'uninstall', '--yes', 'opencv-python'], false);
  const restored = removed.ok && run(PYTHON, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--force-reinstall', '--no-deps', headless], false).ok;
  if (!restored) giveUp('could not put the headless OpenCV back in place (see above).');
}

const check = analyzerImports(PYTHON);
if (!check.ok) giveUp(`the packages installed but the analyzer cannot import them: ${check.detail}`);
await writeFile(READY, `${new Date().toISOString()} OpenCV ${check.detail}\n`);
console.log(`  ready at ${PYTHON} (OpenCV ${check.detail})`);
