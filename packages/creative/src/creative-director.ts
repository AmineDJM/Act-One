import { z } from 'zod';
import {
  VoiceStrategy,
  newId,
  topMoments,
  type BrandSystem,
  type Concept,
  type CreativeTreatment,
  type ProductUnderstanding,
  type ProjectBrief,
} from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';
import { getSystem } from './systems/index.ts';

/**
 * The Creative Director.
 *
 * Turns an approved concept into a treatment: the document a director would
 * hand a crew. The distinctive requirement is that it must decide what NOT to
 * show. A treatment that only lists what is in the film produces a film that
 * includes everything, and a film that includes everything says nothing.
 *
 * It also decides whether the film speaks. Voice-over is the default in
 * automated video and it is usually wrong — most launch films are stronger with
 * type, product sound and music, because a synthetic voice explaining on-screen
 * text is the single clearest tell that nobody directed this.
 */
const TreatmentResponse = z.object({
  title: z.string().trim().min(1).max(120),
  tagline: z.string().trim().min(1).max(200),
  /** Empty is a legitimate answer. Many good launch films have no script. */
  script: z.string().max(6000).default(''),
  visualLanguage: z.string().trim().min(1).max(1200),
  typographyDirection: z.string().trim().min(1).max(800),
  cameraLanguage: z.string().trim().min(1).max(800),
  rhythm: z.string().trim().min(1).max(600),
  motionStyleNotes: z.string().trim().min(1).max(600),
  soundStyle: z.string().trim().min(1).max(600),
  voiceStrategy: VoiceStrategy,
  voiceRationale: z.string().max(400).default(''),
  generativeMediaStrategy: z.string().trim().min(1).max(800),
  productUiUsage: z.string().trim().min(1).max(800),
  /** The discipline that makes it a treatment. */
  exclusions: z.array(z.string().trim().min(1).max(200)).min(2).max(8),
  cta: z.string().trim().min(1).max(200),
});

const SYSTEM_PROMPT = `You are the creative director. A concept has been approved and you are writing the treatment the crew will work from.

You decide three things nobody else can:
1. What the film shows.
2. What the film deliberately does NOT show. Be specific and give at least two real exclusions — things a lesser film would include and this one will not.
3. Whether the film speaks at all.

On voice: do not default to voice-over. Choose "none" unless narration genuinely does something typography and product sound cannot. A voice reading out what is already on screen is the clearest sign a film was automated. If you do choose a voice, say why in voiceRationale.

On the script: if the film has no narration, "script" should contain the on-screen text beats instead, one per line, in order. If there is narration, write it as narration. Either way write it tight — you have seconds, not paragraphs.

Write like a director, not a marketer. Concrete nouns, specific instructions. "The cursor hesitates, then commits" beats "dynamic and engaging interactions".

Return JSON only.`;

export type DirectionInput = {
  projectId: string;
  concept: Concept;
  understanding: ProductUnderstanding;
  brand: BrandSystem;
  brief: ProjectBrief;
};

export class CreativeDirector {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async direct(input: DirectionInput, context: CallContext): Promise<CreativeTreatment> {
    const system = getSystem(input.concept.creativeSystem);
    const hasRealFootage = input.understanding.productMoments.some((m) => m.screenshots.length > 0);
    const moments = topMoments(input.understanding, 6);

