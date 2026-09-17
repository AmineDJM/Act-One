import { z } from 'zod';
import { newId, type QaCheck, type QaIssue, type Scene } from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';

/**
 * Vision QA.
 *
 * Looks at rendered frames for the defects arithmetic cannot decide: a warped
 * logo, a hand with six fingers in a generated shot, a composition that is
 * technically within the grid and still ugly.
 *
 * Deliberately narrow. A model asked "is this good?" will always find something
 * to say, and a QA pass that flags every film is a QA pass everybody learns to
 * ignore. It is given a specific checklist, told to return nothing when the
 * frame is fine, and its findings are capped in severity — vision findings
 * trigger a repair, never a hard block on their own.
 */
const VisionFinding = z.object({
  findings: z
    .array(
      z.object({
        check: z.enum([
          'distorted_ui',
          'image_artifact',
          'anatomy',
          'logo_integrity',
          'composition',
          'visual_hierarchy',
          'brand_consistency',
          'typo',
          'legible_generated_text',
          'spacing',
        ]),
        severity: z.enum(['major', 'minor', 'note']),
        message: z.string().max(400),
        confidence: z.number().min(0).max(1).default(0.6),
      }),
    )
    .max(6)
    .default([]),
});

const SYSTEM_PROMPT = `You are reviewing a single frame from a launch film made for a software company.

You are looking ONLY for defects a viewer would notice:
- Interface that is warped, stretched, melted or obviously not a real screenshot
- Generated imagery with artifacts: malformed hands, faces, impossible geometry, smeared detail
- Text inside a generated image (generative models cannot set type; any readable text in a generated area is a defect)
- A logo that is stretched, recoloured or cropped wrongly
- Elements colliding, overlapping or crowding the frame edge
- A frame where nothing leads the eye

You are NOT looking for:
- Subjective taste. Restraint, empty space and darkness are intentional.
- Missing information. A frame showing one word is intentional.
- Anything you would only notice by pausing.

If the frame is fine, return an empty findings array. Most frames are fine. Return JSON only.`;

export type VisionQaInput = {
  /** Data URL or signed https URL of the frame. */
  frameUrl: string;
  scene: Scene | null;
  atSeconds: number;
  /** Told to the model so it does not flag intentional emptiness. */
  intent?: string;
};

export async function inspectFrame(
  llm: LlmProvider,
  input: VisionQaInput,
  context: CallContext,
): Promise<QaIssue[]> {
  const { value } = await llm.completeJson(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Frame at ${input.atSeconds.toFixed(1)}s.` +
          (input.scene ? ` This scene is meant to: ${input.scene.purpose}.` : '') +
          (input.intent ? ` Creative intent: ${input.intent}` : ''),
      },
    ],
    {
      schema: VisionFinding,
      schemaName: 'VisionFinding',
      tier: 'balanced',
      // Low temperature: we want the same verdict on the same frame, so a
      // re-run after a repair is comparable to the run before it.
      temperature: 0.1,
      images: [{ url: input.frameUrl, detail: 'high' }],
    },
    context,
  );

  return value.findings.map((finding) => ({
    id: newId('evt'),
    check: finding.check as QaCheck,
    // Vision findings never block on their own. A model that misreads a
    // deliberately dark frame must not be able to stop a film shipping.
    severity: finding.severity === 'major' ? ('major' as const) : ('minor' as const),
    sceneId: input.scene?.id ?? null,
    atSeconds: input.atSeconds,
    message: finding.message,
    evidenceAssetId: null,
    confidence: finding.confidence,
    repair: repairFor(finding.check),
    detectedBy: 'vision' as const,
  }));
}

function repairFor(check: string): QaIssue['repair'] {
  switch (check) {
    case 'image_artifact':
    case 'anatomy':
    case 'legible_generated_text':
      return 'regenerate_shot';
    case 'distorted_ui':
      return 'recapture_product';
    case 'typo':
      return 'rewrite_copy';
    case 'spacing':
    case 'composition':
    case 'visual_hierarchy':
      return 'relayout_text';
    case 'logo_integrity':
      return 'swap_asset';
    default:
      return 'manual_review';
  }
}

/**
 * Chooses which frames to inspect.
 *
 * Inspecting every frame is unaffordable and pointless — consecutive frames are
 * nearly identical. We sample the middle of each scene, where motion has
 * settled and the frame is what the viewer actually reads, and always include
 * generated scenes, which are where defects actually live.
 */
export function selectFramesToInspect(
  scenes: Scene[],
  options: { maxFrames?: number } = {},
): { scene: Scene; atSeconds: number }[] {
  const maxFrames = options.maxFrames ?? 8;

  const scored = scenes.map((scene) => {
    let priority = 1;
    if (scene.visualType === 'generated_broll' || scene.visualType === 'mixed_media') priority += 3;
    if (scene.visualType === 'product_ui_3d' || scene.visualType === 'cinematic_3d') priority += 2;
    if (scene.visualType === 'logo_reveal') priority += 2;
    if (scene.onScreenText.length > 0) priority += 1;
    return { scene, priority };
  });

  return scored
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxFrames)
    .map(({ scene }) => ({
      scene,
      // 60% in: motion has settled, and the frame is not yet dissolving out.
      atSeconds: scene.startTime + scene.duration * 0.6,
    }))
    .sort((a, b) => a.atSeconds - b.atSeconds);
}
