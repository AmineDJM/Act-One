import { z } from 'zod';
import { brandDirectionLines, briefDirectionLines, cutDirectionLines, formatDirectionLines } from './brief-lines.ts';
import {
  standardsBrief,
  budgetFor,
  cutAspect,
  cutSeconds,
  FILM_CUTS,
  findMoment,
  newId,
  coherentRecipe,
  REAL_PRODUCT_VISUAL_TYPES,
  resequence,
  round3,
  sceneShowsSomething,
  storyboardDuration,
  isRealProductAsset,
  LIBRARY_CATEGORY_LABELS,
  type Asset,
  type BrandSystem,
  type CameraRecipe,
  type Concept,
  type CreativeTreatment,
  type EasingName,
  type FilmCut,
  type FilmFormat,
  type MotionRecipe,
  type MotionRecipeName,
  type ProductMoment,
  type ProductUnderstanding,
  type ProjectBrief,
  type Scene,
  type SoundCue,
  type Storyboard,
  type VisualType,
} from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';
import { archetypesFor, getSystem, pacedForCut, type CreativeSystem, type SceneArchetype } from './systems/index.ts';
import { routeShot, enforceBudget, checkBudget, type BudgetViolation } from './shot-routing.ts';
import { copyFits, fitToDuration, narrationSeconds, readingSeconds, varyRhythm, type TimingConstraint } from './timing.ts';

/**
 * The Storyboard Engine.
 *
 * Takes an approved treatment and produces a scene-by-scene plan precise enough
 * to render — and cheap enough to argue with. Everything expensive happens
 * after this, so this is where composition, timing, legibility and budget are
 * decided and corrected.
 *
 * The model plans the *narrative*: what each scene is for, what it says, which
 * product moment it films. Everything mechanical — durations, easing, camera,
 * sound placement, technique routing — is computed from the creative system's
 * grammar and the brand, because those are the parts that must be consistent
 * and are exactly the parts a model is worst at.
 */
const ScenePlan = z.object({
  scenes: z
    .array(
      z.object({
        /** Which archetype from the creative system this scene is. */
        archetypeId: z.string().min(1).max(60),
        purpose: z.string().trim().min(1).max(300),
        onScreenText: z.array(z.string().max(160)).max(4).default([]),
        narration: z.string().max(400).default(''),
        /** Moment id from the brief, when this scene films the product. */
        momentId: z.string().nullable().default(null),
        /** Written as a shot brief for generated scenes; ignored otherwise. */
        generativeBrief: z.string().max(600).default(''),
        /** Which supported claim this scene asserts, if any. */
        claimText: z.string().max(300).default(''),
        /** A real picture from the library to show in this scene, by id. */
        libraryAssetId: z.string().nullable().default(null),
      }),
    )
    .min(3)
    .max(24),
});

const SYSTEM_PROMPT = `You are storyboarding an approved treatment. You are planning what happens in each scene, in order.

You will be given the creative system's scene archetypes. Every scene must use one of them by id. Choose archetypes that serve the beat — do not use the same archetype more than twice in a row.

Rules:
- On-screen text is short. Most scenes carry a few words or none. If a scene's archetype allows 4 words, do not write 12.
- Never write on-screen text that repeats the narration. If both exist, they must do different work.
- Only set "momentId" when the scene genuinely films that product moment.
- Each moment says what we can actually show. A capture of a public page shows that page, not an interaction: write that scene's on-screen text about what the page proves, never "watch it happen". Product images and in-product captures can carry feature beats. A moment marked NOT captured cannot carry a product scene at all.
- Never film the same moment in two consecutive scenes. Two shots of one capture in a row is the same picture twice; put a different beat between them or use a different moment.
- Only write "generativeBrief" for atmospheric, metaphorical or environmental scenes. Never describe a product interface in a generative brief — generated footage must never stand in for the real product.
- "claimText" must be copied verbatim from the supported claims you are given, or left empty. Never invent a claim.
- The library lists real pictures the customer supplied or the research kept. Real pictures come before anything imagined: when a beat about people, a place, a product or a proof can be carried by one of them, set "libraryAssetId" to its id and leave "generativeBrief" empty. Prefer pictures marked approved. Use each picture at most once. A UI picture from the library may carry a product beat only when it shows the moment the scene films; a photograph of people, an office or a product carries a human or environmental beat.
- Every line of on-screen text is a complete thought on its own. Never end a line expecting the next thing to finish it — the end card is composed separately and will not complete your sentence.
- The first scene is the hook. Do not write the ending: the film closes on its own end card, with the company's name and address. Earn everything in between.

${standardsBrief('storyboard')}

Return JSON only.`;

