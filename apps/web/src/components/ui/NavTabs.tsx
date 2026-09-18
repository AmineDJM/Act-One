'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The tabs, with the quietest possible active state: the text comes up to
 * full contrast and a one-pixel line sits under it. A tab is active for its
 * own path and everything beneath it, except the root, which is only itself.
 */
export function NavTabs({ tabs, className }: { tabs: { href: string; label: string }[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={className} aria-label="Workspace">
      {tabs.map((tab) => {
        const active =
          tab.href === '/app' ? pathname === '/app' || pathname.startsWith('/app/projects') : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} data-active={active} aria-current={active ? 'page' : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
