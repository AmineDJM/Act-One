/**
 * The interface pieces worth lifting out whole: the hero, the buttons, the cards.
 *
 * Found by what they look like, not by what they are called — class names on
 * the web are hashed or utility soup — and ranked by the evidence a designer
 * would use: a button is a short piece of text on a painted, padded, rounded
 * box; a card is a painted box with a heading and some copy, usually one of a
 * row of siblings that look the same. Distinct styles are kept, not the ten
 * identical cards of a grid.
 *
 * `isolateForCapture` and `restoreAfterCapture` prepare one element for a
 * transparent capture: every ancestor stops painting, everything overlapping
 * that is not part of the element hides, and nothing moves — visibility and
 * colour change, layout does not.
 *
 * All three are serialised by `page.evaluate`: self-contained.
 */
export type RawComponentKind = 'hero' | 'button' | 'card';

export type RawComponent = {
  marker: string;
  kind: RawComponentKind;
  score: number;
  reasons: string[];
  label: string;
  signature: string;
  rect: { x: number; y: number; width: number; height: number };
  style: {
    background: string;
    color: string;
    borderColor: string;
    borderWidth: number;
    borderRadius: number;
    boxShadow: string;
    fontFamily: string;
    fontWeight: string;
    fontSize: string;
    textTransform: string;
    padding: [number, number, number, number];
  };
};

export const COMPONENT_MARKER = 'data-actone-component';