/**
 * A library asset as the planner sees it: enough to choose it and to know
 * what it may stand for, never the bytes.
 */
export type LibraryAsset = Pick<
  Asset,
  'id' | 'name' | 'category' | 'description' | 'approved' | 'favorite' | 'origin' | 'kind' | 'contentType' | 'width' | 'height'
>;

export type StoryboardInput = {
  projectId: string;
  concept: Concept;
  treatment: CreativeTreatment;
  understanding: ProductUnderstanding;
  brand: BrandSystem;
  brief: ProjectBrief;
  version: number;
  targetDurationSeconds?: number;
  /** What the library holds for this project, in the order it should be consulted. */
  libraryAssets?: LibraryAsset[];
};

export type StoryboardResult = {
  storyboard: Storyboard;
  violations: BudgetViolation[];
  /** Copy that had to be re-broken to fit the type treatment. */
  copyAdjustments: { sceneId: string; from: string[]; to: string[] }[];
};

export class StoryboardEngine {
  private readonly llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async build(input: StoryboardInput, context: CallContext): Promise<StoryboardResult> {
    const written = getSystem(input.concept.creativeSystem);
    const format = input.brief.filmFormat;
    /*
     * The vocabulary this film is allowed to speak in.
     *
     * Everything else in this method reads from here rather than from the
     * system directly, so a pitch cannot reach a product archetype by any
     * route — not through the planner, not through a fuzzy id match, not
     * through the positional fallback.
     */
    const vocabulary = archetypesFor(written, format);
    /*
     * The runtime, held inside what the cut can carry.
     *
     * A caller's explicit target still wins outright — that is the campaign
     * asking for a specific length from approved material. Everything else,
     * including the concept's own estimate, is pulled into the cut's band:
     * a twenty-two second reel storyboarded to sixty seconds is a long film
     * with two thirds of it cut off, which is the repurposed-landscape look
     * this choice exists to prevent.
     */
    const cut = input.brief.filmCut;
    // The system, cut for this film's rhythm. Everything below reads from
    // these rather than from the system as written.
    const { system, archetypes } = pacedForCut(written, vocabulary, cut);
    const target =
      input.targetDurationSeconds ??
      cutSeconds(cut, input.brief.durationSeconds ?? input.concept.estimatedDurationSeconds);

    const plan = await this.plan(input, system, archetypes, target, context);
    const built = this.materialise(plan, input, system, archetypes, target);

    const budget = { ...budgetFor(input.brief.creativeMode, format) };
    const withinBudget = enforceBudget(built.storyboard, budget);
    const finalBoard = resequence(withinBudget);

    return {
      storyboard: finalBoard,
      violations: checkBudget(finalBoard, input.understanding, input.brief.creativeMode, {}, format),
      copyAdjustments: built.copyAdjustments,
    };
  }

  /**
   * The end card, when the film does not already have one.
   *
   * Returns null when the model's own last beat is already an ending — a
   * storyboard that closes on a logo reveal does not need a second one.
   */
  private closingScene(
    system: CreativeSystem,
    storyboardId: string,
    scenes: readonly Scene[],
  ): Scene | null {
    const last = scenes[scenes.length - 1];
    if (!last) return null;
    if (last.visualType === 'logo_reveal') return null;

    /*
     * Prefer the ending that carries the call to action.
     *
     * The alternative in every system is a pure sign-off — the mark alone, no
     * address. It is a beautiful last frame and it tells a viewer who has just
     * decided they want this nowhere to go, which is the one job the last three
     * seconds of a launch film has.
     */
    const ending =
      system.endings.find((option) => option.motion === 'cta_end_card') ?? system.endings[0];
    if (!ending) return null;

    const duration = round3((ending.durationRange[0] + ending.durationRange[1]) / 2);

    return {
      id: newId('scn'),
      storyboardId,
      index: scenes.length,
      startTime: 0,
      duration,
      purpose: 'Close on the brand and the address.',
      narration: '',
      // Deliberately empty: the renderer composes the lockup, the tagline and
      // the company's own domain. Copy here would compete with all three.
      onScreenText: [],
      visualType: 'logo_reveal',
      assetRefs: [],
      momentIds: [],
      motionRecipe: {
        name: coherentRecipe('logo_reveal', ending.motion, null),
        easing: system.pacing.defaultEasing,
        delay: 0,
        stagger: 0.06,
        intensity: 0.5,
        params: {},
      },
      cameraRecipe: {
        move: 'static',
        fromScale: 1,
        toScale: 1,
        fromX: 0,
        toX: 0,
        fromY: 0,
        toY: 0,
        motionBlur: 0.1,
        depthOfField: 0,
        easing: 'in_out_quart',
      },
      soundCues: ending.soundCues.map((type) => ({
        time: 0,
        type,
        assetId: null,
        intensity: 0.6,
        durationSeconds: null,
      })),
      voiceOver: false,
      generativeNeeds: [],
      threeDSceneId: null,
      status: 'draft',
      claimEvidenceIds: [],
      notes: `Ending: ${ending.name}`,
      estimatedCostUsd: 0,
    };
  }

