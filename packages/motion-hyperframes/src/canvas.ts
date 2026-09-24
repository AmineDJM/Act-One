import { ASPECT_DIMENSIONS, dimensionsFor, type AspectRatio, type RenderQuality } from '@act-one/core';

export type Canvas = { aspect: AspectRatio; width: number; height: number };

/**
 * Every scene is written for the HD frame of its aspect.
 *
 * One size, whatever the render quality, so a scene written for the animatic
 * is byte for byte the scene in the master: the preview is the master scaled
 * down, and 4K is the master drawn at twice the pixel density. Writing a scene
 * per quality would let the agent make a different film for each.
 */
export function authoringCanvas(aspect: AspectRatio): Canvas {
  const { width, height } = ASPECT_DIMENSIONS[aspect];
  return { aspect, width, height };
}

/**
 * How a quality is reached from the authoring canvas.
 *
 * HyperFrames draws 4K by raising the browser's pixel density over the same
 * layout, but only for the frames it has a preset for. A 4:5 frame has none,
 * so it is drawn at HD and scaled up afterwards, and says so.
 */
export type OutputPlan = {
  width: number;
  height: number;
  /** Passed to `hyperframes render --resolution`, or null to render at the canvas size. */
  resolutionPreset: string | null;
  /** Set when the rendered file must be scaled to reach the requested size. */
  scaleTo: { width: number; height: number } | null;
  /** Human-readable reason when the requested quality is reached by scaling rather than drawn. */
  note: string | null;
};

const FOUR_K_PRESETS: Partial<Record<AspectRatio, string>> = {
  '16:9': 'landscape-4k',
  '9:16': 'portrait-4k',
  '1:1': 'square-4k',
};

export function outputPlan(aspect: AspectRatio, quality: RenderQuality): OutputPlan {
  const target = dimensionsFor(aspect, quality);
  if (quality === 'hd') {
    return { ...target, resolutionPreset: null, scaleTo: null, note: null };
  }
  if (quality === 'preview') {
    return { ...target, resolutionPreset: null, scaleTo: target, note: null };
  }
  const preset = FOUR_K_PRESETS[aspect] ?? null;
  if (preset) return { ...target, resolutionPreset: preset, scaleTo: null, note: null };
  return {
    ...target,
    resolutionPreset: null,
    scaleTo: target,
    note: `HyperFrames has no 4K preset for ${aspect}; drawn at HD and scaled to ${target.width}×${target.height}.`,
  };
}
