import { registrableDomainOf } from './url.ts';

/**
 * The brand's name as the site writes it.
 *
 * A film says the brand's name on screen and in its narration, so the casing
 * is the brand's, not ours: "KDE", not "Kde"; "GitHub", not "Github". The
 * address only says which word the name is — the site says how it is
 * written. That word is looked for, in the site's own casing, where a site
 * names itself: og:site_name, application-name, its structured data, then its
 * title. A declared name that does not contain the word (a site whose address
 * is not its name) is taken when it is short enough to be a name. Only when
 * the page names itself nowhere is the address capitalised.
 */
export function siteName(html: string, url: string): string {
  const word = addressWord(url);
  if (!word) return 'Product';
  const declared = [
    ...metaContents(html, 'og:site_name'),
    ...metaContents(html, 'application-name'),
    ...structuredNames(html),
  ];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const sources = [...declared, ...(title ? [decodeEntities(title)] : []), ...metaContents(html, 'og:title')];
  for (const source of sources) {
    const spelled = spelling(source, word);
    if (spelled) return spelled;
  }
  const named = declared.find((name) => isNameLike(name));
  return named ?? word.charAt(0).toUpperCase() + word.slice(1);
}

/** The word of the address that is the name: "kde" for www.kde.org, "bbc" for bbc.co.uk. */
function addressWord(url: string): string {
  const domain = registrableDomainOf(url);
  return domain.split('.')[0]?.toLowerCase() ?? '';
}

const squash = (text: string): string => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/**
 * The run of one to three words in `source` that spells the address word,
 * as `source` writes it: "Hugging Face" for huggingface.co. Null when none does.
 */
function spelling(source: string, word: string): string | null {
  const target = squash(word);
  if (!target) return null;
  const tokens = source.split(/[\s|·•:—–\-,/()[\]]+/).filter(Boolean);
  for (let size = 1; size <= 3; size += 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      const run = tokens.slice(start, start + size);
      if (squash(run.join('')) === target) return trimPunctuation(run.join(' '));
    }
  }
  return null;
}

function trimPunctuation(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}!+]+$/gu, '');
}

function isNameLike(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 2 && trimmed.length <= 32 && trimmed.split(/\s+/).length <= 3 && !/https?:|www\./i.test(trimmed);
}

/** Every `content` of a <meta> naming `key`, whatever the order of its attributes. */
function metaContents(html: string, key: string): string[] {
  const found: string[] = [];
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attributes.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    }
    const named = attributes.get('property') ?? attributes.get('name') ?? '';
    const content = attributes.get('content');
    if (named.toLowerCase() === key && content) found.push(decodeEntities(content).trim());
  }
  return found.filter(Boolean);
}

/** The names a site's structured data gives itself, as an organisation or a website. */
function structuredNames(html: string): string[] {
  const names: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1]!);
    } catch {
      continue;
    }
    const pending: unknown[] = [data];
    while (pending.length > 0 && names.length < 8) {
      const node = pending.shift();
      if (Array.isArray(node)) {
        pending.push(...node);
      } else if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>;
        const type = ([] as unknown[]).concat(record['@type'] ?? []).map(String);
        if (type.some((t) => /^(Organization|Corporation|WebSite|Brand|SoftwareApplication)$/.test(t)) && typeof record.name === 'string') {
          names.push(decodeEntities(record.name).trim());
        }
        if (Array.isArray(record['@graph'])) pending.push(...record['@graph']);
      }
    }
  }
  return names.filter(Boolean);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
