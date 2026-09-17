import { z } from 'zod';

/**
 * Working product name. Branding is not final; nothing should hardcode it.
 *
 * Read through a guard because this module is also bundled for the browser by
 * Remotion, where `process` does not exist.
 */
function env(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name]?.trim() : undefined;
}

export const PRODUCT_NAME = env('ACT_ONE_PRODUCT_NAME') || 'Act One';
export const PRODUCT_TAGLINE = env('ACT_ONE_TAGLINE') || 'Your product. Directed.';
export const PRODUCT_SUBLINE =
  env('ACT_ONE_SUBLINE') ||
  'Give us your product. We write, direct and produce the launch film.';

/** Creative guard-rails that the engines enforce, tunable by Super Admin. */
export const CreativeBudget = z.object({
  /** Fractions of runtime. The defaults keep generative content supplementary. */
  minDeterministicRatio: z.number().min(0).max(1).default(0.45),
  maxGenerativeRatio: z.number().min(0).max(1).default(0.25),
  minRealMediaRatio: z.number().min(0).max(1).default(0.15),
  maxCostPerSecondUsd: z.number().min(0).default(0.9),
  maxRetries: z.number().int().min(0).default(2),
});
export type CreativeBudget = z.infer<typeof CreativeBudget>;

export const DEFAULT_CREATIVE_BUDGET: CreativeBudget = CreativeBudget.parse({});

/** Per-mode overrides of the budget. */
export const MODE_BUDGETS = {
  authentic: {
    ...DEFAULT_CREATIVE_BUDGET,
    maxGenerativeRatio: 0,
    minRealMediaRatio: 0.3,
    minDeterministicRatio: 0.5,
    maxCostPerSecondUsd: 0.35,
  },
  studio: DEFAULT_CREATIVE_BUDGET,
  cinematic: {
    ...DEFAULT_CREATIVE_BUDGET,
    maxGenerativeRatio: 0.4,
    minDeterministicRatio: 0.35,
    maxCostPerSecondUsd: 2.2,
  },
} as const satisfies Record<string, CreativeBudget>;

/**
 * Frame-safe areas as fractions of the frame. Typography never crosses these,
 * in any aspect ratio. Vertical needs far more bottom margin because of
 * platform UI chrome (captions, handles, CTA buttons).
 */
export const SAFE_AREAS = {
  '16:9': { top: 0.06, bottom: 0.08, left: 0.055, right: 0.055 },
  '9:16': { top: 0.11, bottom: 0.19, left: 0.07, right: 0.07 },
  '1:1': { top: 0.08, bottom: 0.1, left: 0.07, right: 0.07 },
  '4:5': { top: 0.08, bottom: 0.13, left: 0.07, right: 0.07 },
} as const;

export const DEFAULT_FPS = 30;

/** WCAG-ish minimum contrast for on-screen film typography. */
export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_LARGE_TEXT_CONTRAST = 3.0;

/** Reading speed used to time on-screen text. Words per second, comfortable. */
export const READING_WORDS_PER_SECOND = 2.6;
/** Narration pace for voice-over timing. */
export const NARRATION_WORDS_PER_SECOND = 2.35;
