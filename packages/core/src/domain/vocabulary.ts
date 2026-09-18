import type { ProjectStage } from './project.ts';

/**
 * The words this product uses, in one place.
 *
 * Act One is a production house that happens to be software, and the language
 * has to hold that even when nobody is looking. A film is not "generated", it
 * is produced. A project is a production. The finished file is a master, and
 * the shorter versions are cuts. What the customer keeps is an archive, not a
 * library of assets.
 *
 * Two rules keep this from becoming costume:
 *
 *   1. Internal names do not change. The code says `project`, `asset`,
 *      `render`; the interface says production, material, master. Renaming
 *      a database column to sound like a film studio would buy nothing and
 *      cost a migration.
 *   2. The word has to be the accurate one. "Mastering" is used where sound
 *      and picture are actually being finished, never as decoration for a
 *      progress bar. Where the plain word is the true one — settings, billing,
 *      sign in — the plain word stays.
 */
export const WORDS = {
  production: 'production',
  productions: 'productions',
  archive: 'archive',
  identity: 'identity',
  discovery: 'discovery',
  /** The rough cut a customer watches before the film is finished. */
  workprint: 'workprint',
  /** The finished film. */
  master: 'master',
  /** The other lengths and shapes cut from the master. */
  cut: 'cut',
  cuts: 'cuts',
  /** Pictures and footage a production is made from. "Assets" stays in code. */
  material: 'material',
  materials: 'materials',
  collections: 'Collections',
} as const;

/** What a public film says about where it came from. Never "AI-generated". */
export const ATTRIBUTION = 'An Act One Production';

/** The mark on a film Act One made for itself rather than for a customer. */
export const ORIGINAL_LABEL = 'Act One Original';

/** The mark on a film a person selected for the public gallery. */
export const SELECTED_LABEL = 'Selected for Act One Collections';

/**
 * The six phases of a production, in order.
 *
 * This is what a customer sees. The thirteen stages underneath are how the
 * machine thinks about the same work, and they stay in the console: nobody
 * outside this building needs to know that capturing the product and
 * rendering the film are different jobs.
 */
export const PRODUCTION_PHASES = ['discovery', 'direction', 'storyboard', 'production', 'mastering', 'ready'] as const;
export type ProductionPhase = (typeof PRODUCTION_PHASES)[number];

export const PRODUCTION_PHASE_LABELS: Record<ProductionPhase, string> = {
  discovery: 'DISCOVERY',
  direction: 'DIRECTION',
  storyboard: 'STORYBOARD',
  production: 'PRODUCTION',
  mastering: 'MASTERING',
  ready: 'READY',
};

/** One line saying what happens in each phase, for the rail on the production page. */
export const PRODUCTION_PHASE_LINES: Record<ProductionPhase, string> = {
  discovery: 'Reading the product and measuring the identity.',
  direction: 'Three directions that genuinely disagree.',
  storyboard: 'Timing, legibility and budget settled before anything costs money.',
  production: 'Source material, motion, product cinematography, sound.',
  mastering: 'The cut checked frame by frame against the standards.',
  ready: 'The master, and every cut the launch needs.',
};

/**
 * Where a stage sits in the production.
 *
 * Null before anything has started and when a production has been
 * interrupted: neither is a phase, and pretending otherwise would put a
 * broken production somewhere on the rail as though it were progressing.
 */
export function productionPhase(stage: ProjectStage): ProductionPhase | null {
  switch (stage) {
    case 'researching':
    case 'understanding_ready':
      return 'discovery';
    case 'concepting':
    case 'concepts_ready':
      return 'direction';
    case 'storyboarding':
    case 'storyboard_ready':
      return 'storyboard';
    case 'capturing_product':
    case 'generating_assets':
    case 'rendering':
      return 'production';
    case 'qa':
      return 'mastering';
    case 'film_ready':
      return 'ready';
    default:
      return null;
  }
}

/** How far along the rail a production is, 0–6, for a phase indicator. */
export function phaseIndex(phase: ProductionPhase): number {
  return PRODUCTION_PHASES.indexOf(phase);
}

/** `MASTER 01`, `CUT 03`: a numbered piece of work, mono, two digits. */
export function pieceLabel(kind: 'master' | 'cut' | 'workprint', index?: number): string {
  const name = kind.toUpperCase();
  return index === undefined ? name : `${name} ${String(index).padStart(2, '0')}`;
}
