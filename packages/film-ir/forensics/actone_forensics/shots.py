"""
Where the picture is replaced, and how.

A hard cut is a single-frame discontinuity that three independent signals
agree on: the colour histogram, the pixels, and the edges (Zabih's edge
change ratio). A one-frame flash that returns to the picture before it is not
a cut. A fade is a ramp into or out of a nearly uniform field; a dissolve is
a run of frames that are, measurably, a linear mix of the frames either side
of it. Anything else that changes gradually — a push, a morph, a whip — is not
called a boundary here: it is motion, and it is measured as motion.
"""
import numpy as np

UNIFORM_STD = 0.02
# Mean absolute luma change between frames above which the picture is still moving.
RAMP_CHANGE = 0.002


def _values(series):
    return np.array([np.nan if v is None else float(v) for v in series], dtype=np.float64)


def _local_median(values, index, radius=10):
    lo, hi = max(1, index - radius), min(len(values), index + radius + 1)
    neighbourhood = [values[i] for i in range(lo, hi) if abs(i - index) > 1 and np.isfinite(values[i])]
    return float(np.median(neighbourhood)) if neighbourhood else 0.0


def detect_cuts(features, repeat_of, small_grey):
    hd = _values(features["histogram_distance"])
    pd = _values(features["pixel_difference"])
    ecr = _values(features["edge_change_ratio"])
    tracked = _values(features["gm_tracked_ratio"])
    n = len(hd)
    candidates = []
    for i in range(1, n):
        if repeat_of[i] is not None or not np.isfinite(hd[i]) or not np.isfinite(pd[i]):
            continue
        hd_base = _local_median(hd, i)
        pd_base = _local_median(pd, i)
        strong = hd[i] >= max(0.3, 3 * hd_base + 0.05) and pd[i] >= max(0.05, 3 * pd_base + 0.02)
        if not strong:
            continue
        supported = (np.isfinite(ecr[i]) and ecr[i] >= 0.5) or (np.isfinite(tracked[i]) and tracked[i] < 0.3) or hd[i] >= 0.6
        if not supported:
            continue
        if i + 1 < n:
            # A flash: the frame after looks like the frame before.
            back = float(np.abs(small_grey[i + 1].astype(np.float32) - small_grey[i - 1].astype(np.float32)).mean() / 255.0)
            if back < 0.35 * pd[i]:
                continue
        candidates.append({
            "frame": i,
            "scores": {
                "histogramDistance": float(hd[i]),
                "pixelDifference": float(pd[i]),
                "edgeChangeRatio": float(ecr[i]) if np.isfinite(ecr[i]) else None,
                "trackedRatio": float(tracked[i]) if np.isfinite(tracked[i]) else None,
                "histogramBaseline": hd_base,
                "pixelBaseline": pd_base,
            },
        })
    # Two cuts on consecutive frames are one cut and its settling; keep the stronger.
    kept = []
    for candidate in candidates:
        if kept and candidate["frame"] - kept[-1]["frame"] <= 1:
            if candidate["scores"]["histogramDistance"] > kept[-1]["scores"]["histogramDistance"]:
                kept[-1] = candidate
            continue
        kept.append(candidate)
    return kept


