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
    /** Small inline SVGs by how they are drawn: stroked outlines, or filled shapes. */
    iconography: { outline: number; filled: number };
    /** Large pictures by kind, and what their alt text says they show. */
    imagery: { photos: number; illustrations: number; screenshots: number; subjects: string[] };
    faviconUrl: string | null;
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

  // Icons: small inline SVGs, counted by whether they are drawn with a
  // stroke and no fill (outline) or with filled shapes. A brand's icon style
  // is one of the first things a designer reads and one of the last a
  // template gets right.
  const iconography = { outline: 0, filled: 0 };
  for (const svg of Array.from(document.querySelectorAll<SVGElement>('svg'))) {
    const rect = svg.getBoundingClientRect();
    if (rect.width < 10 || rect.width > 64 || rect.height < 10 || rect.height > 64) continue;
    const shapes = Array.from(svg.querySelectorAll('path, circle, rect, polygon, line, polyline, ellipse'));
    if (shapes.length === 0) continue;
    let stroked = 0;
    let filledShapes = 0;
    for (const shape of shapes.slice(0, 12)) {
      const style = getComputedStyle(shape);
      const fill = shape.getAttribute('fill') ?? style.fill;
      const stroke = shape.getAttribute('stroke') ?? style.stroke;
      const hasStroke = Boolean(stroke) && stroke !== 'none' && parseFloat(style.strokeWidth || '0') > 0;
      const hasFill = Boolean(fill) && fill !== 'none' && fill !== 'transparent';
      if (hasStroke && !hasFill) stroked += 1;
      else if (hasFill) filledShapes += 1;
    }
    if (stroked > filledShapes) iconography.outline += 1;
    else if (filledShapes > 0) iconography.filled += 1;
  }

  // Pictures: what the page shows at size. Raster images are photographs
  // unless their name says otherwise; large SVGs are illustrations; a wide
  // raster with an app-like name is a screenshot of the product.
  const imagery = { photos: 0, illustrations: 0, screenshots: 0, subjects: [] as string[] };
  for (const node of Array.from(document.querySelectorAll<HTMLImageElement | SVGElement>('img, picture img, svg'))) {
    const rect = node.getBoundingClientRect();
    if (rect.width < 240 || rect.height < 160) continue;
    const isSvg = node.tagName.toLowerCase() === 'svg';
    const src = (isSvg ? '' : (node as HTMLImageElement).currentSrc || node.getAttribute('src') || '').toLowerCase();
    const alt = (node.getAttribute('alt') ?? node.getAttribute('aria-label') ?? '').trim();
    const name = `${src} ${alt} ${node.getAttribute('class') ?? ''}`.toLowerCase();
    if (isSvg || src.endsWith('.svg') || /illustration|illus|vector|drawing/.test(name)) imagery.illustrations += 1;
    else if (/screenshot|screen|dashboard|app|ui|interface|product-?shot|mockup/.test(name) && rect.width / rect.height > 1.2) imagery.screenshots += 1;
    else imagery.photos += 1;
    if (alt.length >= 4 && alt.length <= 80 && imagery.subjects.length < 8 && !imagery.subjects.includes(alt)) imagery.subjects.push(alt);
  }

  const faviconLink =
    document.querySelector<HTMLLinkElement>('link[rel~="icon"][href], link[rel="apple-touch-icon"][href]') ?? null;
  const faviconUrl = faviconLink ? faviconLink.href : null;

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
      iconography,
      imagery,
      faviconUrl,
    },
  };
}

/**
 * Finds the product imagery a page displays: the screenshots of the product
 * the company itself published, as rendered.
 *
 * Runs inside the page, like `probeDocument`, and follows the same rule — no
 * outside helpers. It does not decide whether an image is a photograph or an
 * interface; that is measured from the pixels afterwards. It decides what is
 * worth measuring: large, landscape, visible, in the body of the page, and not
 * a logo, an avatar or a headshot by its own labelling.
 *
 * Chosen elements are tagged with a `data-actone-capture` attribute so the
 * caller can screenshot each one by a selector that cannot collide with the
 * page's own.
 */
