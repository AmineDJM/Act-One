import { SAFE_AREAS, dimensionsFor, type AspectRatio, type RenderQuality } from '@act-one/core';

/**
 * Composition.
 *
 * A grid, safe areas, and a small vocabulary of placements. The reason this is
 * deterministic code rather than per-scene instructions is consistency: a film
 * where the left margin moves by 12px between scenes reads as sloppy even to
 * people who cannot say why. One grid, applied everywhere.
 */
export type Frame = {
  width: number;
  height: number;
  aspect: AspectRatio;
};

export type Box = { x: number; y: number; width: number; height: number };

export type Grid = {
  frame: Frame;
  columns: number;
  gutter: number;
  margin: { top: number; right: number; bottom: number; left: number };
  /** The area type is allowed to occupy. */
  safe: Box;
  columnWidth: number;
  /** Vertical rhythm unit, derived from the frame rather than hardcoded. */
  baseline: number;
};

export function createFrame(aspect: AspectRatio, quality: RenderQuality = 'hd'): Frame {
  const { width, height } = dimensionsFor(aspect, quality);
  return { width, height, aspect };
}

/**
 * Builds the grid for a frame.
 *
 * Columns vary by aspect because a 12-column grid on a 9:16 frame produces
 * columns narrower than a word. Vertical formats get fewer, wider columns.
 */
export function createGrid(frame: Frame, options: { columns?: number; density?: 'airy' | 'balanced' | 'dense' } = {}): Grid {
  const safeArea = SAFE_AREAS[frame.aspect];
  const density = options.density ?? 'balanced';

  const marginScale = density === 'airy' ? 1.25 : density === 'dense' ? 0.82 : 1;
  const margin = {
    top: Math.round(frame.height * safeArea.top * marginScale),
    right: Math.round(frame.width * safeArea.right * marginScale),
    bottom: Math.round(frame.height * safeArea.bottom * marginScale),
    left: Math.round(frame.width * safeArea.left * marginScale),
  };

  const columns =
    options.columns ?? (frame.aspect === '9:16' ? 4 : frame.aspect === '16:9' ? 12 : 6);

  const safe: Box = {
    x: margin.left,
    y: margin.top,
    width: frame.width - margin.left - margin.right,
    height: frame.height - margin.top - margin.bottom,
  };

  const gutter = Math.round(frame.width * (frame.aspect === '9:16' ? 0.024 : 0.014));
  const columnWidth = (safe.width - gutter * (columns - 1)) / columns;

  return {
    frame,
    columns,
    gutter,
    margin,
    safe,
    columnWidth,
    // A baseline derived from frame height keeps vertical rhythm identical
    // across 1080p and 4K renders of the same film.
    baseline: Math.round(frame.height * 0.0125),
  };
}

/** A box spanning columns `from`..`from+span-1`. */
export function columnSpan(grid: Grid, from: number, span: number): Box {
  const start = Math.max(0, Math.min(grid.columns - 1, from));
  const width = Math.min(grid.columns - start, Math.max(1, span));
  return {
    x: Math.round(grid.safe.x + start * (grid.columnWidth + grid.gutter)),
    y: grid.safe.y,
    width: Math.round(width * grid.columnWidth + (width - 1) * grid.gutter),
    height: grid.safe.height,
  };
}

export type Placement =
  | 'top_left'
  | 'center_left'
  | 'bottom_left'
  | 'center'
  | 'top_center'
  | 'bottom_center'
  | 'lower_third';

/**
 * Where a block of content sits.
 *
 * `lower_third` exists because vertical formats need copy above the platform's
 * own UI, and because the eye reads a held frame from slightly below centre —
 * dead-centre text in a 9:16 film consistently feels too high.
 */
export function place(grid: Grid, content: { width: number; height: number }, placement: Placement): Box {
  const { safe } = grid;
  const width = Math.min(content.width, safe.width);
  const height = Math.min(content.height, safe.height);

  const left = safe.x;
  const centerX = Math.round(safe.x + (safe.width - width) / 2);
  const centerY = Math.round(safe.y + (safe.height - height) / 2);

  switch (placement) {
    case 'top_left':
      return { x: left, y: safe.y, width, height };
    case 'center_left':
      return { x: left, y: centerY, width, height };
    case 'bottom_left':
      return { x: left, y: safe.y + safe.height - height, width, height };
    case 'center':
      return { x: centerX, y: centerY, width, height };
    case 'top_center':
      return { x: centerX, y: safe.y, width, height };
    case 'bottom_center':
      return { x: centerX, y: safe.y + safe.height - height, width, height };
    case 'lower_third':
      return {
        x: left,
        y: Math.round(safe.y + safe.height * 0.62 - height / 2),
        width,
        height,
      };
  }
}

/** Is a box entirely inside the frame-safe area? Used by the QA pass. */
export function withinSafeArea(grid: Grid, box: Box, tolerancePx = 1): boolean {
  return (
    box.x >= grid.safe.x - tolerancePx &&
    box.y >= grid.safe.y - tolerancePx &&
    box.x + box.width <= grid.safe.x + grid.safe.width + tolerancePx &&
    box.y + box.height <= grid.safe.y + grid.safe.height + tolerancePx
  );
}

/**
 * Recomposes a box from one aspect ratio into another.
 *
 * This is what makes a vertical cut a re-composition rather than a crop: the
 * element keeps its *relative role* in the frame (a left-anchored headline
 * stays left-anchored and re-wraps) instead of being scaled and clipped.
 */
export function recompose(
  box: Box,
  from: Grid,
  to: Grid,
  placement: Placement,
): Box {
  const widthRatio = box.width / from.safe.width;
  const heightRatio = box.height / from.safe.height;

  const target = {
    width: Math.round(Math.min(1, widthRatio * (from.frame.aspect === to.frame.aspect ? 1 : 1.1)) * to.safe.width),
    height: Math.round(Math.min(1, heightRatio) * to.safe.height),
  };

  return place(to, target, placement);
}

/** Product UI staged inside the frame, never bleeding to the edge. */
export function stageProduct(
  grid: Grid,
  assetAspect: number,
  options: { inset?: number; placement?: Placement } = {},
): Box {
  const inset = options.inset ?? 0.9;
  const maxWidth = grid.safe.width * inset;
  const maxHeight = grid.safe.height * inset;

  let width = maxWidth;
  let height = width / assetAspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * assetAspect;
  }

  return place(grid, { width: Math.round(width), height: Math.round(height) }, options.placement ?? 'center');
}
