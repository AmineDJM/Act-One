import { RESEARCH_PAGE_LABELS, RESEARCH_PAGE_PURPOSE, type ResearchSource } from '@act-one/core';
import { Index, Prompt } from '@/components/ui/Prompt.tsx';
import styles from '../../app.module.css';

/**
 * What the research read.
 *
 * Every page, in the order it was read, with what it gave the brief: the
 * trail behind the understanding, kept so a customer can see what the
 * system actually used and a reviser has the same ground to stand on.
 */
export function ResearchSources({ sources }: { sources: ResearchSource[] }) {
  const useful = sources.filter((source) => source.useful);
  if (useful.length === 0) return null;
  return (
    <section className={styles.panel} style={{ gridColumn: '1 / -1' }}>
      <div className={styles.panelHead}>
        <Prompt as="h3" tone="text">
          Discovery <span className="muted">({useful.length} sources)</span>
        </Prompt>
        <span className="hint">What we read to understand the product.</span>
      </div>
      <ol className={styles.sourceList}>
        {useful.map((source, position) => (
          <li key={source.id} className={styles.sourceRow}>
            <Index value={position + 1} />
            {source.screenshotAssetId ? (
              <a href={`/api/assets/${source.screenshotAssetId}`} target="_blank" rel="noreferrer" className={styles.sourceThumb}>
                <img src={`/api/assets/${source.screenshotAssetId}`} alt="" loading="lazy" />
              </a>
            ) : (
              <span className={styles.sourceThumb} data-empty="true" />
            )}
            <div className={styles.sourceBody}>
              <a href={source.url} target="_blank" rel="noreferrer" className={styles.sourceUrl}>
                {displayUrl(source.url)}
              </a>
              <div className={styles.sourceMeta}>
                <span>{RESEARCH_PAGE_LABELS[source.pageType]}</span>
                <span className="muted">{source.findings[0] ? shorten(source.findings[0]) : RESEARCH_PAGE_PURPOSE[source.pageType]}</span>
              </div>
              {source.findings.length > 0 || source.excerpt ? (
                <details className={styles.sourceMore}>
                  <summary>
                    {source.findings.length > 0
                      ? `${source.findings.length} finding${source.findings.length === 1 ? '' : 's'}`
                      : 'what it said'}
                    {source.evidenceCount > 0 ? ` · ${source.evidenceCount} excerpt${source.evidenceCount === 1 ? '' : 's'} kept` : ''}
                  </summary>
                  {source.findings.length > 0 ? (
                    <ul>
                      {source.findings.map((finding) => (
                        <li key={finding}>{finding}</li>
                      ))}
                    </ul>
                  ) : null}
                  {source.excerpt ? <blockquote>{source.excerpt}</blockquote> : null}
                  {source.reason ? <p className="hint">Visited because: {source.reason}</p> : null}
                </details>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}

function shorten(text: string): string {
  return text.length > 96 ? `${text.slice(0, 93).trimEnd()}…` : text;
}