  private async plan(
    input: StoryboardInput,
    system: CreativeSystem,
    archetypes: SceneArchetype[],
    target: number,
    context: CallContext,
  ): Promise<z.infer<typeof ScenePlan>> {
    const format = input.brief.filmFormat;
    const cut = input.brief.filmCut;
    // A pitch is not shown the moments at all. Listing captures it may not use
    // is how a planner talks itself into a product beat and then writes copy
    // that only makes sense over a screenshot nobody will see.
    const moments = format === 'pitch' ? [] : input.understanding.productMoments;
    const claims = [
      ...input.understanding.keyBenefits,
      ...input.understanding.differentiators,
      ...input.understanding.proofPoints,
    ];
    // The first sixteen: the ranking put approved and favourite pictures first.
    const library = (input.libraryAssets ?? []).slice(0, 16);
    const approximateScenes = Math.max(
      4,
      Math.round(target / system.pacing.averageSceneSeconds),
    );

    const { value } = await this.llm.completeJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `# Treatment: ${input.treatment.title}`,
            input.treatment.tagline,
            ``,
            `Visual language: ${input.treatment.visualLanguage}`,
            `Camera: ${input.treatment.cameraLanguage}`,
            `Rhythm: ${input.treatment.rhythm}`,
            `Voice strategy: ${input.treatment.voiceStrategy}`,
            input.treatment.voiceStrategy === 'none'
              ? 'There is NO narration. Leave every "narration" empty.'
              : 'Narration is used. Keep it short and never duplicate the on-screen text.',
            ``,
            `Deliberately excluded from this film:`,
            ...input.treatment.exclusions.map((e) => `- ${e}`),
            ``,
            input.treatment.script ? `Script / text beats:\n${input.treatment.script}` : '',
            ``,
            `# Concept beats to cover, in order`,
            ...input.concept.keyScenes.map((s, i) => `${i + 1}. ${s}`),
            ``,
            `# Available scene archetypes (use these ids)`,
            ...archetypes.map(
              (a) =>
                `- ${a.id}: ${a.purpose} (${a.durationRange[0]}–${a.durationRange[1]}s, ` +
                `max ${a.maxWords} words on screen${a.requiresProductAsset ? ', needs real product capture' : ''})`,
            ),
            ``,
            ...formatLines(format),
            ...cutLines(cut),
            ``,
            `# Product moments available (id — what happens — what we can actually show)`,
            ...(format === 'pitch'
              ? ['- none. This film does not navigate the product. Leave every "momentId" null.']
              : moments.length > 0
                ? moments.map(
                    (m) =>
                      `- ${m.id} — ${m.title}: ${m.startState || 'start'} → ${m.endState || 'result'} ` +
                      captureNote(m),
                  )
                : ['- none']),
            ``,
            `# Library (real pictures; use these before imagining anything)`,
            ...(library.length > 0
              ? library.map(
                  (asset) =>
                    `- ${asset.id} — ${asset.name || 'untitled'} [${LIBRARY_CATEGORY_LABELS[asset.category]}` +
                    `${asset.approved ? ', approved' : asset.favorite ? ', favourite' : ''}]` +
                    `${asset.description ? `: ${asset.description.slice(0, 200)}` : ''}`,
                )
              : ['- none']),
            ``,
            `# Supported claims (copy verbatim into claimText or leave empty)`,
            ...(claims.length > 0 ? claims.map((c) => `- ${c.text}`) : ['- none']),
            ``,
            `# Constraints`,
            `Target runtime: ${target} seconds. Plan roughly ${approximateScenes} scenes.`,
            ...briefDirectionLines(input.brief),
            ...brandDirectionLines(input.brand),
            `CTA at the end: ${input.treatment.cta}`,
            input.brief.realMediaOnly ? 'Real media only: no generative briefs at all.' : '',
            `Hard prohibitions: ${system.prohibitions.join('; ')}`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      {
        schema: ScenePlan,
        schemaName: 'ScenePlan',
        tier: 'deep',
        temperature: 0.6,
        maxOutputTokens: 6000,
        repairAttempts: 1,
      },
      context,
    );

