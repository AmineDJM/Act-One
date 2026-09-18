import { vi } from 'vitest';

/**
 * A request, for the server modules that expect to be inside one.
 *
 * Next.js supplies cookies() and headers() from the request being handled
 * and redirect() as a thrown control-flow signal. Under test there is no
 * request, so this is one: a cookie jar and a header bag a test can set,
 * and a redirect that throws something a test can catch. `server-only` is
 * an import-time tripwire meant for client bundles; here it is nothing.
 *
 * Registered as a setup file so every test file sees the same request scope
 * without repeating the mocks — and so a test that forgets to reset the jar
 * between users cannot leak one user's session into another's assertions
 * unnoticed: `resetRequest()` is what a suite calls between people.
 */
export type TestRequest = {
  cookies: Map<string, string>;
  headers: Map<string, string>;
};

declare global {
  // eslint-disable-next-line no-var
  var __actOneTestRequest: TestRequest | undefined;
}

export function request(): TestRequest {
  if (!globalThis.__actOneTestRequest) {
    globalThis.__actOneTestRequest = { cookies: new Map(), headers: new Map() };
  }
  return globalThis.__actOneTestRequest;
}

export function resetRequest(): void {
  globalThis.__actOneTestRequest = { cookies: new Map(), headers: new Map() };
}

export class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = request().cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      request().cookies.set(name, value);
    },
    delete: (name: string) => {
      request().cookies.delete(name);
    },
  }),
  headers: async () => ({
    get: (name: string) => request().headers.get(name.toLowerCase()) ?? null,
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));
