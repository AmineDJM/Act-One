import {
  dimensionsFor,
  storyboardDuration,
  type AspectRatio,
  type BrandSystem,
  type CaptionCue,
  type RenderQuality,
  type Storyboard,
} from '@act-one/core';

/**
 * The parts of the film package that carry no JSX.
 *
 * This file exists so that importing `@act-one/motion` from a plain Node
 * process does not drag React components in behind it. The worker needs
 * `bundleFilm` and nothing else; when the package entry re-exported `Film.tsx`,
 * `node --experimental-strip-types` refused to load the worker at all —
 * stripping handles `.ts`, not `.tsx`. The components stay behind the `./entry`
 * subpath, which only Remotion's bundler ever resolves, and webpack compiles
 * JSX perfectly well.
 */
export type FilmProps = {
  storyboard: Storyboard;
  brand: BrandSystem;
  /** Asset id -> resolvable URL. Provided by the render worker. */
  assetUrls: Record<string, string>;
  typeScale?: { displayRatio: number; bodyRatio: number; tracking: number; lineHeight: number };
  theme?: 'dark' | 'light' | 'auto';
  watermarkLabel?: string | null;
  cta?: string;
  tagline?: string;
  /**
   * Captions burned into the picture.
   *
   * Passed only for the cuts whose format asks for them — a vertical ad
   * watched muted in a feed. Every render also ships the same cues as a
   * sidecar track, which is the copy a viewer can turn off.
   */
  captions?: CaptionCue[];
  /**
   * Which of the assets are moving footage rather than stills.
   *
   * The renderer cannot tell from a signed URL, and playing a still or showing
   * a clip both produce an empty frame. Told explicitly, it can fall back
   * correctly when a generated shot did not arrive.
   */
  footageAssetIds?: string[];
};

export function filmDurationInFrames(storyboard: Storyboard, fps: number): number {
  return Math.max(1, Math.round(storyboardDuration(storyboard) * fps));
}

/** One composition per aspect ratio; the film itself arrives as input props. */
export function compositionId(aspect: AspectRatio): string {
  return `film-${aspect.replace(':', 'x')}`;
}

export function dimensionsForRender(aspect: AspectRatio, quality: RenderQuality) {
  return dimensionsFor(aspect, quality);
}

/**
 * The scene-graph composition, one per aspect.
 *
 * Separate from the storyboard compositions rather than replacing them: a film
 * arrives either as a storyboard of named recipes or as a list of graphs, and
 * the renderer picks the door by which id it selects.
 */
export function sceneCompositionId(aspect: AspectRatio): string {
  return `ActOneScenes-${aspect.replace(':', 'x')}`;
}

export function scenesDurationInFrames(
  scenes: readonly { durationSeconds: number }[],
  fps: number,
): number {
  const seconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  return Math.max(1, Math.round(seconds * fps));
}
