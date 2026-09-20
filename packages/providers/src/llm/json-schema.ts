import { z } from 'zod';

/**
 * Zod schema to an OpenAI strict JSON schema.
 *
 * Repair loops are a workaround, not a solution. Across live runs the model
 * omitted a required field, returned an enum value we never listed, and
 * produced prose around the JSON — each time costing an expensive pipeline
 * stage that had already done its thinking. Structured outputs make those
 * failures impossible at the API level rather than recoverable after the fact.
 *
 * Two transformations are needed, and both are consequences of how strict mode
 * works rather than preferences:
 *
 *  1. Every property must appear in `required`. Strict mode has no notion of
 *     an optional field. This is fine and arguably better — a field the model
 *     must fill in cannot be silently omitted, and zod's own defaults still
 *     apply on every non-model code path.
 *
 *  2. Validation keywords must be stripped. Strict mode rejects minLength,
 *     maximum, pattern, format and friends outright. The schema therefore
 *     guarantees SHAPE, and zod still validates CONTENT after parsing — which
 *     is the division of labour we want anyway, since only zod can express
 *     "this is a hex colour" or "clamp this to 0..1".
 *
 *     But a stripped constraint is a rule the model cannot see and is then
 *     judged against, which is not a division of labour, it is a trap. A
 *     research pass that had already crawled a whole site was thrown away
 *     because the model wrote 214 characters into a field limited to 200 —
 *     a limit that had been deleted from the schema before it ever saw it.
 *     So the constraints are not discarded: they are folded into the field's
 *     `description`, which strict mode does allow, and the model is told in
 *     words what it is not allowed to be told in keywords.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  'minLength', 'maxLength', 'pattern', 'format',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minItems', 'maxItems', 'uniqueItems',
  'minProperties', 'maxProperties',
  'default', 'examples', 'const', 'contentEncoding', 'contentMediaType',
]);

export type StrictSchema = { name: string; schema: Record<string, unknown> };

export function toStrictJsonSchema<T>(
  schema: z.ZodType<T>,
  name: string,
): StrictSchema | null {
  try {
    // `io: 'input'` describes what the model should SEND, which is what we are
    // constraining — the output type has defaults already applied.
    const raw = z.toJSONSchema(schema, {
      io: 'input',
      unrepresentable: 'any',
      cycles: 'ref',
    }) as Record<string, unknown>;

    const strict = harden(raw);
    // A name OpenAI will accept: letters, digits, underscores and dashes.
    return { name: name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), schema: strict };
  } catch {
    // A schema we cannot express — a transform, a union of unions — falls back
    // to plain JSON mode plus the repair loop, which still works.
    return null;
  }
}

function harden(node: unknown): Record<string, unknown> {
  if (Array.isArray(node)) {
    return node.map((item) => harden(item)) as unknown as Record<string, unknown>;
  }
  if (typeof node !== 'object' || node === null) {
    return node as Record<string, unknown>;
  }

  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const stripped: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) {
      const said = describeConstraint(key, value);
      if (said) stripped.push(said);
      continue;
    }
    out[key] =
      value !== null && typeof value === 'object' ? harden(value) : value;
  }

  /*
   * What was taken out, said in words.
   *
   * `description` is one of the few annotations strict mode keeps, so a limit
   * the schema may not carry can still reach the model. Appended rather than
   * replacing, because the field's own description is usually the more useful
   * half of the sentence.
   */
  if (stripped.length > 0) {
    const existing = typeof out['description'] === 'string' ? `${out['description']} ` : '';
    out['description'] = `${existing}(${stripped.join('; ')})`;
  }

  if (out['type'] === 'object' || out['properties']) {
    const properties = (out['properties'] as Record<string, unknown>) ?? {};
    out['additionalProperties'] = false;
    // Every property, not just the ones zod marked required.
    out['required'] = Object.keys(properties);
  }

  return out;
}

/**
 * One stripped keyword, as an instruction a model can act on.
 *
 * Only the ones worth the tokens: a length limit is broken constantly and a
 * `multipleOf` never is. Anything not listed here is dropped silently, as it
 * always was.
 */
function describeConstraint(key: string, value: unknown): string | null {
  if (typeof value === 'number') {
    switch (key) {
      case 'maxLength':
        return `at most ${value} characters`;
      case 'minLength':
        return value > 1 ? `at least ${value} characters` : null;
      case 'maxItems':
        return `at most ${value} items`;
      case 'minItems':
        return value > 0 ? `at least ${value} items` : null;
      case 'maximum':
        return `no greater than ${value}`;
      case 'minimum':
        return `no less than ${value}`;
      default:
        return null;
    }
  }
  if (key === 'pattern' && typeof value === 'string') return `matching ${value}`;
  return null;
}

/**
 * Whether a schema can be expressed strictly at all.
 *
 * Schemas built from `.transform()` produce input types the converter cannot
 * describe; those keep the JSON-mode path rather than failing.
 */
export function supportsStrictMode<T>(schema: z.ZodType<T>): boolean {
  return toStrictJsonSchema(schema, 'probe') !== null;
}
