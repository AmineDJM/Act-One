import {
  CONTRAST_AA_LARGE,
  CONTRAST_AA_NORMAL,
  MODULAR_SCALES,
  cornerRadiusScale,
  fontFor,
  leadingFor,
  modularStep,
  type AspectRatio,
  type BrandSystem,
  type ModularScaleName,
  type RenderQuality,
} from '@act-one/core';
import { clamp, ensureContrast, isDark, mix, withAlpha } from './color.ts';
import { createFrame, createGrid, type Frame, type Grid } from './layout.ts';
import { metricsFor, opticalTracking } from './typography.ts';

/**
 * Design tokens for one render.
 *
 * Resolved once per film and threaded through every renderer, so a scene cannot
 * pick a slightly different grey or a slightly different radius than the scene
 * before it. Everything is absolute pixels at the render's own resolution —
 * a 4K master and a 1080p preview of the same film are then genuinely identical
 * compositions rather than similar ones.
 */
export type DesignTokens = {
  frame: Frame;
  grid: Grid;
  canvas: string;
  onCanvas: { primary: string; secondary: string; muted: string; accent: string };
  accent: string;
  /** Hairlines, dividers and UI chrome inside product staging. */
  line: string;
  surface: string;
  surfaceRaised: string;
  radius: { sm: number; md: number; lg: number };
  space: (steps: number) => number;
  type: {
    display: TypeToken;
    statement: TypeToken;
    body: TypeToken;
    caption: TypeToken;
    mono: TypeToken;
  };
  shadow: { soft: string; hard: string } | null;
  isDarkCanvas: boolean;
};

export type TypeToken = {
  family: string;
  weight: number;
  /** Absolute pixels at this render's resolution. */
  sizePx: number;
  lineHeight: number;
  tracking: number;
  case: 'sentence' | 'upper' | 'title';
};

export type TokenOptions = {
  aspect: AspectRatio;
  quality?: RenderQuality;
  /** Dark is the default for launch films, but only when the brand allows it. */
  theme?: 'dark' | 'light' | 'auto';
  /** Type scale multipliers from the creative system. */
  scale?: { displayRatio: number; bodyRatio: number; tracking: number; lineHeight: number };
  /** The interval every other size steps by. Defaults to a perfect fourth. */
  scaleRatio?: ModularScaleName;
};

