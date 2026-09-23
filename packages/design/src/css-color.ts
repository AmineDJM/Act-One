/**
 * CSS Color Module Level 4, parsed and brought into sRGB.
 *
 * Browsers serialise a computed colour in the space it was written in: a
 * Tailwind v4 site paints `oklch(0.62 0.19 259.8)`, a design system built on
 * wide gamut paints `color(display-p3 …)`, and only the legacy forms come back
 * as `rgb()`. A reader that understands `rgb()` alone sees none of the colours
 * a modern brand is built from. Everything here follows the conversion code
 * published with the specification, so the numbers are the browser's numbers,
 * not an approximation of them.
 *
 * Out-of-gamut colours are mapped with the specification's own algorithm
 * (chroma reduction in OKLCh until the clipped result is within one just
 * noticeable difference), not clipped per channel: clipping shifts hue, and a
 * shifted brand hue is exactly the near-miss that makes a film look off-brand.
 */

export type CssColorSpace =
  | 'srgb'
  | 'srgb-linear'
  | 'display-p3'
  | 'a98-rgb'
  | 'prophoto-rgb'
  | 'rec2020'
  | 'xyz-d50'
  | 'xyz-d65'
  | 'hsl'
  | 'hwb'
  | 'lab'
  | 'lch'
  | 'oklab'
  | 'oklch';

export type Vec3 = readonly [number, number, number];
export type OklchColor = { l: number; c: number; h: number };
export type OklabColor = { l: number; a: number; b: number };
export type SrgbColor = { r: number; g: number; b: number };

export type CssColor = {
  /** The input, trimmed. Kept verbatim so a render can use the exact value. */
  css: string;
  space: CssColorSpace;
  /** Gamma-encoded sRGB, 0..1 per channel, after gamut mapping. */
  srgb: SrgbColor;
  alpha: number;
  /** `#rrggbb` of the mapped colour, alpha ignored. */
  hex: string;
  /** `#rrggbbaa`, alpha included. */
  hex8: string;
  /** Of the colour as written, before any gamut mapping. */
  oklch: OklchColor;
  /** Whether the colour as written fits inside sRGB. */
  inGamut: boolean;
};

/*
 * Matrices from the CSS Color 4 sample code (conversions.js). Copied digit for
 * digit: a rounded matrix drifts by a code value on saturated colours, and
 * "one off" on a brand colour is a different brand colour to a designer.
 */
const LIN_SRGB_TO_XYZ: readonly Vec3[] = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_TO_LIN_SRGB: readonly Vec3[] = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const LIN_P3_TO_XYZ: readonly Vec3[] = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const LIN_A98_TO_XYZ: readonly Vec3[] = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
];
const LIN_PROPHOTO_TO_XYZ_D50: readonly Vec3[] = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
];
const LIN_REC2020_TO_XYZ: readonly Vec3[] = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0, 0.028072693049087428, 1.060985057710791],
];
const D50_TO_D65: readonly Vec3[] = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const D65_TO_D50: readonly Vec3[] = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];
const XYZ_TO_LMS: readonly Vec3[] = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_OKLAB: readonly Vec3[] = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const OKLAB_TO_LMS: readonly Vec3[] = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_XYZ: readonly Vec3[] = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];

/** The D50 white point, as the specification states it. */
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const LAB_KAPPA = 24389 / 27;
const LAB_EPSILON = 216 / 24389;

/** One just noticeable difference in OKLab, the gamut-mapping tolerance. */
const JND = 0.02;
const MAPPING_EPSILON = 0.0001;
/** Slack on the sRGB cube, so rounding noise is not reported as out of gamut. */
const GAMUT_SLACK = 0.000075;

function multiply(matrix: readonly Vec3[], vector: Vec3): Vec3 {
  const [x, y, z] = vector;
  const row = (index: number): number => {
    const r = matrix[index]!;
    return r[0] * x + r[1] * y + r[2] * z;
  };
  return [row(0), row(1), row(2)];
}

// ---------------------------------------------------------------------------
// Transfer functions
// ---------------------------------------------------------------------------

