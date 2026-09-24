import type { AspectRatio, CameraRecipe, EasingName, Handover, MotionRecipeName, VisualType } from '@act-one/core';
import type { StagedAsset } from './assets.ts';
import type { ProductWindowBox } from './studio.ts';
import type { Typeset } from './typeset.ts';

/**
 * One scene, as the agent that writes it is told about it.
 *
 * Everything a Remotion scene component receives, in a form that survives
 * JSON: the storyboard's words and recipe, the camera, the capture's planned
 * framings, the files it may place, and the timing of the window it is
 * mounted for. Nothing here is a URL; a scene refers to files by their path in
 * the render project, and only to the ones listed.
 */
export type ScenePacket = {
  /** Composition id and file stem, `scene-01`. Also the key the scene's timeline is registered under. */
  frameId: string;
  sceneId: string;
  index: number;
  sceneCount: number;
  canvas: { aspect: AspectRatio; width: number; height: number };
  timing: SceneTiming;
  purpose: string;
  /** The only words the scene may set in type. */
  onScreenText: string[];
  /**
   * Those words as the studio's layout engine set them for this recipe: the
   * lines, the size each role came down to, the width they were broken at.
   * Null where the recipe sets no type (a product shot, a logo).
   */
  typeset: Typeset | null;
  /** What the voice says during this beat. A timing reference, never on screen. */
  narration: string;
  visualType: VisualType;
  recipe: {
    name: MotionRecipeName;
    easing: EasingName;
    delaySeconds: number;
    staggerSeconds: number;
    intensity: number;
    params: Record<string, string | number | boolean>;
  };
  camera: CameraRecipe;
  /** The capture's planned framings, when production filmed it; layer sources given as project paths. */
  uiSequence: unknown | null;
  /** The files this scene may place, in the storyboard's order. */
  assets: StagedAsset[];
  /** The first clip among them, when the scene plays one. */
  clip: StagedAsset | null;
  /**
   * Where the capture's surface stands when the scene is a product shot, as
   * the Remotion engine stages it: its box in pixels and its bar's height.
   * Null for every other kind of scene.
   */
  productWindow: ProductWindowBox | null;
  brand: {
    name: string;
    logo: StagedAsset | null;
    /** The company's own address, for an end card. */
    cta: string;
    /** One clause about the product, for an end card with no line of its own. */
    tagline: string;
  };
  /** True for the last scene, the only one allowed to leave the frame on its own. */
  isFinalScene: boolean;
};

/**
 * When things happen, in seconds from the moment the scene is mounted.
 *
 * A scene is mounted early when it arrives through a join and held late when
 * it leaves through one; the join itself is applied to the whole scene by the
 * film, not by the scene. Inside that window, the editorial beat — the time
 * the storyboard gave it — starts at `beatStart` and lasts `beatDuration`.
 */
export type SceneTiming = {
  mountedSeconds: number;
  beatStart: number;
  beatDuration: number;
  arrives: { through: Handover; seconds: number } | null;
  leaves: { through: Handover; seconds: number } | null;
};

export type SceneSource = 'agent' | 'cache' | 'fallback';

export type SceneFinding = { code: string; severity: 'error' | 'warning'; message: string };

/** What happened to one scene between its packet and the film. */
export type SceneReport = {
  frameId: string;
  sceneId: string;
  source: SceneSource;
  attempts: number;
  costUsd: number;
  /** What the checks found on the version that went into the film. */
  findings: SceneFinding[];
  /** Why the scene fell back to the engine's own safe composition, when it did. */
  fallbackReason: string | null;
};

/**
 * Where written scenes are kept between renders.
 *
 * The agent does not write the same scene twice for the same packet. The
 * animatic's scenes are the master's scenes: a director who approved a cut
 * has approved those compositions, and writing them again for the master
 * would hand the customer a film nobody watched.
 */
export interface AuthoredSceneStore {
  get(key: string): Promise<string | null>;
  put(key: string, html: string): Promise<void>;
}
