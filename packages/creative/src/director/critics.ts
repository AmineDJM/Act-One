import { z } from 'zod';
import {
  CriticFinding,
  CreativeVerdict,
  newId,
  standardsBrief,
  verdictForFindings,
  type AudienceModel,
  type BrandGenome,
  type CreativeBrief,
  type CriticId,
  type CriticReview,
} from '@act-one/core';
import type { CallContext, ImageInput, LlmProvider } from '@act-one/providers';

/**
 * The panel.
 *
 * Nine specialists, each shown the same artifact and asked one question from
 * one professional position. They do not talk to each other, they do not vote,
 * and nothing here averages them. Each returns findings with evidence and a
 * verdict; the Director reads all nine and decides.
 *
 * That shape is deliberate and it is the opposite of what a multi-agent system
 * usually does. Personas in conversation converge — they are agreeable by
 * construction — and a panel that converges has told you nothing you did not
 * already believe. These are kept apart so that the conversion critic can want
 * a louder call to action while the film critic says it would ruin the ending,
 * because that disagreement is a real creative decision and somebody has to
 * make it. The record of who won is worth more later than either opinion was.
 *
 * Every critic is asked for the same thing in the same shape, so a new one is
 * a row in a table rather than a new subsystem, and so the Director never has
 * to parse nine kinds of prose.
 */

const CriticResponse = z.object({
  verdict: CreativeVerdict,
  /** What is wrong, with the evidence. Empty is a real and common answer. */
  findings: z.array(CriticFinding).max(8).default([]),
  /** The one thing this critic would change first. Empty when nothing. */
  headline: z.string().max(300).default(''),
  /**
   * What the work said, for the critic that was told nothing else.
   *
   * Asked for as a report rather than a judgement: what company is this,
   * what does it appear to do, who is it for, what was the value, which
   * moment is remembered. An empty string from any other critic.
   */
  readback: z.string().max(1400).default(''),
});

/** What each critic is for, in the words it is asked to think in. */
const BRIEFS: Record<CriticId, { title: string; question: string; lens: string[] }> = {
  film: {
    title: 'the film critic',
    question: 'Is this a film, and is it any good?',
    lens: [
      'Structure, rhythm and payoff. Does the opening earn the rest? Does the ending answer the opening?',
      'Is there ONE organising idea, or seven small ones? Seven is fragmentation and it is the most',
      'common failure in automated work — flag it as such.',
      'Would removing any shot improve this? Say which.',
      'Competent is a failing grade. A film with nothing wrong and nothing memorable is the normal',
      'output of this process and the thing you exist to stop.',
    ],
  },
  art_direction: {
    title: 'the art director',
    question: 'Does this look like somebody decided?',
    lens: [
      'Composition, hierarchy, negative space, colour relationships, type as image.',
      'Restraint counts for more than incident. A frame with three ideas in it has none.',
      'Is the palette doing something, or is it the logo colour applied to everything?',
      'A strong static frame is a legitimate answer; unmotivated movement is not.',
    ],
  },
  brand: {
    title: 'the brand guardian',
    question: 'Is this them?',
    lens: [
      'Register, density, energy, humour, how the product is presented, what the brand would never do.',
      'A film that is good and off-brand is a failure. Say which dimension is off and by how much.',
      'Watch for the house style of the tool leaking in — this must look like the company, not like us.',
    ],
  },
  product_marketing: {
    title: 'the product marketer',
    question: 'Does a stranger understand what this is and why it is different?',
    lens: [
      'When, in seconds, does the category become clear? When does the differentiator?',
      'Late differentiation is the single most expensive defect in a launch film — name the timecode.',
      'Are claims proved or asserted? Proof is real UI, a real result, a real number with a source.',
    ],
  },
  conversion: {
    title: 'the conversion specialist',
    question: 'Does this move the viewer toward the action?',
    lens: [
      'Awareness stage, friction, objections answered or ignored, what the viewer is asked to do.',
      'Sound-off legibility: most of this is watched muted.',
      'Be explicit about the trade-off you are asking for. If a stronger call to action would cost the',
      'ending, say so — the director will weigh it.',
    ],
  },
  copy: {
    title: 'the copywriter',
    question: 'Is a single line of this worth reading?',
    lens: [
      'Specificity over register. Product-specific truth beats elegant nothing.',
      'Flag generic AI copy hard: "reimagine what is possible", "unlock your potential", "welcome to the',
      'future", "the power of", "seamlessly". These are the sound of nobody having decided anything.',
      'Would this line work for a competitor with the logo swapped? Then it is not copy, it is filler.',
    ],
  },
  sound: {
    title: 'the sound director',
    question: 'Is sound carrying half this film or decorating it?',
    lens: [
      'Music progression and where it turns. Sync between what is heard and what is cut.',
      'Silence used on purpose is powerful; silence nobody chose is a fault. Tell them apart.',
      'Is there sonic contrast, or one bed at one level for the whole runtime?',
    ],
  },
  originality: {
    title: 'the originality critic',
    question: 'Have I seen this exact film before?',
    lens: [
      'Look for the automated-video house style: floating UI panels, unmotivated slow push-ins,',
      'particles, glowing gradients, stock people pleased at laptops, every word bouncing in.',
      'Also look for OUR repetitions — the devices listed as recently used are a warning, not a ban.',
      'Novelty under constraint is the target. Random strangeness is not originality.',
    ],
  },
  first_time_viewer: {
    title: 'a person who has never heard of this company',
    question: 'Watching this once, what did you understand?',
    lens: [
      'You know nothing about this company, this product or this interface. You have not read a brief.',
      'You are watching once, the way anyone watches anything: reading whatever is on screen, looking',
      'at whatever the picture shows you, at the speed the film goes.',
      '',
      'Report, in `readback`, and in this order: what company or product this is; what it appears to do;',
      'who might use it; what the main value seemed to be; and which single product moment you would',
      'still be able to describe tomorrow. Where you could not tell, say you could not tell — that is',
      'the most useful thing you can report and the reason you exist.',
      '',
      'Then raise a finding for each of these that happened, with its timecode:',
      '- a line of text that was gone before you finished reading it',
      '- an interface on screen too briefly, or too small, for anything in it to be read',
      '- a screen where you did not know where to look',
      '- a moment where the words and the picture were both asking for your attention at once',
      '- a point where you lost the thread of what was being shown',
      '',
      'Judge ONLY what the film communicated. If you find yourself inferring what the company probably',
      'does, that inference is the finding: the film did not say it.',
      'A film you enjoyed but could not describe afterwards is a revise.',
    ],
  },
  production: {
    title: 'the head of production',
    question: 'Can this actually be made, with what we hold?',
    lens: [
      'Material we have versus material this asks for. A shot that needs a capture nobody took is a',
      'blocker at this stage, not a surprise at render time.',
      'Cost and reliability per shot. A brilliant plan that cannot be produced is not a plan.',
      'Say what the cheapest change is that makes it producible without losing the idea.',
    ],
  },
};

