import sharp from 'sharp';
import {
  COLOR_STANDARDS,
  MAX_ACCENT_SHARE,
  MIN_CANVAS_SHARE,
  cite,
  newId,
  type QaFinding,
  type Scene,
} from '@act-one/core';
import type { DesignTokens } from '@act-one/design';

/**
 * How a rendered frame's area divides between canvas, accent and the rest.
 *
 * The storyboard knows which colour every mark has; only the frame knows how
 * much of it there is. Pixels are classified by nearest token colour within a
 * tolerance — anything not close to the canvas or the accent counts as
 * "other", which is where type, surfaces and captures land.
 */
export type ColourShares = {
  canvas: number;
  accent: number;
  other: number;
};

export async function colourShares(
  frame: Uint8Array | string,
  tokens: Pick<DesignTokens, 'canvas' | 'accent'>,
): Promise<ColourShares> {
  const { data, info } = await sharp(typeof frame === 'string' ? frame : Buffer.from(frame))
    .resize({ width: 240, withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const canvas = rgb(tokens.canvas);
  const accent = rgb(tokens.accent);
  const total = info.width * info.height;
  let canvasCount = 0;
  let accentCount = 0;

  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (distance(r, g, b, canvas) < 28) canvasCount += 1;
    else if (distance(r, g, b, accent) < 40) accentCount += 1;
  }

  return {
    canvas: canvasCount / total,
    accent: accentCount / total,
    other: (total - canvasCount - accentCount) / total,
  };
}

/**
 * The 60/30/10 rule, checked on a typographic frame.
 *
 * Only on frames that are the film's own composition: a product capture has
 * the customer's colours, and judging it against our palette would be judging
 * their interface. Two thresholds, both with room: the accent may not cover a
 * fifth of the frame, and the canvas has to still be most of it.
 */
export function distributionIssues(
  shares: ColourShares,
  scene: Pick<Scene, 'id' | 'startTime' | 'index'>,
): QaFinding[] {
  const issues: QaFinding[] = [];
  const base = {
    id: newId('evt'),
    sceneId: scene.id,
    timecodeStart: scene.startTime,
    detectedBy: 'deterministic' as const,
    evidenceAssetId: null,
    check: 'composition' as const,
    confidence: 0.85,
    repair: 'manual_review' as const,
  };
  if (shares.accent > MAX_ACCENT_SHARE) {
    issues.push({
      ...base,
      severity: 'soft_fail',
      message:
        `The accent covers ${(shares.accent * 100).toFixed(0)}% of scene ${scene.index + 1}; past ` +
        `${(MAX_ACCENT_SHARE * 100).toFixed(0)}% it is the canvas, not an accent ` +
        `(${cite(COLOR_STANDARDS.distribution)}).`,
    });
  } else if (shares.canvas < MIN_CANVAS_SHARE) {
    issues.push({
      ...base,
      id: newId('evt'),
      severity: 'warning',
      message:
        `Only ${(shares.canvas * 100).toFixed(0)}% of scene ${scene.index + 1} is canvas; a ` +
        `typographic frame that is mostly not canvas is crowded (${cite(COLOR_STANDARDS.distribution)}).`,
    });
  }
  return issues;
}

function rgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function distance(r: number, g: number, b: number, to: [number, number, number]): number {
  return Math.sqrt((r - to[0]) ** 2 + (g - to[1]) ** 2 + (b - to[2]) ** 2);
}
