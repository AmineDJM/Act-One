/**
 * The palette, measured inside the page.
 *
 * Runs in the customer's page through `page.evaluate`, which serialises this
 * one function: everything it needs is declared inside it, and it returns raw
 * computed values for Node to parse. Colours are reported exactly as the
 * browser computed them — `oklch(…)`, `color(display-p3 …)`, `rgb(…)` — and
 * weighed by what a visitor actually sees: a background counts for the part
 * of its box its children leave uncovered, text by its ink, a border by its
 * stroke area.
 */
export type RawColorUsage = 'background' | 'text' | 'border' | 'fill' | 'stroke' | 'gradient' | 'shadow';

export type RawColorUse = {
  css: string;
  usage: RawColorUsage;
  weight: number;
  elements: number;
  interactive: boolean;
};

export type RawPalette = {
  uses: RawColorUse[];
  gradients: { css: string; stops: string[]; area: number }[];
  tokens: { name: string; value: string; color: string | null }[];
  themeColor: string | null;
  canvas: string;
  pairs: { background: string; color: string; area: number }[];
  scanned: number;
  truncated: boolean;
};

export function probePalette(options: { maxElements: number; maxTokens: number }): RawPalette {
  const COLOR = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|#[0-9a-fA-F]{3,8}\b/g;
  const INTERACTIVE = 'a[href],button,[role="button"],input[type="submit"],input[type="button"],summary';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD', 'TITLE']);
  const REPLACED = new Set(['IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'IFRAME', 'EMBED', 'OBJECT']);
  const MAX_SIDE = 20_000;

  const invisibleColor = (css: string): boolean =>
    !css || css === 'transparent' || css === 'rgba(0, 0, 0, 0)' || /\/\s*0(\.0+)?%?\s*\)$/.test(css);

  const uses = new Map<string, RawColorUse>();
  const add = (css: string, usage: RawColorUsage, weight: number, interactive: boolean): void => {
    if (invisibleColor(css) || !(weight > 0)) return;
    const key = `${usage}|${css}`;
    const existing = uses.get(key);
    if (existing) {
      existing.weight += weight;
      existing.elements += 1;
      existing.interactive ||= interactive;
    } else {
      uses.set(key, { css, usage, weight, elements: 1, interactive });
    }
  };

  const visible = (element: Element, style: CSSStyleDeclaration): boolean => {
    const check = (element as Element & {
      checkVisibility?: (options: Record<string, boolean>) => boolean;
    }).checkVisibility;
    if (typeof check === 'function') {
      return check.call(element, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
    }
    return style.visibility === 'visible' && Number.parseFloat(style.opacity) > 0;
  };

  const gradients: RawPalette['gradients'] = [];
  const pairs: RawPalette['pairs'] = [];
  let scanned = 0;
  let truncated = false;

  /*
   * Post-order walk: an element's visible background is its box minus what
   * its descendants paint over it. Returns the area this subtree covers
   * opaquely, clipped to the element's own box.
   */
  const visit = (element: Element, depth: number): number => {
    if (scanned >= options.maxElements) {
      truncated = true;
      return 0;
    }
    if (SKIP.has(element.tagName) || depth > 400) return 0;
    scanned += 1;

    const style = getComputedStyle(element);
    if (style.display === 'none') return 0;
    const rect = element.getBoundingClientRect();
    const width = Math.min(rect.width, MAX_SIDE);
    const height = Math.min(rect.height, MAX_SIDE);
    const area = width * height;

    let covered = 0;
    for (const child of Array.from(element.children)) covered += visit(child, depth + 1);
    covered = Math.min(covered, area);

    if (area < 1 || !visible(element, style)) return covered;
    const interactive = element.closest(INTERACTIVE) !== null;

    const background = style.backgroundColor;
    const hasBackground = !invisibleColor(background);
    const ownArea = Math.max(0, area - covered);
    if (hasBackground) add(background, 'background', ownArea, interactive);

    if (/gradient\(/i.test(style.backgroundImage)) {
      const stops = style.backgroundImage.match(COLOR) ?? [];
      if (stops.length > 0) {
        if (gradients.length < 40) {
          gradients.push({ css: style.backgroundImage.slice(0, 2000), stops: stops.slice(0, 16), area: ownArea });
        }
        const share = ownArea / stops.length;
        for (const stop of stops) add(stop, 'gradient', share, interactive);
      }
    }

    // Text by ink: direct text only, so a heading and the span inside it
    // each count their own words once.
    let characters = 0;
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3) characters += (node.textContent ?? '').trim().length;
    }
    if (characters > 0) {
      const size = Number.parseFloat(style.fontSize) || 16;
      const ink = characters * size * size * 0.5;
      const fill = (style as CSSStyleDeclaration & { webkitTextFillColor?: string }).webkitTextFillColor ?? '';
      const clippedToText = /text/.test(style.backgroundClip) || /text/.test((style as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip ?? '');
      if (clippedToText && invisibleColor(fill)) {
        const stops = style.backgroundImage.match(COLOR) ?? [];
        for (const stop of stops) add(stop, 'text', ink / Math.max(1, stops.length), interactive);
      } else {
        add(fill && !invisibleColor(fill) ? fill : style.color, 'text', ink, interactive);
      }
    }

    const sides: [string, string, string, number][] = [
      [style.borderTopWidth, style.borderTopStyle, style.borderTopColor, width],
      [style.borderRightWidth, style.borderRightStyle, style.borderRightColor, height],
      [style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor, width],
      [style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor, height],
    ];
    for (const [widthCss, lineStyle, color, length] of sides) {
      const stroke = Number.parseFloat(widthCss);
      if (stroke > 0 && lineStyle !== 'none' && lineStyle !== 'hidden') add(color, 'border', stroke * length, interactive);
    }

    if (element instanceof SVGElement && element.tagName.toLowerCase() !== 'svg') {
      const fill = style.fill;
      if (fill && fill !== 'none' && !fill.startsWith('url(')) add(fill, 'fill', area, interactive);
      const strokeWidth = Number.parseFloat(style.strokeWidth);
      if (style.stroke && style.stroke !== 'none' && !style.stroke.startsWith('url(') && strokeWidth > 0) {
        add(style.stroke, 'stroke', 2 * (width + height) * strokeWidth, interactive);
      }
    }

    /*
     * A shadow with no offset and no blur is not a shadow: it is how design
     * systems draw a border without changing layout (Tailwind's rings, most
     * of Vercel's hairlines). It is counted as the border it looks like.
     */
    if (style.boxShadow && style.boxShadow !== 'none') {
      for (const layer of style.boxShadow.split(/,(?![^()]*\))/)) {
        const color = layer.match(COLOR)?.[0];
        if (!color) continue;
        const lengths = (layer.replace(COLOR, '').match(/-?\d*\.?\d+px/g) ?? []).map((value) => Number.parseFloat(value));
        const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = lengths;
        if (offsetX === 0 && offsetY === 0 && blur === 0 && spread > 0) {
          add(color, 'border', spread * 2 * (width + height), interactive);
        } else {
          add(color, 'shadow', area * 0.05, interactive);
        }
      }
    }

    if (hasBackground && element.matches(INTERACTIVE) && pairs.length < 60) {
      pairs.push({ background, color: style.color, area });
    }

    // What hides the parent's background: an opaque colour, any image or
    // gradient, or a replaced element drawing its own pixels.
    const translucent = /\/\s*0?\.\d+\s*\)$|rgba\([^)]*,\s*0?\.\d+\)$/.test(background);
    const paintsBox =
      (hasBackground && !translucent) ||
      style.backgroundImage !== 'none' ||
      REPLACED.has(element.tagName.toUpperCase());
    return paintsBox ? area : covered;
  };

  if (document.body) visit(document.body, 0);

  // The canvas: what the browser paints behind everything when nothing else does.
  const canvasOf = (): string => {
    for (const element of [document.documentElement, document.body]) {
      if (!element) continue;
      const background = getComputedStyle(element).backgroundColor;
      if (!invisibleColor(background)) return background;
    }
    return 'rgb(255, 255, 255)';
  };

  /*
   * Design tokens. Custom properties are enumerable on computed style; each
   * is resolved as a colour through a probe whose parent carries a sentinel,
   * so a token that is not a colour resolves to the sentinel and is dropped.
   */
  const tokens: RawPalette['tokens'] = [];
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1px;height:1px;color:rgb(1, 2, 3);';
  const probe = document.createElement('span');
  host.appendChild(probe);
  const SENTINEL = 'rgb(1, 2, 3)';
  const scopes: [Element, Element][] = [[document.documentElement, document.documentElement]];
  if (document.body) scopes.push([document.body, document.body]);
  const seenTokens = new Set<string>();
  try {
    for (const [scope, mount] of scopes) {
      mount.appendChild(host);
      const computed = getComputedStyle(scope);
      for (let index = 0; index < computed.length && tokens.length < options.maxTokens; index += 1) {
        const name = computed[index]!;
        if (!name.startsWith('--') || seenTokens.has(name)) continue;
        seenTokens.add(name);
        const value = computed.getPropertyValue(name).trim();
        if (!value || value.length > 400) continue;
        probe.style.removeProperty('color');
        probe.style.setProperty('color', `var(${name})`);
        const resolved = getComputedStyle(probe).color;
        tokens.push({ name, value, color: resolved === SENTINEL ? null : resolved });
      }
      host.remove();
    }
  } finally {
    host.remove();
  }

  let themeColor: string | null = null;
  for (const meta of Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))) {
    const media = meta.getAttribute('media');
    if (media && !window.matchMedia(media).matches) continue;
    const content = (meta.getAttribute('content') ?? '').trim();
    if (!content || content.length > 100) continue;
    const swatch = document.createElement('span');
    swatch.style.color = 'rgb(1, 2, 3)';
    swatch.style.color = content;
    document.documentElement.appendChild(swatch);
    const resolved = getComputedStyle(swatch).color;
    swatch.remove();
    if (resolved !== SENTINEL) {
      themeColor = resolved;
      break;
    }
  }

  return {
    uses: [...uses.values()],
    gradients,
    tokens,
    themeColor,
    canvas: canvasOf(),
    pairs,
    scanned,
    truncated,
  };
}
