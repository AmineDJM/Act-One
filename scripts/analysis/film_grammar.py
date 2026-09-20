"""
The grammar of a film: what moved, how, relative to what.

The first version of this counted hard cuts and reported that a seventy-second
motion-design film had three shots. That is true and useless. A film of this
class changes idea twenty times without cutting once, so the cut is not the
unit — and "how much did the pixels move" is not motion grammar, it is a
seismograph.

This reads four kinds of boundary, because they are four different decisions:

  SHOT           the picture is replaced between one frame and the next.
  SCENE          the world changes: a new field, a new place, a new register.
                 May happen with no cut at all, over half a second.
  CREATIVE_BEAT  same world, new idea: the elements are replaced, the line
                 changes, the layout reorganises. This is the unit a director
                 actually works in.
  TRANSFORMATION material becomes other material — a morph, a scale handoff,
                 an object carried across. The opposite of a cut: maximum
                 change with maximum continuity.

And it tracks ELEMENTS rather than pixels: type, panels, cards, devices,
faces, marks, the background field. For each one it recovers position, scale
and opacity over time, when it entered and left, and how it was staggered
against its siblings — then fits the easing to the TRAJECTORY, which is where
easing actually lives. Optical-flow magnitude cannot tell a cubic ease-out
from a linear drift; a position curve can.

Nothing of anyone's creative work is retained. What comes out is the shape:
durations, curves, ratios, offsets.
"""
import json
import os
import math
import subprocess
import sys
from collections import defaultdict

import cv2
import numpy as np

# Resolved rather than written down: this runs on a laptop, in CI and on a
# render host, and an absolute path from one of them is a crash on the other
# two. ACT_ONE_FFMPEG_PATH is what the rest of the system already reads.
FFMPEG = (
    os.environ.get("ACT_ONE_FFMPEG_PATH")
    or os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "node_modules", "ffmpeg-static", "ffmpeg",
    )
)
if not os.path.exists(FFMPEG):
    FFMPEG = "ffmpeg"


# ---------------------------------------------------------------- decoding

def probe(path):
    out = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    for line in out.splitlines():
        if "Duration:" in line:
            h, m, s = line.split("Duration:")[1].split(",")[0].strip().split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return 0.0


