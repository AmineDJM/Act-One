import {
  SIGNATURE_KINDS,
  newId,
  signatureKey,
  type CreativeSignature,
  type SignatureKind,
  type Storyboard,
} from '@act-one/core';

/**
 * What a finished film did, in the terms a director would use in an edit.
 *
 * Read off the storyboard rather than written by a model, for two reasons.
 * The obvious one is cost: this runs on every film and a model call to
 * summarise a plan we already hold is a call nobody needs. The real one is
 * that a model asked "what devices did this film use" writes a nice paragraph
 * and a slightly different one each time, which makes the memory unable to
 * recognise its own entries — and a repetition detector that cannot match two
 * descriptions of the same device detects nothing.
 *
 * So the devices are derived deterministically and coarsely. What makes work
 * feel repetitive is the mechanism, not the pixels: "opens on a held
 * typographic card", not the copy that was on it.
 */
export function signaturesOf(
  storyboard: Storyboard,
  scope: { organizationId: string; projectId: string },
): CreativeSignature[] {
  const scenes = storyboard.scenes;
  if (scenes.length === 0) return [];

  const devices: { kind: SignatureKind; device: string }[] = [];
  const first = scenes[0]!;
  const last = scenes[scenes.length - 1]!;

  devices.push({ kind: 'opening', device: describeShot(first) });
  devices.push({ kind: 'ending', device: describeShot(last) });

  /*
   * The shot vocabulary of the middle, as a set. Not every shot — a film with
   * nine typographic cards and one capture should read as "typographic cards
   * and a capture", which is what somebody watching it would say.
   */
  for (const device of new Set(scenes.slice(1, -1).map(describeShot))) {
    devices.push({ kind: 'shot_archetype', device });
  }

  const moves = new Set(
    scenes.map((scene) => scene.cameraRecipe.move).filter((move) => move !== 'static'),
  );
  if (moves.size > 0) {
    devices.push({ kind: 'camera_pattern', device: `camera ${[...moves].sort().join(' and ')}` });
  }

  const transitions = new Set(scenes.map((scene) => scene.motionRecipe.name));
  if (transitions.size === 1) {
    devices.push({ kind: 'transition', device: `one treatment throughout: ${[...transitions][0]}` });
  }

  const now = new Date().toISOString();
  return devices.map((entry) => ({
    id: newId('sig'),
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    kind: entry.kind,
    device: entry.device,
    key: signatureKey(entry.kind, entry.device),
    createdAt: now,
  }));
}

/** A shot as a device: what carried it and how it was treated. */
function describeShot(scene: Storyboard['scenes'][number]): string {
  const carried = scene.visualType.replace(/_/g, ' ');
  const treatment = scene.motionRecipe.name.replace(/_/g, ' ');
  return `${carried} shot treated as ${treatment}`;
}

/** Every kind of device the extractor above can produce. Used by the Lab. */
export const EXTRACTED_SIGNATURE_KINDS: readonly SignatureKind[] = SIGNATURE_KINDS.filter((kind) =>
  ['opening', 'ending', 'shot_archetype', 'camera_pattern', 'transition'].includes(kind),
);
