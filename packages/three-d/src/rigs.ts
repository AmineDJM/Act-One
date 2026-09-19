import { z } from 'zod';

/**
 * Blender rigs.
 *
 * The security posture here is the whole design. A model never writes Blender
 * Python — it chooses a rig by name and fills in validated numbers. The script
 * is assembled from a fixed template by code that only ever interpolates
 * values which have already passed a schema.
 *
 * Blender's Python API can read and write files, spawn processes and reach the
 * network. "Let the model write a short script and run it" is remote code
 * execution with extra steps, and no amount of prompt instruction closes that.
 *
 * The rigs themselves are a small, opinionated set. Each one is a way of
 * presenting software as a physical object, and each has been chosen because
 * it survives at 4K without looking like a stock mockup.
 */
export const RigName = z.enum([
  'floating_ui',        // planes of interface held in space, gently drifting
  'screen_tunnel',      // the camera travels through a corridor of screens
  'layered_depth',      // one interface separated into its own z-layers
  'card_stack',         // interface panels as physical cards, fanning
  'logo_extrusion',     // the mark given depth and lit
  'browser_float',      // a browser window as an object, off-axis
  'device_laptop',      // interface on a laptop, shot like product photography
  'device_phone',       // vertical interface on a handset
  'glass_planes',       // frosted planes with the interface behind them
  'spatial_transition', // a move between two arrangements, used as a cut
  /*
   * The two rigs that hold no interface at all.
   *
   * Every rig above stages a screen. A film that is not allowed to show a
   * screen — a pitch — still wants the texture that three dimensions give it:
   * real light falling on a real surface, a lens with a real depth of field,
   * an object that turns. Without these, `cinematic_3d` in such a film was a
   * scene Blender rendered as an empty void, because the geometry was built
   * from the screens and there were none.
   */
  'material_monolith',  // one bevelled form, lit and turning. Weight and edge.
  'material_field',     // a landscape of extruded forms, shot long
]);
export type RigName = z.infer<typeof RigName>;

export const CameraMove = z.enum(['slow_push', 'slow_pull', 'orbit_left', 'orbit_right', 'rise', 'static']);
export const LightingPreset = z.enum(['studio_soft', 'single_key', 'rim_dark', 'daylight', 'product_table']);
export const BackgroundKind = z.enum(['solid', 'gradient_subtle', 'void', 'reflective_floor']);

/**
 * A 3D scene request.
 *
 * Every field is bounded. The bounds are not arbitrary: they are the range
 * within which each rig has been checked to render without clipping the frame,
 * inverting the camera or producing a shot that reads as a template mockup.
 */
export const ThreeDScene = z.object({
  rig: RigName,
  camera: CameraMove.default('slow_push'),
  /** Storage paths for the interface images mapped onto the rig's screens. */
  screenAssets: z.array(z.string().max(512)).min(0).max(6).default([]),
  /** Separation between planes, in scene units. */
  depth: z.number().min(0).max(4).default(1.2),
  lighting: LightingPreset.default('studio_soft'),
  background: BackgroundKind.default('void'),
  /** Hex, applied to the background and the floor tint. */
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#08080c'),
  /** Accent used for rim light and edge highlights. */
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2f6fed'),
  durationSeconds: z.number().min(0.5).max(20).default(4),
  fps: z.number().int().min(24).max(60).default(30),
  width: z.number().int().min(480).max(3840).default(1920),
  height: z.number().int().min(480).max(3840).default(1080),
  /** Field of view in degrees. Wide reads as a game engine, long as product photography. */
  focalLengthMm: z.number().min(24).max(135).default(50),
  /** 0 keeps everything sharp; higher isolates the hero plane. */
  depthOfField: z.number().min(0).max(1).default(0.25),
  /** Cycles samples. Quality against render time. */
  samples: z.number().int().min(16).max(512).default(96),
});
export type ThreeDScene = z.infer<typeof ThreeDScene>;

export type RigDefinition = {
  name: RigName;
  /** What this rig is for, in a sentence a director would say. */
  purpose: string;
  /** How many screens the rig can hold. */
  screenCapacity: number;
  /** Camera moves that suit it. Others are allowed but will look wrong. */
  suitedMoves: z.infer<typeof CameraMove>[];
  defaultLighting: z.infer<typeof LightingPreset>;
  /** Roughly how long one second of this rig takes to render, for estimates. */
  secondsPerFrameEstimate: number;
};