    return value;
  }

  /**
   * Converts the narrative plan into renderable scenes.
   *
   * Everything here is deterministic. Given the same plan, brand and system,
   * this produces byte-identical scenes — which is what makes a re-render after
   * a one-scene repair produce the same film minus the repaired shot.
   */
  private materialise(
    plan: z.infer<typeof ScenePlan>,
    input: StoryboardInput,
    system: CreativeSystem,
    archetypes: SceneArchetype[],
    target: number,
  ): { storyboard: Storyboard; copyAdjustments: StoryboardResult['copyAdjustments'] } {
    const storyboardId = newId('sbd');
    const format = input.brief.filmFormat;
    const cut = input.brief.filmCut;
    const allowGenerative =
      !input.brief.realMediaOnly && budgetFor(input.brief.creativeMode, format).maxGenerativeRatio > 0;
    const allowThreeD = input.brief.creativeMode !== 'authentic' || true;
    const copyAdjustments: StoryboardResult['copyAdjustments'] = [];

    /*
     * Carried across scenes so each one can step away from the treatment the
     * last one used. Without it a film with no product capture routes every
     * beat to the same typographic recipe and reads as a template.
     */
    let previousRecipe: MotionRecipeName | null = null;

    /*
     * Real pictures first. A scene the planner gave a library picture shows
     * that picture: a product capture from the library carries the product
     * beat the way a moment's capture does; a photograph is staged as real
     * media. Each picture once — the model is told, and this is the lock.
     */
    const library = new Map((input.libraryAssets ?? []).map((asset) => [asset.id, asset] as const));
    const used = new Set<string>();
    // Generated shots are anchored to the brand's own approved material, so
    // what the model imagines is lit and coloured like what is real.
    const anchor = (input.libraryAssets ?? []).find(
      (asset) => asset.approved && (asset.category === 'product' || asset.category === 'brand') && !asset.contentType.includes('svg'),
    );

    const drafted = plan.scenes.map((planned, index): { scene: Scene; planned: typeof planned } => {
      const archetype = this.resolveArchetype(archetypes, planned.archetypeId, index, plan.scenes.length);
      // A pitch never films a moment, so a moment id the planner supplied
      // anyway is dropped here rather than carried into assetRefs.
      const moment =
        format !== 'pitch' && planned.momentId
          ? findMoment(input.understanding, planned.momentId)
          : undefined;
      const picked = planned.libraryAssetId && !used.has(planned.libraryAssetId) ? library.get(planned.libraryAssetId) : undefined;
      if (picked) used.add(picked.id);
      // In a pitch a product capture from the archive is still a product
      // capture, and the format says no interface. It is simply not used.
      const pickedIsProduct = Boolean(picked && isRealProductAsset(picked));
      const pickedIsPhoto = Boolean(picked && !pickedIsProduct);
      const usablePicture = format === 'pitch' ? pickedIsPhoto : Boolean(picked);
      const hasRealAsset = format !== 'pitch' && (Boolean(moment && moment.screenshots.length > 0) || pickedIsProduct);

      const routed = routeShot({
        purpose: purposeFor(archetype, planned.generativeBrief.length > 0),
        hasRealProductAsset: hasRealAsset,
        allowGenerative,
        allowThreeD,
        format,
      });

      /*
       * The archetype's own visual type wins unless something has vetoed it,
       * and a photograph from the library is real media whatever the archetype
       * was written for.
       *
       * Four vetoes, all the same shape: the archetype declares a container
       * and nothing exists to put in it. A product scene with no capture, an
       * interface in a film that promised not to show one, a photography beat
       * with no photograph, a commissioned shot on a project that does not
       * commission shots. Each one used to render as an empty frame or, worse,
       * quietly become something the customer said no to.
       */
      const vetoed =
        (archetype.requiresProductAsset && !hasRealAsset) ||
        (format === 'pitch' && REAL_PRODUCT_VISUAL_TYPES.includes(archetype.visualType)) ||
        (archetype.visualType === 'real_media' && !usablePicture) ||
        (!allowGenerative &&
          !usablePicture &&
          (archetype.visualType === 'generated_broll' || archetype.visualType === 'mixed_media'));

      const visualType: VisualType = pickedIsPhoto
        ? 'real_media'
        : vetoed
          ? routed.visualType
          : archetype.visualType;

      const typeScale =
        visualType === 'kinetic_typography' && index === 0
          ? system.typeScale.display
          : visualType === 'quote' || visualType === 'statistic'
            ? system.typeScale.statement
            : system.typeScale.caption;

      const requested = planned.onScreenText.filter((line) => line.trim().length > 0);
      const trimmed = limitWords(requested, archetype.maxWords);
      const fit = copyFits(trimmed, typeScale);
      const onScreenText = fit.fits ? trimmed : fit.suggestedBreak.slice(0, typeScale.maxLines);
      if (!fit.fits && requested.length > 0) {
        copyAdjustments.push({ sceneId: `${storyboardId}-${index}`, from: requested, to: onScreenText });
      }

      const narration =
        input.treatment.voiceStrategy === 'none' ? '' : planned.narration.trim();

      const sceneId = newId('scn');
      const motionRecipe = stagedForCapture(
        motionFor(archetype, input.brand, system, visualType, previousRecipe),
        moment,
        visualType,
        previousRecipe,
      );
      previousRecipe = motionRecipe.name;

      const scene: Scene = {
        id: sceneId,
        storyboardId,
        index,
        startTime: 0,
        duration: preferredDuration(archetype, onScreenText, narration, system),
        purpose: planned.purpose,
        narration,
        onScreenText,
        visualType,
        assetRefs: usablePicture && picked ? [picked.id, ...(moment?.screenshots ?? [])] : (moment?.screenshots ?? []),
        momentIds: moment ? [moment.id] : [],
        motionRecipe,
        cameraRecipe: cameraFor(archetype, input.brand),
        soundCues: [],
        voiceOver: narration.length > 0,
        generativeNeeds:
          !usablePicture && (visualType === 'generated_broll' || visualType === 'mixed_media')
            ? [
                {
                  kind: 'video' as const,
                  brief: planned.generativeBrief || planned.purpose,
                  mustNotContainText: true,
                  referenceAssetIds: anchor ? [anchor.id] : [],
                  durationSeconds: 4,
                  /*
                   * Commissioned in the frame the film is actually in.
                   *
                   * Hardcoded landscape, a vertical film paid for a 16:9 shot
                   * and then cropped the middle out of it — which loses the
                   * composition the shot was generated for, and is the same
                   * repurposed-landscape look choosing a short was meant to
                   * avoid, except this version costs money.
                   */
                  aspect: cutAspect(cut),
                  resolvedProvider: null,
                  resolvedModel: null,
                  estimatedCostUsd: 0,
                },
              ]
            : [],
        threeDSceneId: null,
        status: 'draft' as const,
        claimEvidenceIds: evidenceFor(planned.claimText, input.understanding),
        notes:
          usablePicture && picked
            ? `Real picture from the library: ${picked.name || picked.id}.`
            : routed.reason,
        estimatedCostUsd: 0,
      };

      return { scene, planned };
    });

    /*
     * Drop any scene that would put nothing on screen.
     *
     * The model sometimes returns a beat with no copy — intending a pause, or
     * simply having nothing to say there — and a `kinetic_typography` scene
     * with no typography renders as pure black for its whole duration. Three of
     * those in a twenty-four second film is six seconds of nothing, and it
     * passed every check the system had.
     *
     * Dropped rather than converted to a hold: a deliberate pause is something
     * a director asks for, and the plan did not ask for one. The time goes back
     * to the scenes that do have something to say when the timing is solved.
     */
    const kept = drafted.filter((entry) => sceneShowsSomething(entry.scene));
    const scenes: Scene[] = kept.map((entry, index) => ({ ...entry.scene, index }));

    /*
     * Close the film on the brand.
     *
     * Every creative system has always declared its `endings` — a CTA card and
     * a mark, with durations and sound cues — and nothing ever read them. So
     * films ended wherever the model's last beat happened to land, which is how
     * one came to end on the words "See the difference at": copy written to be
     * completed by a call to action that no scene was ever going to draw.
     */
    const ending = this.closingScene(system, storyboardId, scenes);
    if (ending) scenes.push(ending);

    const constraints: TimingConstraint[] = scenes.map((scene, index) => {
      const archetype = this.resolveArchetype(
        archetypes,
        kept[index]?.planned.archetypeId ?? '',
        index,
        scenes.length,
      );
      const floor = Math.max(
        archetype.durationRange[0],
        readingSeconds(scene.onScreenText),
        narrationSeconds(scene.narration),
      );
      return {
        id: scene.id,
        preferred: scene.duration,
        min: round3(floor),
        max: Math.max(round3(floor), archetype.durationRange[1]),
        // The opening and the ending are the two scenes an editor protects.
        rigid: index === 0 || index === scenes.length - 1,
      };
    });

    const fitted = varyRhythm(fitToDuration(constraints, target), constraints);
    const timed = scenes.map((scene) => ({
      ...scene,
      duration: fitted.get(scene.id) ?? scene.duration,
    }));

    const sequenced = resequence({
      id: storyboardId,
      projectId: input.projectId,
      conceptId: input.concept.id,
      treatmentId: input.treatment.id,
      version: input.version,
      scenes: timed,
      voiceStrategy: input.treatment.voiceStrategy,
      // The brief's word; the storyboard stage asks the copy when there is none.
      language: input.brief.language ?? null,
      musicDirection: input.treatment.soundStyle,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return {
      storyboard: {
        ...sequenced,
        scenes: sequenced.scenes.map((scene, index) => ({
          ...scene,
          soundCues: soundCuesFor(
            scene,
            this.resolveArchetype(archetypes, plan.scenes[index]?.archetypeId ?? '', index, scenes.length),
            system,
            index,
            sequenced.scenes.length,
          ),
        })),
      },
      copyAdjustments,
    };
  }

  /**
   * Maps a planned archetype id onto a real one.
   *
   * Models invent archetype ids. Rather than failing the whole storyboard, we
   * fall back on position: the first scene is an opening, the last an ending,
   * and anything else becomes the archetype whose purpose is closest.
   */
  private resolveArchetype(
    archetypes: readonly SceneArchetype[],
    id: string,
    index: number,
    total: number,
  ): SceneArchetype {
    const exact = archetypes.find((a) => a.id === id);
    if (exact) return exact;

    if (index === total - 1) {
      return (
        archetypes.find((a) => a.visualType === 'logo_reveal') ??
        archetypes[archetypes.length - 1]!
      );
    }
    const fuzzy = archetypes.find(
      (a) => a.id.includes(id) || id.includes(a.id) || a.purpose.toLowerCase().includes(id.toLowerCase()),
    );
    return fuzzy ?? archetypes[index % archetypes.length]!;
  }
}

/** What the director is told a moment can show. */
function captureNote(moment: ProductMoment): string {
  if (moment.screenshots.length === 0) return '[NOT captured — cannot be filmed in detail]';
  switch (moment.captureKind) {
    case 'in_app':
      return `[captured in the product${moment.captureLabel ? `: ${moment.captureLabel}` : ''}]`;
    case 'product_image':
      return `[real product image the company published${moment.captureLabel ? `: ${moment.captureLabel}` : ''}]`;
    case 'public_page':
      return `[capture of ${moment.captureLabel || 'a public page of the site'}]`;
    default:
      return '[real capture]';
  }
}

/**
 * Adjusts a product scene's recipe to what its capture actually is.
 *
 * A published product image is shown as published — no second browser frame
 * around an image that often carries its own — and at its own shape rather
 * than cropped to 16:9. A cursor sequence replays an interaction; on a
 * capture where no interaction happened it would invent one, so a scene
 * backed by a public capture never gets it.
 */
export function stagedForCapture(
  recipe: MotionRecipe,
  moment: ProductMoment | undefined,
  visualType: VisualType,
  avoid: MotionRecipeName | null,
): MotionRecipe {
  // Only a scene that shows the capture stages it: a statistic that happens
  // to cite a moment draws a figure, and carries no frame to shape.
  if (!moment || moment.screenshots.length === 0 || !REAL_PRODUCT_VISUAL_TYPES.includes(visualType)) {
    return recipe;
  }
  const params: MotionRecipe['params'] = { ...recipe.params };
  if (moment.captureAspect) params['aspect'] = moment.captureAspect;
  if (moment.captureKind === 'product_image') params['frame'] = 'bare';

  let name = recipe.name;
  if (moment.captureKind !== 'in_app' && name === 'cursor_sequence') {
    name = coherentRecipe(visualType, 'product_window', avoid);
    if (name === 'cursor_sequence') name = 'product_window';
  }
  return { ...recipe, name, params };
}

/**
 * What the format means, in the planner's own terms.
 *
 * Read from one table so the sentence the customer chose on the brief form is
 * the sentence the planner is working to, rather than a paraphrase of it that
 * drifts the first time either is edited.
 */
/**
 * How this film is cut, in the planner's own terms.
 *
 * The shared direction plus the two rules that are the planner's to obey
 * rather than the writer's: where the hook goes, and that a film watched
 * without sound has to carry its meaning in the picture.
 */
function cutLines(cut: FilmCut): string[] {
  const spec = FILM_CUTS[cut];
  return [
    ``,
    `# How it is cut: ${spec.title}`,
    ...cutDirectionLines(cut),
    ...(cut === 'short'
      ? [
          'Scene 1 is the strongest thing in this film, not an introduction to it. Do not plan a',
          'title card, a logo or a question before the idea — by the time they clear the screen the',
          'viewer has gone.',
          'The voice is not heard. Every scene that says something must also show it or write it:',
          'a scene whose meaning lives only in the narration is a silent scene here.',
        ]
      : []),
  ];
}

function formatLines(format: FilmFormat): string[] {
  return [
    ``,
    `# The kind of film this is`,
    ...formatDirectionLines(format),
    ...(format === 'pitch'
      ? [
          'There is no interface in this film and there is no capture to reach for. Do not plan a',
          'scene that shows a screen, a cursor, a dashboard or a window, and do not write a',
          'generative brief that describes one. You may say what the product does; you may not',
          'show it being done.',
          'The pictures you have are the archive, commissioned footage, form and light in three',
          'dimensions, figures and type. Use them. A pitch planned entirely as title cards is the',
          'failure mode of this format and it will be sent back.',
        ]
      : []),
  ];
}

function purposeFor(
  archetype: SceneArchetype,
  hasGenerativeBrief: boolean,
): Parameters<typeof routeShot>[0]['purpose'] {
  if (archetype.visualType === 'logo_reveal') return 'ending';
  if (archetype.visualType === 'statistic') return 'proof';
  if (archetype.visualType === 'kinetic_typography' || archetype.visualType === 'quote') {
    return 'statement';
  }
  if (archetype.visualType === 'generated_broll') return hasGenerativeBrief ? 'metaphor' : 'mood';
  if (archetype.visualType === 'product_ui_3d' || archetype.visualType === 'cinematic_3d') return 'hero';
  if (archetype.requiresProductAsset) return 'workflow';
  return 'statement';
}

function preferredDuration(
  archetype: SceneArchetype,
  onScreenText: string[],
  narration: string,
  system: CreativeSystem,
): number {
  const [min, max] = archetype.durationRange;
  const mid = (min + max) / 2;
  // Bias toward the system's own pacing so a slow system does not inherit a
  // fast archetype's midpoint.
  const paced = (mid + system.pacing.averageSceneSeconds) / 2;
  return round3(
    Math.min(max, Math.max(min, paced, readingSeconds(onScreenText), narrationSeconds(narration))),
  );
}

function motionFor(
  archetype: SceneArchetype,
  brand: BrandSystem,
  system: CreativeSystem,
  visualType: VisualType,
  avoid: MotionRecipeName | null,
): MotionRecipe {
  const easingByBrand: Record<BrandSystem['motionStyle'], EasingName> = {
    precise: 'out_quint',
    fluid: 'spring_soft',
    snappy: 'out_expo',
    cinematic: 'in_out_quart',
    mechanical: 'linear',
  };
  const staggerByBrand: Record<BrandSystem['motionStyle'], number> = {
    precise: 0.05,
    fluid: 0.09,
    snappy: 0.035,
    cinematic: 0.11,
    mechanical: 0.04,
  };

  return {
    /*
     * The archetype names the recipe it was written for, but routing may have
     * moved the scene to a different visual type — a product beat with no
     * capture behind it becomes typography. Carrying the product recipe across
     * that move left scenes whose renderer had no asset to draw and returned an
     * empty frame, so the recipe follows the visual type, not the archetype.
     */
    name: coherentRecipe(visualType, archetype.motion, avoid),
    // The brand's own motion language wins over the system's default: two
    // brands using the same system should still move differently.
    easing: easingByBrand[brand.motionStyle] ?? system.pacing.defaultEasing,
    delay: 0,
    stagger: staggerByBrand[brand.motionStyle] ?? 0.06,
    intensity: brand.motionStyle === 'cinematic' ? 0.45 : brand.motionStyle === 'snappy' ? 0.8 : 0.6,
    params: {},
  };
}

function cameraFor(archetype: SceneArchetype, brand: BrandSystem): CameraRecipe {
  const base: CameraRecipe = {
    move: archetype.camera,
    fromScale: 1,
    toScale: 1,
    fromX: 0,
    toX: 0,
    fromY: 0,
    toY: 0,
    // Kept low deliberately: heavy motion blur is the cheapest-looking effect
    // in the toolbox.
    motionBlur: brand.motionStyle === 'cinematic' ? 0.18 : 0.1,
    depthOfField: 0,
    easing: brand.motionStyle === 'snappy' ? 'out_expo' : 'in_out_quart',
  };

  switch (archetype.camera) {
    case 'slow_push':
      return { ...base, fromScale: 1, toScale: 1.06, depthOfField: 0.25 };
    case 'slow_pull':
      return { ...base, fromScale: 1.08, toScale: 1, depthOfField: 0.2 };
    case 'crop_push':
      return { ...base, fromScale: 1.02, toScale: 1.14 };
    case 'lateral_drift':
      return { ...base, fromX: -0.03, toX: 0.03 };
    case 'orbit':
      return { ...base, fromX: -0.05, toX: 0.05, fromScale: 1.02, toScale: 1.02 };
    case 'rack_focus':
      return { ...base, depthOfField: 0.6 };
    case 'handheld_micro':
      return { ...base, fromY: -0.006, toY: 0.006, motionBlur: 0.06 };
    default:
      return base;
  }
}

/**
 * Places sound against the cut.
 *
 * Cues are positioned in film time so the mix can be built without re-deriving
 * the edit, and so a scene that moves takes its sound with it.
 */
function soundCuesFor(
  scene: Scene,
  archetype: SceneArchetype,
  system: CreativeSystem,
  index: number,
  total: number,
): SoundCue[] {
  const cues: SoundCue[] = [];
  const isFirst = index === 0;
  const isLast = index === total - 1;

  if (isFirst) {
    const opening = system.openings[0];
    if (opening?.soundEntry === 'silence') {
      cues.push({ time: 0, type: 'silence', assetId: null, intensity: 0, durationSeconds: Math.min(1.5, scene.duration) });
      cues.push({ time: round3(Math.min(1.5, scene.duration * 0.6)), type: 'music_in', assetId: null, intensity: 0.5, durationSeconds: null });
    } else if (opening?.soundEntry === 'riser') {
      cues.push({ time: 0, type: 'riser', assetId: null, intensity: 0.6, durationSeconds: scene.duration });
      cues.push({ time: round3(scene.duration), type: 'impact', assetId: null, intensity: 0.85, durationSeconds: null });
    } else {
      cues.push({ time: 0, type: 'music_in', assetId: null, intensity: 0.55, durationSeconds: null });
    }
  }

  if (!isFirst && system.sound.impactsOnCuts && archetype.soundCues.includes('impact')) {
    cues.push({
      time: round3(scene.startTime),
      type: 'impact',
      assetId: null,
      intensity: 0.6,
      durationSeconds: null,
    });
  }

  if (
    system.sound.uiSoundDensity !== 'none' &&
    (scene.visualType === 'product_ui' || scene.visualType === 'screenshot_motion')
  ) {
    const clicks = system.sound.uiSoundDensity === 'rhythmic' ? 2 : 1;
    for (let i = 0; i < clicks; i += 1) {
      cues.push({
        time: round3(scene.startTime + scene.duration * (0.3 + i * 0.35)),
        type: 'ui_click',
        assetId: null,
        intensity: 0.35,
        durationSeconds: null,
      });
    }
  }

  if (scene.voiceOver) {
    // Duck the music under narration rather than fighting it in the mix.
    cues.push({
      time: round3(scene.startTime),
      type: 'music_duck',
      assetId: null,
      intensity: 0.4,
      durationSeconds: scene.duration,
    });
  }

  if (isLast && system.sound.endWithSting) {
    cues.push({
      time: round3(scene.startTime + scene.duration * 0.25),
      type: 'logo_sting',
      assetId: null,
      intensity: 0.8,
      durationSeconds: null,
    });
    cues.push({
      time: round3(scene.startTime + scene.duration),
      type: 'music_out',
      assetId: null,
      intensity: 0,
      durationSeconds: 1.2,
    });
  }

  return cues;
}

export function limitWords(lines: string[], maxWords: number): string[] {
  if (maxWords <= 0) return [];
  const words = lines.join(' ').split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return lines;

  // Truncating mid-sentence looks broken; drop whole trailing lines first.
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const count = line.split(/\s+/).filter(Boolean).length;
    if (used + count > maxWords) break;
    kept.push(line);
    used += count;
  }
  if (kept.length > 0) return kept;

  /*
   * Even the first line is over budget.
   *
   * This used to hand back the first N words, which is the exact mid-sentence
   * cut the comment above rules out: it put "See how fast work" on screen, a
   * phrase ending nowhere, in a finished film.
   *
   * The line is kept whole instead. The archetype's word limit is guidance for
   * the model — it is in the prompt, and the model usually respects it — not a
   * guillotine to run over the words afterwards. A line that is one word long
   * is a fitting problem, and the type engine solves fitting problems by
   * sizing; there is nothing that solves a sentence with its end cut off.
   */
  return [lines[0] ?? words.join(' ')];
}

function evidenceFor(claimText: string, understanding: ProductUnderstanding): string[] {
  if (!claimText.trim()) return [];
  const normalized = claimText.toLowerCase().trim();
  const claims = [
    ...understanding.keyBenefits,
    ...understanding.differentiators,
    ...understanding.proofPoints,
    ...understanding.coreFeatures,
  ];
  const match = claims.find((c) => c.text.toLowerCase().trim() === normalized);
  return match?.evidenceIds ?? [];
}

export { storyboardDuration };