function srgbToLinear(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return abs <= 0.04045 ? value / 12.92 : sign * ((abs + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return abs > 0.0031308 ? sign * (1.055 * abs ** (1 / 2.4) - 0.055) : 12.92 * value;
}

function a98ToLinear(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.abs(value) ** (563 / 256);
}

function prophotoToLinear(value: number): number {
  const abs = Math.abs(value);
  const sign = value < 0 ? -1 : 1;
  return abs <= 16 / 512 ? value / 16 : sign * abs ** 1.8;
}

function rec2020ToLinear(value: number): number {
  const alpha = 1.09929682680944;
  const beta = 0.018053968510807;
  const abs = Math.abs(value);
  const sign = value < 0 ? -1 : 1;
  return abs < beta * 4.5 ? value / 4.5 : sign * ((abs + alpha - 1) / alpha) ** (1 / 0.45);
}

// ---------------------------------------------------------------------------
// Spaces to XYZ D65
// ---------------------------------------------------------------------------

function labToXyzD50([l, a, b]: Vec3): Vec3 {
  const f1 = (l + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const x = f0 ** 3 > LAB_EPSILON ? f0 ** 3 : (116 * f0 - 16) / LAB_KAPPA;
  const y = l > LAB_KAPPA * LAB_EPSILON ? ((l + 16) / 116) ** 3 : l / LAB_KAPPA;
  const z = f2 ** 3 > LAB_EPSILON ? f2 ** 3 : (116 * f2 - 16) / LAB_KAPPA;
  return [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]];
}

function polarToCartesian(chroma: number, hueDegrees: number): [number, number] {
  const radians = (hueDegrees * Math.PI) / 180;
  return [chroma * Math.cos(radians), chroma * Math.sin(radians)];
}

export function oklabToXyz([l, a, b]: Vec3): Vec3 {
  const lms = multiply(OKLAB_TO_LMS, [l, a, b]);
  return multiply(LMS_TO_XYZ, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3]);
}

export function xyzToOklab(xyz: Vec3): Vec3 {
  const lms = multiply(XYZ_TO_LMS, xyz);
  return multiply(LMS_TO_OKLAB, [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])]);
}

function hslToSrgb(hue: number, saturation: number, lightness: number): Vec3 {
  const s = Math.max(0, saturation) / 100;
  const l = lightness / 100;
  const h = normaliseHue(hue);
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12;
    const amplitude = s * Math.min(l, 1 - l);
    return l - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

function hwbToSrgb(hue: number, whiteness: number, blackness: number): Vec3 {
  const white = whiteness / 100;
  const black = blackness / 100;
  if (white + black >= 1) {
    const grey = white / (white + black);
    return [grey, grey, grey];
  }
  const base = hslToSrgb(hue, 100, 50);
  return [
    base[0] * (1 - white - black) + white,
    base[1] * (1 - white - black) + white,
    base[2] * (1 - white - black) + white,
  ];
}

function normaliseHue(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function linearSrgbToXyz(rgb: Vec3): Vec3 {
  return multiply(LIN_SRGB_TO_XYZ, rgb);
}

function toXyzD65(space: CssColorSpace, coords: Vec3): Vec3 {
  switch (space) {
    case 'srgb':
    case 'hsl':
    case 'hwb':
      return linearSrgbToXyz([srgbToLinear(coords[0]), srgbToLinear(coords[1]), srgbToLinear(coords[2])]);
    case 'srgb-linear':
      return linearSrgbToXyz(coords);
    case 'display-p3':
      return multiply(LIN_P3_TO_XYZ, [srgbToLinear(coords[0]), srgbToLinear(coords[1]), srgbToLinear(coords[2])]);
    case 'a98-rgb':
      return multiply(LIN_A98_TO_XYZ, [a98ToLinear(coords[0]), a98ToLinear(coords[1]), a98ToLinear(coords[2])]);
    case 'prophoto-rgb':
      return multiply(
        D50_TO_D65,
        multiply(LIN_PROPHOTO_TO_XYZ_D50, [
          prophotoToLinear(coords[0]),
          prophotoToLinear(coords[1]),
          prophotoToLinear(coords[2]),
        ]),
      );
    case 'rec2020':
      return multiply(LIN_REC2020_TO_XYZ, [
        rec2020ToLinear(coords[0]),
        rec2020ToLinear(coords[1]),
        rec2020ToLinear(coords[2]),
      ]);
    case 'xyz-d65':
      return coords;
    case 'xyz-d50':
      return multiply(D50_TO_D65, coords);
    case 'lab':
      return multiply(D50_TO_D65, labToXyzD50(coords));
    case 'lch': {
      const [a, b] = polarToCartesian(coords[1], coords[2]);
      return multiply(D50_TO_D65, labToXyzD50([coords[0], a, b]));
    }
    case 'oklab':
      return oklabToXyz(coords);
    case 'oklch': {
      const [a, b] = polarToCartesian(coords[1], coords[2]);
      return oklabToXyz([coords[0], a, b]);
    }
  }
}

// ---------------------------------------------------------------------------
// OKLCh and gamut mapping
// ---------------------------------------------------------------------------

export function oklabToOklch([l, a, b]: Vec3): OklchColor {
  const c = Math.hypot(a, b);
  // Hue is powerless on an achromatic colour; 0 rather than noise from a and b.
  const h = c < 1e-6 ? 0 : normaliseHue((Math.atan2(b, a) * 180) / Math.PI);
  return { l, c, h };
}

function oklchToLinearSrgb({ l, c, h }: OklchColor): Vec3 {
  const [a, b] = polarToCartesian(c, h);
  return multiply(XYZ_TO_LIN_SRGB, oklabToXyz([l, a, b]));
}

function encode(linear: Vec3): Vec3 {
  return [linearToSrgb(linear[0]), linearToSrgb(linear[1]), linearToSrgb(linear[2])];
}

function inSrgbGamut(rgb: Vec3): boolean {
  return rgb.every((channel) => channel >= -GAMUT_SLACK && channel <= 1 + GAMUT_SLACK);
}

function clip(rgb: Vec3): Vec3 {
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
}

function srgbToOklab(rgb: Vec3): Vec3 {
  return xyzToOklab(linearSrgbToXyz([srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])]));
}

