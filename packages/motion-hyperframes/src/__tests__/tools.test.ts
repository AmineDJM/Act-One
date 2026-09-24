import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CliAbortedError, CliTimeoutError, cliEnvironment, runCli, stripAnsi, type HyperFramesTools } from '../tools.ts';

/**
 * Running the CLI.
 *
 * A stand-in script plays the CLI, so what is tested is the runner: what the
 * child can see of this process, what comes back from it, and that stopping a
 * render stops everything it started.
 */
async function fakeCli(body: string): Promise<HyperFramesTools> {
  const dir = await mkdtemp(path.join(tmpdir(), 'act-one-hf-cli-'));
  const cliPath = path.join(dir, 'cli.js');
  await writeFile(cliPath, body, 'utf8');
  return {
    cliPath,
    cliVersion: 'test',
    nodePath: process.execPath,
    browserPath: '/opt/browser/headless_shell',
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    binDir: path.join(dir, 'bin'),
    homeDir: path.join(dir, 'home'),
  };
}

/** Whether a process still runs. A zombie has stopped; only its parent has not collected it, which in a container may never happen. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ')[0] !== 'Z';
  } catch {
    return true;
  }
}

const secret = 'ACT_ONE_TEST_SECRET_THAT_MUST_NOT_LEAK';
afterEach(() => {
  delete process.env[secret];
});

describe('the CLI’s environment', () => {
  it('is an allowlist: none of the worker’s secrets, all of the privacy switches', async () => {
    process.env[secret] = 'sk-live-123';
    process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgres://secret';
    const tools = await fakeCli('');
    const env = cliEnvironment(tools);
    expect(Object.keys(env)).not.toContain(secret);
    expect(Object.keys(env)).not.toContain('DATABASE_URL');
    expect(Object.keys(env)).not.toContain('OPENAI_API_KEY');
    expect(Object.keys(env)).not.toContain('GEMINI_API_KEY');
    expect(env).toMatchObject({
      HOME: tools.homeDir,
      HYPERFRAMES_NO_TELEMETRY: '1',
      DO_NOT_TRACK: '1',
      HYPERFRAMES_NO_UPDATE_CHECK: '1',
      HYPERFRAMES_NO_AUTO_INSTALL: '1',
      HYPERFRAMES_SKIP_SKILLS: '1',
      HYPERFRAMES_BROWSER_PATH: tools.browserPath,
      TZ: 'UTC',
    });
    expect(env['PATH']!.split(path.delimiter)[0]).toBe(tools.binDir);
  });

  it('is what the child actually sees', async () => {
    process.env[secret] = 'sk-live-123';
    const tools = await fakeCli(`process.stdout.write(JSON.stringify(Object.keys(process.env).sort()));`);
    const run = await runCli(tools, ['env'], { cwd: tmpdir(), timeoutMs: 10_000, captureStdout: true });
    const keys = JSON.parse(run.stdout) as string[];
    expect(keys).not.toContain(secret);
    expect(keys).toContain('HYPERFRAMES_NO_TELEMETRY');
  });
});

describe('a CLI run', () => {
  it('reports its lines as they come, and keeps the last of each stream', async () => {
    const tools = await fakeCli(`
      for (let i = 1; i <= 100; i += 1) console.log('\\u001b[32m  25%  Streaming frame ' + i + '/100\\u001b[39m');
      console.error('a warning');
      process.exit(3);
    `);
    const lines: string[] = [];
    const run = await runCli(tools, ['render'], { cwd: tmpdir(), timeoutMs: 10_000, onLine: (line) => lines.push(line) });
    expect(run.exitCode).toBe(3);
    expect(lines).toHaveLength(101);
    expect(lines[0]).toBe('  25%  Streaming frame 1/100');
    expect(run.stdoutTail).toHaveLength(60);
    expect(run.stdoutTail.at(-1)).toBe('  25%  Streaming frame 100/100');
    expect(run.stderrTail).toEqual(['a warning']);
    expect(run.stdout).toBe('');
  });

  it('survives a progress callback that throws', async () => {
    const tools = await fakeCli(`console.log('one'); console.log('two');`);
    const run = await runCli(tools, ['render'], { cwd: tmpdir(), timeoutMs: 10_000, onLine: () => { throw new Error('bad callback'); } });
    expect(run.exitCode).toBe(0);
    expect(run.stdoutTail).toEqual(['one', 'two']);
  });

  it('is stopped, with everything it started, when it runs past its time', async () => {
    // The CLI starts a grandchild that would outlive it, as a browser would.
    const tools = await fakeCli(`
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      console.log(String(child.pid));
      setInterval(() => {}, 1000);
    `);
    const lines: string[] = [];
    await expect(runCli(tools, ['render'], { cwd: tmpdir(), timeoutMs: 600, onLine: (line) => lines.push(line) })).rejects.toBeInstanceOf(CliTimeoutError);
    const grandchild = Number(lines[0]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(running(grandchild)).toBe(false);
  });

  it('is stopped when the render is cancelled', async () => {
    const tools = await fakeCli(`setInterval(() => {}, 1000);`);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    await expect(runCli(tools, ['render'], { cwd: tmpdir(), timeoutMs: 10_000, signal: controller.signal })).rejects.toBeInstanceOf(CliAbortedError);
    const already = new AbortController();
    already.abort();
    await expect(runCli(tools, ['check'], { cwd: tmpdir(), timeoutMs: 10_000, signal: already.signal })).rejects.toBeInstanceOf(CliAbortedError);
  });
});

describe('terminal colour', () => {
  it('is stripped from what the CLI prints', () => {
    expect(stripAnsi('\u001b[1m\u001b[32m◆  Rendering\u001b[39m\u001b[22m \u001b[?25l')).toBe('◆  Rendering ');
  });
});
