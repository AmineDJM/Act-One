import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readlink, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { resolveFfmpeg } from '@act-one/sound';

/**
 * Everything the HyperFrames CLI needs from the host, and nothing else.
 *
 * The CLI is a third-party program that, left to its defaults, reports
 * telemetry to its vendor, checks npm for a newer version and can install one
 * in the background, and would happily download a browser at render time. A
 * render worker does none of that: it runs one pinned version, offline, with
 * a browser and FFmpeg it was given, and an environment that carries no
 * secret of ours. The worker's own environment holds database credentials and
 * provider keys; none of it is inherited.
 */
export type HyperFramesTools = {
  /** The pinned CLI's entry script, run with this process's own Node. */
  cliPath: string;
  cliVersion: string;
  nodePath: string;
  browserPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  /** A private bin directory holding `ffmpeg` and `ffprobe`, first on the CLI's PATH. */
  binDir: string;
  /** The CLI's HOME: its config, logs and caches land here rather than in the worker's. */
  homeDir: string;
};

export class ToolingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolingError';
  }
}

const require = createRequire(import.meta.url);

export type ToolOptions = {
  browserPath?: string;
  /** Where the private bin directory and the CLI's home live. Defaults to a per-user temp directory. */
  baseDir?: string;
};

const resolved = new Map<string, Promise<HyperFramesTools>>();

/** Resolved once per process and options; the answers do not change while a worker runs. */
export function resolveTools(options: ToolOptions = {}): Promise<HyperFramesTools> {
  const key = JSON.stringify([options.browserPath ?? null, options.baseDir ?? null]);
  const existing = resolved.get(key);
  if (existing) return existing;
  const attempt = findTools(options);
  resolved.set(key, attempt);
  // A failed resolution is not kept: the operator may fix the host, and the next render should see it.
  attempt.catch(() => resolved.delete(key));
  return attempt;
}

async function findTools(options: ToolOptions): Promise<HyperFramesTools> {
  const packageJsonPath = require.resolve('hyperframes/package.json');
  const cliPath = path.join(path.dirname(packageJsonPath), 'dist', 'cli.js');
  if (!(await isReadable(cliPath))) {
    throw new ToolingError(`The HyperFrames CLI is not installed where expected: ${cliPath}.`);
  }
  const { version: cliVersion } = require('hyperframes/package.json') as { version: string };

  const browserPath = await resolveBrowser(options.browserPath);
  const ffmpegPath = await resolveFfmpeg();
  const ffprobePath = await resolveFfprobe(ffmpegPath);

  const baseDir = options.baseDir ?? path.join(os.tmpdir(), `act-one-hyperframes-${os.userInfo().uid}`);
  const binDir = path.join(baseDir, 'bin');
  const homeDir = path.join(baseDir, 'home');
  await mkdir(binDir, { recursive: true, mode: 0o700 });
  await mkdir(homeDir, { recursive: true, mode: 0o700 });
  await linkTool(path.join(binDir, 'ffmpeg'), await absoluteCommand(ffmpegPath));
  await linkTool(path.join(binDir, 'ffprobe'), await absoluteCommand(ffprobePath));

  return { cliPath, cliVersion, nodePath: process.execPath, browserPath, ffmpegPath, ffprobePath, binDir, homeDir };
}

/**
 * The browser HyperFrames drives.
 *
 * The same chrome-headless-shell the worker installs for Remotion. Required,
 * never downloaded: a render that fetches a browser on its first run depends on
 * the network and on whatever version is current that day.
 */
async function resolveBrowser(explicit?: string): Promise<string> {
  for (const candidate of browserCandidates(explicit)) {
    if (await isExecutable(candidate)) return candidate;
  }
  throw new ToolingError(
    'No browser for HyperFrames. Run `npm run browsers`, or set ACT_ONE_CHROME_HEADLESS_SHELL to a chrome-headless-shell.',
  );
}

