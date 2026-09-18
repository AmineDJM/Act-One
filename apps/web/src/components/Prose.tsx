import styles from './prose.module.css';

/**
 * Markdown, rendered without a Markdown library.
 *
 * The journal's bodies come from an editor and, sometimes, from a model.
 * Neither is allowed to emit HTML into a page, so this understands a small,
 * deliberate subset — paragraphs, headings below the article's own, bold,
 * italic, inline code, links, lists, quotes — and escapes everything else.
 * A model that tries to write a script tag gets a paragraph that reads
 * "<script>".
 */
export function Prose({ markdown }: { markdown: string }) {
  return <div className={styles.prose} dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />;
}

export function renderMarkdown(source: string): string {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const html: string[] = [];

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    const heading = /^(#{2,4})\s+(.*)$/.exec(block);
    if (heading) {
      const level = Math.min(6, heading[1]!.length + 1);
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(block)) {
      const quote = block
        .split('\n')
        .map((line) => line.replace(/^>\s?/, ''))
        .join(' ');
      html.push(`<blockquote>${inline(quote)}</blockquote>`);
      continue;
    }

    const lines = block.split('\n');
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      html.push(`<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`);
      continue;
    }
    if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
      html.push(`<ol>${lines.map((line) => `<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`);
      continue;
    }

    html.push(`<p>${inline(lines.join(' '))}</p>`);
  }

  return html.join('\n');
}

/** Escapes first, then allows the few marks the journal uses. */
function inline(text: string): string {
  let safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  safe = safe.replace(/`([^`]+)`/g, (_, code: string) => `<code>${code}</code>`);
  // Links: only http(s) and only to somewhere, never javascript: or data:.
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, href: string) => {
    const external = !href.startsWith('/') && !href.includes('//localhost');
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  safe = safe.replace(/—/g, '—');
  return safe;
}
