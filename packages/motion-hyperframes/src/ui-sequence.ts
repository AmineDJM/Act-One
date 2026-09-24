import type { MotionRecipeName } from '@act-one/core';

/**
 * A capture filmed as its planned sequence of framings: the Remotion `UiCinema`.
 *
 * Shared by the packet builder, which sets the scene's words for it, and by
 * the engine's own composition, which films it; both must agree on which
 * scenes are filmed and on what a usable plan is.
 */
/** The recipes the Remotion engine films as a sequence of framings when production planned one. */
export const FILMED_RECIPES: ReadonlySet<MotionRecipeName> = new Set<MotionRecipeName>([
  'product_window', 'product_sequence', 'floating_ui', 'feature_stack', 'product_zoom',
]);

export type Rect = { x: number; y: number; width: number; height: number };
export type Framing = {
  move: string;
  from: Rect;
  to: Rect;
  seconds: number;
  cut: boolean;
  lift: Rect | null;
  words: 'none' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  layers: { role: string; motion: string; delaySeconds: number; durationSeconds: number }[];
};
export type FilmedSequence = { sourceWidth: number; sourceHeight: number; background: { r: number; g: number; b: number }; framings: Framing[] };

/** The planned sequence, read defensively: the brief carries it as data, and a malformed one is not filmed. */
export function filmedSequence(value: unknown): FilmedSequence | null {
  const sequence = value as Partial<FilmedSequence> | null;
  if (!sequence || !Array.isArray(sequence.framings) || sequence.framings.length === 0) return null;
  const finite = (...numbers: unknown[]) => numbers.every((number) => typeof number === 'number' && Number.isFinite(number));
  const rect = (candidate: unknown): candidate is Rect => {
    const r = candidate as Rect | null;
    return Boolean(r) && finite(r!.x, r!.y, r!.width, r!.height) && r!.width > 0 && r!.height > 0;
  };
  if (!finite(sequence.sourceWidth, sequence.sourceHeight) || !sequence.background || !finite(sequence.background.r, sequence.background.g, sequence.background.b)) return null;
  const framings = sequence.framings.filter((framing) => rect(framing.from) && rect(framing.to) && finite(framing.seconds) && framing.seconds > 0);
  if (framings.length === 0) return null;
  return {
    sourceWidth: sequence.sourceWidth!,
    sourceHeight: sequence.sourceHeight!,
    background: { r: channel(sequence.background.r), g: channel(sequence.background.g), b: channel(sequence.background.b) },
    framings: framings.map((framing) => ({
      move: String(framing.move ?? 'settle'),
      from: framing.from,
      to: framing.to,
      seconds: framing.seconds,
      cut: framing.cut !== false,
      lift: rect(framing.lift) ? framing.lift : null,
      words: (['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const).find((corner) => corner === framing.words) ?? 'none',
      layers: Array.isArray(framing.layers) ? framing.layers.map((layer) => ({ role: String(layer.role), motion: String(layer.motion), delaySeconds: Number(layer.delaySeconds) || 0, durationSeconds: Number(layer.durationSeconds) || 0.8 })) : [],
    })),
  };
}

function channel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
