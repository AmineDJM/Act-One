/**
 * JSON out of a model that was asked for JSON and nearly obliged.
 *
 * WHY THIS IS NOT IN THE SCRIPT THAT USES IT. It was, and it was wrong twice.
 * A critic's judgement is the only measurement this project steers by, so a
 * parser that silently loses one is not a detail of a script — and a parser
 * living inside a top-level-await script cannot be imported, which means both
 * repairs were written against a guess about what the model had said rather
 * than against the text it actually sent. It is testable here, and the two
 * replies that defeated it are in the tests.
 *
 * The repairs stay narrow. Anything beyond a stray closer and a trailing comma
 * still throws, because silently accepting arbitrary malformed output is how a
 * critic starts agreeing with you.
 */

/**
 * Drops every `}` or `]` that cannot legitimately be there, byte for byte
 * otherwise.
 *
 * TWO WAYS A CLOSER IS WRONG, and the second one cost two rounds to find.
 *
 * The obvious one is a closer with nothing open. The other is a closer that
 * ends the whole document while the document is still going: the reply that
 * broke this was `..."tell":"..."},"oneChange":"..."}`, where the stray brace
 * sits at depth 1 and closes the root perfectly legally. A walker that only
 * dropped unopened closers kept that one and dropped the real final brace
 * instead, so the text parsed as a complete object two thirds of the way
 * through with `,"oneChange"` left over — a NEW failure, at a new position,
 * pointing at the damage rather than the cause.
 *
 * Depth is tracked outside string literals only: a brace inside `"why"` text
 * is prose, not structure. The escape handling is there so that a quoted
 * backslash cannot end a string early and flip the walker into reading the
 * rest of the reply as structure.
 */
export function dropStrayClosers(body: string): string {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (escaped) { escaped = false; out += ch; continue; }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      out += ch;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      if (depth === 0) continue;
      if (depth === 1 && body.slice(i + 1).trim() !== '') continue;
      depth -= 1;
    }
    out += ch;
  }
  return out;
}

/** The object a model meant to send, or a throw naming what it sent instead. */
export function readModelJson(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
  const body = text.slice(start, end + 1);
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return JSON.parse(dropStrayClosers(body).replace(/,\s*([}\]])/g, '$1')) as Record<string, unknown>;
  }
}
