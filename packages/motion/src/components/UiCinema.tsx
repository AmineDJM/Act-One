import React from 'react';
import { Img, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { DesignTokens } from '@act-one/design';
import type { EasingName, FramingRect, UiFraming, UiSequence, WordCorner } from '@act-one/core';
import { clockFrom, SceneClockProvider, useSceneClock, type SceneClock } from '../clock.tsx';
import { ease, exitProgress, progress } from '../easing.ts';
import { WordReveal } from './Type.tsx';
import { LayeredShot, VolumeShot, plateGeometry } from './UiLayers.tsx';

/**
 * The product, filmed.
 *
 * Everything on screen here is the customer's own capture. There is no code
 * path that draws an interface, tints one, relights one or fills a gap in one
 * — the only decisions this component makes are where the frame is, how it
 * moves, what is separated in depth and where the words sit. That constraint
 * is the entire reason this can be pointed at a real product at all.
 *
 * What makes it a shot rather than a screenshot is that the frame is smaller
 * than the picture. A capture shown whole is a diagram of an interface: every
 * element present, none of them legible, nothing the eye is told to look at.
 * A frame that holds one panel at a readable size, moves to the next one, and
 * cuts to what came of it, is a scene — built out of exactly the same pixels.
 */
export type UiCinemaProps = {
  src: string;
  /** Every asset the film resolved, for a shot whose layers come from several captures. */
  sources?: Record<string, string>;
  sequence: UiSequence;
  tokens: DesignTokens;
  /** The scene's on-screen line, set into the composition rather than onto a card. */
  words?: string;
  easing?: EasingName;
};

export const UiCinema: React.FC<UiCinemaProps> = ({ src, sources, sequence, tokens, words, easing }) => {
  const { fps } = useVideoConfig();
  const scene = useSceneClock();

  let cursor = 0;
  return (
    <>
      {sequence.framings.map((framing, index) => {
        const start = cursor;
        const from = Math.round(start * fps);
        cursor += framing.seconds;
        const last = index === sequence.framings.length - 1;
        /*
         * Each framing is cut away at its own end, so what it holds clears
         * there. The last one belongs to the scene: it holds for as long as the
         * scene is mounted, clears at the beat's end when the scene leaves by
         * a cut and not at all when a join carries it out, rather than leaving
         * the frame empty after a join brought the scene in early.
         */
        const own: SceneClock = { beatStartSeconds: 0, beatSeconds: framing.seconds, mountedSeconds: framing.seconds, leavesByCut: true };
        const clock = last && scene ? clockFrom(scene, start) : own;
        const frames = Math.max(1, Math.round(Math.max(framing.seconds, clock.mountedSeconds) * fps));
        return (
          <Sequence key={index} from={from} durationInFrames={frames} name={`${index + 1}. ${framing.role}`}>
            <SceneClockProvider value={clock}>
              <Shot
                src={src}
                sources={sources}
                sequence={sequence}
                framing={framing}
                tokens={tokens}
                words={words}
                easing={easing}
                last={last}
              />
            </SceneClockProvider>
          </Sequence>
        );
      })}
    </>
  );
};

/** How long the picture takes to settle after a cut. Short: this is a cut, not a dissolve. */
const CUT_IN_SECONDS = 0.22;

const Shot: React.FC<{
  src: string;
  sources?: Record<string, string>;
  sequence: UiSequence;
  framing: UiFraming;
  tokens: DesignTokens;
  words?: string;
  easing?: EasingName;
  last: boolean;
}> = ({ src, sources, sequence, framing, tokens, words, easing, last }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  /*
   * The move.
   *
   * A lateral travels at an even rate, because a camera panning across a desk
   * does not accelerate into the middle of the pan; a push eases out, because
   * a camera arriving at a subject decelerates onto it. Getting this backwards
   * is most of why template motion feels wrong without being able to say why.
   */
  const curve: EasingName =
    framing.move === 'lateral' ? 'linear' : framing.move === 'hold' ? 'linear' : (easing ?? 'out_quint');
  /*
   * The camera's clock.
   *
   * Normally the whole beat. But when the shot is built around something the
   * product itself brings on screen, the frame moves on THAT thing's timing
   * rather than on the shot's — the camera opens out exactly as the toast
   * rises, so the hole it is opening onto is never in shot on its own. A move
   * timed to the subject instead of to the slot is the difference between a
   * shot and a slide advancing.
   */
  const arriving =
    framing.layers.find((layer) => layer.role === 'overlay' && layer.motion !== 'hold') ??
    framing.layers.find((layer) => layer.role === 'control' && layer.motion !== 'hold');
  const t = arriving
    ? ease('out_expo', progress(frame, fps, {
        delaySeconds: arriving.delaySeconds,
        durationSeconds: arriving.durationSeconds,
      }))
    : ease(curve, progress(frame, fps, { durationSeconds: framing.seconds }));
  const rect = lerpRect(framing.from, framing.to, t);

  // Place the capture so `rect` exactly fills the frame. Nothing is letterboxed
  // and nothing is stretched: the crop was planned at the frame's own aspect.
  const geometry = plateGeometry(sequence, rect, width, height);
  const { imageWidth, imageHeight, left, top } = geometry;

  const cutIn = framing.cut ? ease('out_quint', progress(frame, fps, { durationSeconds: CUT_IN_SECONDS })) : 1;
  const clock = useSceneClock();
  const out = last ? exitProgress(frame, fps, framing.seconds, 0.3, clock) : 0;

  const lift = framing.lift ? geometry.onScreen(framing.lift) : null;
  /*
   * Depth is applied to the plate, not to the lifted panel.
   *
   * The lifted rectangle is the same pixels at the same scale as the plate
   * beneath it; what separates them is that the plate recedes — a touch
   * darker, a touch soft — while the panel stays where the eye is. That is a
   * compositor's move on a still, and it needs no invented geometry, no fake
   * 3D and no drawn arrow to say "look here".
   */
  const liftIn = lift ? ease('out_expo', progress(frame, fps, { delaySeconds: 0.12, durationSeconds: 0.5 })) : 0;

  /*
   * Three kinds of shot, in order of how much of the interface is moving.
   *
   * A volume is the interface in a constructed space. Layers are the
   * interface taken apart in the frame. Neither is a default: most shots are
   * the third kind, a camera on a plate, and a film that reached for the
   * volume every time would be as templated as one that never did.
   */
  if (framing.space === 'volume' && framing.layers.length > 0) {
    return (
      <div style={{ position: 'absolute', inset: 0, opacity: 1 - out }}>
        <VolumeShot src={src} sources={sources} sequence={sequence} framing={framing} tokens={tokens} words={words} easing={easing} />
        {words && framing.words !== 'none' && !framing.wordsBehind ? (
          <WordsInFrame corner={framing.words} tokens={tokens} words={words} seconds={framing.seconds} easing={easing} />
        ) : null}
      </div>
    );
  }

  if (framing.layers.length > 0) {
    return (
      <div style={{ position: 'absolute', inset: 0, opacity: 1 - out, transform: `scale(${1 + (1 - cutIn) * 0.02})` }}>
        <LayeredShot src={src} sequence={sequence} framing={framing} crop={rect} tokens={tokens} easing={easing} />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: 'radial-gradient(120% 110% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.26) 100%)',
          }}
        />
        {words && framing.words !== 'none' ? (
          <WordsInFrame corner={framing.words} tokens={tokens} words={words} seconds={framing.seconds} easing={easing} />
        ) : null}
      </div>
    );
  }

  const plate = (
    <Img
      src={src}
      style={{
        position: 'absolute',
        left,
        top,
        width: imageWidth,
        height: imageHeight,
        maxWidth: 'none',
        display: 'block',
      }}
    />
  );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        // The frame's ground is the interface's own background, so the edges
        // of the picture do not announce a card sitting on a brand colour.
        background: `rgb(${sequence.background.r}, ${sequence.background.g}, ${sequence.background.b})`,
        opacity: 1 - out,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          // A cut lands: the picture arrives a hair wide and settles. Under a
          // quarter of a second, which reads as an edit rather than a move.
          transform: `scale(${1 + (1 - cutIn) * 0.02})`,
          filter: lift ? `brightness(${1 - liftIn * 0.28}) blur(${liftIn * 2.4}px)` : undefined,
        }}
      >
        {plate}
      </div>

      {lift ? (
        <div
          style={{
            position: 'absolute',
            left: lift.x,
            top: lift.y,
            width: lift.width,
            height: lift.height,
            overflow: 'hidden',
            borderRadius: tokens.radius.md,
            transform: `scale(${1 + liftIn * 0.05}) translateY(${(1 - liftIn) * height * 0.012}px)`,
            boxShadow: `0 ${height * 0.02}px ${height * 0.055}px rgba(0,0,0,${0.42 * liftIn})`,
            opacity: cutIn,
          }}
        >
          <Img
            src={src}
            style={{
              position: 'absolute',
              left: -framing.lift!.x * imageWidth,
              top: -framing.lift!.y * imageHeight,
              width: imageWidth,
              height: imageHeight,
              maxWidth: 'none',
              display: 'block',
            }}
          />
        </div>
      ) : null}

      {/*
        * A vignette, and nothing else.
        *
        * No grain, no chromatic aberration, no scan lines: a screenshot that
        * has been given film artefacts looks like a screenshot that has been
        * given film artefacts. What a lens genuinely does to a bright flat
        * panel is fall off slightly at the corners, which is enough to stop
        * the frame reading as a rectangle pasted onto a slide.
        */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(120% 110% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.26) 100%)`,
        }}
      />

      {words && framing.words !== 'none' ? (
        <WordsInFrame corner={framing.words} tokens={tokens} words={words} seconds={framing.seconds} easing={easing} />
      ) : null}
    </div>
  );
};

/**
 * The scene's words, in the quiet part of the picture.
 *
 * The corner was chosen by the planner from where the interface's own ink is
 * not, so the type lands on the emptiest quarter of this particular frame
 * rather than in the one place a template always puts it.
 *
 * Everything else here is about one problem: white type over a screenshot.
 * A product interface is mostly light, mostly busy, and full of its own text
 * at its own sizes, so words simply placed on top read as a subtitle somebody
 * stuck on afterwards — which is exactly what they are if nothing holds them.
 * What holds them is a scrim anchored to the corner they sit in, falling off
 * across roughly half the frame so the picture stays the picture, and the
 * type set hard against the margin rather than floating in the middle of it.
 * The short rule above the line is the brand's one mark in the shot: enough
 * to say this film was made by someone, far less than a card.
 */
const WordsInFrame: React.FC<{
  corner: Exclude<WordCorner, 'none'>;
  tokens: DesignTokens;
  words: string;
  seconds: number;
  easing?: EasingName;
}> = ({ corner, tokens, words, seconds, easing }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const top = corner === 'top_left' || corner === 'top_right';
  const leftSide = corner === 'top_left' || corner === 'bottom_left';
  const margin = tokens.grid.safe.x;
  const blockWidth = Math.min(tokens.grid.safe.width * 0.46, width * 0.42);
  const arrive = ease('out_quint', progress(frame, fps, { delaySeconds: 0.18, durationSeconds: 0.7 }));

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            `radial-gradient(84% 68% at ${leftSide ? '6%' : '94%'} ${top ? '8%' : '92%'}, ` +
            `rgba(6,6,10,0.86) 0%, rgba(6,6,10,0.62) 34%, rgba(6,6,10,0.18) 66%, rgba(6,6,10,0) 100%)`,
          opacity: arrive,
        }}
      />
      <div
        style={{
          position: 'absolute',
          [top ? 'top' : 'bottom']: margin,
          [leftSide ? 'left' : 'right']: margin,
          width: blockWidth,
          display: 'flex',
          flexDirection: 'column',
          alignItems: leftSide ? 'flex-start' : 'flex-end',
          gap: Math.round(tokens.type.statement.sizePx * 0.42),
          opacity: arrive,
          transform: `translateY(${(1 - arrive) * height * 0.018}px)`,
        }}
      >
        <div style={{ width: Math.round(width * 0.036), height: 3, background: tokens.accent, borderRadius: 2 }} />
        <div
          style={{
            // The interface underneath is light, dense and already full of
            // words; a shadow is what keeps ours readable across a cut without
            // putting a box around them.
            textShadow: `0 ${Math.round(height * 0.004)}px ${Math.round(height * 0.02)}px rgba(0,0,0,0.55)`,
          }}
        >
          <WordReveal
            text={words}
            token={tokens.type.statement}
            color="#ffffff"
            tokens={tokens}
            maxWidth={blockWidth}
            maxLines={3}
            align={leftSide ? 'left' : 'right'}
            easing={easing}
            delaySeconds={0.25}
            durationSeconds={seconds}
          />
        </div>
      </div>
    </>
  );
};

function lerpRect(from: FramingRect, to: FramingRect, t: number): FramingRect {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    width: from.width + (to.width - from.width) * t,
    height: from.height + (to.height - from.height) * t,
  };
}
