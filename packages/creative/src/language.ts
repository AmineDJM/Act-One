import { z } from 'zod';
import type { CallContext, LlmProvider } from '@act-one/providers';

const Detected = z.object({ language: z.string() });

/**
 * The language a storyboard was written in, as an ISO 639-1 code.
 *
 * The brief may not say, and the film is then written in the language of
 * the product's own site — which the writer knows and the voice does not.
 * This asks, cheaply, so the voice can be chosen for it. Null when it
 * cannot be told, and the voice then reads the language off the text.
 */
export async function detectLanguage(
  llm: LlmProvider,
  lines: string[],
  context: CallContext,
): Promise<string | null> {
  const sample = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join('\n');
  if (sample.length < 12) return null;
  try {
    const { value } = await llm.completeJson(
      [
        {
          role: 'system',
          content:
            'You identify the language of short lines of copy. Answer with the ISO 639-1 code ' +
            '(two lowercase letters, e.g. "fr", "en", "de"). JSON only.',
        },
        { role: 'user', content: sample },
      ],
      { schema: Detected, schemaName: 'DetectedLanguage', tier: 'fast', temperature: 0 },
      context,
    );
    const code = value.language.trim().toLowerCase();
    return /^[a-z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}
