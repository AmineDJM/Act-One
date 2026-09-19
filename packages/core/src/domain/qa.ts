import { z } from 'zod';
import { score01 } from '../zod-helpers.ts';

/**
 * What QA looks at, in layers.
 *
 * A single vague pass cannot say why it failed. These are the six passes a
 * post-production supervisor makes, in the order the cost of each one runs:
 * the spec is arithmetic, delivery needs the finished file, and cross-modal
 * needs both the picture and the words that were supposed to go with it.
 */
export const QaLayer = z.enum([
  /** Duration, frame size, aspect, codec, captions present, audio present. */
  'spec',
  /** Does the output obey the format it was asked for — short, pitch, tour. */
  'structural',
  /** Frames: layout, safe areas, artifacts, continuity. */
  'visual',
  /** Loudness, clipping, silence, fades, the mix. */
  'audio',
  /** Picture against words: narration, captions, beats, claims. */
  'cross_modal',
  /** The bytes that will be delivered, and whether they play. */
  'delivery',
]);
export type QaLayer = z.infer<typeof QaLayer>;

/**
 * The family a defect belongs to.
 *
 * Coarser than the check, and the thing worth counting across films: forty
 * captions outside the safe area is one bug in the captioner, not forty bugs.
 */
export const QaCategory = z.enum([
  'sync',
  'timing',
  'continuity',
  'text',
  'editorial',
  'audio',
  'delivery',
]);
export type QaCategory = z.infer<typeof QaCategory>;

export const QaCheck = z.enum([
  // --- text, layout, legibility ---
  'text_clipping',
  'text_overflow',
  'spacing',
  'typo',
  'unsupported_claim',
  'distorted_ui',
  'contrast',
  'logo_integrity',
  'image_artifact',
  'anatomy',
  'composition',
  'visual_hierarchy',
  'brand_consistency',
  'transition_quality',
  'safe_area',
  'flicker',
  'duplicate_frames',
  'asset_resolution',
  'audio_loudness',
  'audio_clipping',
  'audio_balance',
  'missing_audio',
  'fake_product_ui',
  'legible_generated_text',
  /* The voice, listened back to. */
  'narration_language',
  'narration_accuracy',
  'narration_timing',
  'narration_pause',
  'narration_truncated',
  'narration_loudness',
  /* The captions, read back at the speed a viewer reads. */
  'caption_readability',
  'captions_missing',

  /*
   * Temporal precision.
   *
   * Everything above can be decided from a plan or a frame. These need the
   * finished thing and a clock, and they are the defects a demanding viewer
   * notices without being able to name: the caption that lands a beat after
   * the word, the cut that arrives just off the music, the shot held two
   * frames too long. "Roughly aligned" is what this group exists to refuse.
   */
  'caption_onset',
  'caption_offset',
  'caption_overlap',
  'caption_speech_drift',
  'lip_sync',
  'narration_shot_drift',
  'music_beat_alignment',
  'sfx_sync',
  'transition_sync',
  'silence_gap',
  'dead_pacing',
  'still_frame_hold',
  'awkward_hold',
  'level_jump',
  'abrupt_music_end',
  'fade_quality',
  'ducking_failure',

  /* Continuity, across shots rather than inside one. */
  'frame_jump',
  'style_drift',
  'identity_drift',
  'lighting_continuity',
  'perspective_continuity',

  /* Delivery: the file itself. */
  'duration_mismatch',
  'aspect_mismatch',
  'framerate_mismatch',
  'missing_channel',
  'container_integrity',
  'caption_burn_failed',
  'preview_master_mismatch',

  /* Not a defect. The one judgement here with no arithmetic behind it. */
  'direction',
]);
export type QaCheck = z.infer<typeof QaCheck>;

/**
 * How much a finding matters, and what it obliges.
 *
 * The three levels below `hard_fail` used to be one undifferentiated "not a
 * blocker", which meant a defect worth repairing and a defect worth noting
 * were treated the same and neither was repaired. Each level now says what
 * happens next:
 *
 * - `info`: an observation. Nothing happens.
 * - `warning`: acceptable, better if improved. Repaired if a repair is going
 *   to run anyway; never on its own.
 * - `soft_fail`: repaired automatically before delivery if a repair exists.
 *   Ships if the repair cannot be made and nothing worse is outstanding.
 * - `hard_fail`: does not ship. Repaired, replanned or escalated.
 * - `critical_fail`: the output is invalid — corrupt, unplayable, empty. Not
 *   repaired shot by shot; regenerated or stopped.
 */
