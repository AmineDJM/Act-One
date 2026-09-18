import { z } from 'zod';
import { BrandCommunication, type ProductUnderstanding } from '@act-one/core';
import type { CallContext, LlmProvider, PageCapture } from '@act-one/providers';
import { extractMeta } from './evidence.ts';

/**
 * How the brand speaks, read from its own pages.
 *
 * The visual DNA is measured; the way a brand writes cannot be, so this is
 * the one place a model is asked to read the site — and it is asked to
 * quote, not to characterise. The vocabulary is words the pages use, the
 * tagline is the line the homepage leads with, the claims are sentences the
 * site actually says. Nothing here is a judgement of what the brand should
 * sound like; every field is something a person can check against the page.
 */
const SYSTEM_PROMPT = `You are reading how a brand speaks, from its own website copy. Quote, do not characterise.

Return:
- language: the ISO 639-1 code of the copy ("en", "fr", "de"...).
- vocabulary: 5 to 12 words or short phrases the pages use repeatedly and distinctively, exactly as written.
- positioning: one sentence stating how the brand positions itself, built from its own words.
- claims: up to 8 claims the brand makes about itself, verbatim sentences or fragments from the pages. Never invent one.
- naming: how the product, the company and their things are named — the exact capitalisation, whether the product is ever called "the X app", what customers and workspaces are called.
- tagline: the line the homepage leads with, verbatim, or an empty string if there is no clear one.
- wordsToAvoid: up to 8 words the brand visibly never uses or that would clash with its register (for example "AI-powered" for a site that never says "AI", "cheap" for a luxury register). Only words you are confident about.

Return JSON only.`;

const Reading = BrandCommunication;

export async function extractCommunication(
  llm: LlmProvider,
  input: { understanding: Pick<ProductUnderstanding, 'name' | 'oneLiner' | 'tone' | 'brandTraits'>; captures: PageCapture[] },
  context: CallContext,
): Promise<BrandCommunication> {
  const homepage = input.captures[0];
  if (!homepage) return BrandCommunication.parse({});
  const meta = extractMeta(homepage.html);
  const pages = input.captures.slice(0, 6).map((capture) => `## ${capture.title || capture.url}\n${capture.text.slice(0, capture === homepage ? 6000 : 2000)}`);

  try {
    const { value } = await llm.completeJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `# ${input.understanding.name}`,
            `In one line: ${input.understanding.oneLiner}`,
            `Tone as read: ${input.understanding.tone}${input.understanding.brandTraits.length > 0 ? ` (${input.understanding.brandTraits.join(', ')})` : ''}`,
            meta.description ? `Meta description: ${meta.description}` : '',
            meta.ogTitle ? `Open Graph title: ${meta.ogTitle}` : '',
            ``,
            `# The pages, as written`,
            ...pages,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      { schema: Reading, schemaName: 'BrandCommunication', tier: 'balanced', temperature: 0.1, maxOutputTokens: 900, repairAttempts: 1 },
      context,
    );
    return tidy(value);
  } catch {
    // The brand is still measured; it just has nothing to say about its words yet.
    return BrandCommunication.parse({ language: '', tagline: meta.ogTitle?.slice(0, 160) ?? '' });
  }
}

function tidy(value: z.infer<typeof Reading>): BrandCommunication {
  const unique = (items: string[], max: number) => [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, max);
  return {
    language: value.language.trim().toLowerCase().slice(0, 12),
    vocabulary: unique(value.vocabulary, 24),
    positioning: value.positioning.trim().slice(0, 300),
    claims: unique(value.claims, 12).map((claim) => claim.slice(0, 200)),
    naming: value.naming.trim().slice(0, 240),
    tagline: value.tagline.trim().slice(0, 160),
    wordsToAvoid: unique(value.wordsToAvoid, 24),
  };
}
