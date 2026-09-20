import { describe, it, expect } from 'vitest';
import { releasable } from '../domain/render.ts';

/**
 * The one answer to "may this be handed over".
 *
 * Four places used to decide it separately — the project page, the download
 * route, Collections and the campaign stage — and they disagreed. The page
 * offered "Download the master" for anything that had produced bytes, which
 * included a cut this system had itself marked `needs_attention`.
 */
function render(over: Record<string, unknown> = {}) {
  return {
    kind: 'film',
    status: 'completed' as const,
    masterAssetId: 'ast_1',
    productionVerdict: 'pass' as const,
    creativeVerdict: 'pass' as const,
    ...over,
  };
}

describe('may this film be handed over', () => {
  it('hands over a film that finished and passed both gates', () => {
    expect(releasable(render())).toBe(true);
  });

  it('refuses a film with no bytes', () => {
    expect(releasable(render({ masterAssetId: null }))).toBe(false);
  });

  it('refuses a film still being worked on', () => {
    expect(releasable(render({ status: 'needs_attention' }))).toBe(false);
    expect(releasable(render({ status: 'repairing' }))).toBe(false);
  });

  it('never hands over an animatic', () => {
    // A preview is the customer looking at their own cut. It is not a deliverable.
    expect(releasable(render({ kind: 'animatic' }))).toBe(false);
  });

  it('refuses a film production QA did not pass', () => {
    expect(releasable(render({ productionVerdict: 'needs_attention' }))).toBe(false);
    expect(releasable(render({ productionVerdict: 'failed' }))).toBe(false);
  });

  it('refuses a film the creative review sent back or stopped', () => {
    expect(releasable(render({ creativeVerdict: 'revise' }))).toBe(false);
    expect(releasable(render({ creativeVerdict: 'block' }))).toBe(false);
  });

  it('hands over a film passed with concerns', () => {
    // Concerns are said out loud on the page. They are not a reason to
    // withhold a film somebody paid for.
    expect(releasable(render({ creativeVerdict: 'pass_with_concerns' }))).toBe(true);
  });

  it('does not treat a gate that never ran as a gate that failed', () => {
    /*
     * Every film made before these columns existed has null in both, and
     * back-filling them with a pass would be writing down a judgement nobody
     * made. Null means unjudged, and an unjudged film that finished cleanly
     * is still the customer's film.
     */
    expect(releasable(render({ productionVerdict: null, creativeVerdict: null }))).toBe(true);
  });
});
