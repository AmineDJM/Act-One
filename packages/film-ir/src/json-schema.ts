import { z } from 'zod';
import { FILM_IR_SCHEMA, FILM_IR_VERSION, FilmIR } from './schema/document.ts';

/**
 * The JSON Schema of FilmIR, generated from the Zod schema so the two can
 * never disagree. What an executor in another language validates against.
 *
 * The integrity rules that JSON Schema cannot state — references that must
 * resolve, times that must be monotonic, evidence that must match the mode —
 * live in the validator, and a document is only trusted once both have run.
 */
export function filmIrJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(FilmIR, { target: 'draft-2020-12', unrepresentable: 'any' }) as Record<string, unknown>;
  return {
    ...schema,
    $id: `https://act-one.dev/schemas/${FILM_IR_SCHEMA}/${FILM_IR_VERSION}.json`,
    title: `${FILM_IR_SCHEMA} ${FILM_IR_VERSION}`,
  };
}