def detect_fades(features, vectors, small_grey):
    """
    Ramps into and out of a nearly uniform field.

    A run of uniform frames is only half the evidence: a line of type wiped
    onto an empty canvas also starts from a uniform frame. A fade is the whole
    picture blended with the field, so the frames of the ramp must fit
    α·picture + (1−α)·field, measured, before the ramp is called a fade.
    """
    luma = _values(features["luma_mean"])
    spread = _values(features["luma_std"])
    change = _values(features["pixel_difference"])
    n = len(luma)
    uniform = spread < UNIFORM_STD
    found = []
    i = 0
    while i < n:
        if not uniform[i]:
            i += 1
            continue
        a = i
        while i + 1 < n and uniform[i + 1]:
            i += 1
        run_end = b = i
        # The field is where the picture stops changing, not where it first looks
        # uniform: the last frames of a fade to black are dark enough to pass for
        # the field while they are still fading, as are the first of a fade in.
        while a < b and np.isfinite(change[a + 1]) and change[a + 1] > RAMP_CHANGE:
            a += 1
        while b > a and np.isfinite(change[b]) and change[b] > RAMP_CHANGE:
            b -= 1
        # Back over the ramp: s ends on the last frame the fade out has not touched.
        s = a
        while s - 1 >= 0 and np.isfinite(change[s]) and change[s] > RAMP_CHANGE and spread[s - 1] >= spread[s] - 1e-4:
            s -= 1
        # Forward over the ramp: e ends on the first frame the fade in has fully revealed.
        e = b
        while e + 1 < n and np.isfinite(change[e + 1]) and change[e + 1] > RAMP_CHANGE and spread[e + 1] >= spread[e] - 1e-4:
            e += 1
        out_fit = _fade_fit(small_grey, s + 1, a) if a - s >= 3 else None
        in_fit = _fade_fit(small_grey, b + 1, e) if e - b >= 3 else None
        rgb = np.median(np.array(vectors["border_rgb"][a: b + 1]), axis=0)
        field = "black" if luma[a: b + 1].mean() < 0.04 else "white" if luma[a: b + 1].mean() > 0.96 else "colour"
        found.append({
            "uniform": [a, b],
            "lastUntouched": s if out_fit else None,
            "firstRevealed": e if in_fit else None,
            "outFit": out_fit,
            "inFit": in_fit,
            "field": field,
            "rgb": rgb.tolist(),
        })
        i = run_end + 1
    return found


def _fade_fit(frames, first, last):
    """
    Frames first..last−1 as a blend of frame first−1 and frame last. For a fade out
    the second is the field, for a fade in the first is; either way the weight
    moves one way and the blend explains the pixels.
    """
    if last - first < 1 or first < 1 or last >= len(frames):
        return None
    fit = mixing_fit(frames, first, last - 1)
    if fit is None:
        return None
    alphas, residuals = fit
    mean_residual = float(np.mean(residuals))
    monotonic = all(alphas[k + 1] <= alphas[k] + 0.05 for k in range(len(alphas) - 1))
    if not monotonic or mean_residual > 0.02:
        return None
    return {"meanMixResidual": mean_residual, "alphaFirst": alphas[0], "alphaLast": alphas[-1], "frames": last - first}


def mixing_fit(frames, a, b):
    """How well frames a..b are explained as α·A + (1−α)·B, with A = frame a−1 and B = frame b+1."""
    first = frames[a - 1].astype(np.float32).ravel()
    last = frames[b + 1].astype(np.float32).ravel()
    direction = first - last
    norm = float(direction @ direction)
    if norm <= 1e-6:
        return None
    alphas, residuals = [], []
    for k in range(a, b + 1):
        frame = frames[k].astype(np.float32).ravel()
        alpha = float((frame - last) @ direction) / norm
        fitted = alpha * first + (1 - alpha) * last
        alphas.append(alpha)
        residuals.append(float(np.sqrt(np.mean((frame - fitted) ** 2)) / 255.0))
    return alphas, residuals


def detect_dissolves(features, small_grey, cut_frames, fps):
    pd = _values(features["pixel_difference"])
    n = len(pd)
    smooth = np.convolve(np.nan_to_num(pd), np.ones(5) / 5, mode="same")
    peaks = [i for i in range(3, n - 3) if smooth[i] == smooth[max(0, i - 7): i + 8].max() and smooth[i] > 0.004]
    lengths = [6, 10, 14, 20, 30, 45, 60, int(1.5 * fps)]
    found = []
    for centre in peaks:
        if any(abs(centre - c) <= 2 for c in cut_frames):
            continue
        best = None
        for length in sorted(set(lengths)):
            a, b = centre - length // 2, centre + (length - length // 2) - 1
            if a < 1 or b + 1 >= n:
                continue
            if any(a - 1 <= c <= b + 1 for c in cut_frames):
                continue
            total = float(np.abs(small_grey[a - 1].astype(np.float32) - small_grey[b + 1].astype(np.float32)).mean() / 255.0)
            if total < 0.06:
                continue
            fit = mixing_fit(small_grey, a, b)
            if fit is None:
                continue
            alphas, residuals = fit
            mean_residual = float(np.mean(residuals))
            monotonic = all(alphas[k + 1] <= alphas[k] + 0.05 for k in range(len(alphas) - 1))
            if not monotonic or alphas[0] < 0.7 or alphas[-1] > 0.3 or mean_residual > 0.02:
                continue
            score = mean_residual / total
            if best is None or score < best["score"]:
                best = {"span": [a - 1, b + 1], "score": score, "meanResidual": mean_residual, "totalChange": total, "alphas": alphas}
        if best and not any(best["span"][0] <= f["span"][1] and f["span"][0] <= best["span"][1] for f in found):
            found.append(best)
    return found


