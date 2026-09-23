/**
 * The type, measured inside the page.
 *
 * Picks one representative element per role, reads its computed type, and
 * marks it so the DevTools protocol can then be asked which font file the
 * renderer actually drew it with. Also reports every face the document loaded
 * and every `@font-face` rule it can read; cross-origin stylesheets, which the
 * CSSOM refuses to open, are named so Node can parse their recorded text.
 *
 * Self-contained: serialised by `page.evaluate`.
 */
export type RawTypeRole = 'display' | 'heading' | 'body' | 'ui' | 'mono';

export type RawTypeSample = {
  role: RawTypeRole;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  fontSize: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  color: string;
  text: string;
};

export type RawLoadedFace = {
  family: string;
  weight: string;
  style: string;
  stretch: string;
  unicodeRange: string;
  status: string;
};

export type RawFontFaceRule = {
  family: string;
  src: string;
  weight: string;
  style: string;
  stretch: string;
  unicodeRange: string;
  baseUrl: string;
};

export type RawTypography = {
  samples: RawTypeSample[];
  loadedFaces: RawLoadedFace[];
  rules: RawFontFaceRule[];
  unreadableSheets: string[];
  lang: string | null;
};

export const TYPE_MARKER = 'data-actone-type';

export function probeTypography(options: { maxCandidates: number; maxRules: number }): RawTypography {
  const MARKER = 'data-actone-type';
  for (const marked of Array.from(document.querySelectorAll(`[${MARKER}]`))) marked.removeAttribute(MARKER);

  const directText = (element: Element): string => {
    let text = '';
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3) text += node.textContent ?? '';
    }
    return text.replace(/\s+/g, ' ').trim();
  };

  const isVisible = (element: Element): boolean => {
    const check = (element as Element & { checkVisibility?: (options: Record<string, boolean>) => boolean })
      .checkVisibility;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    if (typeof check === 'function') {
      return check.call(element, { opacityProperty: true, visibilityProperty: true });
    }
    const style = getComputedStyle(element);
    return style.visibility === 'visible' && Number.parseFloat(style.opacity) > 0;
  };

  type Candidate = { element: Element; text: string; size: number; top: number };
  const candidates: Candidate[] = [];
  const selector = 'h1,h2,h3,h4,h5,h6,p,li,a,button,span,div,code,pre,kbd,samp,blockquote,td,label,strong,em,small,figcaption,dd,dt';
  for (const element of Array.from(document.body?.querySelectorAll(selector) ?? [])) {
    if (candidates.length >= options.maxCandidates) break;
    if (element.closest('[aria-hidden="true"],script,style,noscript,template,svg')) continue;
    const text = directText(element);
    if (text.length < 2 || !isVisible(element)) continue;
    const rect = element.getBoundingClientRect();
    candidates.push({
      element,
      text,
      size: Number.parseFloat(getComputedStyle(element).fontSize) || 16,
      top: rect.top + window.scrollY,
    });
  }

  const chosen = new Map<RawTypeRole, Element>();
  const firstScreens = window.innerHeight * 1.5;

  // Display: the largest type near the top, where the brand makes its first statement.
  const display = candidates
    .filter((candidate) => candidate.top < firstScreens)
    .sort((a, b) => b.size - a.size || Number(b.element.tagName === 'H1') - Number(a.element.tagName === 'H1'))[0];
  if (display) chosen.set('display', display.element);

  const heading = candidates.find(
    (candidate) => /^H[2-3]$/.test(candidate.element.tagName) && candidate.element !== display?.element,
  );
  if (heading) chosen.set('heading', heading.element);

  // Body: the size and family that carry the most running text.
  const groups = new Map<string, { characters: number; best: Candidate }>();
  for (const candidate of candidates) {
    if (!/^(P|LI|DD|BLOCKQUOTE|TD|FIGCAPTION|SPAN|DIV)$/.test(candidate.element.tagName)) continue;
    if (candidate.text.length < 24 || candidate.size < 11 || candidate.size > 26) continue;
    const style = getComputedStyle(candidate.element);
    const key = `${style.fontFamily}|${style.fontSize}|${style.fontWeight}`;
    const group = groups.get(key) ?? { characters: 0, best: candidate };
    group.characters += candidate.text.length;
    if (candidate.text.length > group.best.text.length) group.best = candidate;
    groups.set(key, group);
  }
  const body = [...groups.values()].sort((a, b) => b.characters - a.characters)[0];
  if (body) chosen.set('body', body.best.element);

  // UI: a button's type, which is usually a different weight or case from the body.
  const ui = candidates.find((candidate) => {
    const control = candidate.element.closest('button,[role="button"],a,input[type="submit"]');
    if (!control) return false;
    const style = getComputedStyle(control);
    const boxed =
      style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
      (Number.parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none');
    return boxed && candidate.text.length <= 40;
  });
  if (ui) chosen.set('ui', ui.element);

  const mono = candidates.find((candidate) => candidate.element.closest('code,pre,kbd,samp') !== null);
  if (mono) chosen.set('mono', mono.element);

  const samples: RawTypeSample[] = [];
  for (const [role, element] of chosen) {
    element.setAttribute(MARKER, role);
    const style = getComputedStyle(element);
    samples.push({
      role,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textTransform: style.textTransform,
      color: (style as CSSStyleDeclaration & { webkitTextFillColor?: string }).webkitTextFillColor || style.color,
      text: directText(element).slice(0, 160),
    });
  }

  const loadedFaces: RawLoadedFace[] = [];
  if (document.fonts) {
    for (const face of Array.from(document.fonts as unknown as Iterable<FontFace>)) {
      if (loadedFaces.length >= 300) break;
      loadedFaces.push({
        family: face.family.replace(/^["']|["']$/g, ''),
        weight: face.weight,
        style: face.style,
        stretch: face.stretch,
        unicodeRange: face.unicodeRange,
        status: face.status,
      });
    }
  }

  const rules: RawFontFaceRule[] = [];
  const unreadableSheets: string[] = [];
  const walk = (list: CSSRuleList, baseUrl: string, depth: number): void => {
    if (depth > 8) return;
    for (const rule of Array.from(list)) {
      if (rules.length >= options.maxRules) return;
      if (rule instanceof CSSFontFaceRule) {
        const style = rule.style;
        rules.push({
          family: style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, ''),
          src: style.getPropertyValue('src').trim(),
          weight: style.getPropertyValue('font-weight').trim() || 'normal',
          style: style.getPropertyValue('font-style').trim() || 'normal',
          stretch: style.getPropertyValue('font-stretch').trim() || 'normal',
          unicodeRange: style.getPropertyValue('unicode-range').trim(),
          baseUrl,
        });
      } else if (rule instanceof CSSImportRule) {
        const sheet = rule.styleSheet;
        if (sheet) readSheet(sheet, depth + 1);
      } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
        walk((rule as CSSGroupingRule).cssRules, baseUrl, depth + 1);
      }
    }
  };
  const readSheet = (sheet: CSSStyleSheet, depth: number): void => {
    const baseUrl = sheet.href ?? document.baseURI;
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      if (sheet.href && unreadableSheets.length < 100) unreadableSheets.push(sheet.href);
      return;
    }
    walk(list, baseUrl, depth);
  };
  for (const sheet of Array.from(document.styleSheets)) readSheet(sheet, 0);
  for (const sheet of (document as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? []) {
    readSheet(sheet, 0);
  }

  return {
    samples,
    loadedFaces,
    rules,
    unreadableSheets,
    lang: document.documentElement.getAttribute('lang'),
  };
}
