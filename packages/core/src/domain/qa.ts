import { z } from 'zod';
import { score01 } from '../zod-helpers.ts';

export const QaCheck = z.enum([
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
  /* Not a defect. The one judgement here with no arithmetic behind it. */
  'direction',
]);
export type QaCheck = z.infer<typeof QaCheck>;

export const QaSeverity = z.enum(['blocker', 'major', 'minor', 'note']);
export type QaSeverity = z.infer<typeof QaSeverity>;

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
  'manual_review',
]);
export type RepairAction = z.infer<typeof RepairAction>;

export const QaIssue = z.object({
  id: z.string(),
  check: QaCheck,
  severity: QaSeverity,
  sceneId: z.string().nullable().default(null),
  /** Seconds into the film, for the reviewer's timeline marker. */
  atSeconds: z.number().min(0).nullable().default(null),
  message: z.string().max(800),
  evidenceAssetId: z.string().nullable().default(null),
  confidence: score01.default(0.7),
  /** Targeted repair — never "re-render everything". */
  repair: RepairAction.nullable().default(null),
  detectedBy: z.enum(['deterministic', 'vision', 'fact_check', 'audio']).default('deterministic'),
});
export type QaIssue = z.infer<typeof QaIssue>;

export const QaReport = z.object({
  id: z.string(),
  renderId: z.string(),
  projectId: z.string(),
  passed: z.boolean(),
  issues: z.array(QaIssue).default([]),
  repairActions: z
    .array(
      z.object({
        sceneId: z.string().nullable().default(null),
        action: RepairAction,
        reason: z.string().max(400),
      }),
    )
    .default([]),
  framesInspected: z.number().int().min(0).default(0),
  createdAt: z.string(),
});
export type QaReport = z.infer<typeof QaReport>;

/** Blockers stop a master from shipping; majors trigger auto-repair once. */
export function qaVerdict(issues: QaIssue[]): {
  passed: boolean;
  blockers: QaIssue[];
  repairable: QaIssue[];
} {
  const blockers = issues.filter((i) => i.severity === 'blocker');
  const repairable = issues.filter(
    (i) => (i.severity === 'blocker' || i.severity === 'major') && i.repair && i.repair !== 'manual_review',
  );
  return { passed: blockers.length === 0, blockers, repairable };
}
