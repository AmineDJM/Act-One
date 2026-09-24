import type { MotionRecipeName } from '@act-one/core';
import { applyCase, breakLines, fitTextToBox, fitToLines, type DesignTokens, type TypeToken } from '@act-one/design';
import type { TypeRole } from './tokens.ts';

/**
 * The type of a scene, set the way the Remotion engine sets it.
 *
 * Same functions, same numbers: the lines come from the design engine's own
 * breaking and fitting, measured with the metrics of the faces both engines
 * bundle, at the widths and line caps each Remotion component uses. A headline
 * that breaks after "launch" in one engine breaks after "launch" in the other,
 * and a line that had to come down to 74% of its role size comes down to 74%
 * in both. The agent is handed these lines rather than asked to rediscover
 * them; the engine's own composition draws them directly.
 */
export type TypesetBlock = {
  /** What the block is to its scene. */
  part: 'headline' | 'figure' | 'caption' | 'quote' | 'attribution' | 'address' | 'wordmark';
  role: TypeRole;
  /** Already cased: the role's transform has been applied where the Remotion component applies it. */
  lines: string[];
  fontSizePx: number;
  /** Null where the Remotion component leaves it to the browser: CSS `normal`. */
  lineHeight: number | null;
  weight: number;
  trackingEm: number;
  /** The Remotion type components' kerning, ligatures and geometric precision, where they set them. */
  features: boolean;
  /** A token name: primary, muted and accent come from the design tokens, white is literal. */
  colour: 'primary' | 'muted' | 'accent' | 'white';
  /** The width the lines were broken to. */
  maxWidthPx: number;
  /** The space above this block, from the one before it. */
  marginTopPx: number;
};

export type Typeset = {
  /** Where the block sits in the safe area, as the Remotion engine frames it. */
  placement: 'center_left' | 'center' | 'lower_third' | 'end_card' | 'lockup';
  blocks: TypesetBlock[];
  /** The mark, where the recipe places the logo image: its height, and the space above it. */
  logo: { heightPx: number; marginTopPx: number } | null;
};

export type TypesetInput = {
  recipe: MotionRecipeName;
  index: number;
  onScreenText: readonly string[];
  hasClip: boolean;
  hasImage: boolean;
  hasLogo: boolean;
  brandName: string;
  cta: string;
  tagline: string;
};

const PRODUCT_RECIPES: ReadonlySet<MotionRecipeName> = new Set<MotionRecipeName>([
  'product_window', 'product_sequence', 'floating_ui', 'feature_stack', 'product_zoom',
  'spatial_cards', 'image_wall', 'cursor_sequence', 'depth_transition',
]);

/** The scene's type, or null when the Remotion engine sets none (a product shot, a logo). */
export function typesetScene(input: TypesetInput, tokens: DesignTokens): Typeset | null {
  const text = input.onScreenText.join(' ');
  const safeWidth = tokens.grid.safe.width;

  switch (input.recipe) {
    case 'kinetic_headline':
      return words('center_left', text, tokens.type.display, 'display', safeWidth * 0.88, 2);
    case 'editorial_headline':
      return words('center_left', text, tokens.type.display, 'display', safeWidth * 0.76, 3);
    case 'word_reveal':
    case 'hold': {
      const [token, role] = input.index === 0 ? [tokens.type.display, 'display' as const] : [tokens.type.statement, 'statement' as const];
      return words('center_left', text, token, role, safeWidth * 0.82, 3);
    }
    case 'mask_reveal':
      return words('center_left', text, tokens.type.statement, 'statement', safeWidth * 0.8, 3);

    case 'statistic_reveal':
    case 'metric_reveal': {
      const [value, ...rest] = input.onScreenText;
      const display = tokens.type.display;
      const caption = tokens.type.caption;
      const blocks: TypesetBlock[] = [
        block('figure', 'display', [value ?? ''], display.sizePx, 1, 700, display.tracking, 'primary', safeWidth, false),
      ];
      const captionText = rest.join(' ');
      if (captionText.trim()) {
        blocks.push(block('caption', 'caption', [applyCase(captionText, caption)], caption.sizePx, null, caption.weight, caption.tracking, 'muted', safeWidth, false, tokens.space(1.5)));
      }
      return { placement: 'center_left', blocks, logo: null };
    }

    case 'quote_hold': {
      const statement = tokens.type.statement;
      const caption = tokens.type.caption;
      const quote = input.onScreenText[0] ?? text;
      const attribution = input.onScreenText[1] ?? '';
      const maxWidth = safeWidth * 0.74;
      const lines = breakLines(quote, {
        family: statement.family,
        fontSizePx: statement.sizePx,
        tracking: statement.tracking,
        weight: statement.weight,
        maxWidthPx: maxWidth,
      });
      const blocks = [block('quote', 'statement', lines, statement.sizePx, statement.lineHeight, statement.weight, statement.tracking, 'primary', maxWidth, false)];
      if (attribution.trim()) {
        blocks.push(block('attribution', 'caption', [applyCase(attribution, caption)], caption.sizePx, null, 400, caption.tracking, 'muted', maxWidth, false, tokens.space(2)));
      }
      return { placement: 'center_left', blocks, logo: null };
    }

    case 'footage':
      if (input.hasClip) return text ? words('lower_third', text, tokens.type.statement, 'statement', safeWidth * 0.7, 2, 'white') : null;
      // A clip that turned out to be a still is held as a photograph, without words, as the Remotion engine holds it.
      if (input.hasImage) return null;
      return typeFallback(text, tokens);

    case 'photo_hold':
      if (input.hasImage) return text ? words('lower_third', text, tokens.type.caption, 'caption', safeWidth * 0.6, 2, 'white') : null;
      return typeFallback(text, tokens);

    case 'logo_reveal': {
      const display = tokens.type.display;
      if (input.hasLogo) return { placement: 'lockup', blocks: [], logo: { heightPx: round(display.sizePx * 0.9), marginTopPx: 0 } };
      return {
        placement: 'lockup',
        blocks: [block('wordmark', 'display', [input.brandName], display.sizePx * 0.62, null, 700, display.tracking, 'primary', safeWidth, false)],
        logo: null,
      };
    }

    case 'cta_end_card': {
      const statement = tokens.type.statement;
      const caption = tokens.type.caption;
      const display = tokens.type.display;
      const headline = text || input.tagline;
      const fitted = fitTextToBox(
        headline,
        { widthPx: safeWidth * 0.8, heightPx: statement.sizePx * 2.6 },
        {
          family: statement.family,
          tracking: statement.tracking,
          weight: statement.weight,
          lineHeight: statement.lineHeight,
          maxLines: 2,
          maxFontSizePx: statement.sizePx,
          minFontSizePx: statement.sizePx * 0.62,
        },
      );
      const blocks: TypesetBlock[] = [];
      if (headline.trim()) {
        blocks.push(block('headline', 'statement', fitted.lines, fitted.fontSizePx, statement.lineHeight, statement.weight, statement.tracking, 'primary', safeWidth * 0.8, false));
      }
      if (input.cta.trim()) {
        blocks.push(block('address', 'caption', [applyCase(input.cta, caption)], caption.sizePx, null, 400, caption.tracking, 'accent', safeWidth, false, tokens.space(3)));
      }
      if (!input.hasLogo) {
        blocks.push(block('wordmark', 'display', [input.brandName], statement.sizePx * 0.52, null, 700, display.tracking, 'primary', safeWidth, false, tokens.space(4)));
      }
      return {
        placement: 'end_card',
        blocks,
        logo: input.hasLogo ? { heightPx: round(statement.sizePx * 0.62), marginTopPx: round(tokens.space(4)) } : null,
      };
    }

    default:
      if (PRODUCT_RECIPES.has(input.recipe) && input.hasImage) return null;
      return typeFallback(text, tokens);
  }
}