    const { value } = await this.llm.completeJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `# Approved concept`,
            `"${input.concept.name}"`,
            `Idea: ${input.concept.keyIdea}`,
            `Hook: ${input.concept.hook}`,
            `Angle: ${input.concept.productAngle}`,
            `Emotional target: ${input.concept.targetEmotion}`,
            `Structure: ${input.concept.narrativeStructure}`,
            `Beats the customer approved:`,
            ...input.concept.keyScenes.map((s, i) => `  ${i + 1}. ${s}`),
            ``,
            `# Creative system: ${system.name}`,
            system.essence,
            `Pacing: average scene ${system.pacing.averageSceneSeconds}s, range ${system.pacing.sceneRange[0]}–${system.pacing.sceneRange[1]}s.`,
            `Sound behaviour: ${system.sound.musicCharacter} UI sound: ${system.sound.uiSoundDensity}.`,
            `Hard prohibitions: ${system.prohibitions.join('; ')}`,
            ``,
            `# The product`,
            `${input.understanding.name} — ${input.understanding.oneLiner}`,
            `Their own tone: ${input.understanding.tone}`,
            `Supported benefits: ${input.understanding.keyBenefits.map((c) => c.text).join(' | ') || 'none established'}`,
            `Proof we may use: ${input.understanding.proofPoints.map((c) => c.text).join(' | ') || 'none — do not imply metrics'}`,
            ``,
            `Real filmable moments:`,
            ...moments.map(
              (m) => `- ${m.title}: ${m.startState || 'start'} → ${m.endState || 'result'}${m.screenshots.length > 0 ? ' [captured]' : ' [not captured]'}`,
            ),
            hasRealFootage
              ? ''
              : `We have NO captured product footage. The treatment must not depend on detailed UI shots, and must never call for a fabricated interface.`,
            ``,
            `# Brand`,
            `Visual: ${input.brand.visualStyle}. Motion: ${input.brand.motionStyle}. Corners: ${input.brand.cornerStyle}.`,
            `Gradients: ${input.brand.allowsGradient ? 'used by the brand' : 'NOT used — do not introduce them'}.`,
            `Glow: ${input.brand.allowsGlow ? 'used by the brand' : 'NOT used — do not introduce it'}.`,
            `Tone: ${input.brand.tone}`,
            ``,
            `# Constraints`,
            `Runtime: about ${input.brief.durationSeconds ?? input.concept.estimatedDurationSeconds} seconds.`,
            input.brief.creativeMode === 'authentic'
              ? 'Authentic mode: real product and company material only. No generated imagery whatsoever.'
              : input.brief.creativeMode === 'cinematic'
                ? 'Cinematic mode: a larger generative budget is available for atmosphere and metaphor.'
                : 'Studio mode: real material first, generated shots only where they genuinely add.',
            input.brief.voiceStrategy ? `The customer asked for voice: ${input.brief.voiceStrategy}.` : '',
            input.brief.excludedClaims.length > 0
              ? `Never claim: ${input.brief.excludedClaims.join('; ')}`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      {
        schema: TreatmentResponse,
        schemaName: 'CreativeTreatment',
        tier: 'deep',
        temperature: 0.7,
        maxOutputTokens: 3500,
        repairAttempts: 1,
      },
      context,
    );

    // The customer's explicit voice choice outranks the director's.
    const voiceStrategy = input.brief.voiceStrategy ?? value.voiceStrategy;

    return {
      id: newId('cpt'),
      conceptId: input.concept.id,
      projectId: input.projectId,
      title: value.title,
      tagline: value.tagline,
      script: value.script,
      visualLanguage: value.visualLanguage,
      typographyDirection: value.typographyDirection,
      cameraLanguage: value.cameraLanguage,
      rhythm: value.rhythm,
      motionStyleNotes: value.motionStyleNotes,
      soundStyle: value.soundStyle,
      voiceStrategy,
      generativeMediaStrategy: input.brief.realMediaOnly
        ? 'Real media only, at the customer’s instruction. No generated imagery.'
        : value.generativeMediaStrategy,
      productUiUsage: value.productUiUsage,
      exclusions: dedupe([
        ...value.exclusions,
        ...system.prohibitions.slice(0, 2),
        ...(input.brand.allowsGradient ? [] : ['No gradients — the brand does not use them']),
        ...(input.brand.allowsGlow ? [] : ['No glow — the brand does not use it']),
        ...(hasRealFootage ? [] : ['No fabricated product interface']),
      ]),
      cta: value.cta,
      confidence: hasRealFootage ? 0.85 : 0.6,
      createdAt: new Date().toISOString(),
    };
  }
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(value);
  }
  return kept.slice(0, 10);
}
