import type { DesignTokens, TypeToken } from '@act-one/design';

/**
 * The design tokens, as the scene agent is given them.
 *
 * The same `resolveTokens` output the Remotion engine lays out with, flattened
 * into values that survive JSON and CSS: the spacing function becomes its
 * steps, and every colour, size and face becomes a custom property. A scene
 * that uses `var(--ao-display-size)` cannot drift from the brand the way a
 * scene that copied the number can, and the agent never has to invent one.
 */
export type TypeRole = 'display' | 'statement' | 'body' | 'caption' | 'mono';

export const TYPE_ROLES: readonly TypeRole[] = ['display', 'statement', 'body', 'caption', 'mono'];

export type FilmTokens = {
  frame: { width: number; height: number };
  safe: { x: number; y: number; width: number; height: number };
  margin: { top: number; right: number; bottom: number; left: number };
  canvas: string;
  onCanvas: { primary: string; secondary: string; muted: string; accent: string };
  accent: string;
  line: string;
  surface: string;
  surfaceRaised: string;
  radius: { sm: number; md: number; lg: number };
  /** `space(1)` to `space(8)`, in pixels. */
  space: number[];
  type: Record<TypeRole, TypeToken>;
  shadow: { soft: string; hard: string } | null;
  isDarkCanvas: boolean;
};

const SPACE_STEPS = [1, 2, 3, 4, 5, 6, 7, 8];

export function filmTokens(tokens: DesignTokens): FilmTokens {
  return {
    frame: { width: tokens.frame.width, height: tokens.frame.height },
    safe: { ...tokens.grid.safe },
    margin: { ...tokens.grid.margin },
    canvas: tokens.canvas,
    onCanvas: { ...tokens.onCanvas },
    accent: tokens.accent,
    line: tokens.line,
    surface: tokens.surface,
    surfaceRaised: tokens.surfaceRaised,
    radius: { ...tokens.radius },
    space: SPACE_STEPS.map((step) => round(tokens.space(step))),
    type: {
      display: { ...tokens.type.display },
      statement: { ...tokens.type.statement },
      body: { ...tokens.type.body },
      caption: { ...tokens.type.caption },
      mono: { ...tokens.type.mono },
    },
    shadow: tokens.shadow ? { ...tokens.shadow } : null,
    isDarkCanvas: tokens.isDarkCanvas,
  };
}

/** Generic fallbacks per role, so a missing face degrades to the right kind of face. */
const GENERIC_FALLBACK: Record<TypeRole, string> = {
  display: 'sans-serif',
  statement: 'sans-serif',
  body: 'sans-serif',
  caption: 'sans-serif',
  mono: 'monospace',
};

const TEXT_TRANSFORM: Record<TypeToken['case'], string> = {
  sentence: 'none',
  upper: 'uppercase',
  title: 'capitalize',
};

/** The custom properties every composition can read, declared once on `:root`. */
export function tokenCss(tokens: FilmTokens): string {
  const lines: string[] = [
    `--ao-frame-width: ${tokens.frame.width}px;`,
    `--ao-frame-height: ${tokens.frame.height}px;`,
    `--ao-safe-x: ${round(tokens.safe.x)}px;`,
    `--ao-safe-y: ${round(tokens.safe.y)}px;`,
    `--ao-safe-width: ${round(tokens.safe.width)}px;`,
    `--ao-safe-height: ${round(tokens.safe.height)}px;`,
    `--ao-canvas: ${cssColour(tokens.canvas)};`,
    `--ao-primary: ${cssColour(tokens.onCanvas.primary)};`,
    `--ao-secondary: ${cssColour(tokens.onCanvas.secondary)};`,
    `--ao-muted: ${cssColour(tokens.onCanvas.muted)};`,
    `--ao-accent-text: ${cssColour(tokens.onCanvas.accent)};`,
    `--ao-accent: ${cssColour(tokens.accent)};`,
    `--ao-line: ${cssColour(tokens.line)};`,
    `--ao-surface: ${cssColour(tokens.surface)};`,
    `--ao-surface-raised: ${cssColour(tokens.surfaceRaised)};`,
    `--ao-radius-sm: ${round(tokens.radius.sm)}px;`,
    `--ao-radius-md: ${round(tokens.radius.md)}px;`,
    `--ao-radius-lg: ${round(tokens.radius.lg)}px;`,
    `--ao-shadow-soft: ${tokens.shadow ? cssShadow(tokens.shadow.soft) : 'none'};`,
    `--ao-shadow-hard: ${tokens.shadow ? cssShadow(tokens.shadow.hard) : 'none'};`,
  ];
  tokens.space.forEach((value, index) => lines.push(`--ao-space-${index + 1}: ${value}px;`));
  for (const role of TYPE_ROLES) {
    const token = tokens.type[role];
    lines.push(
      `--ao-${role}-family: ${fontStack(token.family, GENERIC_FALLBACK[role])};`,
      `--ao-${role}-weight: ${token.weight};`,
      `--ao-${role}-size: ${round(token.sizePx)}px;`,
      `--ao-${role}-line-height: ${token.lineHeight};`,
      `--ao-${role}-tracking: ${token.tracking}em;`,
      `--ao-${role}-transform: ${TEXT_TRANSFORM[token.case] ?? 'none'};`,
    );
  }
  return `:root {\n  ${lines.join('\n  ')}\n}`;
}

/** The one font stack a scene may name for a role. Quoted, because family names carry spaces. */
export function fontStack(family: string, generic: string): string {
  return `"${family.replace(/["\\]/g, '')}", ${generic}`;
}

/*
 * Values that come out of the brand system are measured from a customer's site.
 * They are colours and shadows by construction, but they are written into a
 * stylesheet, so anything that is not plainly a colour or a shadow is refused
 * rather than trusted: a value carrying `;` or `}` would end the declaration
 * and start one of its own.
 */
const SAFE_CSS_VALUE = /^[#a-zA-Z0-9(),.%\s-]+$/;

function cssColour(value: string): string {
  if (!SAFE_CSS_VALUE.test(value)) throw new Error(`Refusing an unsafe colour value in the design tokens: ${JSON.stringify(value)}`);
  return value;
}

function cssShadow(value: string): string {
  if (!SAFE_CSS_VALUE.test(value)) throw new Error(`Refusing an unsafe shadow value in the design tokens: ${JSON.stringify(value)}`);
  return value;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
