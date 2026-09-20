import { releasable, type Asset, type Render } from '@act-one/core';
import type { Store } from '@act-one/db';

/**
 * Whether these bytes may leave as a finished film.
 *
 * One question, answered in one place, on the server. The project page, the
 * download route, Collections and the campaign stage each used to decide it
 * for themselves, and they disagreed: the page offered "Download the master"
 * for anything that had produced bytes, including a cut the quality gate had
 * held back and marked `needs_attention`. A customer downloaded one, opened
 * thirty seconds of type on a black field in silence, and had no way of
 * knowing that Act One's own checks agreed with them.
 *
 * A master that has not passed both gates still exists and is still watchable
 * in the app — the customer should see what was made, and hiding it would be
 * a second way of not telling them. What it may not do is arrive on their
 * disk, or in a gallery, under the name "master".
 */
export async function releaseCheck(
  store: Store,
  organizationId: string,
  asset: Pick<Asset, 'id' | 'kind' | 'projectId'>,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (asset.kind !== 'master_video') return { allowed: true };
  if (!asset.projectId) return { allowed: true };

  const renders = await store.renders.listForProject(organizationId, asset.projectId);
  const owner = renders.find((render) => render.masterAssetId === asset.id);
  /*
   * No render owns these bytes. That is an asset from before renders recorded
   * their master, or one uploaded by hand; refusing it would break a download
   * that has always worked, and there is nothing here to check against.
   */
  if (!owner) return { allowed: true };

  if (releasable(owner)) return { allowed: true };
  return { allowed: false, reason: holdReason(owner) };
}

/** Why this film is being held, in the words of whichever gate held it. */
function holdReason(render: Render): string {
  if (render.creativeVerdict === 'block') {
    return render.creativeReason || 'The creative review stopped this film.';
  }
  if (render.creativeVerdict === 'revise') {
    return render.creativeReason || 'The creative review sent this film back.';
  }
  if (render.status !== 'completed') {
    return render.error || 'This film has not finished its quality checks.';
  }
  return render.error || 'This film has not passed both quality gates.';
}
