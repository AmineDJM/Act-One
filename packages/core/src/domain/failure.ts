/**
 * What a customer may be told about a failure.
 *
 * A job's last error is written for an operator: a provider's name, a
 * status code, a validation dump, a stack. None of that belongs on a
 * customer's screen — it reads as a system that does not know what it is
 * doing, and it names vendors the product never mentions. A sentence the
 * pipeline wrote for the customer passes through; anything that smells of
 * infrastructure is replaced by the page's own generic copy.
 */
const INFRASTRUCTURE = /\b(openai|browserbase|higgsfield|elevenlabs|stripe|supabase|zod|postgres|ffmpeg|blender|remotion|http|https|api|json|token|status code|econn|etimedout|enotfound|timeout|stack|undefined|null|exception|trace)\b/i;
const SHAPE = /[{}\[\]<>]|^\s*at\s|\bat\s+\S+\s*\(|\d{3}\s*(?:internal|bad|not found|unauthori[sz]ed|forbidden)/i;

export function customerFacingFailure(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (text.length === 0 || text.length > 220) return null;
  if (SHAPE.test(text) || INFRASTRUCTURE.test(text)) return null;
  // A sentence, not a code: it has a space and ends like one.
  if (!/\s/.test(text)) return null;
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}