export function deltaEOk(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * CSS Color 4 §13.2, "CSS gamut mapping to an RGB destination".
 *
 * Binary search on chroma at constant lightness and hue, accepting the first
 * clipped colour within one JND of the chroma-reduced one. Lightness and hue,
 * the two properties a viewer recognises a brand colour by, are held.
 */
export function gamutMapToSrgb(origin: OklchColor): Vec3 {
  if (origin.l >= 1) return [1, 1, 1];
  if (origin.l <= 0) return [0, 0, 0];

  const direct = encode(oklchToLinearSrgb(origin));
  if (inSrgbGamut(direct)) return clip(direct);

  const toOklab = (color: OklchColor): Vec3 => {
    const [a, b] = polarToCartesian(color.c, color.h);
    return [color.l, a, b];
  };

  let current = { ...origin };
  let clipped = clip(direct);
  if (deltaEOk(srgbToOklab(clipped), toOklab(current)) < JND) return clipped;

  let min = 0;
  let max = origin.c;
  let minInGamut = true;
  while (max - min > MAPPING_EPSILON) {
    const chroma = (min + max) / 2;
    current = { ...current, c: chroma };
    const candidate = encode(oklchToLinearSrgb(current));
    if (minInGamut && inSrgbGamut(candidate)) {
      min = chroma;
      continue;
    }
    clipped = clip(candidate);
    const error = deltaEOk(srgbToOklab(clipped), toOklab(current));
    if (error < JND) {
      if (JND - error < MAPPING_EPSILON) return clipped;
      minInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }
  return clipped;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Component =
  | { kind: 'number'; value: number }
  | { kind: 'percentage'; value: number }
  | { kind: 'angle'; degrees: number }
  | { kind: 'none' };

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const PERCENTAGE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)%$/i;
const ANGLE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)$/i;

function readComponent(token: string): Component | null {
  const lower = token.toLowerCase();
  if (lower === 'none') return { kind: 'none' };
  if (NUMBER.test(lower)) return { kind: 'number', value: Number(lower) };
  const percentage = PERCENTAGE.exec(lower);
  if (percentage) return { kind: 'percentage', value: Number(percentage[1]) };
  const angle = ANGLE.exec(lower);
  if (angle) {
    const value = Number(angle[1]);
    const unit = angle[2]!;
    const degrees =
      unit === 'deg' ? value : unit === 'rad' ? (value * 180) / Math.PI : unit === 'grad' ? value * 0.9 : value * 360;
    return { kind: 'angle', degrees };
  }
  return null;
}

/** A number, or a percentage scaled so 100% is `full`. `none` is zero. */
function scalar(component: Component, full: number): number | null {
  switch (component.kind) {
    case 'none':
      return 0;
    case 'number':
      return component.value;
    case 'percentage':
      return (component.value / 100) * full;
    case 'angle':
      return null;
  }
}

function hue(component: Component): number | null {
  switch (component.kind) {
    case 'none':
      return 0;
    case 'number':
      return component.value;
    case 'angle':
      return component.degrees;
    case 'percentage':
      return null;
  }
}

function readAlpha(component: Component | undefined): number | null {
  if (!component) return 1;
  const value = scalar(component, 1);
  return value === null ? null : clamp01(value);
}

/** Arguments of a colour function, legacy comma syntax or modern space syntax. */
function splitArguments(body: string): { components: Component[]; alpha: Component | undefined } | null {
  const trimmed = body.trim();
  let main: string[];
  let alphaToken: string | undefined;
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((part) => part.trim());
    if (parts.some((part) => part.length === 0 || /\s/.test(part))) return null;
    main = parts.slice(0, 3);
    alphaToken = parts[3];
    if (parts.length > 4) return null;
  } else {
    const [left, right, ...extra] = trimmed.split('/');
    if (extra.length > 0 || left === undefined) return null;
    main = left.trim().split(/\s+/).filter(Boolean);
    alphaToken = right?.trim();
    if (right !== undefined && !alphaToken) return null;
  }
  const components: Component[] = [];
  for (const token of main) {
    const component = readComponent(token);
    if (!component) return null;
    components.push(component);
  }
  let alpha: Component | undefined;
  if (alphaToken !== undefined) {
    const component = readComponent(alphaToken);
    if (!component) return null;
    alpha = component;
  }
  return { components, alpha };
}

