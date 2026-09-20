import React from 'react';
import { type FilmProps } from './composition.ts';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  TITLE_SAFE_INSET,
  VERTICAL_CHROME_BOTTOM,
  dimensionsFor,
  storyboardDuration,
  type AspectRatio,
  type BrandSystem,
  type CaptionCue,
  type RenderQuality,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import { resolveTokens, watermark as watermarkSvg, type DesignTokens } from '@act-one/design';
import {
  WordReveal,
  KineticHeadline,
  EditorialHeadline,
  MetricReveal,
  QuoteScene,
} from './components/Type.tsx';
import { SceneCamera } from './components/SceneCamera.tsx';
import { ElementField, type FieldFigure } from './components/ElementField.tsx';
import {
  ProductWindow,
  ProductZoom,
  SpatialCards,
  CursorSequence,
  PhotoHold,
} from './components/Product.tsx';
import { UiCinema } from './components/UiCinema.tsx';
import { Footage } from './components/Footage.tsx';
import { CtaEndCard, DepthTransition, LogoReveal, MaskReveal } from './components/Brand.tsx';

/**
 * The film.
 *
 * One composition driven entirely by a storyboard document. Nothing about a
 * specific customer's film lives in code — which is what makes a re-render
 * after a one-scene repair produce exactly the same film minus that shot, and
 * what makes the storyboard editor's preview honest rather than approximate.
 */
