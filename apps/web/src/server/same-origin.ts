import 'server-only';
import { AppError } from '@act-one/core';

/**
 * Refuses a state-changing request a browser sent from another site.
 *
 * Session cookies are SameSite=Lax, which already keeps them off a
 * cross-site POST; this is the second lock, for any route that takes a body
 * outside a server action (which Next checks itself). A browser always names
 * the origin of a cross-origin POST, so a request that names another one is
 * refused, and one that names none is not a browser's cross-site request.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  let from: string;
  try {
    from = new URL(origin).host;
  } catch {
    throw new AppError('forbidden', 'The request came from somewhere this site does not recognise.');
  }
  if (!host || from !== host) throw new AppError('forbidden', 'The request came from another site.');
}
