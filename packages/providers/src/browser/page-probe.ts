/**
 * Runs inside the customer's page.
 *
 * This is where Brand DNA actually comes from. We do not ask a model what a
 * brand looks like — we measure the rendered document: which colours cover the
 * most painted area, which families are used at which sizes, what the radius
 * and spacing rhythm is. Measurement is reproducible and lands within a pixel
 * of the real brand; asking a model produces a plausible-looking near-miss,
 * and a near-miss is exactly what makes a film feel like a template.
 *
 * Kept as a self-contained string-serialisable function: it is passed to
 * page.evaluate and must not close over anything from the Node side.
 */
export function probeDocument(): {
  title: string;
  text: string;
  links: { href: string; text: string }[];
  styleProfile: {
    colorWeights: { color: string; weight: number; role: 'background' | 'text' | 'accent' }[];
    fontFamilies: { family: string; weight: number; usage: 'display' | 'body' | 'mono' }[];
    borderRadii: number[];
    spacingScale: number[];
    hasGradients: boolean;
    hasGlow: boolean;
    logoCandidates: { src: string; alt: string; width: number; height: number }[];
    maxHeadingSizePx: number;
    bodySizePx: number;
  };
} {
  // Everything probeDocument needs must be defined INSIDE it: page.evaluate
  // serialises this single function and evaluates it in the page, where module
  // scope does not exist. A helper declared outside is silently undefined at
  // runtime, which takes down the whole capture.
  const inlineSvgMarkup = (svg: SVGElement): string => {
    const clone = svg.cloneNode(true) as SVGElement;
    if (!clone.getAttribute('xmlns')) {
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    // A logo that inherits currentColor renders black-on-black once it leaves
    // the page, so resolve it to what the browser actually painted.
    const painted = getComputedStyle(svg).color;
    if (painted && painted.startsWith('rgb')) {
      clone.setAttribute('color', painted);
      if (!clone.getAttribute('fill')) clone.setAttribute('fill', painted);
    }
    if (!clone.getAttribute('viewBox')) {
      const rect = svg.getBoundingClientRect();
      clone.setAttribute('viewBox', `0 0 ${Math.round(rect.width)} ${Math.round(rect.height)}`);
    }
    return clone.outerHTML;
  };

  const toHex = (value: string): string | null => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match || !match[1]) return null;
    const parts = match[1].split(',').map((p) => parseFloat(p.trim()));
    const [r, g, b] = parts;
    const alpha = parts[3] === undefined ? 1 : parts[3];
    if (r === undefined || g === undefined || b === undefined) return null;
    if (alpha < 0.35) return null; // effectively invisible; not part of the brand
    const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  };

  const backgroundWeights = new Map<string, number>();
  const textWeights = new Map<string, number>();
  const accentWeights = new Map<string, number>();
  const fontUsage = new Map<string, { weight: number; maxSize: number; mono: boolean }>();
  const radii = new Map<number, number>();
  const spacings = new Map<number, number>();
  let hasGradients = false;
  let hasGlow = false;
  let maxHeadingSizePx = 0;
  const bodySizes = new Map<number, number>();

  const elements = Array.from(document.body?.querySelectorAll('*') ?? []).slice(0, 4000);

  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const area = Math.min(rect.width, 2400) * Math.min(rect.height, 2400);
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;

    const background = toHex(style.backgroundColor);
    if (background) backgroundWeights.set(background, (backgroundWeights.get(background) ?? 0) + area);

    const hasText = (element.textContent ?? '').trim().length > 0 && element.children.length === 0;
    if (hasText) {
      const color = toHex(style.color);
      const fontSize = parseFloat(style.fontSize) || 16;
      // Text weight is by ink, not by box: a headline should outrank a long
      // paragraph of body copy in the same colour.
      const inkWeight = (element.textContent ?? '').trim().length * fontSize;
      if (color) textWeights.set(color, (textWeights.get(color) ?? 0) + inkWeight);

      const family = style.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? '';
      if (family) {
        const existing = fontUsage.get(family) ?? { weight: 0, maxSize: 0, mono: false };
        existing.weight += inkWeight;
        existing.maxSize = Math.max(existing.maxSize, fontSize);
        existing.mono = existing.mono || /mono|code|courier|consolas/i.test(style.fontFamily);
        fontUsage.set(family, existing);
      }

      if (/^h[1-3]$/i.test(element.tagName)) {
        maxHeadingSizePx = Math.max(maxHeadingSizePx, fontSize);
      } else if (fontSize >= 12 && fontSize <= 24) {
        bodySizes.set(fontSize, (bodySizes.get(fontSize) ?? 0) + 1);
      }
    }

    // Buttons and links carry the accent colour far more reliably than large
    // background panels do.
    const isInteractive =
      element.tagName === 'BUTTON' ||
      element.tagName === 'A' ||
      (element as HTMLElement).getAttribute?.('role') === 'button';
    if (isInteractive) {
      const accent = toHex(style.backgroundColor);
      if (accent && accent !== '#ffffff' && accent !== '#000000') {
        accentWeights.set(accent, (accentWeights.get(accent) ?? 0) + area);
      }
      const border = toHex(style.borderColor);
      if (border) accentWeights.set(border, (accentWeights.get(border) ?? 0) + area * 0.2);
    }

    const radius = parseFloat(style.borderTopLeftRadius);
    if (Number.isFinite(radius) && radius > 0 && radius < 200) {
      const rounded = Math.round(radius);
      radii.set(rounded, (radii.get(rounded) ?? 0) + 1);
    }

    for (const prop of [style.paddingTop, style.paddingLeft, style.marginBottom, style.gap]) {
      const value = parseFloat(prop);
      if (Number.isFinite(value) && value >= 4 && value <= 160) {
        const rounded = Math.round(value);
        spacings.set(rounded, (spacings.get(rounded) ?? 0) + 1);
      }
    }

    if (/gradient\(/i.test(style.backgroundImage)) hasGradients = true;
    if (style.boxShadow && /rgba?\([^)]*\)\s+0(px)?\s+0(px)?\s+\d{2,}/.test(style.boxShadow)) {
      hasGlow = true;
    }
  }

  const rank = <K>(map: Map<K, number>, limit: number): { key: K; weight: number }[] =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, weight]) => ({ key, weight }));

  const colorWeights = [
    ...rank(backgroundWeights, 6).map((entry) => ({
      color: entry.key,
      weight: entry.weight,
      role: 'background' as const,
    })),
    ...rank(textWeights, 5).map((entry) => ({
      color: entry.key,
      weight: entry.weight,
      role: 'text' as const,
    })),
    ...rank(accentWeights, 5).map((entry) => ({
      color: entry.key,
      weight: entry.weight,
      role: 'accent' as const,
    })),
  ];

  const rankedFonts = Array.from(fontUsage.entries()).sort((a, b) => b[1].weight - a[1].weight);
  const displayFamily = rankedFonts
    .slice()
    .sort((a, b) => b[1].maxSize - a[1].maxSize)[0]?.[0];

  const fontFamilies = rankedFonts.slice(0, 4).map(([family, usage]) => ({
    family,
    weight: usage.weight,
    usage: usage.mono
      ? ('mono' as const)
      : family === displayFamily
        ? ('display' as const)
        : ('body' as const),
  }));

  const logoCandidates = Array.from(document.querySelectorAll<Element>('img, svg'))
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.top > 400 || rect.width < 16 || rect.width > 520) return false;
      const haystack = [
        node.getAttribute('alt') ?? '',
        node.getAttribute('class') ?? '',
        node.getAttribute('id') ?? '',
        node.getAttribute('src') ?? '',
        node.getAttribute('aria-label') ?? '',
        node.closest('a')?.getAttribute('href') ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return /logo|brand|wordmark/.test(haystack) || node.closest('header') !== null;
    })
    .slice(0, 8)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      // Inline <svg> is how most well-built sites ship their logo, and it has
      // no src at all. Serialising it to a data URL is the only way to get the
      // real mark rather than falling back to a screenshot crop — and it is
      // vector, which is what a 4K logo reveal needs.
      // percent-encoded rather than base64: btoa throws on any non-Latin-1
      // character, and logos carry ™, © and accented wordmarks routinely.
      const src =
        node.tagName.toLowerCase() === 'svg'
          ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
              inlineSvgMarkup(node as SVGElement),
            )}`
          : node.getAttribute('src') ?? node.getAttribute('data-src') ?? '';
      return {
        src,
        alt: node.getAttribute('alt') ?? node.getAttribute('aria-label') ?? '',
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    })
    .filter((candidate) => candidate.src.length > 0 && candidate.src.length < 200_000);

  const bodySizePx =
    Array.from(bodySizes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 16;

  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .slice(0, 400)
    .map((anchor) => ({
      href: anchor.href,
      text: (anchor.textContent ?? '').trim().slice(0, 140),
    }))
    .filter((link) => link.href.startsWith('http'));

  // innerText, not textContent: we want what a human sees, including the effect
  // of display:none. That distinction matters because this text becomes evidence.
  const text = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').slice(0, 60_000);

  return {
    title: document.title ?? '',
    text,
    links,
    styleProfile: {
      colorWeights,
      fontFamilies,
      borderRadii: rank(radii, 6).map((entry) => entry.key),
      spacingScale: rank(spacings, 8)
        .map((entry) => entry.key)
        .sort((a, b) => a - b),
      hasGradients,
      hasGlow,
      logoCandidates,
      maxHeadingSizePx,
      bodySizePx,
    },
  };
}

/** Injected before capture so screenshots are clean and reproducible. */
export const CLEAN_CAPTURE_CSS = `
  *, *::before, *::after {
    animation-play-state: paused !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
  [class*="cookie" i], [id*="cookie" i],
  [class*="consent" i], [id*="consent" i],
  [class*="gdpr" i], [id*="gdpr" i],
  [class*="intercom" i], [id*="intercom" i],
  [class*="drift" i], [class*="crisp" i], [class*="hubspot-messages" i],
  [class*="banner-notice" i], [aria-label*="cookie" i] {
    display: none !important;
  }
  ::-webkit-scrollbar { display: none !important; }
  html { scrollbar-width: none !important; }
`;
