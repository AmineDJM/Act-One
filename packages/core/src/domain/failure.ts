import type { ProductionPhase } from './vocabulary.ts';
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

/**
 * What a customer is told when something did not go to plan.
 *
 * Three different things wear the word "error" in most software, and only one
 * of them is an error here:
 *
 *   — the work is being done again, because a shot came back wrong or a
 *     system was briefly unavailable. That is a production doing its job, and
 *     it is reported as work in progress, never as a failure;
 *   — the production stopped and needs a person to press something. That is
 *     the only case that gets attention;
 *   — the account needs attention, which is not a production problem at all.
 *
 * Nothing here names a provider, a model, a status code or a stack. The one
 * piece of raw text that may reach a customer is a sentence the pipeline
 * wrote for them, and `customerFacingFailure` above decides whether it is
 * one.
 */
export type FailureKind =
  | 'rebuilding'
  | 'refining'
  | 'production_paused'
  | 'discovery_paused'
  | 'production_interrupted'
  | 'master_not_completed'
  | 'payment_attention';

/** What the notice is: work still happening, or something waiting on a person. */
export type FailureTone = 'working' | 'attention';

export type FailureAction = 'retry' | 'resume' | 'back' | 'billing';

export type FailureNotice = {
  kind: FailureKind;
  tone: FailureTone;
  title: string;
  body: string;
  /**
   * The one way on, or nothing while work is in progress.
   *
   * One, not a list. A page that renders a single button beside a notice
   * carrying three of them is a page quietly ignoring two of its own
   * promises, which is how "Return to production" ended up being offered on
   * the production page itself.
   */
  action: { action: FailureAction; label: string } | null;
  /** The pipeline's own sentence for the customer, when it wrote one. */
  detail: string | null;
};

const NOTICES: Record<FailureKind, Omit<FailureNotice, 'detail'>> = {
  rebuilding: {
    kind: 'rebuilding',
    tone: 'working',
    title: 'Rebuilding this shot',
    body: 'One shot did not come back the way it should have, so it is being made again. Nothing for you to do.',
    action: null,
  },
  refining: {
    kind: 'refining',
    tone: 'working',
    title: 'Refining this shot',
    body: 'This shot did not meet the standard, so it is being directed again. Everything else is finished.',
    action: null,
  },
  production_paused: {
    kind: 'production_paused',
    /*
     * Attention, despite the gentle words. By the time this appears the
     * automatic attempts are spent, so somebody has to press something —
     * and a notice that reassures without offering a way on strands them.
     */
    tone: 'attention',
    title: 'Production paused',
    body: 'One of our production systems was temporarily unavailable. Everything is kept, and this picks up from where it stopped.',
    action: { action: 'resume', label: 'Resume production' },
  },
  discovery_paused: {
    kind: 'discovery_paused',
    tone: 'attention',
    title: 'Discovery paused',
    body: 'We could not finish reading your product. Everything we did read is kept, and your work is safe.',
    action: { action: 'retry', label: 'Continue discovery' },
  },
  production_interrupted: {
    kind: 'production_interrupted',
    tone: 'attention',
    title: 'Production interrupted',
    body: 'We could not complete this part of the production. Your work is safe, and we pick up from where it stopped.',
    action: { action: 'retry', label: 'Try again' },
  },
  master_not_completed: {
    kind: 'master_not_completed',
    tone: 'attention',
    title: 'Master not completed',
    body: 'The film was not finished. The storyboard, the material and every shot that was made are kept, so this resumes rather than starts again. Your work is safe.',
    action: { action: 'resume', label: 'Resume mastering' },
  },
  payment_attention: {
    kind: 'payment_attention',
    tone: 'attention',
    title: 'Payment requires attention',
    body: 'This production is ready to continue as soon as the account is in order. Your work is safe.',
    action: { action: 'billing', label: 'Review payment' },
  },
};

/**
 * The same notice as the status word on the card and beside the title.
 *
 * The pill and the notice used to be computed from different things — one
 * from the failed job's kind, the other from its code — so a production could
 * say PRODUCTION INTERRUPTED above a panel explaining that a system of ours
 * was briefly unavailable. One source now, said twice.
 */
export const NOTICE_STATUS: Record<FailureKind, { label: string; tone: 'active' | 'attention' }> = {
  rebuilding: { label: 'REBUILDING', tone: 'active' },
  refining: { label: 'REFINING', tone: 'active' },
  production_paused: { label: 'PRODUCTION PAUSED', tone: 'attention' },
  discovery_paused: { label: 'DISCOVERY PAUSED', tone: 'attention' },
  production_interrupted: { label: 'PRODUCTION INTERRUPTED', tone: 'attention' },
  master_not_completed: { label: 'MASTER NOT COMPLETED', tone: 'attention' },
  payment_attention: { label: 'PAYMENT NEEDS ATTENTION', tone: 'attention' },
};

/** Codes that mean "somebody else's system, briefly" rather than "this broke". */
const TRANSIENT = new Set(['provider_unavailable', 'rate_limited', 'timeout', 'upstream_error', 'unavailable']);
const BILLING = new Set(['entitlement_required', 'payment_required', 'insufficient_credits', 'plan_limit']);

/**
 * The notice for a production that is not going to plan.
 *
 * Order matters: work in progress beats everything, because telling somebody
 * their production failed while it is quietly being remade is the single
 * worst thing this system could say.
 */
export function failureNotice(input: {
  /** Another attempt is already scheduled: this is not a failure yet. */
  retryScheduled?: boolean;
  /** Quality rejected the shot and it is being directed again. */
  refining?: boolean;
  /** The AppError code the stage failed with, when there is one. */
  code?: string | null;
  /** Which part of the production stopped. */
  phase?: ProductionPhase | null;
  /** Whether a film had already begun: a master that stopped resumes. */
  hadRender?: boolean;
  /** The raw last error, filtered before anyone sees it. */
  rawError?: string | null;
}): FailureNotice {
  const detail = customerFacingFailure(input.rawError);
  const kind: FailureKind = input.refining
    ? 'refining'
    : input.retryScheduled
      ? 'rebuilding'
      : BILLING.has(input.code ?? '')
        ? 'payment_attention'
        : TRANSIENT.has(input.code ?? '')
          ? 'production_paused'
          : input.phase === 'discovery'
            ? 'discovery_paused'
            : input.hadRender || input.phase === 'mastering' || input.phase === 'production'
              ? 'master_not_completed'
              : 'production_interrupted';

  return { ...NOTICES[kind], detail };
}