const PREDEFINED_SPACES: Record<string, CssColorSpace> = {
  srgb: 'srgb',
  'srgb-linear': 'srgb-linear',
  'display-p3': 'display-p3',
  'a98-rgb': 'a98-rgb',
  'prophoto-rgb': 'prophoto-rgb',
  rec2020: 'rec2020',
  xyz: 'xyz-d65',
  'xyz-d65': 'xyz-d65',
  'xyz-d50': 'xyz-d50',
};

type Coordinates = { space: CssColorSpace; coords: Vec3; alpha: number };

const SRGB_FAMILY: ReadonlySet<CssColorSpace> = new Set(['srgb', 'hsl', 'hwb']);

function readHex(value: string): Coordinates | null {
  const digits = value.slice(1);
  if (!/^[0-9a-f]+$/i.test(digits) || ![3, 4, 6, 8].includes(digits.length)) return null;
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const byte = (index: number): number => Number.parseInt(full.slice(index * 2, index * 2 + 2), 16);
  return {
    space: 'srgb',
    coords: [byte(0) / 255, byte(1) / 255, byte(2) / 255],
    alpha: full.length === 8 ? byte(3) / 255 : 1,
  };
}

function readFunction(name: string, body: string): Coordinates | null {
  if (name === 'color') {
    const match = /^\s*([a-z0-9-]+)\s+([\s\S]*)$/i.exec(body);
    if (!match) return null;
    const space = PREDEFINED_SPACES[match[1]!.toLowerCase()];
    if (!space) return null;
    const args = splitArguments(match[2]!);
    if (!args || args.components.length !== 3 || body.includes(',')) return null;
    const values = args.components.map((component) => scalar(component, 1));
    const alpha = readAlpha(args.alpha);
    if (values.some((value) => value === null) || alpha === null) return null;
    return { space, coords: values as unknown as Vec3, alpha };
  }

  const args = splitArguments(body);
  if (!args || args.components.length !== 3) return null;
  const [first, second, third] = args.components as [Component, Component, Component];
  const alpha = readAlpha(args.alpha);
  if (alpha === null) return null;

  switch (name) {
    case 'rgb':
    case 'rgba': {
      const channels = [first, second, third].map((component) => scalar(component, 255));
      if (channels.some((channel) => channel === null)) return null;
      return {
        space: 'srgb',
        coords: channels.map((channel) => clamp01(channel! / 255)) as unknown as Vec3,
        alpha,
      };
    }
    case 'hsl':
    case 'hsla': {
      const h = hue(first);
      const s = scalar(second, 100);
      const l = scalar(third, 100);
      if (h === null || s === null || l === null) return null;
      return { space: 'hsl', coords: hslToSrgb(h, s, l), alpha };
    }
    case 'hwb': {
      const h = hue(first);
      const w = scalar(second, 100);
      const b = scalar(third, 100);
      if (h === null || w === null || b === null) return null;
      return { space: 'hwb', coords: hwbToSrgb(h, w, b), alpha };
    }
    case 'lab': {
      const l = scalar(first, 100);
      const a = scalar(second, 125);
      const b = scalar(third, 125);
      if (l === null || a === null || b === null) return null;
      return { space: 'lab', coords: [Math.min(100, Math.max(0, l)), a, b], alpha };
    }
    case 'lch': {
      const l = scalar(first, 100);
      const c = scalar(second, 150);
      const h = hue(third);
      if (l === null || c === null || h === null) return null;
      return { space: 'lch', coords: [Math.min(100, Math.max(0, l)), Math.max(0, c), h], alpha };
    }
    case 'oklab': {
      const l = scalar(first, 1);
      const a = scalar(second, 0.4);
      const b = scalar(third, 0.4);
      if (l === null || a === null || b === null) return null;
      return { space: 'oklab', coords: [clamp01(l), a, b], alpha };
    }
    case 'oklch': {
      const l = scalar(first, 1);
      const c = scalar(second, 0.4);
      const h = hue(third);
      if (l === null || c === null || h === null) return null;
      return { space: 'oklch', coords: [clamp01(l), Math.max(0, c), h], alpha };
    }
    default:
      return null;
  }
}

