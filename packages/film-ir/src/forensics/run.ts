import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ForensicProbe, ForensicReport } from './report.ts';

/**
 * Running the forensic analyzer.
 *
 * It is a Python program — NumPy, OpenCV, PyAV and an ONNX OCR model are what
 * frame-exact measurement of a video needs, and none of them has an honest
 * JavaScript equivalent — run as a child process with an argv array, never a
 * shell, and its report parsed before anything reads it.
 */
export const FORENSICS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../forensics');

export type ForensicsProgress = { stage: string; progress: number; message: string };

export type ForensicsRunOptions = {
  ffmpeg: string;
  outputPath: string;
  python?: string;
  ocrHz?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ForensicsProgress) => void;
};

export class ForensicsError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ForensicsError';
    this.retryable = retryable;
  }
}

export function pythonBinary(explicit?: string): string {
  return explicit ?? process.env.ACT_ONE_PYTHON ?? 'python3';
}

/**
 * Whether this machine can run the analyzer at all, and with what.
 *
 * Asked before a job starts rather than discovered halfway through one: a
 * missing module is an operator's problem, and retrying the job will not fix it.
 */
export async function checkForensicsRuntime(python?: string): Promise<{ ok: true; versions: Record<string, string> } | { ok: false; reason: string }> {
  const probe = [
    'import json, numpy, cv2, av',
    'import rapidocr_onnxruntime',
    'print(json.dumps({"numpy": numpy.__version__, "opencv": cv2.__version__, "pyav": av.__version__}))',
  ].join('\n');
  const result = await run(pythonBinary(python), ['-c', probe], { timeoutMs: 60_000 });
  if (result.code !== 0) {
    const missing = /No module named '([^']+)'/.exec(result.stderr)?.[1];
    return {
      ok: false,
      reason: missing
        ? `the analyzer's Python module "${missing}" is not installed; run: python3 -m pip install -r packages/film-ir/forensics/requirements.txt`
        : `python could not start the analyzer: ${result.stderr.trim().split('\n').slice(-2).join(' ') || `exit ${result.code}`}`,
    };
  }
  try {
    return { ok: true, versions: JSON.parse(result.stdout.trim().split('\n').pop() ?? '{}') as Record<string, string> };
  } catch {
    return { ok: false, reason: 'python ran but did not report its module versions' };
  }
}

export async function runForensics(filmPath: string, options: ForensicsRunOptions): Promise<ForensicReport> {
  const args = [
    '-m', 'actone_forensics.analyze',
    filmPath,
    options.outputPath,
    '--ffmpeg', options.ffmpeg,
    '--ocr-hz', String(options.ocrHz ?? 6),
  ];
  const result = await run(pythonBinary(options.python), args, {
    cwd: FORENSICS_DIR,
    env: { ...process.env, PYTHONPATH: FORENSICS_DIR, PYTHONUNBUFFERED: '1' },
    timeoutMs: options.timeoutMs ?? 60 * 60_000,
    ...(options.signal ? { signal: options.signal } : {}),
    onLine: (line) => {
      if (!options.onProgress) return;
      try {
        const parsed = JSON.parse(line) as ForensicsProgress;
        if (typeof parsed.stage === 'string') options.onProgress(parsed);
      } catch {
        // Not a progress line; the analyzer only ever prints those, so ignore anything else.
      }
    },
  });
  if (result.killedBy === 'abort') throw new ForensicsError('The analysis was cancelled.', false);
  if (result.killedBy === 'timeout') throw new ForensicsError('The analysis took longer than it is allowed to.', true);
  if (result.code !== 0) {
    const tail = result.stderr.trim().split('\n').slice(-3).join(' | ');
    // A failure to decode is the file's, and will fail the same way again.
    const permanent = /no video stream|Invalid data|moov atom not found|could not find codec/i.test(result.stderr);
    throw new ForensicsError(`The analyzer stopped (exit ${result.code}): ${tail.slice(0, 600)}`, !permanent);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(options.outputPath, 'utf8'));
  } catch (error) {
    throw new ForensicsError(`The analyzer's report could not be read: ${(error as Error).message}`, true);
  }
  const parsed = ForensicReport.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new ForensicsError(`The analyzer's report is not what this version reads: ${first}`, false);
  }
  return parsed.data;
}