/** Type on the canvas: what a scene is when its picture did not arrive. */
function typeFallback(text: string, tokens: DesignTokens): Typeset | null {
  return text.trim() ? words('center_left', text, tokens.type.statement, 'statement', tokens.grid.safe.width * 0.8, 3) : null;
}

function words(
  placement: Typeset['placement'],
  text: string,
  token: TypeToken,
  role: TypeRole,
  maxWidthPx: number,
  maxLines: number,
  colour: TypesetBlock['colour'] = 'primary',
): Typeset | null {
  if (!text.trim()) return null;
  const fitted = fitToLines(applyCase(text, token), {
    family: token.family,
    fontSizePx: token.sizePx,
    tracking: token.tracking,
    weight: token.weight,
    maxWidthPx,
    maxLines,
  });
  return {
    placement,
    blocks: [block('headline', role, fitted.lines, fitted.fontSizePx, token.lineHeight, token.weight, token.tracking, colour, maxWidthPx, true)],
    logo: null,
  };
}

function block(
  part: TypesetBlock['part'],
  role: TypeRole,
  lines: string[],
  fontSizePx: number,
  lineHeight: number | null,
  weight: number,
  trackingEm: number,
  colour: TypesetBlock['colour'],
  maxWidthPx: number,
  features: boolean,
  marginTopPx = 0,
): TypesetBlock {
  return {
    part,
    role,
    lines,
    fontSizePx: round(fontSizePx),
    lineHeight,
    weight,
    trackingEm,
    features,
    colour,
    maxWidthPx: round(maxWidthPx),
    marginTopPx: round(marginTopPx),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The scene's words as the Remotion `WordsInFrame` sets them in a filmed capture.
 *
 * A column in the quiet corner of the framing: at most 46% of the safe width
 * (and 42% of the frame), in the statement role, broken into three lines at
 * most, with an accent rule above them. The corner changes from framing to
 * framing; the lines do not.
 */
export type InFrameWords = {
  lines: string[];
  fontSizePx: number;
  lineHeight: number;
  weight: number;
  trackingEm: number;
  /** The column's width, and its distance from both edges of the corner it sits in. */
  widthPx: number;
  marginPx: number;
  /** Between the rule and the lines. */
  gapPx: number;
  ruleWidthPx: number;
};

export function inFrameWords(onScreenText: readonly string[], tokens: DesignTokens): InFrameWords | null {
  const text = onScreenText.join(' ').trim();
  if (!text) return null;
  const statement = tokens.type.statement;
  const widthPx = Math.min(tokens.grid.safe.width * 0.46, tokens.frame.width * 0.42);
  const fitted = fitToLines(applyCase(text, statement), {
    family: statement.family,
    fontSizePx: statement.sizePx,
    tracking: statement.tracking,
    weight: statement.weight,
    maxWidthPx: widthPx,
    maxLines: 3,
  });
  return {
    lines: fitted.lines,
    fontSizePx: fitted.fontSizePx,
    lineHeight: statement.lineHeight,
    weight: statement.weight,
    trackingEm: statement.tracking,
    widthPx,
    marginPx: tokens.grid.safe.x,
    gapPx: Math.round(statement.sizePx * 0.42),
    ruleWidthPx: Math.round(tokens.frame.width * 0.036),
  };
}