export const CRITIC_VERSION = 'v1';

export type CriticInput = {
  projectId: string;
  artifactKind: CriticReview['artifactKind'];
  artifactId: string;
  brief: CreativeBrief;
  audience: AudienceModel;
  genome: BrandGenome;
  /** The artifact, as the critic should read it. Prose, not JSON dumps. */
  artifact: string;
  /** Frames, when there is something to look at. */
  images?: readonly ImageInput[];
  /** Devices this studio has used lately, for the originality critic. */
  recentDevices?: readonly string[];
};

export class CriticPanel {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  /**
   * Runs the whole panel at once.
   *
   * In parallel because they are independent by design — there is no ordering
   * between them and no critic may read another's opinion, which is the
   * property that keeps them from converging. A critic that fails is dropped
   * with a note rather than failing the panel: eight opinions and a gap is a
   * better input to a decision than an exception.
   */
  async review(
    input: CriticInput,
    critics: readonly CriticId[],
    context: CallContext,
  ): Promise<{ reviews: CriticReview[]; costUsd: number; failed: CriticId[] }> {
    const settled = await Promise.allSettled(
      critics.map((critic) => this.one(critic, input, context)),
    );

    const reviews: CriticReview[] = [];
    const failed: CriticId[] = [];
    let costUsd = 0;
    for (const [index, result] of settled.entries()) {
      if (result.status === 'fulfilled') {
        reviews.push(result.value.review);
        costUsd += result.value.costUsd;
      } else {
        failed.push(critics[index]!);
        console.error(
          `[critics] ${critics[index]} did not answer:`,
          (result.reason as Error).message.slice(0, 200),
        );
      }
    }
    return { reviews, costUsd, failed };
  }

  private async one(
    critic: CriticId,
    input: CriticInput,
    context: CallContext,
  ): Promise<{ review: CriticReview; costUsd: number }> {
    const spec = BRIEFS[critic];
    const { value, usage } = await this.llm.completeJson(
      [
        { role: 'system', content: systemPrompt(critic) },
        { role: 'user', content: userPrompt(input, critic) },
      ],
      {
        schema: CriticResponse,
        schemaName: `critic_${critic}`,
        /*
         * Balanced, not deep. A critic reading one artifact against one lens
         * is not the hardest reasoning in this pipeline, there are nine of
         * them on every gate, and the deep tier on nine parallel calls was
         * where an earlier version of this spent ninety seconds and timed out.
         */
        tier: 'balanced',
        temperature: 0.4,
        maxOutputTokens: 2000,
        repairAttempts: 1,
        ...(input.images && input.images.length > 0 ? { images: [...input.images] } : {}),
      },
      context,
    );

    /*
     * The findings decide the verdict when the stated one is softer than they
     * are. A critic that lists a critical problem and then says "pass with
     * concerns" has written two different opinions, and the one with evidence
     * under it is the one to keep.
     */
    const derived = verdictForFindings(value.findings);
    const verdict = strictest(value.verdict, derived);

    return {
      costUsd: usage.costUsd,
      review: {
        id: newId('crv'),
        projectId: input.projectId,
        artifactKind: input.artifactKind,
        artifactId: input.artifactId,
        critic,
        verdict,
        findings: value.findings,
        readback: value.readback,
        criticVersion: CRITIC_VERSION,
        model: usage.model,
        costUsd: usage.costUsd,
        createdAt: new Date().toISOString(),
      },
    };
  }
}