/**
 * The container's own account of a film: streams, codecs, declared rates and
 * durations. Seconds, not minutes, so the library can say what a film is
 * before its analysis has started. A file the container library cannot open
 * is not a film, and trying again will not make it one.
 */
export async function probeFilm(filmPath: string, options: { python?: string; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ForensicProbe> {
  const result = await run(pythonBinary(options.python), ['-m', 'actone_forensics.probe', filmPath], {
    cwd: FORENSICS_DIR,
    env: { ...process.env, PYTHONPATH: FORENSICS_DIR },
    timeoutMs: options.timeoutMs ?? 120_000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (result.killedBy === 'abort') throw new ForensicsError('The probe was cancelled.', false);
  if (result.killedBy === 'timeout') throw new ForensicsError('The probe took longer than two minutes.', true);
  if (result.code !== 0) {
    const tail = result.stderr.trim().split('\n').slice(-2).join(' | ');
    const unreadable = /Invalid data|moov atom not found|could not find codec|no video stream|StopIteration|'NoneType'/i.test(result.stderr);
    throw new ForensicsError(unreadable ? `The file is not a film the analyzer can read: ${tail.slice(0, 400)}` : `The probe stopped (exit ${result.code}): ${tail.slice(0, 400)}`, !unreadable);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout.trim().split('\n').pop() ?? '');
  } catch {
    throw new ForensicsError('The probe did not answer in JSON.', true);
  }
  const parsed = ForensicProbe.safeParse(raw);
  if (!parsed.success) {
    // Most often: no video stream at all, which the schema requires.
    const first = parsed.error.issues.slice(0, 2).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new ForensicsError(`The file has no video stream the analyzer can use (${first}).`, false);
  }
  return parsed.data;
}

type RunResult = { code: number | null; stdout: string; stderr: string; killedBy: 'timeout' | 'abort' | null };

function run(
  binary: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal; onLine?: (line: string) => void },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pending = '';
    let killedBy: RunResult['killedBy'] = null;
    const timer = setTimeout(() => {
      killedBy = 'timeout';
      child.kill('SIGKILL');
    }, options.timeoutMs);
    const onAbort = () => {
      killedBy = 'abort';
      child.kill('SIGKILL');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout = (stdout + text).slice(-16_000);
      pending += text;
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        options.onLine?.(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-16_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}`, killedBy });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, killedBy });
    });
  });
}

/**
 * Exact frames from the analyzer's own decoder: frame N here is frame N in the
 * measurements, whatever the container's timestamps look like.
 */
export async function extractExactFrames(
  filmPath: string,
  first: number,
  last: number,
  options: { workDir: string; python?: string; width?: number; signal?: AbortSignal },
): Promise<{ frame: number; seconds: number; jpeg: Uint8Array }[]> {
  const out = path.join(options.workDir, `frames-${first}-${last}`);
  const result = await run(pythonBinary(options.python), ['-m', 'actone_forensics.extract', filmPath, out, String(first), String(last), '--width', String(options.width ?? 960)], {
    cwd: FORENSICS_DIR,
    env: { ...process.env, PYTHONPATH: FORENSICS_DIR },
    timeoutMs: 5 * 60_000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (result.code !== 0) throw new ForensicsError(`Frames ${first}–${last} could not be extracted: ${result.stderr.trim().split('\n').slice(-2).join(' ')}`, true);
  const listed = JSON.parse(await readFile(path.join(out, 'frames.json'), 'utf8')) as { frame: number; seconds: number | null; file: string }[];
  const frames: { frame: number; seconds: number; jpeg: Uint8Array }[] = [];
  for (const entry of listed) {
    frames.push({ frame: entry.frame, seconds: entry.seconds ?? 0, jpeg: new Uint8Array(await readFile(path.join(out, entry.file))) });
  }
  return frames;
}