export const RIGS: Record<RigName, RigDefinition> = {
  floating_ui: {
    name: 'floating_ui',
    purpose: 'Interface held in space as an object worth looking at.',
    screenCapacity: 3,
    suitedMoves: ['slow_push', 'orbit_left', 'orbit_right'],
    defaultLighting: 'studio_soft',
    secondsPerFrameEstimate: 0.9,
  },
  screen_tunnel: {
    name: 'screen_tunnel',
    purpose: 'Travelling through a corridor of screens — scale and volume.',
    screenCapacity: 6,
    suitedMoves: ['slow_push'],
    defaultLighting: 'rim_dark',
    secondsPerFrameEstimate: 1.6,
  },
  layered_depth: {
    name: 'layered_depth',
    purpose: 'One interface separated into its own layers to show structure.',
    screenCapacity: 4,
    suitedMoves: ['slow_pull', 'orbit_left'],
    defaultLighting: 'single_key',
    secondsPerFrameEstimate: 1.1,
  },
  card_stack: {
    name: 'card_stack',
    purpose: 'Panels as physical cards, fanning open.',
    screenCapacity: 5,
    suitedMoves: ['slow_push', 'rise'],
    defaultLighting: 'studio_soft',
    secondsPerFrameEstimate: 1,
  },
  logo_extrusion: {
    name: 'logo_extrusion',
    purpose: 'The mark given depth and lit, for an ending.',
    screenCapacity: 0,
    suitedMoves: ['slow_push', 'orbit_right', 'static'],
    defaultLighting: 'rim_dark',
    secondsPerFrameEstimate: 0.7,
  },
  browser_float: {
    name: 'browser_float',
    purpose: 'A browser window as an object, off-axis.',
    screenCapacity: 1,
    suitedMoves: ['slow_push', 'slow_pull'],
    defaultLighting: 'studio_soft',
    secondsPerFrameEstimate: 0.8,
  },
  device_laptop: {
    name: 'device_laptop',
    purpose: 'Interface on a laptop, shot like product photography.',
    screenCapacity: 1,
    suitedMoves: ['slow_push', 'orbit_left'],
    defaultLighting: 'product_table',
    secondsPerFrameEstimate: 1.3,
  },
  device_phone: {
    name: 'device_phone',
    purpose: 'Vertical interface on a handset.',
    screenCapacity: 1,
    suitedMoves: ['slow_push', 'rise'],
    defaultLighting: 'product_table',
    secondsPerFrameEstimate: 1.1,
  },
  glass_planes: {
    name: 'glass_planes',
    purpose: 'Frosted planes with the interface behind them.',
    screenCapacity: 3,
    suitedMoves: ['slow_push', 'orbit_right'],
    defaultLighting: 'rim_dark',
    // Refraction is expensive; worth knowing before quoting a render.
    secondsPerFrameEstimate: 2.4,
  },
  material_monolith: {
    name: 'material_monolith',
    purpose: 'One form, lit and turning. Material and edge, standing in for nothing.',
    screenCapacity: 0,
    suitedMoves: ['orbit_left', 'orbit_right', 'slow_push'],
    defaultLighting: 'rim_dark',
    secondsPerFrameEstimate: 0.7,
  },
  material_field: {
    name: 'material_field',
    purpose: 'A landscape of forms, shot long and shallow. Scale without a subject.',
    screenCapacity: 0,
    suitedMoves: ['slow_push', 'slow_pull', 'orbit_left'],
    defaultLighting: 'rim_dark',
    secondsPerFrameEstimate: 1.1,
  },
  spatial_transition: {
    name: 'spatial_transition',
    purpose: 'A move between two arrangements, used as a cut.',
    screenCapacity: 4,
    suitedMoves: ['slow_push', 'orbit_left', 'orbit_right'],
    defaultLighting: 'single_key',
    secondsPerFrameEstimate: 1.2,
  },
};

export function rigFor(name: RigName): RigDefinition {
  return RIGS[name];
}

/**
 * Estimated render time, so a storyboard can be costed before it is committed
 * to and a customer is not quoted a film that takes four hours of GPU.
 */
export function estimateRenderSeconds(scene: ThreeDScene): number {
  const rig = RIGS[scene.rig];
  const frames = scene.durationSeconds * scene.fps;
  const sampleFactor = scene.samples / 96;
  const resolutionFactor = (scene.width * scene.height) / (1920 * 1080);
  return Math.round(frames * rig.secondsPerFrameEstimate * sampleFactor * resolutionFactor);
}

/**
 * Validates a request and corrects what can be corrected.
 *
 * A model choosing a rig will over-supply screens and pick moves that do not
 * suit it. Both are recoverable — extra screens are dropped and an unsuitable
 * move is replaced — so the shot degrades toward "correct but plainer" rather
 * than failing.
 */
export function normaliseScene(input: unknown): { scene: ThreeDScene; adjustments: string[] } {
  const scene = ThreeDScene.parse(input);
  const rig = RIGS[scene.rig];
  const adjustments: string[] = [];

  let screenAssets = scene.screenAssets;
  if (screenAssets.length > rig.screenCapacity) {
    adjustments.push(
      `${scene.rig} holds ${rig.screenCapacity} screens; dropped ${screenAssets.length - rig.screenCapacity}.`,
    );
    screenAssets = screenAssets.slice(0, rig.screenCapacity);
  }

  let camera = scene.camera;
  if (!rig.suitedMoves.includes(camera)) {
    adjustments.push(`${camera} does not suit ${scene.rig}; using ${rig.suitedMoves[0]}.`);
    camera = rig.suitedMoves[0]!;
  }

  return { scene: { ...scene, screenAssets, camera }, adjustments };
}