def decode(path, fps, width):
    one = subprocess.run(
        [FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
         "-vf", f"scale={width}:-2", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        capture_output=True).stdout
    height = len(one) // (width * 3)
    raw = subprocess.run(
        [FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
         "-vf", f"fps={fps},scale={width}:-2", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        capture_output=True).stdout
    n = len(raw) // (width * height * 3)
    return np.frombuffer(raw[: n * width * height * 3], dtype=np.uint8).reshape(n, height, width, 3).copy()


# ------------------------------------------------------- element detection



def text_lines(grey):
    """
    Where type is, as lines.

    Classic morphological text detection: horizontal gradient energy, closed
    along the reading direction so the letters of a word become one blob and
    the words of a line become one box. It finds set type on a clean field
    very reliably, which is what these films are mostly made of.
    """
    grad = cv2.morphologyEx(grey, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    _, bw = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    closed = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (17, 3)))
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = grey.shape
    out = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        if ch < 4 or cw < 10 or ch > h * 0.45:
            continue
        if cw / ch < 1.6:
            continue
        density = cv2.countNonZero(bw[y:y + ch, x:x + cw]) / float(cw * ch)
        if not (0.08 < density < 0.75):
            continue
        out.append(("type", x, y, cw, ch))
    return out


def panels(bgr, grey):
    """
    Cards, panels and devices: filled rectangles that sit on the field.

    Found on the quantised image so a soft shadow or a gradient does not split
    one card into four. Classified by size and aspect rather than by content,
    because what matters for grammar is that a rectangular object entered and
    where it went, not what was printed on it.
    """
    h, w = grey.shape
    small = cv2.bilateralFilter(bgr, 5, 45, 45)
    edges = cv2.Canny(small, 30, 90)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < (w * h) * 0.004:
            continue
        x, y, cw, ch = cv2.boundingRect(c)
        rect = area / float(cw * ch + 1e-6)
        if rect < 0.55:
            continue
        share = (cw * ch) / float(w * h)
        aspect = cw / float(ch + 1e-6)
        if share > 0.72:
            continue
        kind = "device" if share > 0.16 and 1.1 < aspect < 2.6 else "panel" if share > 0.03 else "card"
        out.append((kind, x, y, cw, ch))
    return out


def discs(grey):
    """
    Round objects: avatar bubbles, nodes, dots, logo marks.

    Not a face detector. OpenCV 5 dropped the Haar cascades from the Python
    build, and rather than claim a detector this does not have, this finds
    what these films actually use a circle for — an avatar bubble, a node on a
    diagram, a status dot. Three of the four references arrange discs radially
    around a centre at some point, so the shape is worth tracking by itself.
    """
    blurred = cv2.medianBlur(grey, 5)
    found = cv2.HoughCircles(
        blurred, cv2.HOUGH_GRADIENT, dp=1.2, minDist=14,
        param1=90, param2=34, minRadius=5, maxRadius=max(8, grey.shape[0] // 6),
    )
    if found is None:
        return []
    return [
        ("disc", int(x - r), int(y - r), int(2 * r), int(2 * r))
        for x, y, r in np.round(found[0]).astype(int)
    ]


def field_of(bgr):
    """The background field: the commonest colour, and how much of the frame it owns."""
    q = (bgr >> 4).reshape(-1, 3)
    keys = (q[:, 0].astype(np.int32) << 8) | (q[:, 1].astype(np.int32) << 4) | q[:, 2].astype(np.int32)
    vals, counts = np.unique(keys, return_counts=True)
    top = vals[np.argmax(counts)]
    share = float(np.max(counts)) / len(keys)
    mask = keys == top
    mean = bgr.reshape(-1, 3)[mask].mean(axis=0)
    return (float(mean[2]), float(mean[1]), float(mean[0])), share  # RGB


def detect(bgr):
    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return text_lines(grey) + panels(bgr, grey) + discs(grey)


# ----------------------------------------------------------------- tracking

def iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    if x2 <= x1 or y2 <= y1:
        return 0.0
    inter = (x2 - x1) * (y2 - y1)
    return inter / float(aw * ah + bw * bh - inter)


class Track:
    _next = 0

    def __init__(self, kind, box, t, index):
        Track._next += 1
        self.id = Track._next
        self.kind = kind
        self.t = [t]
        self.frames = [index]
        self.box = [box]
        self.missing = 0

    def add(self, box, t, index):
        self.t.append(t); self.box.append(box); self.frames.append(index); self.missing = 0

    @property
    def last(self):
        return self.box[-1]


def track_elements(colour, fps, every):
    """
    Detect on a sampling grid, associate by overlap and kind.

    `every` is how often detection runs; between those frames an element is
    simply expected to still be near where it was, which on 5 Hz sampling of a
    24–60 fps film is a safe assumption for anything that is not a cut.
    """
    live, done = [], []
    for index in range(0, len(colour), every):
        t = index / fps
        found = detect(colour[index])
        used = set()
        for track in live:
            best, score = None, 0.28
            for i, (kind, x, y, w, h) in enumerate(found):
                if i in used or kind != track.kind:
                    continue
                s = iou(track.last, (x, y, w, h))
                if s > score:
                    best, score = i, s
            if best is None:
                track.missing += 1
            else:
                kind, x, y, w, h = found[best]
                track.add((x, y, w, h), t, index)
                used.add(best)
        for i, (kind, x, y, w, h) in enumerate(found):
            if i not in used:
                live.append(Track(kind, (x, y, w, h), t, index))
        keep = []
        for track in live:
            (done if track.missing >= 2 else keep).append(track)
        live = keep
    return done + live


EASINGS = {
    "linear": lambda t: t,
    "ease_out_quad": lambda t: 1 - (1 - t) ** 2,
    "ease_out_cubic": lambda t: 1 - (1 - t) ** 3,
    "ease_out_quint": lambda t: 1 - (1 - t) ** 5,
    "ease_in_cubic": lambda t: t ** 3,
    "ease_in_out_cubic": lambda t: np.where(t < 0.5, 4 * t ** 3, 1 - (-2 * t + 2) ** 3 / 2),
    "overshoot": lambda t: 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
}


def fit_easing(values):
    """
    Which easing this TRAJECTORY follows.

    Fitted to position or scale over time, never to flow magnitude — a
    seismograph cannot tell a cubic ease-out from a linear drift, and the
    first version of this tool claimed it could.
    """
    v = np.asarray(values, dtype=float)
    if len(v) < 4:
        return None, 0.0
    span = v[-1] - v[0]
    if abs(span) < 1e-6:
        return None, 0.0
    norm = (v - v[0]) / span
    t = np.linspace(0, 1, len(v))
    best, err = None, 1e9
    for name, fn in EASINGS.items():
        e = float(np.mean((norm - fn(t)) ** 2))
        if e < err:
            best, err = name, e
    # A curve that fits nothing well is not evidence of an easing family.
    return (best, round(1 - min(1.0, err * 6), 3)) if err < 0.06 else (None, 0.0)


def motions(tracks, width, height, min_frames):
    """Every element's move, as a trajectory with a fitted curve."""
    out = []
    for track in tracks:
        if len(track.box) < min_frames:
            continue
        xs = np.array([b[0] + b[2] / 2 for b in track.box], dtype=float)
        ys = np.array([b[1] + b[3] / 2 for b in track.box], dtype=float)
        ss = np.array([math.sqrt(max(1, b[2] * b[3])) for b in track.box], dtype=float)
        dx, dy = xs[-1] - xs[0], ys[-1] - ys[0]
        travel = math.hypot(dx, dy) / width
        scale = ss[-1] / (ss[0] + 1e-6)
        if travel < 0.02 and abs(scale - 1) < 0.06:
            continue
        axis = xs if abs(dx) >= abs(dy) else ys
        curve, fit = fit_easing(axis if travel >= 0.02 else ss)
        out.append({
            "id": track.id,
            "kind": track.kind,
            "enterAt": round(track.t[0], 2),
            "exitAt": round(track.t[-1], 2),
            "seconds": round(track.t[-1] - track.t[0], 2),
            "fromXY": [round(xs[0] / width, 3), round(ys[0] / height, 3)],
            "toXY": [round(xs[-1] / width, 3), round(ys[-1] / height, 3)],
            "travel": round(travel, 3),
            "scale": round(float(scale), 3),
            "directionDeg": round(math.degrees(math.atan2(dy, dx)), 1) if travel >= 0.02 else None,
            "easing": curve,
            "easingFit": fit,
        })
    return out


def stagger(moves):
    """
    Siblings: elements of one kind that enter close together and move alike.

    The gap between their entries is the stagger, and it is the single most
    characteristic number in motion design — it is what makes eight cards read
    as eight objects rather than one PNG.
    """
    groups = defaultdict(list)
    for m in moves:
        groups[(m["kind"], round(m["enterAt"] / 0.75))].append(m)
    out = []
    for (kind, _), members in groups.items():
        if len(members) < 3:
            continue
        members.sort(key=lambda m: m["enterAt"])
        gaps = [round((b["enterAt"] - a["enterAt"]) * 1000) for a, b in zip(members, members[1:])]
        gaps = [g for g in gaps if 0 < g < 900]
        if len(gaps) < 2:
            continue
        dirs = [m["directionDeg"] for m in members if m["directionDeg"] is not None]
        out.append({
            "kind": kind,
            "count": len(members),
            "firstAt": members[0]["enterAt"],
            "staggerMsMedian": int(np.median(gaps)),
            "staggerMsRange": [int(min(gaps)), int(max(gaps))],
            "spanSeconds": round(members[-1]["enterAt"] - members[0]["enterAt"], 2),
            "sameDirection": bool(dirs and float(np.std(dirs)) < 35),
            "easings": sorted({m["easing"] for m in members if m["easing"]}),
        })
    return out


# ------------------------------------------------------- camera vs objects

def camera_and_objects(grey):
    """
    Split the frame's motion into a camera and everything else.

    A similarity transform is fitted to the moving pixels by RANSAC. What it
    explains is camera, or the whole composition moving as one body; what is
    left over is objects moving independently. Two coherent transforms at
    different depths is parallax, which is detected by fitting a second model
    to the residual.
    """
    n = len(grey)
    h, w = grey[0].shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    mag = np.zeros(n); cam = np.zeros(n); obj = np.zeros(n)
    dz = np.zeros(n); dr = np.zeros(n); dxs = np.zeros(n); dys = np.zeros(n)
    parallax = np.zeros(n, dtype=bool)
    for i in range(1, n):
        f = cv2.calcOpticalFlowFarneback(grey[i - 1], grey[i], None, 0.5, 3, 15, 3, 5, 1.2, 0)
        fx, fy = f[..., 0], f[..., 1]
        m = np.hypot(fx, fy)
        mag[i] = float(np.mean(m))
        moving = m > max(0.25, float(np.mean(m)))
        if np.count_nonzero(moving) < 80:
            obj[i] = mag[i]
            continue
        src = np.stack([xx[moving], yy[moving]], 1).reshape(-1, 1, 2)
        dst = src + np.stack([fx[moving], fy[moving]], 1).reshape(-1, 1, 2)
        model, inliers = cv2.estimateAffinePartial2D(
            src, dst, method=cv2.RANSAC, ransacReprojThreshold=1.0, maxIters=400)
        if model is None:
            obj[i] = mag[i]
            continue
        px = model[0, 0] * xx + model[0, 1] * yy + model[0, 2] - xx
        py = model[1, 0] * xx + model[1, 1] * yy + model[1, 2] - yy
        explained = float(np.mean(np.hypot(px, py)))
        residual = float(np.mean(np.hypot(fx - px, fy - py)))
        cam[i], obj[i] = explained, residual
        dz[i] = float(math.hypot(model[0, 0], model[0, 1]) - 1.0)
        dr[i] = float(math.degrees(math.atan2(model[1, 0], model[0, 0])))
        dxs[i], dys[i] = float(model[0, 2]), float(model[1, 2])
        share = float(np.count_nonzero(inliers)) / max(1, len(src))
        # Half the moving pixels obeying one transform and half obeying
        # another is depth, not noise.
        parallax[i] = 0.25 < share < 0.7 and residual > 0.35
    return mag, cam, obj, dz, dr, dxs, dys, parallax


# ------------------------------------------------------------------- audio

def audio_layers(path):
    """
    Voice, music, impacts, ambience and silence — from the mix, without a
    separation model.

    Honest about what it is: band energy, harmonicity and envelope modulation,
    not source separation. Speech has most of its energy in 300–3400 Hz and an
    envelope that wobbles at 4–8 Hz, which nothing else in a film does. Music
    is periodic; its tempo falls out of the onset envelope's autocorrelation.
    An impact is a broadband transient that decays fast and is not on the
    beat grid. Anything left that is quiet and steady is ambience.
    """
    sr = 22050
    raw = subprocess.run(
        [FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
         "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True).stdout
    if not raw:
        return None
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    hop, win = sr // 100, sr // 25          # 10 ms hop, 40 ms window
    n = max(1, (len(x) - win) // hop)
    window = np.hanning(win)
    freqs = np.fft.rfftfreq(win, 1 / sr)
    voice_band = (freqs >= 300) & (freqs <= 3400)
    low_band = freqs < 250
    high_band = freqs > 5000
    spec = np.zeros((n, len(freqs)))
    for i in range(n):
        spec[i] = np.abs(np.fft.rfft(x[i * hop: i * hop + win] * window))
    total = spec.sum(axis=1) + 1e-12
    rms = np.sqrt((spec ** 2).sum(axis=1)) + 1e-12
    db = 20 * np.log10(rms / rms.max())
    voice_share = spec[:, voice_band].sum(axis=1) / total
    low_share = spec[:, low_band].sum(axis=1) / total
    high_share = spec[:, high_band].sum(axis=1) / total
    flux = np.zeros(n)
    flux[1:] = np.maximum(0, spec[1:] - spec[:-1]).sum(axis=1)

    # Envelope modulation in the syllable band: the signature of speech.
    env = rms / rms.max()
    mod = np.zeros(n)
    w2 = 50
    for i in range(n):
        seg = env[max(0, i - w2): i + w2]
        if len(seg) < 20:
            continue
        s = seg - seg.mean()
        sp = np.abs(np.fft.rfft(s))
        f = np.fft.rfftfreq(len(s), 0.01)
        band = (f >= 3) & (f <= 9)
        mod[i] = float(sp[band].sum() / (sp.sum() + 1e-9))

    loud = db > -42
    voiced = loud & (voice_share > 0.55) & (mod > 0.22)
    voiced = smooth_bool(voiced, 12)
    silent = db < -48

    # Tempo from the onset envelope's autocorrelation.
    onset_env = flux / (flux.max() + 1e-9)
    oe = onset_env - onset_env.mean()
    ac = np.correlate(oe, oe, "full")[len(oe) - 1:]
    lo, hi = int(60 / 200 * 100), int(60 / 60 * 100)      # 60–200 BPM
    bpm = None
    if hi < len(ac):
        lag = int(np.argmax(ac[lo:hi])) + lo
        if ac[lag] > 0.08 * ac[0]:
            bpm = round(6000.0 / lag, 1)

    k = 50
    med = np.array([np.median(flux[max(0, i - k): i + k + 1]) for i in range(n)])
    thresh = med * 2.2 + flux.std() * 0.3
    onsets, impacts = [], []
    for i in range(2, n - 2):
        if flux[i] > thresh[i] and flux[i] == flux[i - 2: i + 3].max():
            at = round(i / 100.0, 3)
            onsets.append(at)
            decay = db[min(n - 1, i + 15)] - db[i]
            if low_share[i] > 0.35 and decay < -6:
                impacts.append(at)
    risers = []
    run = []
    for i in range(n):
        if high_share[i] > 0.12 and (i < 2 or db[i] >= db[i - 1] - 0.6):
            run.append(i)
        else:
            if len(run) > 60:
                risers.append([round(run[0] / 100, 2), round(run[-1] / 100, 2)])
            run = []

    # Musical sections: novelty in the mel-ish band profile.
    bands = np.stack([
        spec[:, (freqs >= lo_f) & (freqs < hi_f)].sum(axis=1)
        for lo_f, hi_f in [(0, 200), (200, 500), (500, 1200), (1200, 3000), (3000, 8000), (8000, 11025)]
    ], axis=1)
    bands = bands / (bands.sum(axis=1, keepdims=True) + 1e-9)
    novelty = np.zeros(n)
    w3 = 150
    for i in range(w3, n - w3):
        novelty[i] = float(np.linalg.norm(bands[i:i + w3].mean(0) - bands[i - w3:i].mean(0)))
    sections = []
    if novelty.max() > 0:
        cut = novelty.mean() + 1.6 * novelty.std()
        for i in range(w3, n - w3):
            if novelty[i] > cut and novelty[i] == novelty[max(0, i - 60): i + 60].max():
                sections.append(round(i / 100.0, 2))

    return {
        "voiceSpans": spans(voiced, 0.25),
        "voiceShareOfRuntime": round(float(voiced.mean()), 3),
        "silentSeconds": round(float(silent.sum()) / 100, 2),
        "longestSilence": round(max([e - s for s, e in spans(silent, 0.2)], default=0.0), 2),
        "rangeDb": round(float(np.percentile(db, 98) - np.percentile(db, 2)), 2),
        "bpm": bpm,
        "onsets": onsets,
        "impacts": impacts,
        "risers": risers,
        "sectionsAt": sections,
    }


def smooth_bool(flags, width):
    out = flags.copy()
    for i in range(len(flags)):
        out[i] = flags[max(0, i - width): i + width + 1].mean() > 0.4
    return out


def spans(flags, min_seconds):
    out, run = [], None
    for i, on in enumerate(flags):
        if on and run is None:
            run = i
        elif not on and run is not None:
            if (i - run) / 100 >= min_seconds:
                out.append([round(run / 100, 2), round(i / 100, 2)])
            run = None
    if run is not None and (len(flags) - run) / 100 >= min_seconds:
        out.append([round(run / 100, 2), round(len(flags) / 100, 2)])
    return out


# -------------------------------------------------------------- boundaries

def boundaries(colour, grey, mag, cam, obj, dz, parallax, tracks, fps, every):
    """
    Four boundaries, four different decisions. See the module docstring.

    A SHOT is the only one that requires a discontinuity. The other three are
    read from what the film is made of — its field, its population of elements,
    its type — which is why a film can change idea twenty times without ever
    cutting.
    """
    n = len(grey)
    hist = np.ones(n); pix = np.zeros(n)
    for i in range(1, n):
        a = cv2.calcHist([colour[i - 1]], [0, 1, 2], None, [8, 8, 8], [0, 256] * 3)
        b = cv2.calcHist([colour[i]], [0, 1, 2], None, [8, 8, 8], [0, 256] * 3)
        cv2.normalize(a, a); cv2.normalize(b, b)
        hist[i] = cv2.compareHist(a, b, cv2.HISTCMP_CORREL)
        pix[i] = float(np.mean(np.abs(grey[i].astype(np.int16) - grey[i - 1].astype(np.int16)))) / 255

    fields, shares = [], []
    for i in range(n):
        rgb, share = field_of(colour[i])
        fields.append(rgb); shares.append(share)
    fields = np.array(fields)

    shots = []
    for i in range(2, n - 1):
        local = float(np.median(pix[max(0, i - 15): i + 15])) + 1e-6
        if hist[i] < 0.6 and pix[i] > 0.05 and pix[i] > 2.2 * local:
            if not shots or i - shots[-1] > fps * 0.3:
                shots.append(i)

    # The world changed: the field moved a long way and stayed moved.
    scenes = []
    look = max(2, int(fps * 0.5))
    for i in range(look, n - look):
        before = fields[i - look: i].mean(axis=0)
        after = fields[i: i + look].mean(axis=0)
        if float(np.linalg.norm(after - before)) > 46:
            if not scenes or i - scenes[-1] > fps * 1.2:
                scenes.append(i)

    # A new idea: the population of elements is replaced.
    pop = defaultdict(set)
    for track in tracks:
        for index in track.frames:
            pop[index].add(track.id)
    grid = sorted(pop)
    beats = []
    for a, b in zip(grid, grid[1:]):
        before, after = pop[a], pop[b]
        union = before | after
        if len(union) < 3:
            continue
        churn = len(union - (before & after)) / len(union)
        if churn > 0.62:
            if not beats or b - beats[-1] > fps * 0.8:
                beats.append(b)

    # Material became other material: strong motion, coherent scale change,
    # and the picture survives — the opposite signature to a cut.
    trans = []
    run = []
    for i in range(1, n):
        moving = mag[i] > 0.35 and (abs(dz[i]) > 0.006 or cam[i] > obj[i] * 0.8)
        if moving:
            run.append(i)
        else:
            if len(run) >= int(fps * 0.35):
                s, e = run[0], run[-1]
                if not any(abs(s - c) < fps * 0.3 for c in shots):
                    trans.append((s, e))
            run = []

    def at(i):
        return round(i / fps, 2)

    return {
        "shot": [{"at": at(i), "histDrop": round(float(1 - hist[i]), 3), "pixJump": round(float(pix[i]), 3)} for i in shots],
        "scene": [{
            "at": at(i),
            "fieldFrom": [int(v) for v in fields[max(0, i - look): i].mean(axis=0)],
            "fieldTo": [int(v) for v in fields[i: i + look].mean(axis=0)],
            "withCut": any(abs(i - c) < fps * 0.4 for c in shots),
        } for i in scenes],
        "creativeBeat": [{"at": at(i), "withCut": any(abs(i - c) < fps * 0.4 for c in shots)} for i in beats],
        "transformation": [{
            "from": at(s), "to": at(e), "seconds": round((e - s) / fps, 2),
            "scaleChange": round(float(np.sum(dz[s:e + 1])), 3),
            "cameraLed": bool(np.mean(cam[s:e + 1]) > np.mean(obj[s:e + 1])),
            "parallax": bool(np.mean(parallax[s:e + 1]) > 0.35),
        } for s, e in trans],
        "fieldShareMedian": round(float(np.median(shares)), 3),
    }


# -------------------------------------------------------------------- main

def main():
    path, out = sys.argv[1], sys.argv[2]
    fps = int(sys.argv[sys.argv.index("--fps") + 1]) if "--fps" in sys.argv else 15
    width = int(sys.argv[sys.argv.index("--width") + 1]) if "--width" in sys.argv else 320

    dur = probe(path)
    colour = decode(path, fps, width)
    grey = np.stack([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in colour])
    h, w = grey[0].shape

    mag, cam, obj, dz, dr, dx, dy, parallax = camera_and_objects(grey)
    every = max(1, fps // 5)
    tracks = track_elements(colour, fps, every)
    moves = motions(tracks, w, h, min_frames=3)
    bounds = boundaries(colour, grey, mag, cam, obj, dz, parallax, tracks, fps, every)
    snd = audio_layers(path)

    live = mag[1:] > 0.06
    camera_frames = int(np.sum((cam > obj) & (mag > 0.12)))
    object_frames = int(np.sum((obj >= cam) & (mag > 0.12)))

    # Where a sonic event lands against the nearest element movement.
    sync = []
    if snd:
        marks = np.array(sorted(set(snd["onsets"] + snd["impacts"])))
        for m in moves:
            if len(marks) == 0 or m["seconds"] < 0.2:
                continue
            near = marks[np.abs(marks - m["enterAt"]) < 0.5]
            if len(near):
                offset = float(near[np.argmin(np.abs(near - m["enterAt"]))] - m["enterAt"])
                sync.append({"kind": m["kind"], "enterAt": m["enterAt"], "soundOffsetMs": round(offset * 1000)})

    json.dump({
        "durationSeconds": round(dur, 2),
        "boundaries": bounds,
        "counts": {
            "shot": len(bounds["shot"]),
            "scene": len(bounds["scene"]),
            "creativeBeat": len(bounds["creativeBeat"]),
            "transformation": len(bounds["transformation"]),
        },
        "staticShare": round(float(1 - live.mean()), 3),
        "meanFlow": round(float(np.mean(mag[1:])), 4),
        "cameraVsObject": {
            "cameraFrames": camera_frames,
            "objectFrames": object_frames,
            "cameraShare": round(camera_frames / max(1, camera_frames + object_frames), 3),
            "parallaxShare": round(float(np.mean(parallax)), 3),
        },
        "elements": moves,
        "elementCounts": {k: sum(1 for m in moves if m["kind"] == k) for k in {m["kind"] for m in moves}},
        "staggerGroups": stagger(moves),
        "audio": snd,
        "soundToElement": sync,
    }, open(out, "w"), indent=1)

    c = bounds
    print(f"{path.split('/')[-1]}: {dur:.1f}s  shot={len(c['shot'])} scene={len(c['scene'])} "
          f"beat={len(c['creativeBeat'])} transform={len(c['transformation'])}  "
          f"static={1 - live.mean():.1%}  elements={len(moves)}  stagger={len(stagger(moves))}")


if __name__ == "__main__":
    main()
