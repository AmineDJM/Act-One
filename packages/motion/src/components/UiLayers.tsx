import React from 'react';
import { Img, useCurrentFrame, useVideoConfig } from 'remotion';
import type { DesignTokens } from '@act-one/design';
import type { EasingName, FramingRect, UiFraming, UiLayer, UiSequence } from '@act-one/core';
import { ease, progress } from '../easing.ts';

/**
 * The interface taken apart.
 *
 * A camera moving across a screenshot is a better shot than the screenshot,
 * and it is still one object: whatever the camera does, every pixel moves
 * together, which is the thing that says "photograph of software" rather than
 * "software". An interface is not one object — the product itself knows that,
 * because it slides its own drawers, pushes its own pages back behind its own
 * modals and drops its own toasts in from an edge.
 *
 * So the plate is drawn once per layer, each copy masked to one part of the
 * real capture, each moving on its own clock. The shell falls back and
 * softens; the panel the shot is about holds its scale and its sharpness and
 * therefore takes the frame; the toast arrives from below, out of a hole cut
 * in the shell so it is not already sitting there waiting.
 *
 * Every pixel is the customer's interface at its own scale. Nothing here
 * redraws, recolours or replaces any part of it. The grade that sells depth —
 * blur, brightness, shadow — only ever falls on the layers that are being
 * pushed away from the eye, never on the one being looked at.
 */
export type PlateGeometry = {
  /** Size and offset of the full capture, placed so `crop` fills the frame. */
  imageWidth: number;
  imageHeight: number;
  left: number;
  top: number;
  /** Where a rectangle of the source lands on screen. */
  onScreen: (rect: FramingRect) => { x: number; y: number; width: number; height: number };
};

export function plateGeometry(
  sequence: Pick<UiSequence, 'sourceWidth' | 'sourceHeight'>,
  crop: FramingRect,
  width: number,
  height: number,
): PlateGeometry {
  const imageWidth = width / Math.max(0.02, crop.width);
  const imageHeight = imageWidth * (sequence.sourceHeight / sequence.sourceWidth);
  return {
    imageWidth,
    imageHeight,
    left: -crop.x * imageWidth,
    top: -crop.y * imageHeight,
    onScreen: (rect) => ({
      x: ((rect.x - crop.x) / crop.width) * width,
      y: ((rect.y - crop.y) / crop.height) * height,
      width: (rect.width / crop.width) * width,
      height: (rect.height / crop.height) * height,
    }),
  };
}

/** How far the near and far planes sit from the picture plane, as a share of frame height. */
const DEPTH = 0.42;

export const LayeredShot: React.FC<{
  src: string;
  sequence: UiSequence;
  framing: UiFraming;
  crop: FramingRect;
  tokens: DesignTokens;
  easing?: EasingName;
}> = ({ src, sequence, framing, crop, tokens, easing }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const geometry = plateGeometry(sequence, crop, width, height);

  const shell = framing.layers.find((layer) => layer.role === 'shell');
  const rest = framing.layers.filter((layer) => layer.role !== 'shell');
  const shellT = shell ? layerProgress(shell, frame, fps, easing) : 0;

  /*
   * The holes.
   *
   * Cut in frame space rather than in the shell's own space, so that a shell
   * which is receding does not drag the gap away from the thing about to
   * arrive in it. Even-odd fill: the outer rectangle is the frame, every
   * inner one is subtracted.
   */
  const holes = rest
    .filter((layer) => layer.knockout)
    .map((layer) => geometry.onScreen(layer.rect))
    .map((box) => `M${box.x} ${box.y}H${box.x + box.width}V${box.y + box.height}H${box.x}Z`)
    .join(' ');

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        perspective: height * 2.2,
        background: `rgb(${sequence.background.r}, ${sequence.background.g}, ${sequence.background.b})`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          ...(holes
            ? { clipPath: `path(evenodd, "M0 0H${width}V${height}H0Z ${holes}")` }
            : {}),
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: shell ? shellTransform(shell, shellT, height) : undefined,
            transformOrigin: '50% 50%',
            filter: shell && shell.motion === 'recede'
              ? `blur(${shellT * 7}px) brightness(${1 - shellT * 0.45}) saturate(${1 - shellT * 0.3})`
              : undefined,
          }}
        >
          <Plate src={src} geometry={geometry} />
        </div>
      </div>

      {rest.map((layer, index) => (
        <Layer
          key={index}
          src={src}
          layer={layer}
          geometry={geometry}
          tokens={tokens}
          easing={easing}
          height={height}
        />
      ))}
    </div>
  );
};

