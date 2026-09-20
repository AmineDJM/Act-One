"""
Reverse-engineer the motion, editing and sound grammar of a film.

Not "frame 1 is orange". This reads the film as a temporal work: where it
cuts and where it refuses to, what moves and how fast, whether the camera
moves or the objects do, whether material survives a boundary, where the
sound lands relative to the picture, and what shape the easing has.

Everything it reports is measured off the file. It keeps no frames and no
compositions — only the shape of the thing, which is what can legitimately
be learned from somebody else's work.

Usage: temporal_grammar.py FILM.mp4 OUT.json [--fps 15] [--width 320]
"""
import json
import subprocess
import sys
import numpy as np
import cv2

FFMPEG = "/home/user/Act-One/node_modules/ffmpeg-static/ffmpeg"


def probe(path):
    out = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True
    ).stderr
    dur = 0.0
    for line in out.splitlines():
        if "Duration:" in line:
            h, m, s = line.split("Duration:")[1].split(",")[0].strip().split(":")
            dur = int(h) * 3600 + int(m) * 60 + float(s)
    return dur


def frames(path, fps, width):
    """Decode the whole film once, at working resolution, as greyscale + colour."""
    cmd = [
        FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
        "-vf", f"fps={fps},scale={width}:-2", "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    # Height comes from the aspect; probe one frame to learn it.
    probe_cmd = [
        FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
        "-vf", f"scale={width}:-2", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    one = subprocess.run(probe_cmd, capture_output=True).stdout
    height = len(one) // (width * 3)
    n = len(proc.stdout) // (width * height * 3)
    return np.frombuffer(proc.stdout[: n * width * height * 3], dtype=np.uint8).reshape(
        n, height, width, 3
    )


def boundaries(grey, colour, fps):
    """
    Where the picture changes, and what KIND of change it is.

    Three signals per frame pair, because they disagree in useful ways:
      hist  — colour histogram correlation. A cut to a new world drops it.
      pix   — mean absolute pixel difference. A cut spikes it; a dissolve
              raises it for many frames running.
      flow  — dense optical flow magnitude. A camera move or a transformation
              scores high here while hist stays put, which is exactly how a
              continuous transformation is told from a cut.
    """
    n = len(grey)
    hist = np.zeros(n)
    pix = np.zeros(n)
    for i in range(1, n):
        a = cv2.calcHist([colour[i - 1]], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
        b = cv2.calcHist([colour[i]], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
        cv2.normalize(a, a); cv2.normalize(b, b)
        hist[i] = cv2.compareHist(a, b, cv2.HISTCMP_CORREL)
        pix[i] = np.mean(np.abs(grey[i].astype(np.int16) - grey[i - 1].astype(np.int16))) / 255.0
    return hist, pix


def flow_series(grey):
    """Dense optical flow: magnitude, dominant direction, zoom and rotation."""
    n = len(grey)
    mag = np.zeros(n); ang = np.zeros(n); zoom = np.zeros(n); spin = np.zeros(n)
    resid = np.zeros(n)
    h, w = grey[0].shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2.0, h / 2.0
    for i in range(1, n):
        f = cv2.calcOpticalFlowFarneback(
            grey[i - 1], grey[i], None, 0.5, 3, 15, 3, 5, 1.2, 0
        )
        fx, fy = f[..., 0], f[..., 1]
        m = np.hypot(fx, fy)
        mag[i] = float(np.mean(m))
        # The single affine transform that best explains the whole frame: a
        # camera move, or everything moving as one body. Fitted rather than
        # taken as a median — the median vector is near zero whenever most of
        # the frame is still, which made every film in the first pass read as
        # pure object motion, including the ones that are obviously a push.
        mask = m > (np.mean(m) * 0.5 + 1e-6)
        if np.count_nonzero(mask) > 60:
            src = np.stack([xx[mask], yy[mask]], axis=1)
            dst = src + np.stack([fx[mask], fy[mask]], axis=1)
            model, _ = cv2.estimateAffinePartial2D(
                src.reshape(-1, 1, 2), dst.reshape(-1, 1, 2),
                method=cv2.RANSAC, ransacReprojThreshold=1.2, maxIters=300,
            )
        else:
            model = None
        if model is None:
            gx = gy = 0.0
            resid[i] = mag[i]
        else:
            pred = np.stack([
                model[0, 0] * xx + model[0, 1] * yy + model[0, 2] - xx,
                model[1, 0] * xx + model[1, 1] * yy + model[1, 2] - yy,
            ])
            gx, gy = float(model[0, 2]), float(model[1, 2])
            resid[i] = float(np.mean(np.hypot(fx - pred[0], fy - pred[1])))
        ang[i] = float(np.degrees(np.arctan2(gy, gx)))
        # Radial component about the frame centre: positive is a push in.
        rx, ry = xx - cx, yy - cy
        rlen = np.hypot(rx, ry) + 1e-6
        zoom[i] = float(np.mean((fx * rx + fy * ry) / rlen)) / (w / 2.0) * 100
        spin[i] = float(np.mean((fx * -ry + fy * rx) / rlen)) / (w / 2.0) * 100
    return mag, ang, zoom, spin, resid


def carry_over(colour, index):
    """
    Does material survive this boundary?

    ORB features on either side. A hard cut to an unrelated world matches
    almost nothing; a match cut, a morph or an object carried across matches a
    lot while the histogram says the picture changed completely.
    """
    if index < 2 or index >= len(colour) - 2:
        return 0.0
    orb = cv2.ORB_create(400)
    g1 = cv2.cvtColor(colour[index - 2], cv2.COLOR_BGR2GRAY)
    g2 = cv2.cvtColor(colour[index + 2], cv2.COLOR_BGR2GRAY)
    k1, d1 = orb.detectAndCompute(g1, None)
    k2, d2 = orb.detectAndCompute(g2, None)
    if d1 is None or d2 is None or len(k1) < 8 or len(k2) < 8:
        return 0.0
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = [m for m in bf.match(d1, d2) if m.distance < 40]
    return round(len(matches) / max(len(k1), len(k2)), 3)


def audio(path, dur):
    """Loudness envelope, onsets and silence, at 10ms resolution."""
    sr = 22050
    cmd = [
        FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
        "-ac", "1", "-ar", str(sr), "-f", "f32le", "-",
    ]
    raw = subprocess.run(cmd, capture_output=True).stdout
    if not raw:
        return None
    x = np.frombuffer(raw, dtype=np.float32)
    hop = sr // 100  # 10 ms
    win = hop * 4
    n = max(1, (len(x) - win) // hop)
    rms = np.zeros(n)
    flux = np.zeros(n)
    prev = None
    for i in range(n):
        seg = x[i * hop : i * hop + win]
        rms[i] = float(np.sqrt(np.mean(seg ** 2)) + 1e-9)
        spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
        if prev is not None:
            flux[i] = float(np.sum(np.maximum(0, spec - prev)))
        prev = spec
    db = 20 * np.log10(rms / (np.max(rms) + 1e-9) + 1e-9)
    # Onsets: spectral flux peaks well above the local median.
    k = 50
    med = np.array([np.median(flux[max(0, i - k) : i + k + 1]) for i in range(n)])
    thresh = med * 2.2 + np.std(flux) * 0.3
    onsets = []
    for i in range(2, n - 2):
        if flux[i] > thresh[i] and flux[i] == np.max(flux[i - 2 : i + 3]):
            onsets.append(round(i / 100.0, 3))
    silence = [round(i / 100.0, 2) for i in range(n) if db[i] < -45]
    return {
        "db": [round(float(v), 2) for v in db[::10]],  # 100 ms for reporting
        "dbStepSeconds": 0.1,
        "onsets": onsets,
        "silentSeconds": round(len(silence) / 100.0, 2),
        "rangeDb": round(float(np.percentile(db, 98) - np.percentile(db, 2)), 2),
    }


def easing_shape(curve):
    """
    What shape the speed takes over a move.

    Compares the normalised curve against ease-out (fast then slow), ease-in
    and linear. A studio's motion has a character; "linear" is the signature
    of nobody having chosen one.
    """
    if len(curve) < 4:
        return "too_short"
    c = np.array(curve, dtype=float)
    if c.max() - c.min() < 1e-6:
        return "still"
    c = (c - c.min()) / (c.max() - c.min())
    t = np.linspace(0, 1, len(c))
    models = {
        "ease_out": 1 - (1 - t) ** 3,
        "ease_in": t ** 3,
        "ease_in_out": np.where(t < 0.5, 4 * t ** 3, 1 - (-2 * t + 2) ** 3 / 2),
        "linear": t,
        "overshoot": np.clip(1 - (1 - t) ** 3 + 0.25 * np.sin(np.pi * t) * (t > 0.6), 0, 1.3) / 1.0,
    }
    cum = np.cumsum(c); cum = cum / (cum[-1] + 1e-9)
    best = min(models.items(), key=lambda kv: float(np.mean((cum - kv[1]) ** 2)))
    return best[0]


def main():
    path, out = sys.argv[1], sys.argv[2]
    fps = int(sys.argv[sys.argv.index("--fps") + 1]) if "--fps" in sys.argv else 15
    width = int(sys.argv[sys.argv.index("--width") + 1]) if "--width" in sys.argv else 320

    dur = probe(path)
    colour = frames(path, fps, width)
    grey = np.stack([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in colour])
    hist, pix = boundaries(grey, colour, fps)
    mag, ang, zoom, spin, resid = flow_series(grey)

    # A boundary: the histogram falls apart AND the pixels jump. A dissolve
    # raises pix for a run of frames without hist collapsing in one step.
    cuts = []
    for i in range(2, len(grey) - 1):
        if hist[i] < 0.55 and pix[i] > 0.055 and pix[i] > 2.0 * np.median(pix[max(0, i - 15) : i + 15]):
            if not cuts or (i - cuts[-1]["frame"]) > fps * 0.35:
                cuts.append({"frame": i, "at": round(i / fps, 2)})

    for c in cuts:
        i = c["frame"]
        c["histDrop"] = round(float(1 - hist[i]), 3)
        c["pixJump"] = round(float(pix[i]), 3)
        c["carryOver"] = carry_over(colour, i)
        # A dissolve or transformation spreads the change over several frames.
        span = pix[max(0, i - 4) : i + 5]
        c["spreadFrames"] = int(np.sum(span > np.median(pix) * 2.5))
        c["kind"] = (
            "match_or_morph" if c["carryOver"] > 0.09
            else "dissolve" if c["spreadFrames"] >= 4
            else "hard_cut"
        )
        c["flowBefore"] = round(float(np.mean(mag[max(1, i - 6) : i])), 3)
        c["flowAfter"] = round(float(np.mean(mag[i + 1 : i + 7])), 3)
        del c["frame"]

    still = float(np.mean(mag[1:] < 0.06))
    # Movement events: runs where flow is meaningfully above rest.
    thresh = max(0.09, float(np.percentile(mag[1:], 55)))
    events, run = [], []
    for i in range(1, len(mag)):
        if mag[i] > thresh:
            run.append(i)
        elif run:
            if len(run) >= max(3, fps // 5):
                s, e = run[0], run[-1]
                seg = mag[s : e + 1]
                events.append({
                    "from": round(s / fps, 2), "to": round(e / fps, 2),
                    "seconds": round((e - s + 1) / fps, 2),
                    "peakFlow": round(float(np.max(seg)), 3),
                    "easing": easing_shape(seg.tolist()),
                    "cameraShare": round(float(1 - np.mean(resid[s : e + 1]) / (np.mean(seg) + 1e-9)), 3),
                    "zoom": round(float(np.mean(zoom[s : e + 1])), 3),
                    "spin": round(float(np.mean(spin[s : e + 1])), 3),
                    "direction": round(float(np.median(ang[s : e + 1])), 1),
                    "peakAt": round(float(s + int(np.argmax(seg))) / fps, 2),
                })
            run = []

    snd = audio(path, dur)
    # Where the sound lands relative to the picture's own accelerations.
    align = []
    if snd:
        onsets = np.array(snd["onsets"])
        for ev in events:
            if len(onsets) == 0:
                continue
            near = onsets[np.abs(onsets - ev["peakAt"]) < 0.6]
            if len(near):
                offset = float(near[np.argmin(np.abs(near - ev["peakAt"]))] - ev["peakAt"])
                align.append({"visualPeakAt": ev["peakAt"], "offsetMs": round(offset * 1000)})

    json.dump({
        "durationSeconds": round(dur, 2),
        "fpsAnalysed": fps,
        "cuts": cuts,
        "shots": len(cuts) + 1,
        "staticShare": round(still, 3),
        "meanFlow": round(float(np.mean(mag[1:])), 4),
        "movementEvents": events,
        "audio": snd,
        "soundToPicture": align,
        "flowSeries": [round(float(v), 4) for v in mag[::max(1, fps // 5)]],
        "flowStepSeconds": round(max(1, fps // 5) / fps, 3),
    }, open(out, "w"), indent=1)
    print(f"{path}: {dur:.1f}s  shots={len(cuts)+1}  static={still:.1%}  events={len(events)}")


if __name__ == "__main__":
    main()
