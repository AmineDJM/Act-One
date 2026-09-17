import 'server-only';
import { AppError, toAppError } from '@act-one/core';

/**
 * Server-side error reporting.
 *
 * A customer sees "Something went wrong on our side." and that is correct —
 * internal failure messages leak implementation detail. But it is only correct
 * if the operator can see what actually happened, otherwise every 500 is
 * unreproducible. So: expected failures (a taken email, a missing entitlement)
 * stay quiet, and anything unexpected is logged with its whole cause chain.
 */
export function reportError(where: string, error: unknown): AppError {
  const app = toAppError(error);

  if (app.status >= 500) {
    const chain: string[] = [];
    let cause: unknown = app;
    for (let depth = 0; cause instanceof Error && depth < 5; depth += 1) {
      chain.push(`${cause.name}: ${cause.message}`);
      cause = cause.cause;
    }
    const deepest = deepestStack(app);
    console.error(`[act-one] ${where} failed (${app.code}): ${chain.join(' <- ')}`);
    if (deepest) console.error(deepest);
  }

  return app;
}

function deepestStack(error: Error): string | undefined {
  let current: Error = error;
  for (let depth = 0; depth < 5; depth += 1) {
    const next = current.cause;
    if (!(next instanceof Error)) break;
    current = next;
  }
  return current.stack;
}
