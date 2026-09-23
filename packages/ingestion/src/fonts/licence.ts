import type { FontLicence } from '../schema.ts';
import type { FontFileInfo } from './font-file.ts';

/**
 * What a font file allows, from what it and its host declare.
 *
 * This is evidence, not legal advice, and it errs one way: only a font that
 * positively declares an open licence — in its own name table, or by being
 * served from a host that only serves open fonts — may be rendered into a film
 * without the customer confirming they hold the rights. Everything else is
 * kept, measured and marked, and the decision is theirs: a web-font licence
 * usually covers a website and not a video, and the brand, not Act One, is
 * the licensee.
 */
const OPEN_LICENCE_TEXT = [
  /\bSIL\b.*\bOpen Font License\b/i,
  /\bOpen Font License\b/i,
  /openfontlicense\.org/i,
  /scripts\.sil\.org\/OFL/i,
  /\bOFL\b/,
  /Apache License/i,
  /apache\.org\/licenses/i,
  /Ubuntu Font Licen[cs]e/i,
  /GUST Font License/i,
  /Bitstream Vera/i,
  /creativecommons\.org\/licenses\/by/i,
  /\bMIT License\b/i,
  /public domain|CC0/i,
];

/** Hosts that serve only openly licensed fonts. */
const OPEN_HOSTS = [
  /(^|\.)fonts\.gstatic\.com$/i,
  /(^|\.)fonts\.bunny\.net$/i,
  /(^|\.)cdn\.jsdelivr\.net$/i,
  /(^|\.)rsms\.me$/i,
];
/** On jsDelivr, which serves any npm package, only these packages are open-font distributions. */
const OPEN_PATHS = [/^\/npm\/@fontsource(-variable)?\//i, /^\/npm\/inter-ui(@[^/]+)?\//i];

export function classifyLicence(info: FontFileInfo | null, sourceUrl: string): FontLicence {
  const names = info?.names;
  const description = names?.licenseDescription ?? null;
  const licenseUrl = names?.licenseUrl ?? null;
  const fsType = info?.fsType ?? null;
  const embedding = embeddingFor(fsType);
  const base = {
    embedding,
    fsType,
    licenseDescription: description,
    licenseUrl: licenseUrl?.slice(0, 500) ?? null,
    copyright: names?.copyright?.slice(0, 500) ?? null,
    manufacturer: names?.manufacturer?.slice(0, 200) ?? null,
  };

  const declared = `${description ?? ''} ${licenseUrl ?? ''}`;
  if (OPEN_LICENCE_TEXT.some((pattern) => pattern.test(declared))) {
    return { ...base, kind: 'open', requiresAttestation: false, reason: 'The file declares an open licence.' };
  }
  if (servedFromOpenHost(sourceUrl)) {
    return {
      ...base,
      kind: 'open',
      requiresAttestation: false,
      reason: 'Served by a host that distributes only openly licensed fonts.',
    };
  }
  if (embedding === 'restricted') {
    return {
      ...base,
      kind: 'restricted',
      requiresAttestation: true,
      reason: 'The file marks itself as not to be embedded without its maker’s permission.',
    };
  }
  if (description || licenseUrl) {
    return {
      ...base,
      kind: 'proprietary',
      requiresAttestation: true,
      reason: 'The file names licence terms that are not an open licence.',
    };
  }
  return {
    ...base,
    kind: 'unknown',
    requiresAttestation: true,
    reason: info ? 'The file declares no licence.' : 'The file could not be read.',
  };
}

/**
 * OS/2 `fsType` bits 0–3. Bit 1 alone is "restricted"; the least
 * restrictive bit set wins when a file (incorrectly) sets several.
 */
function embeddingFor(fsType: number | null): FontLicence['embedding'] {
  if (fsType === null) return 'unknown';
  const usage = fsType & 0x000f;
  if (usage === 0) return 'installable';
  if (usage & 0x0008) return 'editable';
  if (usage & 0x0004) return 'preview_print';
  if (usage & 0x0002) return 'restricted';
  return 'unknown';
}

function servedFromOpenHost(sourceUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (!OPEN_HOSTS.some((host) => host.test(url.hostname))) return false;
  // jsDelivr serves anything on npm; only the open-font packages count.
  if (/jsdelivr/i.test(url.hostname)) return OPEN_PATHS.some((path) => path.test(url.pathname));
  if (/rsms\.me/i.test(url.hostname)) return /\/inter\//i.test(url.pathname);
  return true;
}
