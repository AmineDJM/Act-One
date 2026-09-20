import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Credentials from a file the repository ignores.
 *
 * Deployed, every secret arrives as an environment variable and none of this
 * runs. It exists for the other case: somebody working on a machine, or a
 * sandbox, who has a key and no way to set it in the process that needs it —
 * which is how a provider that was configured, paid for and ready came to
 * have never once been called.
 *
 * The environment always wins. A file that quietly overrode a real deployment
 * secret would be a much worse problem than the one it solves, and nothing
 * here is ever logged or echoed: the value is read, put in `process.env`, and
 * never looked at again.
 */
export function loadLocalEnv(root: string = process.cwd()): string[] {
  const loaded: string[] = [];
  for (const name of ['.env.local', '.env']) {
    let text: string;
    try {
      text = readFileSync(path.join(root, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const at = trimmed.indexOf('=');
      if (at <= 0) continue;
      const key = trimmed.slice(0, at).trim();
      if (process.env[key] !== undefined) continue;
      const value = trimmed
        .slice(at + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2');
      process.env[key] = value;
      // The NAME, never the value.
      loaded.push(key);
    }
  }
  return loaded;
}