export function probeComponents(options: { buttons: number; cards: number; hero: boolean }): RawComponent[] {
  const MARKER = 'data-actone-component';
  for (const marked of Array.from(document.querySelectorAll(`[${MARKER}]`))) marked.removeAttribute(MARKER);

  const transparent = (css: string): boolean => !css || css === 'transparent' || css === 'rgba(0, 0, 0, 0)';
  const visible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    const check = (element as Element & { checkVisibility?: (options: Record<string, boolean>) => boolean })
      .checkVisibility;
    return typeof check === 'function' ? check.call(element, { opacityProperty: true, visibilityProperty: true }) : true;
  };
  const effectiveBackground = (element: Element | null): string => {
    let current = element;
    while (current) {
      const background = getComputedStyle(current).backgroundColor;
      if (!transparent(background)) return background;
      current = current.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };
  const borderOf = (style: CSSStyleDeclaration): { width: number; color: string } => {
    const width = Number.parseFloat(style.borderTopWidth) || 0;
    const drawn = width > 0 && style.borderTopStyle !== 'none' && style.borderTopStyle !== 'hidden' && !transparent(style.borderTopColor);
    return drawn ? { width, color: style.borderTopColor } : { width: 0, color: '' };
  };
  const snapshot = (element: Element): RawComponent['style'] => {
    const style = getComputedStyle(element);
    const border = borderOf(style);
    return {
      background: style.backgroundColor,
      color: style.color,
      borderColor: border.color,
      borderWidth: border.width,
      borderRadius: Number.parseFloat(style.borderTopLeftRadius) || 0,
      boxShadow: style.boxShadow === 'none' ? '' : style.boxShadow.slice(0, 600),
      fontFamily: style.fontFamily.slice(0, 400),
      fontWeight: style.fontWeight,
      fontSize: style.fontSize,
      textTransform: style.textTransform,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
        (value) => Number.parseFloat(value) || 0,
      ) as [number, number, number, number],
    };
  };
  const documentRect = (element: Element): RawComponent['rect'] => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
  };
  // innerText, not textContent: it breaks where the layout breaks, so a card
  // reads "Passport Secure every agent" rather than "PassportSecure every agent".
  const text = (element: Element): string =>
    ((element as HTMLElement).innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
  const chrome = (element: Element): boolean =>
    element.closest('footer,[role="contentinfo"],[aria-modal="true"],[role="dialog"]') !== null ||
    /cookie|consent|gdpr/i.test(`${element.getAttribute('class') ?? ''} ${element.id}`);

  const found: RawComponent[] = [];
  let counter = 0;
  const mark = (element: Element, component: Omit<RawComponent, 'marker' | 'rect' | 'style'>): void => {
    counter += 1;
    const marker = `${component.kind}-${counter}`;
    element.setAttribute(MARKER, marker);
    found.push({ ...component, marker, rect: documentRect(element), style: snapshot(element) });
  };

  // The hero: the first full-width block that holds the page's main heading.
  let hero: Element | null = null;
  if (options.hero) {
    const heading =
      Array.from(document.querySelectorAll('h1')).find(visible) ??
      Array.from(document.querySelectorAll('h2')).find(
        (element) => visible(element) && element.getBoundingClientRect().top < window.innerHeight,
      ) ??
      null;
    let current: Element | null = heading;
    while (current && current !== document.body && current !== document.documentElement) {
      const rect = current.getBoundingClientRect();
      const wide = rect.width >= window.innerWidth * 0.6;
      const tall = rect.height >= window.innerHeight * 0.4;
      if (wide && tall) {
        // Stop before a container that is most of the page rather than one section of it.
        const pageHeight = document.documentElement.scrollHeight;
        if (current.tagName === 'MAIN' || rect.height > pageHeight * 0.7) break;
        hero = current;
        break;
      }
      current = current.parentElement;
    }
    if (hero && heading) {
      mark(hero, {
        kind: 'hero',
        score: 10,
        reasons: ['holds the main heading', 'spans the page'],
        label: text(heading).slice(0, 120),
        signature: 'hero',
      });
    }
  }

  // Buttons.
  const buttons: { element: Element; score: number; reasons: string[]; signature: string }[] = [];
  for (const element of Array.from(
    document.querySelectorAll('a[href],button,[role="button"],input[type="submit"],input[type="button"]'),
  ).slice(0, 1500)) {
    if (!visible(element) || chrome(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.height < 24 || rect.height > 96 || rect.width < 48 || rect.width > 480) continue;
    const label = element instanceof HTMLInputElement ? element.value : text(element);
    if (label.length < 1 || label.length > 40) continue;
    const style = getComputedStyle(element);
    const painted = !transparent(style.backgroundColor) || style.backgroundImage !== 'none';
    const border = borderOf(style);
    const padded = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0) >= 12;
    if (!(painted || border.width > 0) || !padded) continue;

    const reasons: string[] = [];
    let score = 0;
    if (painted) {
      score += 3;
      reasons.push('a painted box');
    } else {
      score += 1.5;
      reasons.push('an outlined box');
    }
    if (hero && hero.contains(element)) {
      score += 4;
      reasons.push('a call to action in the hero');
    }
    if (rect.top + window.scrollY < window.innerHeight) {
      score += 1.5;
      reasons.push('on the first screen');
    }
    if (element.closest('header,nav,[role="banner"]')) {
      score += 0.5;
      reasons.push('in the navigation');
    }
    if ((Number.parseFloat(style.borderTopLeftRadius) || 0) > 0) score += 0.5;
    const signature = [
      style.backgroundColor,
      style.backgroundImage === 'none' ? '' : 'image',
      style.color,
      border.color,
      Math.round(Number.parseFloat(style.borderTopLeftRadius) || 0),
      style.fontWeight,
      style.textTransform,
      Math.round(rect.height / 4),
    ].join('|');
    buttons.push({ element, score, reasons, signature });
  }
  const buttonSignatures = new Set<string>();
  for (const candidate of buttons.sort((a, b) => b.score - a.score)) {
    if (buttonSignatures.size >= options.buttons) break;
    if (buttonSignatures.has(candidate.signature)) continue;
    // A button inside a button already kept (an icon wrapper, a nested span) is the same control.
    if (candidate.element.parentElement?.closest(`[${MARKER}^="button-"]`)) continue;
    if (candidate.element.querySelector(`[${MARKER}^="button-"]`)) continue;
    buttonSignatures.add(candidate.signature);
    const element = candidate.element;
    mark(element, {
      kind: 'button',
      score: candidate.score,
      reasons: candidate.reasons,
      label: (element instanceof HTMLInputElement ? element.value : text(element)).slice(0, 80),
      signature: candidate.signature,
    });
  }

  // Cards.
  const cards: { element: Element; score: number; reasons: string[]; signature: string }[] = [];
  for (const element of Array.from(document.querySelectorAll('div,article,li,section,a,aside')).slice(0, 5000)) {
    if (!visible(element) || chrome(element)) continue;
    if (element.closest('header,nav,[role="banner"]')) continue;
    if (hero && (element === hero || element.contains(hero))) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 180 || rect.width > 760 || rect.height < 120 || rect.height > 900) continue;
    const style = getComputedStyle(element);
    const parentBackground = effectiveBackground(element.parentElement);
    const ownBackground = style.backgroundColor;
    const lifted = !transparent(ownBackground) && ownBackground !== parentBackground;
    const border = borderOf(style);
    const shadowed = style.boxShadow !== 'none';
    if (!lifted && border.width === 0 && !shadowed) continue;
    const content = text(element);
    if (content.length < 20) continue;
    if (!element.querySelector('h2,h3,h4,h5,strong,b,img,svg,picture,[class*="title" i]')) continue;

    const reasons: string[] = [];
    let score = 1;
    if (lifted) {
      score += 2;
      reasons.push('lifted off its background');
    }
    if (shadowed) {
      score += 1.5;
      reasons.push('casts a shadow');
    }
    if (border.width > 0) {
      score += 1;
      reasons.push('outlined');
    }
    const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
    if (radius >= 4) {
      score += 1;
      reasons.push('rounded');
    }
    const parent = element.parentElement;
    if (parent) {
      const alike = Array.from(parent.children).filter((sibling) => {
        if (sibling === element || sibling.tagName !== element.tagName) return false;
        const other = sibling.getBoundingClientRect();
        return Math.abs(other.width - rect.width) < rect.width * 0.2 && Math.abs(other.height - rect.height) < rect.height * 0.35;
      }).length;
      if (alike >= 1) {
        score += Math.min(4, 2 + alike);
        reasons.push(`one of ${alike + 1} alike`);
      }
    }
    const signature = [
      ownBackground,
      border.color,
      Math.round(radius),
      shadowed ? style.boxShadow.slice(0, 60) : '',
      Math.round(rect.width / 40),
    ].join('|');
    cards.push({ element, score, reasons, signature });
  }
  const cardSignatures = new Set<string>();
  for (const candidate of cards.sort((a, b) => b.score - a.score)) {
    if (cardSignatures.size >= options.cards) break;
    if (cardSignatures.has(candidate.signature)) continue;
    // A card inside a card already kept is the same component seen twice.
    if (candidate.element.closest(`[${MARKER}^="card-"]`) || candidate.element.querySelector(`[${MARKER}^="card-"]`)) continue;
    cardSignatures.add(candidate.signature);
    mark(candidate.element, {
      kind: 'card',
      score: candidate.score,
      reasons: candidate.reasons,
      label: text(candidate.element).slice(0, 120),
      signature: candidate.signature,
    });
  }

  return found;
}