/** Every place a browser may be, in the order they are tried. */
export function browserCandidates(explicit?: string): string[] {
  return [
    explicit,
    process.env.ACT_ONE_CHROME_HEADLESS_SHELL,
    process.env.REMOTION_BROWSER_EXECUTABLE,
    process.env.HYPERFRAMES_BROWSER_PATH,
    ...remotionHeadlessShells(),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * Where `npm run browsers` leaves the headless shell when nothing says otherwise.
 *
 * Remotion's own cache, under the node_modules that holds its renderer and
 * under the nearest package root from here: the two places it downloads to,
 * depending on where the installer was run from.
 */
function remotionHeadlessShells(): string[] {
  const roots = new Set<string>([path.join(process.cwd(), 'node_modules', '.remotion')]);
  try {
    const renderer = path.dirname(require.resolve('@remotion/renderer/package.json'));
    roots.add(path.resolve(renderer, '..', '..', '.remotion'));
  } catch {
    // Remotion is not installed alongside this engine; only the configured paths apply.
  }
  const platforms = ['linux64', 'linux-arm64', 'mac-arm64', 'mac-x64'];
  return [...roots].flatMap((root) =>
    platforms.flatMap((platform) =>
      ['chrome-headless-shell', 'headless_shell'].map((binary) =>
        path.join(root, 'chrome-headless-shell', platform, `chrome-headless-shell-${platform}`, binary),
      ),
    ),
  );
}

/**
 * ffprobe, which HyperFrames runs on every media file.
 *
 * Explicit configuration first, then a probe beside the FFmpeg in use, then the
 * one Remotion ships while that engine is still installed, then PATH.
 */
async function resolveFfprobe(ffmpegPath: string): Promise<string> {
  const configured = process.env.ACT_ONE_FFPROBE_PATH;
  if (configured && (await isExecutable(configured))) return configured;

  if (path.isAbsolute(ffmpegPath)) {
    const sibling = path.join(path.dirname(ffmpegPath), 'ffprobe');
    if (await isExecutable(sibling)) return sibling;
  }

  for (const compositor of ['@remotion/compositor-linux-x64-gnu', '@remotion/compositor-linux-arm64-gnu', '@remotion/compositor-darwin-arm64', '@remotion/compositor-darwin-x64']) {
    try {
      const probe = path.join(path.dirname(require.resolve(`${compositor}/package.json`)), 'ffprobe');
      if (await isExecutable(probe)) return probe;
    } catch {
      // Not installed for this platform.
    }
  }

  if (await runsOk('ffprobe')) return 'ffprobe';
  throw new ToolingError('ffprobe was not found. Set ACT_ONE_FFPROBE_PATH or put ffprobe on PATH.');
}

/** The environment the CLI runs in: an allowlist, never the worker's own. */
export function cliEnvironment(tools: HyperFramesTools, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: [tools.binDir, path.dirname(tools.nodePath), '/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter),
    HOME: tools.homeDir,
    TMPDIR: os.tmpdir(),
    LANG: 'C.UTF-8',
    // Rendering is a function of the composition; the host's clock zone is not an input.
    TZ: 'UTC',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    HYPERFRAMES_NO_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    HYPERFRAMES_NO_AUTO_INSTALL: '1',
    HYPERFRAMES_SKIP_SKILLS: '1',
    HYPERFRAMES_BROWSER_PATH: tools.browserPath,
    PRODUCER_HEADLESS_SHELL_PATH: tools.browserPath,
    HYPERFRAMES_FONT_CACHE_DIR: path.join(tools.homeDir, 'fonts'),
    ...extra,
  };
}

export type CliRun = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** The last lines of each stream, ANSI stripped: enough to explain a failure, bounded. */
  stdoutTail: string[];
  stderrTail: string[];
  stdout: string;
  durationMs: number;
};

export type CliRunOptions = {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
  /** Keep the whole of stdout, for commands whose answer is a JSON document. */
  captureStdout?: boolean;
};

export class CliTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`hyperframes ${command} did not finish within ${Math.round(timeoutMs / 1000)} s and was stopped.`);
    this.name = 'CliTimeoutError';
  }
}

