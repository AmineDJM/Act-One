export { normalizeUrl } from '@act-one/core';
import { registrableDomain } from '@act-one/providers';

export function registrableDomainOf(url: string): string {
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return '';
  }
}

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '/';
  }
}

export function absolutize(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