export type IsolationResult = {
  rect: { x: number; y: number; width: number; height: number };
  clip: { x: number; y: number; width: number; height: number };
  hidden: number;
} | null;

export function isolateForCapture(input: {
  selector: string;
  transparent: boolean;
  maxHeight: number;
}): IsolationResult {
  const target = document.querySelector(input.selector);
  if (!target) return null;
  const STYLE_ID = 'actone-isolation-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '[data-actone-ancestor]{background-color:transparent!important;background-image:none!important;box-shadow:none!important;border-color:transparent!important;outline-color:transparent!important;backdrop-filter:none!important;}',
      '[data-actone-ancestor]::before,[data-actone-ancestor]::after{visibility:hidden!important;}',
      '[data-actone-hide]{visibility:hidden!important;}',
    ].join('\n');
    document.head.appendChild(style);
  }

  const box = target.getBoundingClientRect();
  const rect = { x: box.left + window.scrollX, y: box.top + window.scrollY, width: box.width, height: box.height };

  // How far the element paints past its box: shadows, outlines, and
  // descendants that overflow a visible parent.
  const style = getComputedStyle(target);
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  const shadows = style.boxShadow === 'none' ? [] : style.boxShadow.split(/,(?![^()]*\))/);
  for (const shadow of shadows) {
    if (/\binset\b/.test(shadow)) continue;
    const lengths = (shadow.replace(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|#[0-9a-f]+/gi, '').match(/-?\d*\.?\d+px/g) ?? [])
      .map((value) => Number.parseFloat(value));
    const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = lengths;
    const reach = blur + spread;
    top = Math.max(top, reach - offsetY);
    bottom = Math.max(bottom, reach + offsetY);
    left = Math.max(left, reach - offsetX);
    right = Math.max(right, reach + offsetX);
  }
  const outline = (Number.parseFloat(style.outlineWidth) || 0) + Math.max(0, Number.parseFloat(style.outlineOffset) || 0);
  if (style.outlineStyle !== 'none' && outline > 0) {
    top = Math.max(top, outline);
    right = Math.max(right, outline);
    bottom = Math.max(bottom, outline);
    left = Math.max(left, outline);
  }
  if (style.overflow === 'visible') {
    for (const child of Array.from(target.querySelectorAll('*')).slice(0, 400)) {
      const inner = child.getBoundingClientRect();
      if (inner.width < 1 || inner.height < 1) continue;
      top = Math.max(top, Math.min(box.height * 0.5, box.top - inner.top));
      left = Math.max(left, Math.min(box.width * 0.5, box.left - inner.left));
      bottom = Math.max(bottom, Math.min(box.height * 0.5, inner.bottom - box.bottom));
      right = Math.max(right, Math.min(box.width * 0.5, inner.right - box.right));
    }
  }
  const margin = 2;
  const clip = {
    x: Math.max(0, rect.x - left - margin),
    y: Math.max(0, rect.y - top - margin),
    width: rect.width + left + right + margin * 2,
    height: Math.min(input.maxHeight, rect.height + top + bottom + margin * 2),
  };

  let hidden = 0;
  if (input.transparent) {
    for (let current = target.parentElement; current; current = current.parentElement) {
      current.setAttribute('data-actone-ancestor', '');
    }
    const view = {
      left: clip.x - window.scrollX,
      top: clip.y - window.scrollY,
      right: clip.x - window.scrollX + clip.width,
      bottom: clip.y - window.scrollY + clip.height,
    };
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      if (element === target || target.contains(element) || element.contains(target)) continue;
      const other = element.getBoundingClientRect();
      if (other.width < 1 || other.height < 1) continue;
      const overlaps = other.left < view.right && other.right > view.left && other.top < view.bottom && other.bottom > view.top;
      if (!overlaps) continue;
      // Every overlapping element is marked, not only the outermost: a child
      // that declares `visibility: visible` would otherwise show through its
      // hidden parent.
      element.setAttribute('data-actone-hide', '');
      hidden += 1;
    }
  }
  return { rect, clip, hidden };
}

export function restoreAfterCapture(): void {
  for (const element of Array.from(document.querySelectorAll('[data-actone-ancestor]'))) {
    element.removeAttribute('data-actone-ancestor');
  }
  for (const element of Array.from(document.querySelectorAll('[data-actone-hide]'))) {
    element.removeAttribute('data-actone-hide');
  }
}
