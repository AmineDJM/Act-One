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
