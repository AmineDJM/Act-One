import { describe, it, expect } from 'vitest';

/**
 * What a green tick in the console is allowed to mean.
 *
 * It said "configured" whenever a credential row existed, whether or not that
 * credential was switched on — while the worker, which requires it to be
 * switched on, read nothing and fell back to the local browser. A real
 * deployment showed Browserbase green with the sentence "Research runs on
 * isolated cloud browsers", and its worker reported Browserbase as not
 * configured at the same moment. The operator had been told a security
 * property their films did not have.
 *
 * The rule: the console may only call something configured if a job would
 * actually pick it up. "Stored but off" is a third state, and a different
 * thing to go and fix than "missing".
 */
type Row = { enabled: boolean } | undefined;

/** The computation from `listProviderState`, stated once so it can be tested. */
function state(row: Row, fromEnv: boolean) {
  const enabled = row?.enabled ?? fromEnv;
  return { configured: (Boolean(row) && enabled) || fromEnv, stored: Boolean(row), enabled };
}

describe('when the console may show a provider as ready', () => {
  it('is ready when a key is stored and switched on', () => {
    expect(state({ enabled: true }, false)).toMatchObject({ configured: true, stored: true });
  });

  it('is NOT ready when a key is stored and switched off', () => {
    // The exact case from production: green in the console, absent in the worker.
    expect(state({ enabled: false }, false)).toMatchObject({ configured: false, stored: true });
  });

  it('is not ready when nothing is stored at all', () => {
    expect(state(undefined, false)).toMatchObject({ configured: false, stored: false });
  });

  it('is ready from the environment when the console has no row', () => {
    expect(state(undefined, true)).toMatchObject({ configured: true, stored: false, enabled: true });
  });

  it('separates "switched off" from "missing", because they are different things to fix', () => {
    const off = state({ enabled: false }, false);
    const missing = state(undefined, false);
    expect(off.configured).toBe(missing.configured);
    // Same verdict, different remedy: one is a toggle, the other is a key.
    expect(off.stored).not.toBe(missing.stored);
  });
});