def segment(features, vectors, repeat_of, small_grey, fps):
    """Boundaries of every kind, in order, and the shots between them."""
    n = len(features["luma_mean"])
    cuts = detect_cuts(features, repeat_of, small_grey)
    boundaries = [{
        "kind": "hard_cut",
        "lastOutgoing": c["frame"] - 1,
        "firstIncoming": c["frame"],
        "span": [c["frame"] - 1, c["frame"]],
        "scores": c["scores"],
    } for c in cuts]
    cut_frames = [c["frame"] for c in cuts]
    # Every boundary's span is [lastOutgoing, firstIncoming]: the last frame the
    # change has not touched and the first it has completed. The change itself
    # is the frames strictly between them — none for a cut, the ramp for a fade.
    for fade in detect_fades(features, vectors, small_grey):
        a, b = fade["uniform"]
        scores = {"field": fade["field"], "fieldRgb": fade["rgb"], "outFit": fade["outFit"], "inFit": fade["inFit"]}
        untouched, revealed = fade["lastUntouched"], fade["firstRevealed"]
        if untouched is not None and revealed is not None and fade["field"] == "colour":
            boundaries.append({"kind": "dip_to_colour", "lastOutgoing": untouched, "firstIncoming": revealed, "span": [untouched, revealed], "scores": scores})
            continue
        if untouched is not None:
            boundaries.append({"kind": "fade_out", "lastOutgoing": untouched, "firstIncoming": a, "span": [untouched, a], "scores": scores})
        if revealed is not None:
            boundaries.append({"kind": "fade_in", "lastOutgoing": b, "firstIncoming": revealed, "span": [b, revealed], "scores": scores})
    for dissolve in detect_dissolves(features, small_grey, cut_frames, fps):
        a, b = dissolve["span"]
        boundaries.append({"kind": "dissolve", "lastOutgoing": a, "firstIncoming": b, "span": [a, b], "scores": {
            "meanMixResidual": dissolve["meanResidual"], "totalChange": dissolve["totalChange"],
            "alphaFirst": dissolve["alphas"][0], "alphaLast": dissolve["alphas"][-1],
        }})
    boundaries.sort(key=lambda boundary: boundary["span"][0])
    # Overlapping boundaries: a cut inside a fade is the fade's.
    merged = []
    for boundary in boundaries:
        if merged and boundary["span"][0] < merged[-1]["span"][1]:
            if boundary["kind"] == "hard_cut":
                continue
            if merged[-1]["kind"] == "hard_cut":
                merged[-1] = boundary
                continue
        merged.append(boundary)
    shots = []
    start = 0
    for boundary in merged:
        end = boundary["lastOutgoing"]
        if end >= start:
            shots.append([start, end])
        start = max(start, boundary["firstIncoming"])
    if start <= n - 1:
        shots.append([start, n - 1])
    return {"boundaries": merged, "shots": shots}


def field_changes(vectors, fps, threshold=0.12):
    """The background changing colour with no cut: a scene change that motion design makes without cutting."""
    from .video import oklab_from_bgr

    rgb = np.array(vectors["border_rgb"], dtype=np.float32)
    if len(rgb) < 2:
        return []
    lab = oklab_from_bgr(np.clip(rgb[:, ::-1], 0, 255).astype(np.uint8).reshape(-1, 1, 3)).reshape(-1, 3)
    window = max(1, int(round(0.5 * fps)))
    events = []
    i = window
    while i < len(lab):
        delta = float(np.linalg.norm(lab[i] - lab[i - window]))
        if delta >= threshold:
            # The frame where most of the change happened.
            steps = np.linalg.norm(np.diff(lab[i - window: i + 1], axis=0), axis=1)
            at = i - window + 1 + int(np.argmax(steps))
            events.append({"frame": at, "deltaE": delta, "fromRgb": rgb[i - window].tolist(), "toRgb": rgb[i].tolist()})
            i += window
        else:
            i += 1
    return events
