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

/** A part of the interface that moves on its own: the Remotion `UiLayer`, with its capture named by path. */
export type FilmedLayer = {
  role: string;
  motion: string;
  rect: Rect;
  depth: number;
  delaySeconds: number;
  durationSeconds: number;
  from: string;
  knockout: boolean;
  /** Another capture's project path; null for the shot's own capture. */
  source: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
};

export type Framing = {
  move: string;
  from: Rect;
  to: Rect;
  seconds: number;
  cut: boolean;
  lift: Rect | null;
  words: 'none' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  layers: FilmedLayer[];
  space: 'flat' | 'volume';
  wordsBehind: boolean;
};
export type FilmedSequence = { sourceWidth: number; sourceHeight: number; background: { r: number; g: number; b: number }; framings: Framing[] };

/** What a staged file's path looks like; anything else named as a layer's capture is not placed. */
const STAGED_PATH = /^assets\/[A-Za-z0-9._-]+$/;

/*
 * The names a layer can carry, as the storyboard schema defines them. They end
 * up in the scene's script, so a value outside them is read as the quietest
 * name rather than written anywhere.
 */
const LAYER_ROLES = ['shell', 'panel', 'overlay', 'control', 'navigation'] as const;
const LAYER_MOTIONS = ['hold', 'recede', 'advance', 'emerge', 'parallax', 'press'] as const;
const LAYER_EDGES = ['below', 'above', 'left', 'right', 'behind'] as const;

/** The planned sequence, read defensively: the brief carries it as data, and a malformed one is not filmed. */
export function filmedSequence(value: unknown): FilmedSequence | null {
  const sequence = value as Partial<FilmedSequence> | null;
  if (!sequence || !Array.isArray(sequence.framings) || sequence.framings.length === 0) return null;
  if (!finite(sequence.sourceWidth, sequence.sourceHeight) || !sequence.background || !finite(sequence.background.r, sequence.background.g, sequence.background.b)) return null;
  const framings = sequence.framings.filter((framing) => isRect(framing.from) && isRect(framing.to) && finite(framing.seconds) && framing.seconds > 0);
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
      lift: isRect(framing.lift) ? framing.lift : null,
      words: (['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const).find((corner) => corner === framing.words) ?? 'none',
      layers: Array.isArray(framing.layers) ? framing.layers.flatMap((layer) => filmedLayer(layer)) : [],
      space: framing.space === 'volume' ? 'volume' : 'flat',
      wordsBehind: framing.wordsBehind === true,
    })),
  };
}

function filmedLayer(value: unknown): FilmedLayer[] {
  const layer = value as Partial<FilmedLayer> | null;
  // Without its rectangle a layer has no pixels to move; the Remotion schema never lets one through.
  if (!layer || !isRect(layer.rect)) return [];
  const source = typeof layer.source === 'string' && STAGED_PATH.test(layer.source) ? layer.source : null;
  const dimension = (candidate: unknown) => (finite(candidate) && (candidate as number) > 0 ? (candidate as number) : null);
  return [{
    role: oneOf(LAYER_ROLES, layer.role, 'panel'),
    motion: oneOf(LAYER_MOTIONS, layer.motion, 'hold'),
    rect: layer.rect,
    depth: finite(layer.depth) ? layer.depth! : 0,
    delaySeconds: finite(layer.delaySeconds) ? Math.max(0, layer.delaySeconds!) : 0,
    durationSeconds: finite(layer.durationSeconds) && layer.durationSeconds! > 0 ? layer.durationSeconds! : 0.8,
    from: oneOf(LAYER_EDGES, layer.from, 'below'),
    knockout: layer.knockout === true,
    source,
    sourceWidth: dimension(layer.sourceWidth),
    sourceHeight: dimension(layer.sourceHeight),
  }];
}

function oneOf<T extends string>(names: readonly T[], value: unknown, otherwise: T): T {
  return names.find((name) => name === value) ?? otherwise;
}

function finite(...numbers: unknown[]): boolean {
  return numbers.every((number) => typeof number === 'number' && Number.isFinite(number));
}

function isRect(candidate: unknown): candidate is Rect {
  const rect = candidate as Rect | null;
  return Boolean(rect) && finite(rect!.x, rect!.y, rect!.width, rect!.height) && rect!.width > 0 && rect!.height > 0;
}

function channel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
