import React from 'react';
import { type FilmProps } from './composition.ts';
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import {
  storyboardDuration,
  type BrandSystem,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import { resolveTokens, watermark as watermarkSvg, type DesignTokens } from '@act-one/design';
import { WordReveal, KineticHeadline, EditorialHeadline, MetricReveal, QuoteScene } from './components/Type.tsx';
import { ProductWindow, ProductZoom, SpatialCards, CursorSequence } from './components/Product.tsx';
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
}) => {
  const { fps, width, height } = useVideoConfig();
  const aspect = aspectFor(width, height);

  const tokens = resolveTokens(brand, {
    aspect,
    quality: width >= 3000 ? 'uhd' : 'hd',
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
          />
        </Sequence>
      ))}

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

type SceneRendererProps = {
  scene: Scene;
  tokens: DesignTokens;
  brand: BrandSystem;
  assetUrls: Record<string, string>;
  cta: string;
  tagline: string;
};

const SceneRenderer: React.FC<SceneRendererProps> = ({ scene, tokens, brand, assetUrls, cta, tagline }) => {
  const text = scene.onScreenText.join(' ');
  const easing = scene.motionRecipe.easing;
  const assets = scene.assetRefs.map((id) => assetUrls[id]).filter((url): url is string => Boolean(url));
  const logoUrl = brand.logo?.assetId ? assetUrls[brand.logo.assetId] ?? brand.logo.url : brand.logo?.url ?? null;

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
        return assets[0] ? (
          <ProductWindow
            src={assets[0]}
            tokens={tokens}
            camera={scene.cameraRecipe}
            durationSeconds={scene.duration}
            delaySeconds={scene.motionRecipe.delay}
            easing={easing}
            chrome={scene.visualType !== 'product_ui_3d'}
          />
        ) : (
          typeFallback()
        );

      case 'product_zoom':
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

      case 'spatial_cards':
      case 'image_wall':
        return assets.length > 0 ? (
          <SpatialCards srcs={assets} tokens={tokens} durationSeconds={scene.duration} easing={easing} />
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

  return <AbsoluteFill style={{ backgroundColor: tokens.canvas }}>{body}</AbsoluteFill>;
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

function aspectFor(width: number, height: number): '16:9' | '9:16' | '1:1' | '4:5' {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.02) return '1:1';
  if (ratio < 0.7) return '9:16';
  if (ratio < 0.95) return '4:5';
  return '16:9';
}