/**
 * Parses one CSS colour value into sRGB.
 *
 * Accepts every form a browser produces for a computed colour — hex, `rgb()`,
 * `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()` — plus
 * `transparent`. Named colours and `currentcolor` are deliberately not
 * resolved here: they depend on context the caller has and this does not, and
 * a browser already turned them into one of the forms above.
 */
export function parseCssColor(input: string): CssColor | null {
  const css = input.trim();
  if (!css || css.length > 200) return null;
  const lower = css.toLowerCase();

  let parsed: Coordinates | null;
  if (lower === 'transparent') {
    parsed = { space: 'srgb', coords: [0, 0, 0], alpha: 0 };
  } else if (lower.startsWith('#')) {
    parsed = readHex(lower);
  } else {
    const match = /^([a-z0-9-]+)\(([^()]*)\)$/i.exec(css);
    parsed = match ? readFunction(match[1]!.toLowerCase(), match[2]!) : null;
  }
  if (!parsed || parsed.coords.some((value) => !Number.isFinite(value))) return null;

  const xyz = toXyzD65(parsed.space, parsed.coords);
  const oklch = oklabToOklch(xyzToOklab(xyz));
  // The sRGB family is already in the destination space; a round trip through
  // XYZ would only add floating-point noise to channels that are exact.
  const encoded = SRGB_FAMILY.has(parsed.space) ? parsed.coords : encode(multiply(XYZ_TO_LIN_SRGB, xyz));
  const inGamut = inSrgbGamut(encoded);
  const mapped = inGamut ? clip(encoded) : gamutMapToSrgb(oklch);
  const srgb = { r: mapped[0], g: mapped[1], b: mapped[2] };
  const alpha = clamp01(parsed.alpha);

  return {
    css,
    space: parsed.space,
    srgb,
    alpha,
    hex: srgbToHex(srgb),
    hex8: `${srgbToHex(srgb)}${toByte(alpha).toString(16).padStart(2, '0')}`,
    oklch,
    inGamut,
  };
}

/** `#rrggbb` from gamma-encoded sRGB channels in 0..1. */
export function srgbToHex({ r, g, b }: SrgbColor): string {
  return `#${[r, g, b].map((channel) => toByte(channel).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A translucent colour over an opaque backdrop, as the browser paints it.
 *
 * Compositing happens on gamma-encoded values: that is what CSS specifies and
 * what every browser does, so the result is the colour a viewer actually sees
 * rather than the physically "correct" linear blend.
 */
export function compositeOver(foreground: Pick<CssColor, 'srgb' | 'alpha'>, backdrop: SrgbColor): SrgbColor {
  const a = foreground.alpha;
  return {
    r: foreground.srgb.r * a + backdrop.r * (1 - a),
    g: foreground.srgb.g * a + backdrop.g * (1 - a),
    b: foreground.srgb.b * a + backdrop.b * (1 - a),
  };
}

/** OKLab of an sRGB colour, for perceptual distances between measured colours. */
export function srgbToOklabColor({ r, g, b }: SrgbColor): OklabColor {
  const [l, a, bb] = srgbToOklab([r, g, b]);
  return { l, a, b: bb };
}

function toByte(channel: number): number {
  return Math.round(clamp01(channel) * 255);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