const Plate: React.FC<{ src: string; geometry: PlateGeometry }> = ({ src, geometry }) => (
  <Img
    src={src}
    style={{
      position: 'absolute',
      left: geometry.left,
      top: geometry.top,
      width: geometry.imageWidth,
      height: geometry.imageHeight,
      maxWidth: 'none',
      display: 'block',
    }}
  />
);

const Layer: React.FC<{
  src: string;
  layer: UiLayer;
  geometry: PlateGeometry;
  tokens: DesignTokens;
  easing?: EasingName;
  height: number;
}> = ({ src, layer, geometry, tokens, easing, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = layerProgress(layer, frame, fps, easing);
  const box = geometry.onScreen(layer.rect);

  /*
   * An emergence starts off its own edge by its own size, which is how the
   * product draws it: a toast comes up from under the bottom of itself, a
   * drawer comes in from the side it is docked to. Using the layer's own
   * dimensions rather than a fixed distance is what keeps a small
   * confirmation from flying across the screen.
   */
  const offset = { x: 0, y: 0 };
  if (layer.motion === 'emerge') {
    const travel = 1 - t;
    if (layer.from === 'below') offset.y = box.height * 1.15 * travel;
    if (layer.from === 'above') offset.y = -box.height * 1.15 * travel;
    if (layer.from === 'left') offset.x = -box.width * 1.15 * travel;
    if (layer.from === 'right') offset.x = box.width * 1.15 * travel;
  }
  if (layer.motion === 'parallax') {
    offset.x = layer.depth * height * 0.09 * (t - 0.5) * 2;
  }

  /* A press is a pulse, not a state: down fast, back slower, once. */
  const press = layer.motion === 'press' ? Math.sin(Math.min(1, t) * Math.PI) : 0;
  const advance = layer.motion === 'advance' ? t : 0;
  const scale = 1 + advance * 0.06 - press * 0.05;
  /*
   * Depth by scale, not by z, for anything smaller than the frame.
   *
   * Moving a panel toward the camera scales it about the perspective origin
   * rather than about itself, so a toast in the bottom-left corner slides
   * down and left as it comes forward — and uncovers the shell's own copy of
   * it in the corner it just left. Scaling about the layer's own centre keeps
   * it exactly over the pixels it is lifting off, which is the whole point:
   * the copy has to cover its original or the trick shows.
   */
  const z = layer.role === 'shell' ? layer.depth * height * DEPTH : 0;

  const shadow =
    layer.motion === 'emerge' || layer.motion === 'advance'
      ? `0 ${height * (0.012 + 0.014 * (layer.motion === 'emerge' ? t : advance))}px ` +
        `${height * 0.05}px rgba(0,0,0,${0.36 * (layer.motion === 'emerge' ? t : advance)})`
      : undefined;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          overflow: 'hidden',
          borderRadius: layer.role === 'overlay' || layer.role === 'control' ? tokens.radius.md : 0,
          transform: `translate3d(${offset.x}px, ${offset.y}px, ${z}px) scale(${scale})`,
          transformStyle: 'preserve-3d',
          opacity: layer.motion === 'emerge' ? Math.min(1, t * 2.2) : 1,
          boxShadow: shadow,
        }}
      >
        <Img
          src={src}
          style={{
            position: 'absolute',
            left: -layer.rect.x * geometry.imageWidth,
            top: -layer.rect.y * geometry.imageHeight,
            width: geometry.imageWidth,
            height: geometry.imageHeight,
            maxWidth: 'none',
            display: 'block',
          }}
        />
      </div>

      {/*
        * The contact.
        *
        * A ring leaving a control that has just been pressed. It is the one
        * mark this system draws that is not in the capture, and it is drawn
        * only on a rectangle the structure pass identified as a filled
        * primary action — never on a panel, never on a guess.
        */}
      {press > 0.02 ? (
        <div
          style={{
            position: 'absolute',
            left: box.x - box.height * 0.5,
            top: box.y - box.height * 0.5,
            width: box.width + box.height,
            height: box.height * 2,
            borderRadius: 999,
            border: `${Math.max(2, height * 0.0022)}px solid ${tokens.accent}`,
            opacity: (1 - Math.min(1, t)) * 0.75,
            transform: `scale(${1 + Math.min(1, t) * 0.35})`,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </>
  );
};

function shellTransform(shell: UiLayer, t: number, height: number): string {
  if (shell.motion === 'recede') {
    return `translate3d(0, ${t * height * 0.012}px, ${-t * height * DEPTH}px) scale(${1 - t * 0.06})`;
  }
  if (shell.motion === 'advance') return `scale(${1 + t * 0.05})`;
  return 'none';
}

export function layerProgress(layer: UiLayer, frame: number, fps: number, easing?: EasingName): number {
  const curve: EasingName =
    layer.motion === 'emerge' ? 'out_expo' : layer.motion === 'press' ? 'linear' : (easing ?? 'out_quint');
  return ease(
    curve,
    progress(frame, fps, { delaySeconds: layer.delaySeconds, durationSeconds: layer.durationSeconds }),
  );
}

/**
 * Real interface, in a place.
 *
 * The one shot in this system that builds an environment instead of finding
 * one — and the line it holds is exact: everything that is the environment is
 * generated from the brand and from the capture's own colour, and everything
 * that is the product is the product, at its own scale, unfiltered, uncropped
 * beyond the rectangle it was given.
 *
 * What makes it worth doing is that it is the one shot that cannot be
 * described as a screenshot with a camera move. Three real panels of the
 * customer's software, at three depths, with a camera travelling past them
 * and a word sitting behind them that the nearest panel passes in front of.
 * The panels are not pictures of the product hung on a wall; they are the
 * product, and the space is the film's.
 *
 * The far planes are defocused. That is a lens doing what lenses do, not a
 * redraw: the plane being read is always the sharp one.
 */
export const VolumeShot: React.FC<{
  src: string;
  sources?: Record<string, string>;
  sequence: UiSequence;
  framing: UiFraming;
  tokens: DesignTokens;
  words?: string;
  easing?: EasingName;
}> = ({ src, sources, sequence, framing, tokens, words, easing }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = ease(easing ?? 'in_out_quart', progress(frame, fps, { durationSeconds: framing.seconds }));

  const planes = framing.layers.filter((layer) => layer.role !== 'shell').slice(0, 3);
  const ground = `rgb(${Math.round(sequence.background.r * 0.16)}, ${Math.round(sequence.background.g * 0.16)}, ${Math.round(
    sequence.background.b * 0.2,
  )})`;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: tokens.canvas }}>
      {/* The environment: three gradients and a horizon, all from the brand. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            `radial-gradient(120% 90% at 50% 120%, ${tokens.accent}38 0%, transparent 62%),` +
            `radial-gradient(90% 70% at 18% 8%, ${tokens.accent}22 0%, transparent 58%),` +
            `linear-gradient(175deg, ${ground} 0%, ${tokens.canvas} 58%, ${ground} 100%)`,
        }}
      />
      {/* Two soft bands of light crossing the space, which is what gives it a size. */}
      <div
        style={{
          position: 'absolute',
          inset: '-20%',
          transform: `rotate(-18deg) translateX(${(t - 0.5) * width * 0.06}px)`,
          background:
            `linear-gradient(90deg, transparent 0%, ${tokens.accent}1f 22%, transparent 34%,` +
            ` transparent 62%, ${tokens.accent}14 74%, transparent 88%)`,
          filter: 'blur(38px)',
        }}
      />

      {words && framing.wordsBehind ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: `${tokens.type.display.family}, system-ui, sans-serif`,
            // Sized to fit rather than to impress: a word behind the product
            // that runs off both edges of the frame is a texture, not a line.
            fontSize: tokens.type.display.sizePx * 0.82,
            fontWeight: tokens.type.display.weight,
            letterSpacing: `${tokens.type.display.tracking}em`,
            lineHeight: 1.06,
            textAlign: 'center',
            color: tokens.onCanvas.primary,
            maxWidth: tokens.grid.safe.width * 0.82,
            marginInline: 'auto',
            overflow: 'hidden',
            // Behind the product: set back, dimmed and slightly soft, so the
            // panels genuinely pass in front of it rather than sitting on it.
            opacity: 0.2 + t * 0.06,
            filter: 'blur(1.5px)',
            transform: `scale(${1.04 - t * 0.04})`,
            padding: `0 ${tokens.grid.safe.x}px`,
          }}
        >
          {words}
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          perspective: height * 1.9,
          perspectiveOrigin: '50% 46%',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transformStyle: 'preserve-3d',
            // The camera: a dolly forward with a slight drift across, which is
            // a move a person could have made rather than a turntable.
            transform:
              `translate3d(${(0.5 - t) * width * 0.08}px, ${(t - 0.5) * height * 0.02}px, ${t * height * 0.34}px) ` +
              `rotateY(${(0.5 - t) * 5}deg)`,
          }}
        >
          {planes.map((layer, index) => {
            const spread = (index - (planes.length - 1) / 2);
            /*
             * A panel may come from another capture entirely, and then its
             * own dimensions are what set its shape. Falling back to the
             * shot's capture would stretch somebody else's screen to the
             * proportions of this one, which is the one thing a product shot
             * may never do.
             */
            const plateSrc = (layer.assetId && sources?.[layer.assetId]) || src;
            const sw = layer.sourceWidth ?? sequence.sourceWidth;
            const sh = layer.sourceHeight ?? sequence.sourceHeight;
            const panelWidth = width * (index === 0 ? 0.58 : 0.46);
            const panelHeight = (panelWidth * (layer.rect.height * sh)) / (layer.rect.width * sw);
            const imageWidth = panelWidth / Math.max(0.02, layer.rect.width);
            const imageHeight = imageWidth * (sh / sw);
            const z = layer.depth * height * 0.55;
            const arrive = ease('out_expo', progress(frame, fps, {
              delaySeconds: layer.delaySeconds,
              durationSeconds: Math.max(0.5, layer.durationSeconds),
            }));
            const far = Math.max(0, -layer.depth);
            return (
              <div
                key={index}
                style={{
                  position: 'absolute',
                  left: width / 2 - panelWidth / 2 + spread * panelWidth * 0.82,
                  top: height / 2 - panelHeight / 2 + spread * height * 0.06,
                  width: panelWidth,
                  height: panelHeight,
                  transformStyle: 'preserve-3d',
                  transform:
                    `translate3d(0, ${(1 - arrive) * height * 0.05}px, ${z}px) ` +
                    `rotateY(${-spread * 13}deg)`,
                  opacity: arrive,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    overflow: 'hidden',
                    borderRadius: tokens.radius.lg,
                    boxShadow: `0 ${height * 0.035}px ${height * 0.09}px rgba(0,0,0,0.55)`,
                    // Only the planes behind the subject are defocused, and
                    // the subject plane carries no filter at all.
                    filter: far > 0 ? `blur(${far * 3.2}px) brightness(${1 - far * 0.2})` : undefined,
                  }}
                >
                  <Img
                    src={plateSrc}
                    style={{
                      position: 'absolute',
                      left: -layer.rect.x * imageWidth,
                      top: -layer.rect.y * imageHeight,
                      width: imageWidth,
                      height: imageHeight,
                      maxWidth: 'none',
                      display: 'block',
                    }}
                  />
                </div>
                {/* The floor takes the light back, which is what says "space". */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: panelHeight,
                    width: panelWidth,
                    height: panelHeight * 0.5,
                    overflow: 'hidden',
                    transform: 'scaleY(-1)',
                    transformOrigin: 'top',
                    opacity: 0.16,
                    maskImage: 'linear-gradient(to top, transparent 4%, rgba(0,0,0,0.9) 100%)',
                    WebkitMaskImage: 'linear-gradient(to top, transparent 4%, rgba(0,0,0,0.9) 100%)',
                    filter: 'blur(3px)',
                  }}
                >
                  <Img
                    src={plateSrc}
                    style={{
                      position: 'absolute',
                      left: -layer.rect.x * imageWidth,
                      top: -layer.rect.y * imageHeight,
                      width: imageWidth,
                      height: imageHeight,
                      maxWidth: 'none',
                      display: 'block',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(118% 108% at 50% 44%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.42) 100%)',
        }}
      />
    </div>
  );
};
