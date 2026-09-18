import { describe, it, expect } from 'vitest';
import { ScriptedLlmProvider } from '@act-one/providers';
import type { PageCapture } from '@act-one/providers';
import { extractCommunication } from '../index.ts';

/**
 * How the brand speaks is read by quotation: the reader is handed the pages
 * as written and returns what it can point to. When the model is not there,
 * the brand still has what the page declares about itself, and no more.
 */
function capture(text: string, html = '<html><head><title>Acme</title></head></html>', url = 'https://acme.example/'): PageCapture {
  return { url, title: 'Acme', text, html, screenshot: null, styleProfile: null, links: [], statusCode: 200, capturedAt: new Date().toISOString() };
}

const understanding = { name: 'Acme', oneLiner: 'Reconciles invoices without a spreadsheet.', tone: 'Plain, precise.', brandTraits: ['precise'] };

describe('extractCommunication', () => {
  it('hands the pages to the reader and keeps what it quotes, tidied', async () => {
    const llm = new ScriptedLlmProvider([
      {
        when: /how a brand speaks/i,
        respond: {
          language: 'EN',
          vocabulary: ['reconcile', 'ledger', ' reconcile ', 'close the books'],
          positioning: 'The reconciliation layer for finance teams.',
          claims: ['Closes the books 3x faster.'],
          naming: '"Acme", never "the Acme app"; customers are "finance teams".',
          tagline: 'Close the books. Keep the weekend.',
          wordsToAvoid: ['AI-powered', 'cheap'],
        },
      },
    ]);
    const words = await extractCommunication(llm, { understanding, captures: [capture('Close the books. Keep the weekend. Acme reconciles…')] }, { organizationId: 'org_1' });
    expect(words).toEqual({
      language: 'en',
      vocabulary: ['reconcile', 'ledger', 'close the books'],
      positioning: 'The reconciliation layer for finance teams.',
      claims: ['Closes the books 3x faster.'],
      naming: '"Acme", never "the Acme app"; customers are "finance teams".',
      tagline: 'Close the books. Keep the weekend.',
      wordsToAvoid: ['AI-powered', 'cheap'],
    });
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('Close the books. Keep the weekend.');
    expect(prompt).toContain('Quote, do not characterise');
  });

  it('falls back to what the page declares when the reader fails', async () => {
    const llm = new ScriptedLlmProvider([]);
    const words = await extractCommunication(
      llm,
      { understanding, captures: [capture('…', '<html><head><meta property="og:title" content="Acme — close the books"></head></html>')] },
      { organizationId: 'org_1' },
    );
    expect(words.tagline).toBe('Acme — close the books');
    expect(words.vocabulary).toEqual([]);
  });

  it('has nothing to say without a page', async () => {
    const words = await extractCommunication(new ScriptedLlmProvider([]), { understanding, captures: [] }, { organizationId: 'org_1' });
    expect(words.tagline).toBe('');
  });
});
