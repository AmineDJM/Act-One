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
  TYPE_STANDARDS,
  TITLE_SAFE_INSET,
  cite,
  contrastFloorInFrame,
  withinInset,
  ctaIsVague,
  containsStatistic,
  longestRun,
  newId,
  opensOnSubject,
  readingSecondsFor,
  rhythmVariation,
  superlativesIn,
  visualMix,
  weaselPhrasesIn,
  type BrandSystem,
  type QaIssue,
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
  storyboard: Storyboard;
  brand: BrandSystem;
  aspect: '16:9' | '9:16' | '1:1' | '4:5';
  /** Ids of evidence the project actually holds, for claim checking. */
  knownEvidenceIds?: Set<string>;
  /** Minimum on-screen asset resolution, in pixels, for the target frame. */
  minAssetWidth?: number;
  assetResolutions?: Record<string, { width: number; height: number }>;
};

export function runDeterministicChecks(input: DeterministicInput): QaIssue[] {
  const issues: QaIssue[] = [];
  const tokens = resolveTokens(input.brand, { aspect: input.aspect });

  for (const scene of input.storyboard.scenes) {
    issues.push(...checkScene(scene, tokens, input));
  }

  issues.push(...checkFilm(input.storyboard, tokens));
  return issues;
}

function checkScene(scene: Scene, tokens: DesignTokens, input: DeterministicInput): QaIssue[] {
  const issues: QaIssue[] = [];
  const add = (
    issue: Omit<QaIssue, 'id' | 'sceneId' | 'atSeconds' | 'detectedBy' | 'evidenceAssetId'>,
  ) => {
    issues.push({
      id: newId('evt'),
      sceneId: scene.id,
      atSeconds: scene.startTime,
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
        severity: 'blocker',
        message: `Copy overflows the safe width at ${token.sizePx}px: "${text.slice(0, 60)}…"`,
        confidence: 1,
        repair: 'relayout_text',
      });
    }

    // Four lines of display type is not a headline, it is a paragraph.
    if (lines.length > 4) {
      add({
        check: 'text_overflow',
        severity: 'major',
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
        severity: 'blocker',
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
        severity: 'minor',
        message:
          `A line runs ${longest} characters; ${MEASURE_MAX_ON_SCREEN} is the comfortable ` +
          `maximum on screen (${cite(TYPE_STANDARDS.measure)}).`,
        confidence: 0.9,
        repair: 'rewrite_copy',
      });
    }

    for (const phrase of weaselPhrasesIn(text)) {
      add({
        check: 'unsupported_claim',
        severity: 'major',
        message: `"${phrase}" asserts evidence without carrying any (${cite(EDITORIAL_STANDARDS.weasel)}).`,
        confidence: 1,
        repair: 'rewrite_copy',
      });
    }

    for (const superlative of superlativesIn(text)) {
      add({
        check: 'unsupported_claim',
        severity: 'major',
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
        severity: 'blocker',
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
        severity: 'blocker',
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
      severity: 'major',
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
      severity: 'blocker',
      message: 'Narration is longer than the scene it sits in and will be cut off mid-word.',
      confidence: 1,
      repair: 'rewrite_copy',
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
      severity: 'blocker',
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
      severity: 'blocker',
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
        severity: 'blocker',
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
        severity: 'major',
        message: `Asset is ${resolution.width}px wide against a ${tokens.frame.width}px frame and will look soft.`,
        confidence: 1,
        repair: 'recapture_product',
      });
    }
  }

  return issues;
}

function checkFilm(storyboard: Storyboard, tokens: DesignTokens): QaIssue[] {
  const issues: QaIssue[] = [];
  const add = (
    issue: Omit<QaIssue, 'id' | 'sceneId' | 'atSeconds' | 'detectedBy' | 'evidenceAssetId'>,
  ) => {
    issues.push({
      id: newId('evt'),
      sceneId: null,
      atSeconds: null,
      detectedBy: 'deterministic',
      evidenceAssetId: null,
      ...issue,
    });
  };

  const scenes = storyboard.scenes;
  if (scenes.length === 0) {
    add({ check: 'composition', severity: 'blocker', message: 'The film has no scenes.', confidence: 1, repair: 'manual_review' });
    return issues;
  }

  // The same transition on every cut is one of the clearest signs a film was
  // assembled rather than edited.
  const motions = scenes.map((scene) => scene.motionRecipe.name);
  const distinct = new Set(motions);
  if (scenes.length >= 5 && distinct.size <= 2) {
    add({
      check: 'transition_quality',
      severity: 'major',
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
      severity: 'minor',
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
      severity: 'major',
      message:
        `Shot lengths vary by ${(variation * 100).toFixed(0)}% of their mean; below ` +
        `${(MIN_RHYTHM_VARIATION * 100).toFixed(0)}% the edit has no rhythm ` +
        `(${cite(MOTION_STANDARDS.rhythm)}).`,
      confidence: 0.9,
      repair: 'manual_review',
    });
  }

  // The opening. Three seconds is where viewers leave, on every platform that
  // publishes retention data, and a logo sting spends exactly that window.
  if (!opensOnSubject(scenes)) {
    add({
      check: 'composition',
      severity: 'major',
      message:
        `The film opens on branding for its first ${HOOK_SECONDS}s rather than on the ` +
        `problem or the product (${cite(CONVERSION_STANDARDS.hook)}).`,
      confidence: 0.9,
      repair: 'manual_review',
    });
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
      severity: 'major',
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
      severity: 'major',
      message:
        `Every line in this film is spoken and none of it is on screen; muted playback ` +
        `carries none of it (${cite(CONVERSION_STANDARDS.soundOff)}).`,
      confidence: 1,
      repair: 'rewrite_copy',
    });
  }

  const mix = visualMix(storyboard);
  if (mix.generative > 0.45) {
    add({
      check: 'brand_consistency',
      severity: 'major',
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
      severity: 'blocker',
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
      severity: 'blocker',
      message:
        `The grid's safe box is inside the ${(TITLE_SAFE_INSET * 100).toFixed(1)}% text-safe ` +
        `inset (${cite(LAYOUT_STANDARDS.titleSafe)}).`,
      confidence: 1,
      repair: 'manual_review',
    });
  }

  return issues;
}
