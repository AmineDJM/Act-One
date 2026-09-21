"""
One comparable profile per film, so "worse than the benchmark" becomes a number.

WHAT THIS IS FOR. A convergence loop that only has opinions in it goes in
circles: a critic says "needs more energy", a change is made, the next critic
says something else, and nothing accumulates. This measures the same things on
our film and on the reference films, so a gap can be stated as a quantity and
a change can be shown to have closed it or not.

WHAT THIS IS NOT. None of these numbers is a target. A film optimised for
motion energy is a film full of pointless movement; we learned that already,
from a cut that beat its replacement on every instrument and was called "a
generic template, entirely disconnected from the narrative". These are
DIAGNOSTIC INSTRUMENTS. They say where to look. The judgement stays with
whoever watches the film.

Measured per film:

  CUTS            where the picture is replaced between frames, and the
                  distribution of shot lengths. Edit rhythm is the single most
                  visible difference between a film and a slideshow.
  MOTION          mean optical-flow magnitude per second: how much the picture
                  is actually moving, distinct from how much is on it.
  STATIC SHARE    the fraction of seconds where almost nothing moves.
  SCALE VARIATION how much the apparent size of content changes across the
                  film, via the spread of edge-density — a proxy for whether
                  the film ever goes macro or wide rather than sitting at one
                  distance the whole way.
  NOVELTY         mean dissimilarity between each second and the ones before
                  it. A film that keeps showing the same picture scores low
                  however much it moves.
  LUMA / PALETTE  brightness over time and the number of distinct dominant
                  hues. A uniformly dark film reads as one note.
  AUDIO ENERGY    RMS per second and where the accents land, so sound can be
                  compared to picture rather than asserted.

Usage: profile.py FILM.mp4 [--json OUT.json]
"""
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

FFMPEG = "node_modules/ffmpeg-static/ffmpeg"
SAMPLE_W = 320


def frames(path, stride=1):
    """Every `stride`-th frame, small and grey, with its timestamp."""
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if index % stride == 0:
            h, w = frame.shape[:2]
            small = cv2.resize(frame, (SAMPLE_W, max(1, int(h * SAMPLE_W / w))))
            yield index / fps, small
        index += 1
    cap.release()


def audio_rms(path, hz=10):
    out = subprocess.run(
        [FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
         "-map", "a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
        capture_output=True,
    )
    if not out.stdout:
        return None
    x = np.frombuffer(out.stdout, dtype=np.float32)
    hop = 48000 // hz
    n = len(x) // hop
    if n == 0:
        return None
    return np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1))


def profile(path):
    greys, colours, times = [], [], []
    for t, frame in frames(path, stride=3):
        times.append(t)
        greys.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        colours.append(frame)

    if len(greys) < 3:
        return {"error": "too few frames"}

    # --- cuts: a hard replacement of the picture ---------------------------
    hist_drops, flows, edges, lumas = [], [], [], []
    prev_hist = None
    for i, g in enumerate(greys):
        hist = cv2.calcHist([g], [0], None, [64], [0, 256])
        hist = cv2.normalize(hist, hist).flatten()
        if prev_hist is not None:
            hist_drops.append(1.0 - float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL)))
        prev_hist = hist
        edges.append(float(np.mean(cv2.Canny(g, 60, 160) > 0)))
        lumas.append(float(np.mean(g)) / 255.0)

    for a, b in zip(greys, greys[1:]):
        flow = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 2, 13, 2, 5, 1.1, 0)
        flows.append(float(np.mean(np.linalg.norm(flow, axis=2))))

    drops = np.array(hist_drops)
    # A cut is a histogram break far above this film's own typical change,
    # not above a constant: a busy film and a still one have different floors.
    threshold = max(0.12, float(np.median(drops) + 4 * np.std(drops)))
    raw_cuts = [times[i + 1] for i, d in enumerate(drops) if d > threshold]
    # Merged, because one cut lands on two or three consecutive samples and
    # counting each of them turns a six-shot film into an eighteen-shot film
    # with a median shot length of 50 milliseconds. No edit is that fast.
    cut_at = []
    for t in raw_cuts:
        if not cut_at or t - cut_at[-1] > 0.35:
            cut_at.append(t)

    duration = times[-1] if times else 0.0
    shots = np.diff([0.0, *cut_at, duration]) if cut_at else np.array([duration])

    flows_arr = np.array(flows)
    edges_arr = np.array(edges)

    # --- novelty: how unlike everything before each moment is ---------------
    step = max(1, len(greys) // 60)
    keys = [cv2.resize(g, (32, 18)).astype(np.float32) / 255.0 for g in greys[::step]]
    novelty = []
    for i in range(1, len(keys)):
        prior = keys[max(0, i - 8) : i]
        novelty.append(float(np.mean([np.mean(np.abs(keys[i] - p)) for p in prior])))

    # --- palette: how many distinct dominant hues the film actually uses ----
    hues = []
    for c in colours[:: max(1, len(colours) // 40)]:
        hsv = cv2.cvtColor(c, cv2.COLOR_BGR2HSV)
        sat = hsv[:, :, 1] > 60
        if np.any(sat):
            hues.append(int(np.median(hsv[:, :, 0][sat])))
    distinct_hues = len({h // 12 for h in hues}) if hues else 0

    rms = audio_rms(path)
    audio = None
    if rms is not None and len(rms) > 2:
        peak = float(np.max(rms)) or 1.0
        norm = rms / peak
        audio = {
            "meanRms": round(float(np.mean(norm)), 4),
            "dynamicRange": round(float(np.percentile(norm, 95) - np.percentile(norm, 15)), 4),
            "silentShare": round(float(np.mean(norm < 0.08)), 4),
            "accents": int(np.sum((norm[1:] - norm[:-1]) > 0.18)),
        }

    return {
        "file": Path(path).name,
        "durationSeconds": round(duration, 2),
        "cuts": len(cut_at),
        "cutsPerMinute": round(len(cut_at) / max(duration, 0.001) * 60, 2),
        "shotSeconds": {
            "median": round(float(np.median(shots)), 2),
            "min": round(float(np.min(shots)), 2),
            "max": round(float(np.max(shots)), 2),
            "spread": round(float(np.std(shots)), 2),
        },
        "motion": {
            "mean": round(float(np.mean(flows_arr)), 4),
            "p90": round(float(np.percentile(flows_arr, 90)), 4),
            # Movement that is all the same amount is a conveyor belt; a film
            # accelerates and rests.
            "variation": round(float(np.std(flows_arr)), 4),
            "staticShare": round(float(np.mean(flows_arr < 0.08)), 4),
        },
        "scaleVariation": round(float(np.std(edges_arr) / max(np.mean(edges_arr), 1e-6)), 4),
        "novelty": round(float(np.mean(novelty)) if novelty else 0.0, 4),
        "luma": {
            "mean": round(float(np.mean(lumas)), 4),
            "range": round(float(np.percentile(lumas, 95) - np.percentile(lumas, 5)), 4),
            "darkShare": round(float(np.mean(np.array(lumas) < 0.22)), 4),
        },
        "distinctHues": distinct_hues,
        "audio": audio,
    }


def main():
    result = profile(sys.argv[1])
    print(json.dumps(result, indent=2))
    if "--json" in sys.argv:
        Path(sys.argv[sys.argv.index("--json") + 1]).write_text(json.dumps(result, indent=2))


main()
