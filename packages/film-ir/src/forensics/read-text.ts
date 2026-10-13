import { spawn } from 'node:child_process';
import type { OcrLine } from '@act-one/core';
import { FORENSICS_DIR, pythonBinary } from './run.ts';

/**
 * The words in one picture, read by the analyzer's OCR model (RapidOCR), with
 * their boxes in the picture's pixels. Used to hold a redrawn interface to
 * the words its capture actually shows.
 */
export async function readTextInImage(imagePath: string, options: { python?: string; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<OcrLine[]> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(pythonBinary(options.python), ['-m', 'actone_forensics.read_text', imagePath], {
      cwd: FORENSICS_DIR,
      env: { ...process.env, PYTHONPATH: FORENSICS_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 120_000);
    const abort = () => child.kill('SIGKILL');
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      if (out.length > 4_000_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-4_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (code === 0) resolve(out);
      else reject(new Error(`the OCR model could not read ${imagePath}: ${err.trim().split('\n').slice(-2).join(' ') || `exit ${code}`}`));
    });
  });
  const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '[]') as unknown;
  if (!Array.isArray(parsed)) throw new Error('the OCR model answered with something other than a list of lines');
  return parsed.flatMap((entry): OcrLine[] => {
    const line = entry as Partial<OcrLine>;
    const box = line.box;
    if (typeof line.text !== 'string' || typeof line.score !== 'number' || !box) return [];
    if (![box.x0, box.y0, box.x1, box.y1].every((value) => Number.isFinite(value))) return [];
    return [{ text: line.text, score: line.score, box: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 } }];
  });
}
