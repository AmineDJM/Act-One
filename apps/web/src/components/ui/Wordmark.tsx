import Link from 'next/link';
import { PRODUCT_NAME } from '@act-one/core';

/**
 * The mark: a prompt in a box, and the name.
 *
 * One component for every surface — the app, the console, the sign-in page,
 * the marketing site — so the product is recognisably itself wherever it is
 * met, and a change to it is one change.
 */
export function Wordmark({
  href = '/',
  compact = false,
  tag,
}: {
  href?: string;
  /** Mark only, for narrow places. */
  compact?: boolean;
  /** A small mono tag after the name: "staff", "beta". */
  tag?: string;
}) {
  return (
    <Link href={href} className="wordmark" aria-label={`${PRODUCT_NAME} home`}>
      <span className="wordmark__mark" aria-hidden="true">
        <span>&gt;_</span>
      </span>
      {compact ? null : <span className="wordmark__name">{PRODUCT_NAME}</span>}
      {tag ? <span className="wordmark__tag">{tag}</span> : null}
    </Link>
  );
}
