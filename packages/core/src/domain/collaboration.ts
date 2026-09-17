import { z } from 'zod';

export const CommentTarget = z.enum(['concept', 'scene', 'render', 'project']);
export type CommentTarget = z.infer<typeof CommentTarget>;

export const Comment = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  target: CommentTarget,
  targetId: z.string(),
  authorUserId: z.string(),
  body: z.string().trim().min(1).max(4000),
  /** Seconds into the film, for timeline comments on a render. */
  atSeconds: z.number().min(0).nullable().default(null),
  resolvedAt: z.string().nullable().default(null),
  resolvedByUserId: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Comment = z.infer<typeof Comment>;

export const ApprovalGate = z.enum(['concept', 'storyboard', 'final']);
export type ApprovalGate = z.infer<typeof ApprovalGate>;

export const Approval = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  gate: ApprovalGate,
  targetId: z.string(),
  approvedByUserId: z.string(),
  createdAt: z.string(),
});
export type Approval = z.infer<typeof Approval>;

/**
 * Natural-language revision requests. The customer never sees "Revision Round 1";
 * they write a sentence and we resolve it into structured storyboard edits.
 */
export const RevisionIntent = z.enum([
  'retime_scene',
  'replace_visual',
  'reduce_text',
  'rewrite_copy',
  'change_tone',
  'remove_voiceover',
  'add_voiceover',
  'reorder_scenes',
  'remove_scene',
  'recapture_product',
  'change_system',
  'restrict_to_real_media',
  'adjust_sound',
  'unknown',
]);
export type RevisionIntent = z.infer<typeof RevisionIntent>;

export const RevisionRequest = z.object({
  id: z.string(),
  projectId: z.string(),
  storyboardId: z.string(),
  authorUserId: z.string(),
  instruction: z.string().trim().min(1).max(1000),
  intent: RevisionIntent.default('unknown'),
  /** Scenes the resolver decided are affected. Only these get re-rendered. */
  affectedSceneIds: z.array(z.string()).default([]),
  applied: z.boolean().default(false),
  appliedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type RevisionRequest = z.infer<typeof RevisionRequest>;
