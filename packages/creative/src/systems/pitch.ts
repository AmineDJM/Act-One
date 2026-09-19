import type { CameraMove, FilmFormat, SoundCueType } from '@act-one/core';
import { REAL_PRODUCT_VISUAL_TYPES } from '@act-one/core';
import type { CreativeSystem, SceneArchetype } from './types.ts';

/**
 * The vocabulary a film has when it is not allowed to show the product.
 *
 * Take the product archetypes out of any of the twelve creative systems and
 * count what is left: typography, typography, and one statistic. Nine of the
 * twelve have exactly that. A pitch film built from what remains is a stack of
 * title cards at a fixed interval — the precise thing the director grades
 * `weak`, and the precise thing people mean when they say something looks
 * generated.
 *
 * So the format does not merely subtract. It substitutes a vocabulary of its
 * own, derived from each system's grammar rather than bolted on: place and
 * light, a real photograph from the customer's own archive, material turning
 * in three dimensions, several things at once. The beats a film uses when its
 * subject is an idea rather than an interface — which is most of the work
 * anybody admires.
 *
 * Derived, not written twelve times: an archetype here inherits the system's
 * pacing, its camera language and its sound behaviour, so a pitch in Cinematic
 * Black is still unmistakably Cinematic Black.
 */

/** A pitch beat, before it is fitted to a system. */
type PitchBeat = {
  id: string;
  purpose: string;
  visualType: PitchVisualType;
  /** Shot length as a multiple of the system's own average scene. */
  lengthFactor: [number, number];
  maxWords: number;
  /** Preferred camera, subject to the system having a camera language at all. */
  camera: CameraMove;
  extraSound: SoundCueType[];
};

const PITCH_BEATS: readonly PitchBeat[] = [
  {
    id: 'world',
    purpose: 'The world the thing lives in — place, light, scale. No information, only weather',
    visualType: 'generated_broll',
    lengthFactor: [0.7, 1.4],
    maxWords: 0,
    camera: 'lateral_drift',
    extraSound: ['texture'],
  },
  {
    id: 'witness',
    purpose: "Somebody's own words, held long enough to be read twice",
    visualType: 'quote',
    lengthFactor: [0.8, 1.5],
    maxWords: 18,
    camera: 'static',
    extraSound: ['silence'],
  },
  {
    id: 'photograph',
    purpose: 'One real picture from the archive: a face, a room, a thing that exists',
    visualType: 'real_media',
    lengthFactor: [0.65, 1.2],
    maxWords: 5,
    camera: 'slow_push',
    extraSound: ['texture'],
  },
  {
    id: 'form',
    purpose: 'Material and light turning in space. Form, never an interface',
    visualType: 'cinematic_3d',
    lengthFactor: [0.8, 1.5],
    maxWords: 0,
    camera: 'orbit',
    extraSound: ['sub_drop'],
  },
  {
    id: 'breadth',
    purpose: 'Several things at once — the range of it, in one frame',
    visualType: 'mixed_media',
    lengthFactor: [0.6, 1.1],
    maxWords: 6,
    camera: 'slow_pull',
    extraSound: ['whoosh'],
  },
];

/**
 * The archetypes a film of this format may use, in the order the planner sees
 * them.
 *
 * A product tour gets the system exactly as written. A pitch gets the system's
 * own non-product archetypes first — those are the ones carrying its voice —
 * and then whatever the pitch vocabulary adds that the system does not already
 * have. Nothing is invented where the system already says it.
 */
export function archetypesFor(system: CreativeSystem, format: FilmFormat): SceneArchetype[] {
  if (format !== 'pitch') return system.archetypes;

  const kept = system.archetypes.filter(
    (archetype) =>
      !archetype.requiresProductAsset && !REAL_PRODUCT_VISUAL_TYPES.includes(archetype.visualType),
  );
  const covered = new Set(kept.map((archetype) => archetype.visualType));
  const ids = new Set(kept.map((archetype) => archetype.id));

  const added = PITCH_BEATS.filter((beat) => !covered.has(beat.visualType) && !ids.has(beat.id)).map(
    (beat) => fit(beat, system),
  );

  return [...kept, ...added];
}

/** Whether a system can carry a pitch at all, which every one of them can. */
export function pitchVocabularySize(system: CreativeSystem): number {
  return archetypesFor(system, 'pitch').length;
}

/** Fits a pitch beat to one system's pacing, camera language and sound. */
function fit(beat: PitchBeat, system: CreativeSystem): SceneArchetype {
  const average = system.pacing.averageSceneSeconds;
  const [floor, ceiling] = system.pacing.sceneRange;
  const min = clamp(round1(average * beat.lengthFactor[0]), floor, ceiling);
  const max = clamp(round1(average * beat.lengthFactor[1]), min + 0.4, ceiling);

  /*
   * A system whose every archetype holds the camera still does not suddenly
   * orbit because the format changed. Restraint is a system's own decision and
   * the format has no business overruling it.
   */
  const movesTheCamera = system.archetypes.some((archetype) => archetype.camera !== 'static');
  const camera: CameraMove = movesTheCamera ? beat.camera : 'static';

  const sound: SoundCueType[] = [
    ...(system.sound.impactsOnCuts ? (['impact'] as SoundCueType[]) : []),
    ...beat.extraSound,
  ];

  return {
    id: beat.id,
    purpose: beat.purpose,
    visualType: beat.visualType,
    motion: MOTION_FOR[beat.visualType],
    camera,
    durationRange: [min, max],
    maxWords: beat.maxWords,
    requiresProductAsset: false,
    soundCues: sound.length > 0 ? sound : (['texture'] as SoundCueType[]),
  };
}

/**
 * The recipe each pitch visual type is drawn with.
 *
 * `footage` for the two types that produce moving pictures, because anything
 * else hands a rendered clip to a component that draws a still and the shot
 * that was paid for is never seen.
 */
type PitchVisualType = 'generated_broll' | 'quote' | 'real_media' | 'cinematic_3d' | 'mixed_media';

const MOTION_FOR: Record<PitchVisualType, SceneArchetype['motion']> = {
  generated_broll: 'footage',
  cinematic_3d: 'footage',
  real_media: 'photo_hold',
  quote: 'quote_hold',
  mixed_media: 'image_wall',
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
