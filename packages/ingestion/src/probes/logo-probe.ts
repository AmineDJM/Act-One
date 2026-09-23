/**
 * The brand's mark, found and lifted out of the page.
 *
 * `probeLogo` ranks what could be the logo by the evidence a person would use
 * (it links home, it is named like one, it carries the site's name, it sits
 * in the header, top left) and marks each candidate so it can be captured.
 * `bakeSvg` turns an inline SVG, or SVG markup the page loaded, into a
 * standalone file: every style the page's CSS applied is written onto the
 * element as a presentation attribute, `<use>` references and gradients are
 * copied in, and nothing that executes survives. Node sanitises the result
 * again with a strict allowlist; this is not the security boundary, only the
 * first pass.
 *
 * Both functions are serialised by `page.evaluate`: self-contained.
 */
export type RawLogoKind = 'inline-svg' | 'img-svg' | 'img-raster' | 'css-background' | 'element' | 'favicon-svg';

export type RawLogoCandidate = {
  marker: string | null;
  kind: RawLogoKind;
  score: number;
  reasons: string[];
  rect: { x: number; y: number; width: number; height: number } | null;
  src: string | null;
  label: string;
  backdrop: string | null;
};

export const LOGO_MARKER = 'data-actone-logo';

export function probeLogo(options: { siteName: string; maxCandidates: number }): RawLogoCandidate[] {
  const MARKER = 'data-actone-logo';
  for (const marked of Array.from(document.querySelectorAll(`[${MARKER}]`))) marked.removeAttribute(MARKER);

  const origin = location.origin;
  const siteWords = options.siteName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
  const LOGO_WORDS = /logo|brand|wordmark|lockup/i;
  const SOCIAL = /twitter|x\.com|github|linkedin|facebook|instagram|youtube|tiktok|discord|app ?store|google ?play|product ?hunt|g2\b|capterra/i;

  const linksHome = (element: Element): boolean => {
    const anchor = element.closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return false;
    try {
      const url = new URL(anchor.href, location.href);
      return url.origin === origin && (url.pathname === '/' || url.pathname === '') && !url.search;
    } catch {
      return false;
    }
  };

  const describe = (element: Element): string =>
    [
      element.getAttribute('alt'),
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.querySelector('title')?.textContent,
      element.closest('a[href]')?.getAttribute('aria-label'),
    ]
      .filter((value): value is string => Boolean(value && value.trim()))
      .join(' ')
      .trim()
      .slice(0, 200);

  const haystack = (element: Element): string =>
    [
      element.getAttribute('class'),
      element.id,
      element.getAttribute('aria-label'),
      element.getAttribute('alt'),
      element.getAttribute('title'),
      element.getAttribute('data-testid'),
      element.getAttribute('src'),
      element.parentElement?.getAttribute('class'),
      element.closest('a[href]')?.getAttribute('href'),
    ]
      .filter(Boolean)
      .join(' ');

  const backdropOf = (element: Element): string | null => {
    let current: Element | null = element;
    while (current) {
      const background = getComputedStyle(current).backgroundColor;
      if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') return background;
      current = current.parentElement;
    }
    return null;
  };

  const visible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    const check = (element as Element & { checkVisibility?: (options: Record<string, boolean>) => boolean })
      .checkVisibility;
    return typeof check === 'function' ? check.call(element, { opacityProperty: true, visibilityProperty: true }) : true;
  };

  const kindOf = (element: Element): RawLogoKind | null => {
    const tag = element.tagName.toLowerCase();
    if (tag === 'svg') return 'inline-svg';
    if (tag === 'img') {
      const src = ((element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src || '').toLowerCase();
      return /\.svg(\?|#|$)|^data:image\/svg\+xml/.test(src) ? 'img-svg' : 'img-raster';
    }
    const background = getComputedStyle(element).backgroundImage;
    if (/url\(/.test(background) && element.children.length === 0) return 'css-background';
    return null;
  };

  const pool = new Set<Element>();
  const consider = (element: Element | null): void => {
    if (element && pool.size < 80) pool.add(element);
  };
  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (!linksHome(anchor)) continue;
    for (const child of Array.from(anchor.querySelectorAll('svg,img')).slice(0, 3)) consider(child);
    const hasText = (anchor.textContent ?? '').trim().length > 0;
    if (hasText && anchor.querySelector('svg,img')) consider(anchor);
  }
  const named = document.querySelectorAll(
    '[class*="logo" i],[id*="logo" i],[aria-label*="logo" i],[alt*="logo" i],[title*="logo" i],[data-testid*="logo" i]',
  );
  for (const element of Array.from(named).slice(0, 40)) {
    if (kindOf(element)) consider(element);
    for (const child of Array.from(element.querySelectorAll('svg,img')).slice(0, 2)) consider(child);
  }
  for (const element of Array.from(document.querySelectorAll('header svg, header img, nav svg, nav img, [role="banner"] svg, [role="banner"] img')).slice(0, 8)) {
    consider(element);
  }

  const candidates: RawLogoCandidate[] = [];
  let counter = 0;
  for (const element of pool) {
    if (!visible(element)) continue;
    // An svg nested in a candidate svg is part of it, not a second logo.
    if (element.tagName.toLowerCase() !== 'svg' && element.closest('svg')) continue;
    if (element.parentElement?.closest('svg')) continue;
    const kind = element.tagName.toLowerCase() === 'a' ? 'element' : kindOf(element);
    if (!kind) continue;

    const rect = element.getBoundingClientRect();
    const reasons: string[] = [];
    let score = 0;
    const text = haystack(element);
    const label = describe(element) || (element.textContent ?? '').trim().slice(0, 120);

    if (linksHome(element)) {
      score += 4;
      reasons.push('links to the home page');
    }
    if (LOGO_WORDS.test(text)) {
      score += 3;
      reasons.push('named like a logo');
    }
    // The name in what the element says about itself, never in an href: every
    // internal link on stripe.com contains "stripe", including its customers'.
    const said = `${label} ${element.getAttribute('class') ?? ''} ${element.id}`.toLowerCase();
    if (siteWords.some((word) => said.includes(word))) {
      score += 2;
      reasons.push("carries the site's name");
    }
    // A row of marks is a wall of customers, not the brand's own mark.
    const row = element.closest('li,figure,a,div')?.parentElement;
    if (row) {
      const marks = Array.from(row.children).filter((sibling) => sibling.querySelector('svg,img') !== null).length;
      if (marks >= 4 && !linksHome(element)) {
        score -= 5;
        reasons.push('one of a wall of logos');
      }
    }
    if (element.closest('header,[role="banner"],nav')) {
      score += 2;
      reasons.push('in the page header');
    }
    const top = rect.top + window.scrollY;
    if (top < 150) {
      score += 1.5;
      reasons.push('at the top of the page');
    } else if (top > window.innerHeight) {
      score -= 3;
      reasons.push('below the first screen');
    }
    if (rect.left < window.innerWidth * 0.35) {
      score += 1;
      reasons.push('on the left');
    }
    if (kind === 'inline-svg' || kind === 'img-svg') {
      score += 1;
      reasons.push('vector');
    }
    if (element.closest('footer,[role="contentinfo"]')) {
      score -= 6;
      reasons.push('in the footer');
    }
    if (SOCIAL.test(text)) {
      score -= 6;
      reasons.push('a social or store badge');
    }
    if (rect.width < 16 || rect.height < 10 || rect.width > 600 || rect.height > 220) {
      score -= 4;
      reasons.push('the wrong size for a mark');
    }
    if (rect.width <= 26 && rect.height <= 26 && !linksHome(element)) {
      score -= 3;
      reasons.push('an icon rather than a mark');
    }

    counter += 1;
    const marker = `logo-${counter}`;
    element.setAttribute(MARKER, marker);
    const src =
      kind === 'img-svg' || kind === 'img-raster'
        ? (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src
        : kind === 'css-background'
          ? (/url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(element).backgroundImage)?.[1] ?? null)
          : null;
    candidates.push({
      marker,
      kind,
      score,
      reasons,
      rect: { x: rect.left + window.scrollX, y: top, width: rect.width, height: rect.height },
      src: src ? new URL(src, location.href).href : null,
      label,
      backdrop: backdropOf(element),
    });
  }

  for (const link of Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"][href],link[rel="mask-icon"][href]'),
  )) {
    const href = link.href;
    const svg = /\.svg(\?|#|$)/i.test(href) || link.type === 'image/svg+xml' || link.rel === 'mask-icon';
    if (!svg) continue;
    candidates.push({
      marker: null,
      kind: 'favicon-svg',
      score: 1,
      reasons: ["the site's own icon"],
      rect: null,
      src: href,
      label: link.getAttribute('title') ?? '',
      backdrop: null,
    });
    break;
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, options.maxCandidates);
}

export type BakeInput =
  | { mode: 'element'; marker: string }
  | { mode: 'markup'; markup: string; width: number; height: number };

export type BakeResult = { markup: string; width: number; height: number } | { error: string };

export function bakeSvg(input: BakeInput): BakeResult {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DANGEROUS = new Set([
    'script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas',
    'animate', 'animatemotion', 'animatetransform', 'animatecolor', 'set', 'discard', 'handler', 'listener',
  ]);
  const INHERITED = [
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'clip-rule', 'visibility',
    'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline',
    'paint-order',
  ];
  const OWN_DEFAULTS: Record<string, string> = {
    opacity: '1',
    'stop-color': 'rgb(0, 0, 0)',
    'stop-opacity': '1',
    'flood-color': 'rgb(0, 0, 0)',
    'flood-opacity': '1',
    'mix-blend-mode': 'normal',
  };
  // What an svg draws with when nothing says otherwise; the root need not repeat it.
  const INITIAL: Record<string, string> = {
    fill: 'rgb(0, 0, 0)',
    'fill-opacity': '1',
    'fill-rule': 'nonzero',
    stroke: 'none',
    'stroke-width': '1px',
    'stroke-opacity': '1',
    'stroke-linecap': 'butt',
    'stroke-linejoin': 'miter',
    'stroke-miterlimit': '4',
    'stroke-dasharray': 'none',
    'stroke-dashoffset': '0px',
    'clip-rule': 'nonzero',
    visibility: 'visible',
    'font-style': 'normal',
    'font-weight': '400',
    'letter-spacing': 'normal',
    'text-anchor': 'start',
    'dominant-baseline': 'auto',
    'paint-order': 'normal',
  };
  const TEXT_PROPERTIES = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline']);
  const RESOURCE_TAGS = new Set([
    'defs', 'symbol', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'pattern', 'filter', 'marker', 'stop',
  ]);

  /** Strips what executes or reaches out, in an inert document, before anything is mounted. */
  const scrub = (element: Element): void => {
    for (const child of Array.from(element.children)) {
      if (DANGEROUS.has(child.localName.toLowerCase())) child.remove();
      else scrub(child);
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on')) element.removeAttribute(attribute.name);
      else if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#') && !/^data:image\/(png|jpe?g|webp|gif);/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.localName.toLowerCase() === 'style') {
      element.textContent = (element.textContent ?? '')
        .replace(/@import[^;]*;?/gi, '')
        .replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, 'none');
    }
  };

  let source: SVGSVGElement;
  let mount: HTMLElement | null = null;
  if (input.mode === 'element') {
    const found = document.querySelector(`[data-actone-logo="${CSS.escape(input.marker)}"]`);
    if (!found || found.tagName.toLowerCase() !== 'svg') return { error: 'the candidate is not an inline svg' };
    source = found as SVGSVGElement;
  } else {
    if (input.markup.length > 1_000_000) return { error: 'the svg is too large' };
    const parsed = new DOMParser().parseFromString(input.markup, 'image/svg+xml');
    const root = parsed.documentElement;
    if (parsed.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
      return { error: 'the markup is not a well-formed svg' };
    }
    scrub(root);
    const imported = document.importNode(root, true) as unknown as SVGSVGElement;
    if (!imported.getAttribute('width')) imported.setAttribute('width', String(input.width));
    if (!imported.getAttribute('height')) imported.setAttribute('height', String(input.height));
    mount = document.createElement('div');
    mount.setAttribute('aria-hidden', 'true');
    mount.style.cssText = `position:fixed;left:-100000px;top:0;width:${input.width}px;height:${input.height}px;overflow:hidden;pointer-events:none;`;
    mount.appendChild(imported);
    document.body.appendChild(mount);
    source = imported;
  }

  try {
    const rect = source.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || (input.mode === 'markup' ? input.width : 0)));
    const height = Math.max(1, Math.round(rect.height || (input.mode === 'markup' ? input.height : 0)));

    const removals: Element[] = [];
    const bake = (original: Element, copy: Element, parentStyle: CSSStyleDeclaration | null): void => {
      const tag = original.localName.toLowerCase();
      if (DANGEROUS.has(tag) || tag === 'style' || tag === 'title' || tag === 'desc' || tag === 'metadata') {
        removals.push(copy);
        return;
      }
      const style = getComputedStyle(original);
      if (style.display === 'none' && !RESOURCE_TAGS.has(tag) && parentStyle !== null) {
        removals.push(copy);
        return;
      }
      for (const property of INHERITED) {
        const value = style.getPropertyValue(property).trim();
        if (!value) continue;
        if (parentStyle === null) {
          // The root states only what differs from an svg's own defaults, and
          // type only when there is text to set.
          if (INITIAL[property] === value) continue;
          if (TEXT_PROPERTIES.has(property) && !original.querySelector('text')) continue;
          copy.setAttribute(property, value);
        } else if (parentStyle.getPropertyValue(property).trim() !== value) {
          copy.setAttribute(property, value);
        }
      }
      for (const [property, fallback] of Object.entries(OWN_DEFAULTS)) {
        const value = style.getPropertyValue(property).trim();
        if (value && value !== fallback) copy.setAttribute(property, value);
      }
      copy.removeAttribute('class');
      copy.removeAttribute('style');
      for (const attribute of Array.from(copy.attributes)) {
        if (attribute.name.toLowerCase().startsWith('on')) copy.removeAttribute(attribute.name);
      }
      const originals = Array.from(original.children);
      const copies = Array.from(copy.children);
      for (let index = 0; index < originals.length && index < copies.length; index += 1) {
        bake(originals[index]!, copies[index]!, style);
      }
    };

    const clone = source.cloneNode(true) as SVGSVGElement;
    bake(source, clone, null);
    for (const element of removals) element.remove();

    /*
     * References the file needs but does not contain: a `<use>` pointing at a
     * sprite elsewhere in the page, a gradient defined in another svg. Copied
     * in, baked in their own context, until nothing is missing.
     */
    const scope: ParentNode = input.mode === 'element' ? document : source;
    let defs = clone.querySelector(':scope > defs');
    for (let round = 0; round < 6; round += 1) {
      const wanted = new Set<string>();
      for (const element of Array.from(clone.querySelectorAll('*'))) {
        for (const attribute of Array.from(element.attributes)) {
          const value = attribute.value;
          if ((attribute.name === 'href' || attribute.name === 'xlink:href') && value.startsWith('#')) wanted.add(value.slice(1));
          for (const match of value.matchAll(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/g)) wanted.add(match[1]!);
        }
      }
      const missing = [...wanted].filter((id) => !clone.querySelector(`#${CSS.escape(id)}`));
      if (missing.length === 0) break;
      let copied = 0;
      for (const id of missing.slice(0, 50)) {
        const target =
          input.mode === 'element'
            ? document.getElementById(id)
            : (scope as Element).querySelector(`#${CSS.escape(id)}`);
        if (!target || target.namespaceURI !== SVG_NS) continue;
        if (!defs) {
          defs = document.createElementNS(SVG_NS, 'defs');
          clone.insertBefore(defs, clone.firstChild);
        }
        const copy = target.cloneNode(true) as Element;
        const beforeRemovals = removals.length;
        bake(target, copy, target.parentElement ? getComputedStyle(target.parentElement) : null);
        for (const element of removals.slice(beforeRemovals)) element.remove();
        defs.appendChild(copy);
        copied += 1;
      }
      if (copied === 0) break;
    }

    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    clone.removeAttribute('x');
    clone.removeAttribute('y');
    return { markup: new XMLSerializer().serializeToString(clone), width, height };
  } finally {
    mount?.remove();
  }
}