export const Film: React.FC<FilmProps> = ({
  storyboard,
  brand,
  assetUrls,
  typeScale,
  theme,
  watermarkLabel,
  cta,
  tagline,
  captions,
  footageAssetIds,
}) => {
  const { fps, width, height } = useVideoConfig();
  const aspect = aspectFor(width, height);

  const tokens = resolveTokens(brand, {
    aspect,
    quality: qualityOf(aspect, width),
    theme: theme ?? 'auto',
    ...(typeScale ? { scale: typeScale } : {}),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: tokens.canvas }}>
      {storyboard.scenes.map((scene) => (
        <Sequence
          key={scene.id}
          from={Math.round(scene.startTime * fps)}
          durationInFrames={Math.max(1, Math.round(scene.duration * fps))}
          name={`${scene.index + 1}. ${scene.purpose.slice(0, 40)}`}
        >
          <SceneRenderer
            scene={scene}
            tokens={tokens}
            brand={brand}
            assetUrls={assetUrls}
            /*
             * No invented fallback. This used to default to "Start free",
             * which is a promise about a product nobody checked has a free
             * tier — made on the customer's behalf, on their launch day.
             * An end card with no line is a design problem; one with a claim
             * we made up is somebody else's problem.
             */
            cta={cta ?? ''}
            tagline={tagline ?? ''}
            footage={new Set(footageAssetIds ?? [])}
          />
        </Sequence>
      ))}

      {captions && captions.length > 0 ? (
        <Captions cues={captions} tokens={tokens} aspect={aspect} />
      ) : null}

      {watermarkLabel ? (
        <AbsoluteFill
          dangerouslySetInnerHTML={{
            __html:
              `<svg xmlns="http://www.w3.org/2000/svg" width="${tokens.frame.width}" height="${tokens.frame.height}" ` +
              `viewBox="0 0 ${tokens.frame.width} ${tokens.frame.height}">${watermarkSvg(tokens, watermarkLabel)}</svg>`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * Captions, burned in.
 *
 * Everything here is a published rule rather than a taste: the block sits
 * inside the EBU R 95 text safe area, and above the platform furniture on a
 * vertical frame, because the bottom right of a phone screen belongs to the
 * app. Each line carries its own plate, since the picture behind it changes
 * every frame and contrast measured against one frame is a measurement of
 * nothing. Two lines at most, because the cues were built that way.
 *
 * No animation. A caption that fades is a caption that is unreadable for the
 * first two hundred milliseconds of the second and a half it has.
 *
 * One word may be marked. In a feed the captions *are* the words, because most
 * playback is muted, so they are composition rather than an accessibility
 * track laid over the bottom of the frame — and the figure or the name a
 * sentence turns on is set in the brand's own accent. Only where the cue has
 * one: a caption that emphasises something in every line emphasises nothing.
 */
const Captions: React.FC<{ cues: CaptionCue[]; tokens: DesignTokens; aspect: string }> = ({
  cues,
  tokens,
  aspect,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = frame / fps;
  const cue = cues.find((candidate) => at >= candidate.start && at < candidate.end);
  if (!cue) return null;

  const vertical = aspect === '9:16' || aspect === '4:5';
  const height = tokens.frame.height;
  // Comfortably above the 2% floor the type standards set, and larger on a
  // vertical cut, which is watched on a phone held at arm's length.
  const sizePx = Math.round(height * (vertical ? 0.038 : 0.03));
  const bottom = Math.round(height * (vertical ? VERTICAL_CHROME_BOTTOM : TITLE_SAFE_INSET));
  const pad = Math.round(sizePx * 0.32);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: bottom,
        paddingLeft: Math.round(tokens.frame.width * TITLE_SAFE_INSET),
        paddingRight: Math.round(tokens.frame.width * TITLE_SAFE_INSET),
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: Math.round(sizePx * 0.16),
        }}
      >
        {(cue.lines.length > 0 ? cue.lines : [cue.text]).map((line, index) => (
          <span
            key={`${cue.start}-${index}`}
            style={{
              fontFamily: tokens.type.body.family,
              fontWeight: 600,
              fontSize: sizePx,
              lineHeight: 1.25,
              letterSpacing: 0,
              color: '#FFFFFF',
              // Black at 78% carries 4.5:1 against white over any picture, and
              // reads as a caption rather than as a graphic.
              backgroundColor: 'rgba(0, 0, 0, 0.78)',
              padding: `${Math.round(pad * 0.55)}px ${pad}px`,
              borderRadius: tokens.radius.sm,
              textAlign: 'center',
              textWrap: 'balance',
            }}
          >
            {marked(line, cue.emphasis, tokens.onCanvas.accent)}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/**
 * The line, with its one word marked.
 *
 * Split on the emphasis rather than wrapped around it, so a word appearing
 * twice is marked once — the first time, which is where the eye lands — and a
 * cue whose emphasis broke onto the other line is returned untouched rather
 * than half-marked.
 */
function marked(line: string, emphasis: string | null, accent: string): React.ReactNode {
  if (!emphasis) return line;
  const at = line.indexOf(emphasis);
  if (at < 0) return line;
  return (
    <>
      {line.slice(0, at)}
      <span style={{ color: accent }}>{emphasis}</span>
      {line.slice(at + emphasis.length)}
    </>
  );
}

/** The figures a scene may ask for. Anything else is ignored rather than guessed. */
const FIELD_FIGURES: readonly FieldFigure[] = ['converge', 'disperse', 'settle', 'stream'];

type SceneRendererProps = {
  scene: Scene;
  tokens: DesignTokens;
  brand: BrandSystem;
  assetUrls: Record<string, string>;
  cta: string;
  tagline: string;
  /** Asset ids that are clips. Everything else in `assetUrls` is a still. */
  footage: Set<string>;
};

const SceneRenderer: React.FC<SceneRendererProps> = ({
  scene,
  tokens,
  brand,
  assetUrls,
  cta,
  tagline,
  footage,
}) => {
  const text = scene.onScreenText.join(' ');
  const easing = scene.motionRecipe.easing;
  /*
   * A field of separate objects behind the beat, when the director asked for one.
   *
   * Opt-in per scene rather than automatic. A film where every beat carries a
   * field is a film with one idea in it, and the measurement this closes —
   * elements on screen, and therefore how much of the picture is in motion —
   * is not worth buying with a house style that repeats.
   */
  const field = FIELD_FIGURES.includes(String(scene.motionRecipe.params['field']) as FieldFigure)
    ? (String(scene.motionRecipe.params['field']) as FieldFigure)
    : null;
  const assets = scene.assetRefs
    .map((id) => assetUrls[id])
    .filter((url): url is string => Boolean(url));
  /** The first clip this scene has, if any. A shot plays one thing. */
  const clip = scene.assetRefs.find((id) => footage.has(id) && assetUrls[id]);
  const logoUrl = brand.logo?.assetId
    ? (assetUrls[brand.logo.assetId] ?? brand.logo.url)
    : (brand.logo?.url ?? null);

  const body = (() => {
    switch (scene.motionRecipe.name) {
      case 'kinetic_headline':
        return (
          <Framed tokens={tokens} placement={scene.index === 0 ? 'center_left' : 'center_left'}>
            <KineticHeadline
              text={text}
              token={tokens.type.display}
              color={tokens.onCanvas.primary}
              tokens={tokens}
              maxWidth={tokens.grid.safe.width * 0.88}
              maxLines={2}
              easing={easing}
              staggerSeconds={scene.motionRecipe.stagger}
              delaySeconds={scene.motionRecipe.delay}
              durationSeconds={scene.duration}
            />
          </Framed>
        );

      case 'editorial_headline':
        return (
          <Framed tokens={tokens} placement="center_left">
            <EditorialHeadline
              text={text}
              token={tokens.type.display}
              color={tokens.onCanvas.primary}
              tokens={tokens}
              maxWidth={tokens.grid.safe.width * 0.76}
              maxLines={3}
              easing={easing}
              delaySeconds={scene.motionRecipe.delay}
              durationSeconds={scene.duration}
            />
          </Framed>
        );

      case 'word_reveal':
      case 'hold':
        return (
          <Framed tokens={tokens} placement="center_left">
            <WordReveal
              text={text}
              token={scene.index === 0 ? tokens.type.display : tokens.type.statement}
              color={tokens.onCanvas.primary}
              tokens={tokens}
              maxWidth={tokens.grid.safe.width * 0.82}
              maxLines={3}
              easing={easing}
              staggerSeconds={scene.motionRecipe.stagger}
              delaySeconds={scene.motionRecipe.delay}
              durationSeconds={scene.duration}
            />
          </Framed>
        );

      case 'statistic_reveal':
      case 'metric_reveal': {
        const [value, ...rest] = scene.onScreenText;
        return (
          <Framed tokens={tokens} placement="center_left">
            <MetricReveal
              value={value ?? ''}
              /*
               * No fallback to `purpose`. That field is the storyboard's note
               * to itself about what the beat is for — "Show scale: real
               * customer impact" — and it was being set in type under the
               * number, on screen, in the customer's film.
               */
              caption={rest.join(' ')}
              tokens={tokens}
              durationSeconds={scene.duration}
              easing={easing}
              delaySeconds={scene.motionRecipe.delay}
            />
          </Framed>
        );
      }

      case 'quote_hold': {
        const [quote, attribution] = [scene.onScreenText[0] ?? text, scene.onScreenText[1] ?? ''];
        return (
          <Framed tokens={tokens} placement="center_left">
            <QuoteScene
              quote={quote}
              attribution={attribution}
              tokens={tokens}
              maxWidth={tokens.grid.safe.width * 0.74}
              durationSeconds={scene.duration}
              delaySeconds={scene.motionRecipe.delay}
            />
          </Framed>
        );
      }

      case 'product_window':
      case 'product_sequence':
      case 'floating_ui':
      case 'feature_stack':
        // Product scenes render real capture only — never an invented
        // interface. When the asset is missing they fall through to type, which
        // is the honest shot: the storyboard engine keeps recipe and visual type
        // coherent, so reaching `typeFallback` here means a broken asset
        // reference, and four seconds of brand-coloured nothing is a worse
        // answer than the line of copy the scene was written around.
        //
        // When production filmed this capture — found the panels in it and
        // planned a set of framings — the sequence is the shot, for every one
        // of these recipes. The flat staging below is not an alternative style
        // to choose between; it is what is left when nobody looked at the
        // picture, and it is why a film made of real product captures could
        // still come out looking like a deck.
        if (scene.uiSequence && scene.uiSequence.framings.length > 0 && assets[0]) {
          return (
            <UiCinema
              src={assets[0]}
              sources={assetUrls}
              sequence={scene.uiSequence}
              tokens={tokens}
              words={text}
              easing={easing}
            />
          );
        }
        return assets[0] ? (
          <ProductWindow
            src={assets[0]}
            tokens={tokens}
            camera={scene.cameraRecipe}
            durationSeconds={scene.duration}
            delaySeconds={scene.motionRecipe.delay}
            easing={easing}
            // A published product image is shown as published: it often
            // carries its own frame, and a browser bar around a browser bar
            // is the tell of a template.
            chrome={
              scene.visualType !== 'product_ui_3d' && scene.motionRecipe.params['frame'] !== 'bare'
            }
            aspect={captureAspect(scene)}
          />
        ) : (
          typeFallback()
        );

      case 'product_zoom':
        if (scene.uiSequence && scene.uiSequence.framings.length > 0 && assets[0]) {
          return (
            <UiCinema
              src={assets[0]}
              sources={assetUrls}
              sequence={scene.uiSequence}
              tokens={tokens}
              words={text}
              easing={easing}
            />
          );
        }
        return assets[0] ? (
          <ProductZoom
            src={assets[0]}
            tokens={tokens}
            focus={focusFrom(scene)}
            durationSeconds={scene.duration}
            easing={easing}
            delaySeconds={scene.motionRecipe.delay}
          />
        ) : (
          typeFallback()
        );

      case 'footage':
        /*
         * A generated shot or a 3D render, playing.
         *
         * Falls through to the still treatment when the asset turned out to be
         * one, and to type when generation produced nothing at all — which is
         * the honest outcome, because a scene with no picture is a scene with
         * words in it rather than a hole.
         */
        return clip ? (
          <Footage
            src={assetUrls[clip]!}
            tokens={tokens}
            camera={scene.cameraRecipe}
            durationSeconds={scene.duration}
            easing={easing}
            delaySeconds={scene.motionRecipe.delay}
          >
            {text ? (
              <Framed tokens={tokens} placement="lower_third">
                <WordReveal
                  text={text}
                  token={tokens.type.statement}
                  color="#ffffff"
                  tokens={tokens}
                  maxWidth={tokens.grid.safe.width * 0.7}
                  maxLines={2}
                  easing={easing}
                  durationSeconds={scene.duration}
                  delaySeconds={0.4}
                />
              </Framed>
            ) : null}
          </Footage>
        ) : assets[0] ? (
          <PhotoHold
            src={assets[0]}
            tokens={tokens}
            camera={scene.cameraRecipe}
            durationSeconds={scene.duration}
            easing={easing}
            delaySeconds={scene.motionRecipe.delay}
          />
        ) : (
          typeFallback()
        );

      case 'photo_hold':
        // A real photograph from the library, full frame. Without the
        // picture the scene is its words, as everywhere else.
        return assets[0] ? (
          <PhotoHold
            src={assets[0]}
            tokens={tokens}
            camera={scene.cameraRecipe}
            durationSeconds={scene.duration}
            easing={easing}
            delaySeconds={scene.motionRecipe.delay}
          >
            {text ? (
              <Framed tokens={tokens} placement="lower_third">
                <WordReveal
                  text={text}
                  token={tokens.type.caption}
                  color="#ffffff"
                  tokens={tokens}
                  maxWidth={tokens.grid.safe.width * 0.6}
                  maxLines={2}
                  easing={easing}
                  durationSeconds={scene.duration}
                  delaySeconds={0.4}
                />
              </Framed>
            ) : null}
          </PhotoHold>
        ) : (
          typeFallback()
        );

      case 'spatial_cards':
      case 'image_wall':
        return assets.length > 0 ? (
          <SpatialCards
            srcs={assets}
            tokens={tokens}
            durationSeconds={scene.duration}
            easing={easing}
          />
        ) : (
          typeFallback()
        );

      case 'cursor_sequence':
        return assets[0] ? (
          <CursorSequence
            src={assets[0]}
            tokens={tokens}
            path={cursorPath(scene)}
            durationSeconds={scene.duration}
            easing={easing}
          />
        ) : (
          typeFallback()
        );

      case 'logo_reveal':
        return (
          <LogoReveal
            logoUrl={logoUrl}
            wordmark={brand.name}
            tokens={tokens}
            durationSeconds={scene.duration}
            easing={easing}
          />
        );

      case 'cta_end_card':
        return (
          <CtaEndCard
            headline={text || tagline}
            cta={cta}
            logoUrl={logoUrl}
            wordmark={brand.name}
            tokens={tokens}
            durationSeconds={scene.duration}
            easing={easing}
          />
        );

      case 'mask_reveal':
        return (
          <MaskReveal tokens={tokens} durationSeconds={scene.duration} easing={easing}>
            <Framed tokens={tokens} placement="center_left">
              <WordReveal
                text={text}
                token={tokens.type.statement}
                color={tokens.onCanvas.primary}
                tokens={tokens}
                maxWidth={tokens.grid.safe.width * 0.8}
                maxLines={3}
                easing={easing}
                durationSeconds={scene.duration}
              />
            </Framed>
          </MaskReveal>
        );

      case 'depth_transition':
        return (
          <DepthTransition tokens={tokens} durationSeconds={scene.duration} easing={easing}>
            {assets[0] ? (
              <ProductWindow
                src={assets[0]}
                tokens={tokens}
                camera={scene.cameraRecipe}
                durationSeconds={scene.duration}
                easing={easing}
                chrome={scene.motionRecipe.params['frame'] !== 'bare'}
                aspect={captureAspect(scene)}
              />
            ) : (
              typeFallback()
            )}
          </DepthTransition>
        );

      default:
        return typeFallback();
    }

    /** Type on brand canvas: what a scene falls back to when its footage is gone. */
    function typeFallback() {
      return text ? (
        <Framed tokens={tokens} placement="center_left">
          <WordReveal
            text={text}
            token={tokens.type.statement}
            color={tokens.onCanvas.primary}
            tokens={tokens}
            maxWidth={tokens.grid.safe.width * 0.8}
            maxLines={3}
            easing={easing}
            durationSeconds={scene.duration}
          />
        </Framed>
      ) : null;
    }
  })();

  /*
   * Every scene gets the camera its storyboard asked for.
   *
   * It used to reach only the components that take `camera` as a prop, which
   * meant a typographic beat rendered inside a static frame and held perfectly
   * still once its words had arrived. `SceneCamera` skips the scenes whose own
   * body already moves, so nothing is double-dollied.
   */
  return (
    <AbsoluteFill style={{ backgroundColor: tokens.canvas }}>
      <SceneCamera
        camera={scene.cameraRecipe}
        recipe={scene.motionRecipe.name}
        durationSeconds={scene.duration}
      >
        {field ? (
          <ElementField
            figure={field}
            count={Number(scene.motionRecipe.params['fieldCount'] ?? 14)}
            tokens={tokens}
            durationSeconds={scene.duration}
            easing={easing}
            staggerSeconds={scene.motionRecipe.stagger || undefined}
            delaySeconds={scene.motionRecipe.delay}
            seed={scene.index + 1}
          />
        ) : null}
        {body}
      </SceneCamera>
    </AbsoluteFill>
  );
};

/** Positions a block on the grid so every scene shares the same margins. */
const Framed: React.FC<{
  tokens: DesignTokens;
  placement: 'center_left' | 'center' | 'lower_third';
  children: React.ReactNode;
}> = ({ tokens, placement, children }) => {
  const { grid } = tokens;
  return (
    <div
      style={{
        position: 'absolute',
        left: grid.safe.x,
        top: grid.safe.y,
        width: grid.safe.width,
        height: grid.safe.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: placement === 'lower_third' ? 'flex-end' : 'center',
        alignItems: placement === 'center' ? 'center' : 'flex-start',
        paddingBottom: placement === 'lower_third' ? grid.safe.height * 0.08 : 0,
      }}
    >
      {children}
    </div>
  );
};

/** The capture's own shape, when the storyboard recorded it; a window otherwise. */
function captureAspect(scene: Scene): number {
  const aspect = Number(scene.motionRecipe.params['aspect']);
  return Number.isFinite(aspect) && aspect > 0.5 && aspect < 3 ? aspect : 16 / 9;
}

/** Region of interest for a zoom, from the moment's measured element bounds. */
function focusFrom(scene: Scene): { x: number; y: number; width: number; height: number } {
  const bounds = scene.motionRecipe.params;
  const x = Number(bounds['focusX'] ?? 0.3);
  const y = Number(bounds['focusY'] ?? 0.3);
  const width = Number(bounds['focusWidth'] ?? 0.4);
  const height = Number(bounds['focusHeight'] ?? 0.4);
  return { x, y, width, height };
}

function cursorPath(scene: Scene): { x: number; y: number }[] {
  const raw = scene.motionRecipe.params['cursorPath'];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as { x: number; y: number }[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to the default sweep
    }
  }
  return [
    { x: 0.2, y: 0.7 },
    { x: 0.62, y: 0.38 },
    { x: 0.5, y: 0.55 },
  ];
}

/**
 * Which resolution is actually being drawn.
 *
 * Every size in the design system comes off the frame, so the tokens have to
 * be resolved against the frame that is really on screen. This used to ask
 * whether the width was over 3000 — true of 4K, false of everything else — so
 * a preview render, whose canvas is half HD, laid itself out at full HD inside
 * it. Type came out at twice the size and ran off the edge, which means the
 * animatic a customer looks at to check their own cut did not look like the
 * film they were checking.
 */
function qualityOf(aspect: AspectRatio, width: number): RenderQuality {
  const qualities: RenderQuality[] = ['preview', 'hd', 'uhd'];
  return qualities
    .map((quality) => ({
      quality,
      distance: Math.abs(dimensionsFor(aspect, quality).width - width),
    }))
    .sort((left, right) => left.distance - right.distance)[0]!.quality;
}

function aspectFor(width: number, height: number): '16:9' | '9:16' | '1:1' | '4:5' {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.02) return '1:1';
  if (ratio < 0.7) return '9:16';
  if (ratio < 0.95) return '4:5';
  return '16:9';
}
