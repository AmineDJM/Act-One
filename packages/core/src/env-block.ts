/**
 * Parses a pasted block of environment variables.
 *
 * An operator setting Act One up already has these values somewhere — a .env
 * file, a Render dashboard, a password manager note. Asking them to pick each
 * one apart and drop it into the right field is busywork we can do for them, so
 * the console takes the whole block.
 *
 * Tolerant on purpose, because paste is messy: `export` prefixes, `KEY: value`
 * from a YAML file, quotes, inline comments, blank lines, and the leading
 * bullet characters that survive a copy out of a web dashboard.
 */
export type EnvEntry = { key: string; value: string };

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*)$/;

export function parseEnvBlock(input: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  const seen = new Set<string>();

  for (const raw of input.split(/\r?\n/)) {
    const line = raw.replace(/^[\s•\-*]+/, '');
    if (line.length === 0 || line.startsWith('#')) continue;

    const match = LINE.exec(line);
    if (!match) continue;

    const key = match[1]!;
    const value = unquote(match[2]!.trim());
    if (value.length === 0) continue;

    // Last one wins, which is what a .env file itself does.
    if (seen.has(key)) {
      const index = entries.findIndex((entry) => entry.key === key);
      entries[index] = { key, value };
    } else {
      seen.add(key);
      entries.push({ key, value });
    }
  }

  return entries;
}

function unquote(value: string): string {
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
  if (quoted) return quoted[2]!;

  /*
   * An unquoted value ends at a comment, but only one introduced by whitespace:
   * `sk-abc#def` is a key containing a hash, not a key followed by a comment,
   * and truncating it would store a credential that silently never works.
   */
  const comment = value.search(/\s+#/);
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}

/**
 * Routes parsed entries to the fields that want them.
 *
 * Returns the unrecognised keys as well: an operator who pasted their whole
 * .env should be told which lines went nowhere, rather than left assuming all
 * of it landed.
 */
export function routeEnvEntries<TRoute extends { envVar: string }>(
  entries: EnvEntry[],
  routes: readonly TRoute[],
): { matched: { route: TRoute; value: string }[]; unmatched: string[] } {
  const byVar = new Map(routes.map((route) => [route.envVar, route]));
  const matched: { route: TRoute; value: string }[] = [];
  const unmatched: string[] = [];

  for (const entry of entries) {
    const route = byVar.get(entry.key);
    if (route) matched.push({ route, value: entry.value });
    else unmatched.push(entry.key);
  }

  return { matched, unmatched };
}
