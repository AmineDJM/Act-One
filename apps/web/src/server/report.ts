import 'server-only';
import { AppError, toAppError, type LogSource } from '@act-one/core';
import { getStore } from './store.ts';

/**
 * Server-side error reporting.
 *
 * A customer sees "Something went wrong on our side." and that is correct —
 * internal failure messages leak implementation detail. But it is only correct
 * if the operator can see what actually happened, otherwise every 500 is
 * unreproducible. So: expected failures (a taken email, a missing entitlement)
 * stay quiet, and anything unexpected is written to the operational log with
 * its whole cause chain, where the Super Admin console can read it.
 */
export function reportError(
  where: string,
  error: unknown,
  context: { organizationId?: string | null; projectId?: string | null; userId?: string | null; source?: LogSource } = {},
): AppError {
  const app = toAppError(error);
  if (app.status < 500) return app;

  const chain: string[] = [];
  let cause: unknown = app;
  for (let depth = 0; cause instanceof Error && depth < 5; depth += 1) {
    chain.push(`${cause.name}: ${cause.message}`);
    cause = cause.cause;
  }

  const summary = chain.join(' <- ');
  console.error(`[act-one] ${where} failed (${app.code}): ${summary}`);
  const stack = deepestStack(app);
  if (stack) console.error(stack);

  // Never let reporting a failure become a second failure: the store is a
  // plausible cause of the first one.
  try {
    getStore().log.recordSafely({
      level: 'error',
      source: context.source ?? 'web',
      event: `${where}.failed`,
      message: app.message,
      organizationId: context.organizationId ?? null,
      projectId: context.projectId ?? null,
      jobId: null,
      actorUserId: context.userId ?? null,
      durationMs: null,
      detail: { code: app.code, status: app.status, causes: chain, stack: stack ?? null },
    });
  } catch {
    /* ignore */
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
