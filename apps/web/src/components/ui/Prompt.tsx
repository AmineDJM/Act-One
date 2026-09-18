/**
 * A terminal label: `> PROJECTS`, `ACT ONE / RESEARCH`, `01`.
 *
 * Monospace, small, tracked, and never the heading itself — it sits above
 * or beside modern type and names the section the way a prompt names a
 * command. The chevron is the product's; the words are the customer's.
 */
export function Prompt({
  children,
  chevron = true,
  tone = 'muted',
  as: Tag = 'span',
  className,
}: {
  children: React.ReactNode;
  chevron?: boolean;
  tone?: 'muted' | 'accent' | 'text';
  as?: 'span' | 'p' | 'h2' | 'h3' | 'div';
  className?: string;
}) {
  return (
    <Tag className={`prompt${className ? ` ${className}` : ''}`} data-tone={tone}>
      {chevron ? (
        <span className="prompt__chevron" aria-hidden="true">
          &gt;
        </span>
      ) : null}
      <span>{children}</span>
    </Tag>
  );
}

/** A two-digit counter: `01`, `02`. */
export function Index({ value, className }: { value: number; className?: string }) {
  return <span className={`index${className ? ` ${className}` : ''}`}>{String(value).padStart(2, '0')}</span>;
}

/** A status in terminal form: `FILM READY`, `NEEDS ATTENTION`. The tone colours it. */
export function Status({
  children,
  tone = 'quiet',
  live = false,
  className,
}: {
  children: React.ReactNode;
  tone?: 'quiet' | 'active' | 'ready' | 'attention';
  /** A pulsing dot before the words, for something happening right now. */
  live?: boolean;
  className?: string;
}) {
  return (
    <span className={`status${className ? ` ${className}` : ''}`} data-tone={tone} data-live={live || undefined}>
      {live ? <span className="status__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