const ORDER: Record<CreativeVerdict, number> = { pass: 0, pass_with_concerns: 1, revise: 2, block: 3 };
function strictest(a: CreativeVerdict, b: CreativeVerdict): CreativeVerdict {
  return ORDER[a] >= ORDER[b] ? a : b;
}

function systemPrompt(critic: CriticId): string {
  const spec = BRIEFS[critic];
  if (critic === 'first_time_viewer') {
    return [
      `You are ${spec.title}. You have been shown a short film and nothing else.`,
      '',
      spec.question,
      '',
      ...spec.lens,
      '',
      'Every finding cites a timecode. Return JSON only.',
    ].join('\n');
  }
  return [
    `You are ${spec.title}, reviewing work for a studio that makes launch films for software companies.`,
    '',
    `Your question, and only yours: ${spec.question}`,
    '',
    ...spec.lens,
    '',
    'You are one of nine specialists. You will not see what the others said and you must not try to',
    'balance their concerns against yours — arguing your own position as hard as it deserves is the',
    'entire value you add. The director reads all nine and decides; a critic who pre-compromises has',
    'deprived them of the input they needed.',
    '',
    'Every finding cites evidence: a shot id, a timecode, a line of copy. A finding with no evidence',
    'is an opinion and will be ignored.',
    '',
    'Say nothing when there is nothing to say. An empty findings list is a real answer and a better',
    'one than manufactured concerns. But do not reach for "pass" out of politeness: if this is',
    'merely competent, that is a revise.',
    '',
    standardsBrief('direction'),
    '',
    'Return JSON only.',
  ].join('\n');
}

function userPrompt(input: CriticInput, critic: CriticId): string {
  /*
   * Blind, and it has to be blind in the prompt rather than by instruction.
   *
   * Telling a model "do not use the brief" and then handing it the brief
   * tests the model's discipline rather than the film's clarity, and it will
   * fail that test in the direction that makes the film look good: it will
   * read the assignment, understand the product, and report that the film
   * communicated it. The only way to find out what a film says is to show
   * somebody the film.
   */
  if (critic === 'first_time_viewer') {
    return [
      `THE FILM, and nothing else:`,
      input.artifact,
      input.images && input.images.length > 0
        ? `\nFrames from it are attached, in order, with their timecodes.`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const { brief, audience, genome } = input;
  return [
    `THE ASSIGNMENT`,
    `${brief.company} — ${brief.product}. A ${brief.durationSeconds}s ${brief.filmFormat.replace(/_/g, ' ')}.`,
    `The film must: ${brief.creativeObjective}`,
    `Viewer walks in believing: ${brief.transformation.before}`,
    `Viewer should walk out believing: ${brief.transformation.after}`,
    `Business objective: ${brief.goal.business.replace(/_/g, ' ')}. Call to action: ${brief.goal.ctaStrength}.`,
    ``,
    `AUDIENCE: ${audience.who} (${audience.sophistication}).`,
    audience.objections.length > 0 ? `Objections: ${audience.objections.slice(0, 5).join('; ')}.` : '',
    audience.attentionContext ? `Watched: ${audience.attentionContext}.` : '',
    ``,
    `BRAND: ${genome.archetype.replace(/_/g, ' ')}. ${genome.languageBehaviour}`,
    genome.taboos.length > 0 ? `Never: ${genome.taboos.slice(0, 6).join('; ')}.` : '',
    ``,
    critic === 'originality' && input.recentDevices && input.recentDevices.length > 0
      ? `DEVICES THIS STUDIO HAS USED RECENTLY: ${input.recentDevices.slice(0, 10).join('; ')}.`
      : '',
    ``,
    `THE WORK (${input.artifactKind.replace(/_/g, ' ')}):`,
    input.artifact,
    input.images && input.images.length > 0
      ? `\nFrames from it are attached, in order, with their timecodes.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Everyone. The default panel for a gate that matters. */
export const FULL_PANEL: readonly CriticId[] = [
  'film',
  'art_direction',
  'brand',
  'product_marketing',
  'conversion',
  'copy',
  'sound',
  'originality',
  'production',
  /*
   * Last, because it is the one whose answer none of the others can give.
   * Everything above judges the work against what it was meant to be; this
   * one reports what it turned out to be, to somebody with no idea.
   */
  'first_time_viewer',
];

/**
 * The panel worth paying for before anything is written in detail.
 *
 * A territory has no typography, no sound and no shots, so four of the nine
 * would be inventing something to review. Asking them anyway is how a system
 * ends up with nine confident opinions about a thing that does not exist yet.
 */
export const TERRITORY_PANEL: readonly CriticId[] = [
  'film',
  'brand',
  'product_marketing',
  'conversion',
  'originality',
];
