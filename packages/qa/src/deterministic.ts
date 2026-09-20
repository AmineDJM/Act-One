import {
  COLOR_STANDARDS,
  CONVERSION_STANDARDS,
  EDITORIAL_STANDARDS,
  HOOK_SECONDS,
  LAYOUT_STANDARDS,
  MAX_CONSECUTIVE_SAME_TREATMENT,
  MAX_TYPE_FAMILIES,
  MEASURE_MAX_ON_SCREEN,
  MIN_RHYTHM_VARIATION,
  MIN_SHOT_SECONDS,
  MOTION_STANDARDS,
  PROOF_BLOCK_START,
  TYPE_STANDARDS,
  TITLE_SAFE_INSET,
  cite,
  contrastFloorInFrame,
  withinInset,
  ctaIsVague,
  containsStatistic,
  endsDangling,
  longestRun,
  newId,
  opensOnSubject,
  readingSecondsFor,
  rhythmVariation,
  sceneShowsSomething,
  storyboardDuration,
  superlativesIn,
  urgencyPhrasesIn,
  visualMix,
  pictureShare,
  longestTypeOnlyRun,
  MIN_PICTURE_SHARE,
  MAX_TYPE_ONLY_RUN_SECONDS,
  PICTURE_STANDARDS,
  type FilmCut,
  weaselPhrasesIn,
  type BrandSystem,
  type QaFinding,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import {
  breakLines,
  contrastRatio,
  createFrame,
  createGrid,
  measureText,
  resolveTokens,
  withinSafeArea,
  type DesignTokens,
} from '@act-one/design';

/**
 * Deterministic QA.
 *
 * Runs before a single frame is rendered and catches the defects that are
 * mathematically decidable: text that will not fit, text nobody can read in
 * time, contrast that fails, a scene too short to register, a claim with no
 * source.
 *
 * These checks are cheap and certain. Vision QA (see vision.ts) runs after and
 * catches what only a viewer can — but it is slower, costs money and is
 * occasionally wrong, so anything decidable in arithmetic is decided here.
 */
export type DeterministicInput = {
  /** What the end card says. Checked so it is a next step, not a filler word. */
  cta?: string;
  storyboard: Storyboard;
  brand: BrandSystem;
  aspect: '16:9' | '9:16' | '1:1' | '4:5';
  /** Ids of evidence the project actually holds, for claim checking. */
  knownEvidenceIds?: Set<string>;
  /** Which shape of film this is. A short holds less of everything, including picture. */
  cut?: FilmCut;
  /** Minimum on-screen asset resolution, in pixels, for the target frame. */
  minAssetWidth?: number;
  assetResolutions?: Record<string, { width: number; height: number }>;
};

export function runDeterministicChecks(input: DeterministicInput): QaFinding[] {
  const issues: QaFinding[] = [];
  const tokens = resolveTokens(input.brand, { aspect: input.aspect });

  for (const scene of input.storyboard.scenes) {
    issues.push(...checkScene(scene, tokens, input));
  }

  issues.push(...checkFilm(input.storyboard, tokens, input.cut ?? 'feature'));

  if (input.cta !== undefined && ctaIsVague(input.cta)) {
    issues.push({
      id: newId('evt'),
      sceneId: null,
      timecodeStart: null,
      detectedBy: 'deterministic',
      evidenceAssetId: null,
      check: 'composition',
      severity: 'soft_fail',
      message:
        `"${input.cta}" names no action (${cite(CONVERSION_STANDARDS.singleCta)}). ` +
        'It is what you write when nobody decided what the viewer should do.',
      confidence: 1,
      repair: 'rewrite_copy',
    });
  }

  return issues;
}

function checkScene(scene: Scene, tokens: DesignTokens, input: DeterministicInput): QaFinding[] {
  const issues: QaFinding[] = [];
  const add = (
    issue: Omit<QaFinding, 'id' | 'sceneId' | 'timecodeStart' | 'detectedBy' | 'evidenceAssetId'>,
  ) => {
    issues.push({
      id: newId('evt'),
      sceneId: scene.id,
      timecodeStart: scene.startTime,
      detectedBy: 'deterministic',
      evidenceAssetId: null,
      ...issue,
    });
  };

  const text = scene.onScreenText.join(' ').trim();

  if (text.length > 0) {
    const token = scene.index === 0 ? tokens.type.display : tokens.type.statement;
    const maxWidth = tokens.grid.safe.width * 0.88;
    const lines = breakLines(text, {
      family: token.family,
      fontSizePx: token.sizePx,
      tracking: token.tracking,
      weight: token.weight,
      maxWidthPx: maxWidth,
    });

    const widest = Math.max(
      0,
      ...lines.map((line) =>
        measureText(line, { family: token.family, fontSizePx: token.sizePx, tracking: token.tracking, weight: token.weight }),
      ),
    );

    if (widest > maxWidth + 1) {
      add({
        check: 'text_clipping',
        severity: 'hard_fail',
        message: `Copy overflows the safe width at ${token.sizePx}px: "${text.slice(0, 60)}…"`,
        confidence: 1,
        repair: 'relayout_text',
      });
    }

    // Four lines of display type is not a headline, it is a paragraph.
    if (lines.length > 4) {
      add({
        check: 'text_overflow',
        severity: 'soft_fail',
        message: `${lines.length} lines of on-screen copy. Four is the most that reads as design.`,
        confidence: 1,
        repair: 'rewrite_copy',
      });
    }

    const words = text.split(/\s+/).filter(Boolean).length;
    const needed = readingSecondsFor(text);
    if (scene.duration < needed) {
      add({
        check: 'text_overflow',
        severity: 'hard_fail',
        message:
          `${words} words need ${needed.toFixed(1)}s to read; the scene runs ` +
          `${scene.duration.toFixed(1)}s (${cite(TYPE_STANDARDS.readingTime)}).`,
        confidence: 1,
        repair: 'reduce_duration',
      });
    }

    // Measure. A held frame is read under time pressure, so the comfortable
    // line is shorter than it is on a page.
    const longest = Math.max(0, ...lines.map((line) => line.length));
    if (longest > MEASURE_MAX_ON_SCREEN) {
      add({
        check: 'text_overflow',
        severity: 'warning',
        message:
          `A line runs ${longest} characters; ${MEASURE_MAX_ON_SCREEN} is the comfortable ` +
          `maximum on screen (${cite(TYPE_STANDARDS.measure)}).`,
        confidence: 0.9,
        repair: 'rewrite_copy',
      });
    }

    // A held frame is read once, whole: a line that stops mid-thought reads as
    // a caption whose second half was lost.
    for (const line of scene.onScreenText) {
      // In the film's own language. The list was English only, so a French
      // film ending on "les conducteurs à" read as a finished sentence here.
      if (!endsDangling(line, input.brand.communication.language)) continue;
      add({
        check: 'text_overflow',
        severity: 'soft_fail',
        message:
          `"${line}" ends mid-thought. On-screen copy is read once and nothing follows it ` +
          `on the frame (${cite(EDITORIAL_STANDARDS.plainLanguage)}).`,
        confidence: 0.95,
        repair: 'rewrite_copy',
      });
    }

    for (const phrase of urgencyPhrasesIn(`${text} ${scene.narration}`)) {
      add({
        check: 'unsupported_claim',
        severity: 'soft_fail',
        message:
          `"${phrase}" invents urgency (${cite(CONVERSION_STANDARDS.noFakeUrgency)}). ` +
          'A deadline the company has not set is a deceptive practice, not a hook.',
        confidence: 0.95,
        repair: 'rewrite_copy',
      });
    }

    for (const phrase of weaselPhrasesIn(text)) {
      add({
        check: 'unsupported_claim',
        severity: 'soft_fail',
        message: `"${phrase}" asserts evidence without carrying any (${cite(EDITORIAL_STANDARDS.weasel)}).`,
        confidence: 1,
        repair: 'rewrite_copy',
      });
    }

    for (const superlative of superlativesIn(text)) {
      add({
        check: 'unsupported_claim',
        severity: 'soft_fail',
        message:
          `"${superlative}" is an objective claim in advertising law and needs substantiation ` +
          `(${cite(EDITORIAL_STANDARDS.superlatives)}).`,
        confidence: 0.9,
        repair: 'rewrite_copy',
      });
    }

    // A number on screen reads as a fact whoever put it there.
    if (containsStatistic(text) && scene.claimEvidenceIds.length === 0) {
      add({
        check: 'unsupported_claim',
        severity: 'hard_fail',
        message:
          `"${text.slice(0, 60)}" puts a figure on screen with nothing behind it ` +
          `(${cite(EDITORIAL_STANDARDS.numbers)}).`,
        confidence: 1,
        repair: 'rewrite_copy',
      });
    }

    const ratio = contrastRatio(tokens.onCanvas.primary, tokens.canvas);
    const minimum = contrastFloorInFrame(token.sizePx, tokens.frame.height);
    if (ratio < minimum) {
      add({
        check: 'contrast',
        severity: 'hard_fail',
        message:
          `Text contrast is ${ratio.toFixed(1)}:1 against the canvas; ${minimum}:1 is the floor ` +
          `(${cite(COLOR_STANDARDS.textContrast)}).`,
        confidence: 1,
        repair: 'adjust_contrast',
      });
    }
  }

  if (scene.duration < MIN_SHOT_SECONDS) {
    add({
      check: 'transition_quality',
      severity: 'soft_fail',
      message:
        `${scene.duration.toFixed(2)}s is below the ${MIN_SHOT_SECONDS}s floor: the viewer ` +
        `registers a disturbance rather than a shot (${cite(MOTION_STANDARDS.minimumShot)}).`,
      confidence: 1,
      repair: 'reduce_duration',
    });
  }

  if (scene.narration && scene.narration.split(/\s+/).length / 2.35 > scene.duration + 0.4) {
    add({
      check: 'text_overflow',
      severity: 'hard_fail',
      message: 'Narration is longer than the scene it sits in and will be cut off mid-word.',
      confidence: 1,
      repair: 'rewrite_copy',
    });
  }

  /*
   * A scene that puts nothing on screen. Rendered, this is pure black for the
   * scene's whole duration — and it shipped: three of them in one twenty-four
   * second film, which passed every other check the system had.
   */
  if (!sceneShowsSomething(scene)) {
    add({
      check: 'composition',
      severity: 'hard_fail',
      message:
        `A ${scene.visualType.replace(/_/g, ' ')} scene with no text, no capture and no shot ` +
        `behind it. It renders as ${scene.duration.toFixed(1)}s of black.`,
      confidence: 1,
      repair: 'remove_scene',
    });
  }

  // The rule the whole system exists to protect.
  if (
    (scene.visualType === 'product_ui' ||
      scene.visualType === 'screenshot_motion' ||
      scene.visualType === 'product_ui_3d') &&
    scene.assetRefs.length === 0
  ) {
    add({
      check: 'fake_product_ui',
      severity: 'hard_fail',
      message: 'A product scene with no captured asset behind it. We never render an invented interface.',
      confidence: 1,
      repair: 'recapture_product',
    });
  }

  if (
    scene.claimEvidenceIds.length > 0 &&
    input.knownEvidenceIds &&
    scene.claimEvidenceIds.some((id) => !input.knownEvidenceIds!.has(id))
  ) {
    add({
      check: 'unsupported_claim',
      severity: 'hard_fail',
      message: 'This scene cites evidence this project does not hold.',
      confidence: 1,
      repair: 'rewrite_copy',
    });
  }

  // Generated shots must not be asked to render readable text.
  for (const need of scene.generativeNeeds) {
    if (!need.mustNotContainText) {
      add({
        check: 'legible_generated_text',
        severity: 'hard_fail',
        message: 'A generated shot was allowed to contain text. Generative models cannot set type.',
        confidence: 1,
        repair: 'regenerate_shot',
      });
    }
  }

  for (const assetId of scene.assetRefs) {
    const resolution = input.assetResolutions?.[assetId];
    const minimum = input.minAssetWidth ?? tokens.frame.width * 0.75;
    if (resolution && resolution.width < minimum) {
      add({
        check: 'asset_resolution',
        severity: 'soft_fail',
        message: `Asset is ${resolution.width}px wide against a ${tokens.frame.width}px frame and will look soft.`,
        confidence: 1,
        repair: 'recapture_product',
      });
    }
  }

  return issues;
}

function checkFilm(storyboard: Storyboard, tokens: DesignTokens, cut: FilmCut): QaFinding[] {
  const issues: QaFinding[] = [];
  const add = (
    issue: Omit<QaFinding, 'id' | 'sceneId' | 'timecodeStart' | 'detectedBy' | 'evidenceAssetId'>,
  ) => {
    issues.push({
      id: newId('evt'),
      sceneId: null,
      timecodeStart: null,
      detectedBy: 'deterministic',
      evidenceAssetId: null,
      ...issue,
    });
  };

  const scenes = storyboard.scenes;
  if (scenes.length === 0) {
    add({ check: 'composition', severity: 'hard_fail', message: 'The film has no scenes.', confidence: 1, repair: 'manual_review' });
    return issues;
  }

  // The same transition on every cut is one of the clearest signs a film was
  // assembled rather than edited.
  const motions = scenes.map((scene) => scene.motionRecipe.name);
  const distinct = new Set(motions);
  if (scenes.length >= 5 && distinct.size <= 2) {
    add({
      check: 'transition_quality',
      severity: 'soft_fail',
      message:
        `Only ${distinct.size} distinct motion treatments across ${scenes.length} scenes ` +
        `(${cite(MOTION_STANDARDS.variety)}).`,
      confidence: 0.9,
      repair: 'manual_review',
    });
  }

  const run = longestRun(motions);
  if (run > MAX_CONSECUTIVE_SAME_TREATMENT) {
    add({
      check: 'transition_quality',
      severity: 'warning',
      message:
        `The same treatment runs for ${run} consecutive scenes; ` +
        `${MAX_CONSECUTIVE_SAME_TREATMENT} is the most that reads as a choice ` +
        `(${cite(MOTION_STANDARDS.variety)}).`,
      confidence: 0.85,
      repair: 'manual_review',
    });
  }

  // Every scene the same length is a slideshow, however good each frame is.
  const durations = scenes.map((scene) => scene.duration);
  const variation = rhythmVariation(durations);
  if (scenes.length >= 5 && variation < MIN_RHYTHM_VARIATION) {
    add({
      check: 'composition',
      severity: 'soft_fail',
      message:
        `Shot lengths vary by ${(variation * 100).toFixed(0)}% of their mean; below ` +
        `${(MIN_RHYTHM_VARIATION * 100).toFixed(0)}% the edit has no rhythm ` +
        `(${cite(MOTION_STANDARDS.rhythm)}).`,
      confidence: 0.9,
      repair: 'manual_review',
    });
  }

  /*
   * A line the film says twice.
   *
   * "Momentum, restored." appeared as scene 5 and again as scene 17 of a
   * forty-eight second film. Each frame was fine; the film was not. Repetition
   * at this distance is not a motif, it is a planner that lost track of what it
   * had already said — and it is one of the clearest signals to a viewer that
   * nobody watched this before they did.
   *
   * Compared after normalising case and punctuation, because "Momentum,
   * restored." and "Momentum restored" are the same line to everyone but a
   * string comparison.
   */
  const timesOnScreen = new Map<string, number>();
  for (const scene of scenes) {
    for (const line of scene.onScreenText) {
      const key = line.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
      // Single words repeat legitimately as a rhythmic device; a phrase does not.
      if (key.split(' ').length < 2) continue;
      timesOnScreen.set(key, (timesOnScreen.get(key) ?? 0) + 1);
    }
  }
  for (const [line, count] of timesOnScreen) {
    if (count < 2) continue;
    add({
      check: 'composition',
      severity: 'soft_fail',
      message: `"${line}" is on screen ${count} times. A film that repeats itself was not edited.`,
      confidence: 1,
      repair: 'rewrite_copy',
    });
  }

  // The opening. Three seconds is where viewers leave, on every platform that
  // publishes retention data, and a logo sting spends exactly that window.
  if (!opensOnSubject(scenes)) {
    add({
      check: 'composition',
      severity: 'soft_fail',
      message:
        `The film opens on branding for its first ${HOOK_SECONDS}s rather than on the ` +
        `problem or the product (${cite(CONVERSION_STANDARDS.hook)}).`,
      confidence: 0.9,
      repair: 'manual_review',
    });
  }

  /*
   * Proof that arrives after the viewer stopped doubting.
   *
   * A statistic answers the claim before it. Two or more of them in a row in
   * the last third of the film are a logo wall by another name: the doubts
   * they answer were held two scenes earlier, and by now the viewer has moved
   * on or left.
   */
  const total = storyboardDuration(storyboard);
  for (let i = 0; i < scenes.length - 1; i += 1) {
    const here = scenes[i]!;
    const next = scenes[i + 1]!;
    if (here.visualType !== 'statistic' || next.visualType !== 'statistic') continue;
    if (total > 0 && here.startTime / total >= PROOF_BLOCK_START) {
      add({
        check: 'composition',
        severity: 'warning',
        message:
          `Scenes ${here.index + 1} and ${next.index + 1} stack proof at the end of the film ` +
          `(${cite(CONVERSION_STANDARDS.proofPlacement)}). Evidence belongs after the claim it supports.`,
        confidence: 0.85,
        repair: 'manual_review',
      });
      break;
    }
  }

  /*
   * Two shots of one capture.
   *
   * On the storyboard "the same subject" is decidable: consecutive scenes on
   * the same asset. The thirty-degree rule says the second must change its
   * angle — here, its treatment or its camera — or it reads as a jump cut. The
   * axis-of-action rule says a lateral move must not reverse across the cut.
   */
  for (let i = 1; i < scenes.length; i += 1) {
    const previous = scenes[i - 1]!;
    const scene = scenes[i]!;
    const shared = scene.assetRefs[0] && scene.assetRefs[0] === previous.assetRefs[0];
    if (!shared) continue;

    if (
      scene.motionRecipe.name === previous.motionRecipe.name &&
      scene.cameraRecipe.move === previous.cameraRecipe.move
    ) {
      add({
        check: 'transition_quality',
        severity: 'warning',
        message:
          `Scenes ${previous.index + 1} and ${scene.index + 1} show the same capture with the same ` +
          `treatment and camera move (${cite(MOTION_STANDARDS.thirtyDegree)}). The cut between ` +
          'them is a jump cut.',
        confidence: 0.9,
        repair: 'manual_review',
      });
    }

    const before = previous.cameraRecipe.toX - previous.cameraRecipe.fromX;
    const after = scene.cameraRecipe.toX - scene.cameraRecipe.fromX;
    if (Math.abs(before) > 0.005 && Math.abs(after) > 0.005 && Math.sign(before) !== Math.sign(after)) {
      add({
        check: 'transition_quality',
        severity: 'warning',
        message:
          `The camera drifts ${before > 0 ? 'right' : 'left'} across scene ${previous.index + 1} and ` +
          `${after > 0 ? 'right' : 'left'} across scene ${scene.index + 1}, on the same capture ` +
          `(${cite(MOTION_STANDARDS.axisOfAction)}). Screen direction reversed across the cut.`,
        confidence: 0.9,
        repair: 'manual_review',
      });
    }
  }

  /*
   * Typefaces. Counted from the resolved tokens rather than per scene, because
   * that is where a film's families are actually decided — and the mono face is
   * excluded, since it labels data rather than setting copy and reads as
   * notation rather than as a third voice.
   */
  const families = new Set(
    [tokens.type.display.family, tokens.type.statement.family, tokens.type.body.family].filter(
      Boolean,
    ),
  );
  if (families.size > MAX_TYPE_FAMILIES) {
    add({
      check: 'brand_consistency',
      severity: 'soft_fail',
      message:
        `${families.size} typefaces across the film; ${MAX_TYPE_FAMILIES} is the limit ` +
        `(${cite(TYPE_STANDARDS.families)}).`,
      confidence: 1,
      repair: 'manual_review',
    });
  }

  // Sound-off legibility. A film whose meaning is only in the narration is a
  // film most of a feed audience will never understand.
  const spoken = scenes.filter((scene) => (scene.narration ?? '').trim().length > 0).length;
  const written = scenes.filter((scene) => scene.onScreenText.join('').trim().length > 0).length;
  if (spoken > 0 && written === 0) {
    add({
      check: 'composition',
      severity: 'soft_fail',
      message:
        `Every line in this film is spoken and none of it is on screen; muted playback ` +
        `carries none of it (${cite(CONVERSION_STANDARDS.soundOff)}).`,
      confidence: 1,
      repair: 'rewrite_copy',
    });
  }

  /*
   * Is there a picture in this film at all?
   *
   * The ceiling below has been here since the beginning — no more than 45% of
   * the runtime may be generated footage — and there was never a floor to go
   * with it. A film of nothing but typography on a bare canvas scores a
   * perfect zero on the generative budget and passes, which is how thirty
   * seconds of white type on black went out as a finished master.
   *
   * Three findings, because three different things go wrong. No picture at
   * all is a failure of the whole production and does not ship. Thin picture
   * is a film that lost most of its material somewhere. A long unbroken run
   * of title cards is a film that has stopped showing and started telling.
   */
  const picture = pictureShare(storyboard);
  const pictureFloor = MIN_PICTURE_SHARE[cut === 'short' ? 'short' : 'feature'];
  if (picture <= 0) {
    add({
      check: 'composition',
      severity: 'hard_fail',
      message:
        `Nothing in this film is a picture: all ${storyboardDuration(storyboard).toFixed(1)}s of it ` +
        `is typography on the canvas (${cite(PICTURE_STANDARDS.substance)}). ` +
        'Either the captures and shots never arrived, or the plan never asked for any.',
      confidence: 1,
      /*
       * Not an automatic repair, and deliberately so. No edit to this
       * storyboard puts a picture in it — the material is missing or was never
       * commissioned, and both answers are upstream of the timeline. It goes
       * to a person with the reason stated, which is the honest end of this
       * particular road.
       */
      repair: 'manual_review',
    });
  } else if (picture < pictureFloor) {
    add({
      check: 'composition',
      severity: 'soft_fail',
      message:
        `Only ${(picture * 100).toFixed(0)}% of the film carries a picture; the floor for a ` +
        `${cut} is ${(pictureFloor * 100).toFixed(0)}% (${cite(PICTURE_STANDARDS.substance)}).`,
      confidence: 1,
      repair: 'regenerate_shot',
    });
  }

  const typeRun = longestTypeOnlyRun(storyboard);
  const runCeiling = MAX_TYPE_ONLY_RUN_SECONDS[cut === 'short' ? 'short' : 'feature'];
  if (picture > 0 && typeRun.seconds > runCeiling) {
    issues.push({
      id: newId('evt'),
      sceneId: typeRun.sceneIds[0] ?? null,
      timecodeStart: typeRun.start,
      detectedBy: 'deterministic',
      evidenceAssetId: null,
      check: 'composition',
      severity: 'soft_fail',
      message:
        `${typeRun.seconds.toFixed(1)}s from ${typeRun.start.toFixed(1)}s with nothing on screen ` +
        `but words, across ${typeRun.sceneIds.length} shots; ${runCeiling}s is the ceiling for a ` +
        `${cut} (${cite(PICTURE_STANDARDS.typeRun)}).`,
      confidence: 1,
      repair: 'regenerate_shot',
    });
  }

  const mix = visualMix(storyboard);
  if (mix.generative > 0.45) {
    add({
      check: 'brand_consistency',
      severity: 'soft_fail',
      message: `${(mix.generative * 100).toFixed(0)}% of the film is generated footage.`,
      confidence: 1,
      repair: 'regenerate_shot',
    });
  }

  const frame = createFrame(tokens.frame.aspect);
  const grid = createGrid(frame);
  if (!withinSafeArea(grid, grid.safe)) {
    add({
      check: 'safe_area',
      severity: 'hard_fail',
      message: `The layout grid falls outside title safe (${cite(LAYOUT_STANDARDS.titleSafe)}).`,
      confidence: 1,
      repair: 'manual_review',
    });
  }

  // The grid must also clear the published standard, not merely our own
  // margins: the two are set independently and only one of them is the floor.
  if (!withinInset(grid.safe, frame, TITLE_SAFE_INSET)) {
    add({
      check: 'safe_area',
      severity: 'hard_fail',
      message:
        `The grid's safe box is inside the ${(TITLE_SAFE_INSET * 100).toFixed(1)}% text-safe ` +
        `inset (${cite(LAYOUT_STANDARDS.titleSafe)}).`,
      confidence: 1,
      repair: 'manual_review',
    });
  }

  return issues;
}