export const QaSeverity = z.enum(['info', 'warning', 'soft_fail', 'hard_fail', 'critical_fail']);
export type QaSeverity = z.infer<typeof QaSeverity>;

export const SEVERITY_ORDER: Record<QaSeverity, number> = {
  info: 0,
  warning: 1,
  soft_fail: 2,
  hard_fail: 3,
  critical_fail: 4,
};

/** True when this severity stops a master being delivered. */
export function blocksRelease(severity: QaSeverity): boolean {
  return severity === 'hard_fail' || severity === 'critical_fail';
}

export const RepairAction = z.enum([
  'regenerate_shot',
  'rewrite_copy',
  'relayout_text',
  'recrop',
  'recapture_product',
  'reduce_duration',
  'swap_asset',
  'adjust_contrast',
  'remix_audio',
  'regenerate_voice',
  'remove_scene',
  /* Temporal repairs: the picture is right and its timing is not. */
  'retime_captions',
  'reposition_captions',
  'retime_scene',
  'trim_hold',
  'realign_audio',
  'refade_audio',
  'replan_opening',
  /* Escalations: the same repair has already failed. */
  'alternate_provider',
  'alternate_archetype',
  'manual_review',
]);
export type RepairAction = z.infer<typeof RepairAction>;

/** Where a finding stands with the repair loop. */
export const RepairStatus = z.enum(['open', 'repairing', 'repaired', 'unrepairable', 'accepted']);
export type RepairStatus = z.infer<typeof RepairStatus>;

export const QaIssue = z.object({
  id: z.string(),
  check: QaCheck,
  severity: QaSeverity,
  layer: QaLayer.default('visual'),
  sceneId: z.string().nullable().default(null),
  /** Seconds into the film. The start of the defect, for the timeline marker. */
  timecodeStart: z.number().min(0).nullable().default(null),
  /** Where it stops, when it has an extent rather than a moment. */
  timecodeEnd: z.number().min(0).nullable().default(null),
  /** Frame numbers, where the check counted frames rather than seconds. */
  frameStart: z.number().int().min(0).nullable().default(null),
  frameEnd: z.number().int().min(0).nullable().default(null),
  message: z.string().max(800),
  /** Why it matters, in the words of the standard it comes from. */
  because: z.string().max(400).default(''),
  evidenceAssetId: z.string().nullable().default(null),
  confidence: score01.default(0.7),
  /** Targeted repair — never "re-render everything". */
  repair: RepairAction.nullable().default(null),
  repairStatus: RepairStatus.default('open'),
  repairAttempts: z.number().int().min(0).default(0),
  detectedBy: z.enum(['deterministic', 'vision', 'fact_check', 'audio', 'temporal']).default('deterministic'),
});
export type QaIssue = z.infer<typeof QaIssue>;

/**
 * What a check hands back before anything normalises it.
 *
 * Every field with a default is optional here, so a check that has nothing to
 * say about frame ranges does not have to say `frameStart: null` — and adding
 * a field to a finding does not mean editing seventy call sites that could not
 * fill it in anyway. `normalizeFindings` turns these into real findings once,
 * at the point they are collected.
 */
export type QaFinding = z.input<typeof QaIssue>;

/** Fills the defaults, and stamps the layer each check belongs to. */
export function normalizeFindings(findings: readonly QaFinding[]): QaIssue[] {
  return findings.map((finding) =>
    QaIssue.parse({ layer: layerOf(finding.check as QaCheck), ...finding }),
  );
}

/** Which pass a check belongs to. Used when a producer does not say. */
export function layerOf(check: QaCheck): QaLayer {
  return CHECK_LAYER[check] ?? 'visual';
}