export function findProductImagery(max: number): {
  selector: string;
  alt: string;
  width: number;
  height: number;
  top: number;
  src: string;
  /**
   * The source's own pixel width, which is usually larger than the box it is
   * drawn in: a site serving a 2320px screenshot into a 580px slot is the
   * normal case, and capturing the slot throws three quarters of the detail
   * away. Zero when unknown, as for a video poster.
   */
  naturalWidth: number;
}[] {
  const NOISE =
    /logo|avatar|icon|badge|portrait|headshot|team|founder|award|partner|testimonial|profile|emoji|flag|photo|people|person|author|map/i;

  const hidden = (element: Element): boolean => {
    const style = getComputedStyle(element);
    return (
      style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.2
    );
  };

  type Candidate = {
    node: HTMLElement;
    alt: string;
    width: number;
    height: number;
    top: number;
    src: string;
    naturalWidth: number;
    score: number;
  };
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const node of Array.from(document.querySelectorAll<HTMLElement>('img, video'))) {
    // The chrome of the site is not the product.
    if (node.closest('header, footer, nav, [role="banner"], [role="contentinfo"], [role="navigation"]')) {
      continue;
    }
    const rect = node.getBoundingClientRect();
    const { width, height } = rect;
    // Below this the image is an illustration beside a paragraph, and a
    // 4K frame would show every pixel of it.
    if (width < 560 || height < 300) continue;
    const aspect = width / height;
    // Software is landscape. Portrait imagery here is a phone mockup or a
    // person, and neither stages as a window.
    if (aspect < 1.15 || aspect > 2.6) continue;
    const top = rect.top + window.scrollY;
    if (top > 7000 || hidden(node)) continue;

    const src =
      node instanceof HTMLImageElement
        ? node.currentSrc || node.src
        : (node as HTMLVideoElement).poster || (node as HTMLVideoElement).currentSrc || '';
    const key = src || `${Math.round(top)}:${Math.round(width)}`;
    if (seen.has(key)) continue;

    const alt = node.getAttribute('alt') ?? node.getAttribute('aria-label') ?? '';
    const haystack = [alt, node.className, node.id, src, node.closest('figure')?.className ?? '']
      .map((value) => String(value ?? ''))
      .join(' ');
    if (NOISE.test(haystack)) continue;

    if (node instanceof HTMLImageElement) {
      // Not yet loaded, or upscaled from a thumbnail: soft on a big frame.
      if (!node.complete || (node.naturalWidth > 0 && node.naturalWidth < 720)) continue;
    } else {
      const video = node as HTMLVideoElement;
      if (!video.poster && video.readyState < 2) continue;
    }

    seen.add(key);
    candidates.push({
      node,
      alt: alt.slice(0, 200),
      width: Math.round(width),
      height: Math.round(height),
      top: Math.round(top),
      src: src.slice(0, 500),
      naturalWidth: node instanceof HTMLImageElement ? node.naturalWidth : 0,
      // Big and high on the page: the hero product shot, which is the one the
      // company chose to lead with.
      score: (width * height) / (1 + top / 1500),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, Math.max(0, max));
  chosen.forEach((candidate, index) => {
    candidate.node.setAttribute('data-actone-capture', String(index));
  });
  return chosen.map((candidate, index) => ({
    selector: `[data-actone-capture="${index}"]`,
    alt: candidate.alt,
    width: candidate.width,
    height: candidate.height,
    top: candidate.top,
    src: candidate.src,
    naturalWidth: candidate.naturalWidth,
  }));
}

/**
 * Hides fixed and sticky elements that overlap an element about to be
 * captured, and returns how many it hid.
 *
 * An element screenshot is a crop of the page, so a sticky header or a
 * floating chat button sitting over the product image ends up in the film.
 * Marked rather than removed, and `unshieldCapture` restores the page.
 */
export function shieldCapture(selector: string): number {
  const target = document.querySelector(selector);
  if (!target) return 0;
  const box = target.getBoundingClientRect();
  let hidden = 0;
  for (const element of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    if (element === target || element.contains(target)) continue;
    const position = getComputedStyle(element).position;
    if (position !== 'fixed' && position !== 'sticky') continue;
    const rect = element.getBoundingClientRect();
    const overlaps =
      rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
    if (!overlaps) continue;
    element.setAttribute('data-actone-shield', '');
    hidden += 1;
  }
  return hidden;
}

export function unshieldCapture(): void {
  for (const element of Array.from(document.querySelectorAll('[data-actone-shield]'))) {
    element.removeAttribute('data-actone-shield');
  }
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
  [class*="banner-notice" i], [aria-label*="cookie" i],
  [role="dialog"], [aria-modal="true"],
  [class*="modal" i], [id*="modal" i],
  [class*="popup" i], [id*="popup" i],
  [class*="newsletter" i] {
    display: none !important;
  }
  [data-actone-shield] { visibility: hidden !important; }
  ::-webkit-scrollbar { display: none !important; }
  html { scrollbar-width: none !important; }
`;