export class CliAbortedError extends Error {
  constructor(command: string) {
    super(`hyperframes ${command} was cancelled.`);
    this.name = 'CliAbortedError';
  }
}

const TAIL_LINES = 60;
const MAX_CAPTURED_STDOUT = 32 * 1024 * 1024;

/**
 * Runs one CLI command and waits for it.
 *
 * Started in its own process group, because a render is a tree — the CLI,
 * the browsers it launches and the encoders it pipes into — and stopping only
 * the parent on a timeout or a cancel leaves Chrome and FFmpeg running on a
 * worker that has already moved on.
 */
export function runCli(tools: HyperFramesTools, args: string[], options: CliRunOptions): Promise<CliRun> {
  const command = args[0] ?? '';
  if (options.signal?.aborted) return Promise.reject(new CliAbortedError(command));

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(tools.nodePath, [tools.cliPath, ...args], {
      cwd: options.cwd,
      env: cliEnvironment(tools, options.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    const tails = { stdout: [] as string[], stderr: [] as string[] };
    const partial = { stdout: '', stderr: '' };
    let stdout = '';
    let settled = false;
    let stoppedBy: Error | null = null;

    const stopTree = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    };

    const timer = setTimeout(() => {
      stoppedBy = new CliTimeoutError(command, options.timeoutMs);
      stopTree();
    }, options.timeoutMs);
    timer.unref();

    const onAbort = () => {
      stoppedBy = new CliAbortedError(command);
      stopTree();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const consume = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout' && options.captureStdout && stdout.length < MAX_CAPTURED_STDOUT) stdout += text;
      const lines = (partial[stream] + text).split(/\r?\n|\r/);
      partial[stream] = lines.pop() ?? '';
      for (const raw of lines) emit(stream, raw);
    };
    const emit = (stream: 'stdout' | 'stderr', raw: string) => {
      const line = stripAnsi(raw).trimEnd();
      if (!line) return;
      const tail = tails[stream];
      tail.push(line);
      if (tail.length > TAIL_LINES) tail.shift();
      try {
        options.onLine?.(line, stream);
      } catch {
        // A progress callback must never take the render down with it.
      }
    };

    child.stdout.on('data', (chunk: Buffer) => consume('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => consume('stderr', chunk));

    const finish = (result: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      result();
    };

    child.on('error', (error) => finish(() => reject(new ToolingError(`Could not start the HyperFrames CLI: ${error.message}`))));
    child.on('close', (exitCode, signal) => {
      if (partial.stdout) emit('stdout', partial.stdout);
      if (partial.stderr) emit('stderr', partial.stderr);
      finish(() => {
        if (stoppedBy) {
          reject(stoppedBy);
          return;
        }
        resolve({
          exitCode,
          signal,
          stdoutTail: tails.stdout,
          stderrTail: tails.stderr,
          stdout,
          durationMs: Date.now() - started,
        });
      });
    });
  });
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

async function linkTool(linkPath: string, target: string): Promise<void> {
  try {
    if ((await readlink(linkPath)) === target) return;
    await rm(linkPath, { force: true });
  } catch {
    // Not a link yet.
  }
  try {
    await symlink(target, linkPath);
  } catch (error) {
    // Two renders starting at once may both try; the other one's link is the same link.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

/** A bare command name resolved against PATH, so the link points at a real file. */
async function absoluteCommand(command: string): Promise<string> {
  if (path.isAbsolute(command)) return command;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, command);
    if (await isExecutable(candidate)) return candidate;
  }
  throw new ToolingError(`${command} is not on PATH.`);
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function isReadable(file: string): Promise<boolean> {
  try {
    await access(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function runsOk(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}