const CHECK_LAYER: Partial<Record<QaCheck, QaLayer>> = {
  duration_mismatch: 'delivery', aspect_mismatch: 'delivery', framerate_mismatch: 'delivery',
  missing_channel: 'delivery', container_integrity: 'delivery', caption_burn_failed: 'delivery',
  preview_master_mismatch: 'delivery', captions_missing: 'spec', missing_audio: 'spec',

  audio_loudness: 'audio', audio_clipping: 'audio', audio_balance: 'audio',
  narration_loudness: 'audio', level_jump: 'audio', abrupt_music_end: 'audio',
  fade_quality: 'audio', ducking_failure: 'audio',

  caption_onset: 'cross_modal', caption_offset: 'cross_modal', caption_speech_drift: 'cross_modal',
  lip_sync: 'cross_modal', narration_shot_drift: 'cross_modal', music_beat_alignment: 'cross_modal',
  sfx_sync: 'cross_modal', transition_sync: 'cross_modal', narration_accuracy: 'cross_modal',
  narration_language: 'cross_modal', unsupported_claim: 'cross_modal',

  dead_pacing: 'structural', silence_gap: 'structural', still_frame_hold: 'structural',
  awkward_hold: 'structural', direction: 'structural', fake_product_ui: 'structural',
};

/** Whether this finding is one the loop can act on without a person. */
export function repairableAutomatically(issue: Pick<QaIssue, 'repair'>): boolean {
  return issue.repair !== null && issue.repair !== 'manual_review';
}

/** The family a check belongs to, for counting across films. */
export function categoryOf(check: QaCheck): QaCategory {
  return CHECK_CATEGORY[check] ?? 'continuity';
}

const CHECK_CATEGORY: Record<QaCheck, QaCategory> = {
  text_clipping: 'text', text_overflow: 'text', spacing: 'text', typo: 'text',
  legible_generated_text: 'text', caption_readability: 'text', captions_missing: 'text',
  caption_overlap: 'text', contrast: 'text', visual_hierarchy: 'text',

  unsupported_claim: 'editorial', fake_product_ui: 'editorial', direction: 'editorial',
  composition: 'editorial', brand_consistency: 'editorial',

  distorted_ui: 'continuity', logo_integrity: 'continuity', image_artifact: 'continuity',
  anatomy: 'continuity', flicker: 'continuity', duplicate_frames: 'continuity',
  asset_resolution: 'continuity', safe_area: 'text', transition_quality: 'continuity',
  frame_jump: 'continuity', style_drift: 'continuity', identity_drift: 'continuity',
  lighting_continuity: 'continuity', perspective_continuity: 'continuity',

  audio_loudness: 'audio', audio_clipping: 'audio', audio_balance: 'audio',
  missing_audio: 'audio', narration_loudness: 'audio', level_jump: 'audio',
  abrupt_music_end: 'audio', fade_quality: 'audio', ducking_failure: 'audio',
  narration_language: 'audio', narration_accuracy: 'audio', narration_truncated: 'audio',

  caption_onset: 'sync', caption_offset: 'sync', caption_speech_drift: 'sync',
  lip_sync: 'sync', narration_shot_drift: 'sync', music_beat_alignment: 'sync',
  sfx_sync: 'sync', transition_sync: 'sync',

  narration_timing: 'timing', narration_pause: 'timing', silence_gap: 'timing',
  dead_pacing: 'timing', still_frame_hold: 'timing', awkward_hold: 'timing',

  duration_mismatch: 'delivery', aspect_mismatch: 'delivery', framerate_mismatch: 'delivery',
  missing_channel: 'delivery', container_integrity: 'delivery', caption_burn_failed: 'delivery',
  preview_master_mismatch: 'delivery',
};

/** One repair the loop attempted, and what it cost. */
export const RepairRecord = z.object({
  id: z.string(),
  /** The finding that asked for it. */
  issueId: z.string(),
  check: QaCheck,
  sceneId: z.string().nullable().default(null),
  action: RepairAction,
  attempt: z.number().int().min(0),
  outcome: z.enum(['fixed', 'unchanged', 'worse', 'failed', 'escalated']),
  /** What the repair itself cost us, on top of the original render. */
  costUsd: z.number().min(0).default(0),
  /** How long the customer waited for it. */
  latencyMs: z.number().int().min(0).default(0),
  note: z.string().max(400).default(''),
});
export type RepairRecord = z.infer<typeof RepairRecord>;

