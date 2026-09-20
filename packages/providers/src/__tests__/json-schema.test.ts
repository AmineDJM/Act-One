import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toStrictJsonSchema, supportsStrictMode } from '../index.ts';

describe('toStrictJsonSchema', () => {
  it('marks every property required, so a field cannot be omitted', () => {
    // The failure this exists to prevent: the model omitted `hook` and an
    // expensive stage that had already done its thinking was thrown away.
    const schema = z.object({
      name: z.string(),
      hook: z.string(),
      notes: z.string().optional(),
      count: z.number().default(3),
    });

    const strict = toStrictJsonSchema(schema, 'Concept')!;
    expect(strict.schema['required']).toEqual(['name', 'hook', 'notes', 'count']);
    expect(strict.schema['additionalProperties']).toBe(false);
  });

  it('strips the validation keywords strict mode rejects', () => {
    const schema = z.object({
      title: z.string().min(1).max(80),
      score: z.number().min(0).max(1),
      items: z.array(z.string()).min(1).max(5),
    });

    const json = JSON.stringify(toStrictJsonSchema(schema, 'X')!.schema);
    for (const keyword of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']) {
      expect(json, keyword).not.toContain(keyword);
    }
    // Shape survives; zod still validates content after parsing.
    expect(json).toContain('"type":"string"');
    expect(json).toContain('"type":"array"');
  });

  it('keeps enums, which are the constraint that matters most', () => {
    const schema = z.object({ channel: z.enum(['homepage_hero', 'linkedin']) });
    const json = JSON.stringify(toStrictJsonSchema(schema, 'X')!.schema);
    expect(json).toContain('homepage_hero');
    expect(json).toContain('linkedin');
  });

  it('hardens nested objects and arrays of objects', () => {
    const schema = z.object({
      scenes: z.array(z.object({ purpose: z.string(), duration: z.number().optional() })),
    });
    const strict = toStrictJsonSchema(schema, 'Storyboard')!;
    const items = (strict.schema['properties'] as Record<string, Record<string, unknown>>)['scenes']![
      'items'
    ] as Record<string, unknown>;

    expect(items['additionalProperties']).toBe(false);
    expect(items['required']).toEqual(['purpose', 'duration']);
  });

  it('sanitises the schema name to what the API accepts', () => {
    expect(toStrictJsonSchema(z.object({ a: z.string() }), 'Product Understanding!')!.name).toBe(
      'Product_Understanding_',
    );
  });

  it('falls back rather than throwing on a schema it cannot express', () => {
    // Transforms describe an input the converter cannot fully represent; those
    // keep the JSON-mode path and the repair loop.
    const transformed = z.object({
      score: z.number().transform((n) => n / 100),
    });
    const result = toStrictJsonSchema(transformed, 'X');
    expect(result === null || typeof result.schema === 'object').toBe(true);
  });

  it('reports whether a schema can be constrained at all', () => {
    expect(supportsStrictMode(z.object({ a: z.string() }))).toBe(true);
  });
});

/**
 * A constraint the model cannot see is a trap, not a division of labour.
 *
 * Strict mode rejects `maxLength`, so it is stripped — and then zod judged the
 * answer against it anyway. A research pass that had already crawled a whole
 * site was discarded because the model wrote 214 characters into a field
 * limited to 200, a limit deleted from the schema before it ever saw it.
 */
describe('stripped constraints are still said out loud', () => {
  it('tells the model a length limit it is not allowed to be told in keywords', () => {
    const strict = toStrictJsonSchema(
      z.object({ tone: z.string().min(1).max(200) }),
      'x',
    );
    const tone = (strict!.schema['properties'] as Record<string, { description?: string; maxLength?: number }>)['tone']!;
    // The keyword is gone, because strict mode refuses it...
    expect(tone.maxLength).toBeUndefined();
    // ...and the rule survives in the one annotation strict mode keeps.
    expect(tone.description).toContain('at most 200 characters');
  });

  it('keeps the field’s own description and adds to it', () => {
    const strict = toStrictJsonSchema(
      z.object({ hook: z.string().max(80).describe('The first three seconds.') }),
      'x',
    );
    const hook = (strict!.schema['properties'] as Record<string, { description?: string }>)['hook']!;
    expect(hook.description).toBe('The first three seconds. (at most 80 characters)');
  });

  it('says how many items an array may hold', () => {
    const strict = toStrictJsonSchema(z.object({ beats: z.array(z.string()).min(3).max(5) }), 'x');
    const beats = (strict!.schema['properties'] as Record<string, { description?: string }>)['beats']!;
    expect(beats.description).toContain('at least 3 items');
    expect(beats.description).toContain('at most 5 items');
  });

  it('stays quiet about constraints a model never breaks', () => {
    // A minimum of one character is what "a string" already means.
    const strict = toStrictJsonSchema(z.object({ name: z.string().min(1) }), 'x');
    const name = (strict!.schema['properties'] as Record<string, { description?: string }>)['name']!;
    expect(name.description).toBeUndefined();
  });
});