export function resolveTokens(brand: BrandSystem, options: TokenOptions): DesignTokens {
  const frame = createFrame(options.aspect, options.quality ?? 'hd');
  const grid = createGrid(frame, { density: brand.layoutDensity });

  const theme =
    options.theme === 'auto' || options.theme === undefined
      ? preferredTheme(brand)
      : options.theme;
  const canvas = theme === 'dark' ? brand.canvasDark : brand.canvasLight;
  const darkCanvas = isDark(canvas);

  const neutrals = darkCanvas ? [...brand.neutrals].reverse() : brand.neutrals;
  const primaryText = neutrals[0] ?? (darkCanvas ? '#ffffff' : '#0a0a0c');
  const secondaryText = ensureContrast(neutrals[2] ?? primaryText, canvas, CONTRAST_AA_NORMAL);
  const mutedText = ensureContrast(neutrals[3] ?? secondaryText, canvas, CONTRAST_AA_LARGE);
  const accent = ensureContrast(brand.primaryColor, canvas, CONTRAST_AA_LARGE);

  const display = fontFor(brand, 'display');
  const body = fontFor(brand, 'body');
  const mono = fontFor(brand, 'mono');

  const scale = options.scale ?? {
    displayRatio: 0.1,
    bodyRatio: 0.024,
    tracking: display.tracking,
    lineHeight: 1.08,
  };

  /*
   * Type is sized against the shorter side of the frame.
   *
   * It used to be sized against the height, on the reasoning that a 9:16 frame
   * is not a smaller 16:9 frame and sizing on width would make vertical type
   * tiny. Half of that is right — and the other half put 211px display type in
   * a frame 1080 wide, where a five-word headline wrapped to three lines and
   * the third one was clipped. "Now it takes one run." rendered as "Now it
   * takes", which is not a design decision, it is a sentence cut in half.
   *
   * The shorter side is what actually constrains a line of type, and it gives
   * the right answer in both frames: in 16:9 it *is* the height, so every
   * landscape film is set exactly as before; in 9:16 it is the width, which is
   * the dimension the line has to fit across.
   */
  const typeBasis = Math.min(frame.width, frame.height);
  const displaySize = Math.round(typeBasis * scale.displayRatio);
  const bodySize = Math.round(typeBasis * scale.bodyRatio);

  /*
   * Every other size is a step on one ratio rather than a multiplier somebody
   * liked. Sizes chosen individually look almost related, which the eye reads
   * as a mistake; sizes from a ratio look deliberate even to a viewer who
   * could not name the ratio. See TYPE_STANDARDS.modularScale.
   *
   * Two anchors, because they answer different questions: display is sized for
   * impact and body for legibility. The steps hang off whichever anchor they
   * belong to.
   */
  const ratio = MODULAR_SCALES[options.scaleRatio ?? 'perfect_fourth'];
  const step = (anchor: number, steps: number) => Math.round(modularStep(anchor, ratio, steps));
  const statementSize = step(displaySize, -2);
  const captionSize = step(bodySize, -2);
  const monoSize = step(bodySize, -1);

  /*
   * Leading follows the optical size, and the creative system's own preference
   * is honoured only within the range the standard allows. A system that wants
   * airy display type gets it; a system that would set 120px headlines at body
   * leading does not, because that is not a style, it is a mistake.
   */
  const leading = (size: number, preferred?: number) => {
    const standard = leadingFor(size, typeBasis);
    if (preferred === undefined) return standard;
    return clamp(preferred, standard * 0.9, standard * 1.15);
  };

  // Radius scales with the frame so a 1080p and a 4K render match, and is
  // anchored to the radius actually measured from the brand's site.
  const radiusBase = (brand.cornerRadiusPx / 1920) * frame.width * cornerRadiusScale[brand.cornerStyle];

  return {
    frame,
    grid,
    canvas,
    onCanvas: { primary: primaryText, secondary: secondaryText, muted: mutedText, accent },
    accent,
    line: withAlpha(primaryText, darkCanvas ? 0.14 : 0.1),
    surface: mix(canvas, primaryText, darkCanvas ? 0.05 : 0.035),
    surfaceRaised: mix(canvas, primaryText, darkCanvas ? 0.09 : 0.06),
    radius: {
      sm: Math.round(radiusBase * 0.6),
      md: Math.round(radiusBase),
      lg: Math.round(radiusBase * 1.8),
    },
    space: (steps: number) => Math.round(grid.baseline * steps),
    type: {
      display: {
        family: display.renderFamily,
        weight: display.weights[display.weights.length - 1] ?? 700,
        sizePx: displaySize,
        lineHeight: leading(displaySize, scale.lineHeight),
        tracking: opticalTracking(displaySize, scale.tracking, typeBasis),
        case: 'sentence',
      },
      statement: {
        family: display.renderFamily,
        weight: display.weights[0] ?? 600,
        sizePx: statementSize,
        lineHeight: leading(statementSize, scale.lineHeight * 1.12),
        tracking: opticalTracking(statementSize, scale.tracking, typeBasis),
        case: 'sentence',
      },
      body: {
        family: body.renderFamily,
        weight: 400,
        sizePx: bodySize,
        lineHeight: leading(bodySize),
        tracking: opticalTracking(bodySize, body.tracking, typeBasis),
        case: 'sentence',
      },
      caption: {
        family: mono.renderFamily,
        weight: 500,
        sizePx: captionSize,
        lineHeight: leading(captionSize),
        // Small mono labels need positive tracking to stay legible in motion.
        tracking: 0.08,
        case: 'upper',
      },
      mono: {
        family: mono.renderFamily,
        weight: 400,
        sizePx: monoSize,
        lineHeight: leading(monoSize),
        tracking: 0,
        case: 'sentence',
      },
    },
    // Shadow only where the brand's own surfaces have depth. Adding it
    // uninvited is what makes product shots look like a template mockup.
    shadow: darkCanvas
      ? { soft: `0 40px 120px ${withAlpha('#000000', 0.55)}`, hard: `0 8px 24px ${withAlpha('#000000', 0.45)}` }
      : { soft: `0 32px 90px ${withAlpha('#0a0a0c', 0.14)}`, hard: `0 4px 16px ${withAlpha('#0a0a0c', 0.1)}` },
    isDarkCanvas: darkCanvas,
  };
}

/**
 * Which canvas suits a brand.
 *
 * Dark reads as premium and is right for most launch films, but forcing a
 * bright editorial brand onto black is exactly the kind of "cinematic" default
 * that makes every automated film look the same.
 */
function preferredTheme(brand: BrandSystem): 'dark' | 'light' {
  if (brand.visualStyle === 'editorial' || brand.visualStyle === 'playful') return 'light';
  if (brand.visualStyle === 'luxury' || brand.visualStyle === 'brutalist') return 'dark';
  return 'dark';
}

/** Cap-height alignment offset, for lockups that must look composed. */
export function capHeightOffset(token: TypeToken): number {
  const metrics = metricsFor(token.family);
  return token.sizePx * (metrics.ascender - metrics.capHeight);
}

export function applyCase(text: string, token: TypeToken): string {
  switch (token.case) {
    case 'upper':
      return text.toUpperCase();
    case 'title':
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default:
      return text;
  }
}
