import { z } from 'zod';
import {
  TITLE_SAFE_INSET,
  VERTICAL_CHROME_BOTTOM,
  VERTICAL_CHROME_RIGHT,
} from './standards/layout.ts';

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
 * Frame-safe areas as fractions of the frame, for each aspect we deliver.
 *
 * Every one of these clears EBU R 95 title safe (a 5% inset on each edge) with
 * room to spare, because a layout that only just clears the standard looks
 * cramped even where nothing is actually cut off. The standard is the floor,
 * not the design.
 *
 * Vertical is not symmetrical, and that is the platforms' doing rather than
 * ours: the caption block, the handle and the action rail sit across the lower
 * part of a 9:16 frame, and their exact boxes move between app versions. So the
 * bottom margin carries `VERTICAL_CHROME_BOTTOM` on top of title safe, and is
 * generous rather than fitted to any one version of any one app.
 */
export const SAFE_AREAS = {
  '16:9': { top: 0.06, bottom: 0.08, left: 0.055, right: 0.055 },
  '9:16': {
    top: TITLE_SAFE_INSET + 0.06,
    bottom: TITLE_SAFE_INSET + VERTICAL_CHROME_BOTTOM,
    left: 0.07,
    right: TITLE_SAFE_INSET + VERTICAL_CHROME_RIGHT,
  },
  '1:1': { top: 0.08, bottom: 0.1, left: 0.07, right: 0.07 },
  '4:5': { top: 0.08, bottom: 0.13, left: 0.07, right: 0.07 },
} as const;

export const DEFAULT_FPS = 30;

/**
 * The platform's own workspace.
 *
 * Work the product does for itself — the journal, a commissioned film — runs
 * under this id so its cost lands in the same ledger as a customer's. Nobody
 * signs into it: it has no members, and the product never makes one.
 */
export const PLATFORM_ORGANIZATION_ID = 'org_platform';