/**
 * Where a deliverable stands.
 *
 * `completed` used to mean both "this is the film" and "this came out of the
 * encoder", and `failed` meant both "the render threw" and "the film exists
 * and is not good enough". A customer cannot be told the difference between
 * those, and neither could the console.
 */
export const ReleaseState = z.enum([
  'generating',
  'analyzing',
  'qa_failed',
  'repairing',
  'qa_recheck',
  'needs_attention',
  'ready',
]);
export type ReleaseState = z.infer<typeof ReleaseState>;

export const QaReport = z.object({
  id: z.string(),
  renderId: z.string(),
  projectId: z.string(),
  passed: z.boolean(),
  /** Where this attempt left the deliverable. */
  state: ReleaseState.default('analyzing'),
  /** Which pass this was. Zero is the first render, before any repair. */
  attempt: z.number().int().min(0).default(0),
  issues: z.array(QaIssue).default([]),
  /** What the loop tried, and what it cost. */
  repairs: z.array(RepairRecord).default([]),
  /** Provider spend caused by repairs, on top of the film itself. */
  extraCostUsd: z.number().min(0).default(0),
  /** Wall-clock the repairs added. */
  extraLatencyMs: z.number().int().min(0).default(0),
  /** Which layers actually ran. A layer that was skipped proved nothing. */
  layers: z.array(QaLayer).default([]),
  framesInspected: z.number().int().min(0).default(0),
  createdAt: z.string(),
});
export type QaReport = z.infer<typeof QaReport>;

/**
 * What the findings oblige.
 *
 * `blocking` is what stops a release. `repairable` is what the loop should
 * act on now — everything blocking, plus the soft fails, which is the level
 * that exists precisely so a defect gets repaired without holding the film
 * hostage if the repair cannot be made.
 */
export function qaVerdict(issues: QaIssue[]): {
  passed: boolean;
  blockers: QaIssue[];
  repairable: QaIssue[];
  worst: QaSeverity | null;
} {
  const blockers = issues.filter((issue) => blocksRelease(issue.severity));
  const repairable = issues.filter(
    (issue) => SEVERITY_ORDER[issue.severity] >= SEVERITY_ORDER.soft_fail && repairableAutomatically(issue),
  );
  const worst = issues.reduce<QaSeverity | null>(
    (highest, issue) =>
      highest === null || SEVERITY_ORDER[issue.severity] > SEVERITY_ORDER[highest] ? issue.severity : highest,
    null,
  );
  return { passed: blockers.length === 0, blockers, repairable, worst };
}

/**
 * The release gate.
 *
 * A master is READY only when nothing hard or critical is outstanding. A
 * warning may remain; a soft fail may remain only when the loop has already
 * tried and cannot repair it, and it is recorded as accepted rather than
 * silently ignored.
 */
export function releaseDecision(params: {
  issues: QaIssue[];
  attempt: number;
  maxAttempts: number;
  /** An animatic is the customer's own draft, not a deliverable. */
  deliverable?: boolean;
}): { state: ReleaseState; blocking: QaIssue[]; reason: string } {
  const { blockers } = qaVerdict(params.issues);
  const deliverable = params.deliverable ?? true;

  if (blockers.length === 0) {
    return { state: 'ready', blocking: [], reason: '' };
  }
  if (!deliverable) {
    // A preview of a storyboard the customer is still changing is not held to
    // the delivery bar; the findings are returned and shown either way.
    return { state: 'ready', blocking: [], reason: '' };
  }

  const unrepairable = blockers.every(
    (issue) => !repairableAutomatically(issue) || issue.repairStatus === 'unrepairable',
  );
  if (unrepairable || params.attempt >= params.maxAttempts) {
    return {
      state: 'needs_attention',
      blocking: blockers,
      reason: unrepairable
        ? 'Nothing here can be repaired without a person.'
        : `Still failing after ${params.maxAttempts} repair attempts.`,
    };
  }
  return { state: 'qa_failed', blocking: blockers, reason: 'Repairable, and not repaired yet.' };
}
