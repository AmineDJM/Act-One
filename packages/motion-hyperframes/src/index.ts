/*
 * The HyperFrames film engine.
 *
 * A second renderer behind the same contract as @act-one/motion's
 * `renderFilm`: the same props in, the same silent master out. Scenes are
 * written as HyperFrames compositions by an agent (or drawn by the engine
 * itself: its port of the Remotion components, or its launch look), checked,
 * assembled and rendered by the pinned HyperFrames CLI.
 */
export {
  renderFilmWithHyperFrames,
  HyperFramesRenderError,
  type FilmLook,
  type HyperFramesErrorCode,
  type HyperFramesRenderOptions,
  type HyperFramesRenderResult,
  type SceneAuthorConfig,
} from './render.ts';
export type { LaunchSoundCue } from './launch.ts';
export { DirectorySceneStore, MemorySceneStore, StorageSceneStore, sceneKey } from './scene-store.ts';
export { resolveTools, ToolingError, type HyperFramesTools, type ToolOptions } from './tools.ts';
export { normalizeScene, validateScene, type ValidationContext, type ValidationFinding } from './validate.ts';
export type { EngineFinding } from './checks.ts';
export type { AuthoredSceneStore, ScenePacket, SceneReport, SceneSource } from './types.ts';
export { ENGINE_NAME, ENGINE_VERSION, SCENE_CONTRACT_VERSION } from './version.ts';
