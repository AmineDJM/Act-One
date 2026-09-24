"""
Where the picture is replaced, and how.

A hard cut is a single-frame discontinuity that three independent signals
agree on: the colour histogram, the pixels, and the edges (Zabih's edge
change ratio). A new picture in the old one's colours moves the histogram and
the pixels less, and is a cut where every edge is replaced and nothing tracks.
A one-frame flash that returns to the picture before it is not a cut, and
neither is the same picture brightening or changing colour: its edges stay
where they were and its features track. A cut whose first frame is
still part the outgoing picture and part the incoming is a wipe completed
within a frame. A fade is a ramp into or out of a nearly uniform field; a
dissolve is a run of frames that are, measurably, a linear mix of the frames
either side of it — and where the frames either side keep most of the same
edges, it is part of the picture cross-fading inside the shot (a wallpaper
behind windows that stay), which is not a boundary. Anything else that changes
gradually — a push, a morph, a whip — is not called a boundary here: it is
motion, and it is measured as motion.
"""
import numpy as np

UNIFORM_STD = 0.02
# Mean absolute luma change between frames above which the picture is still moving.
RAMP_CHANGE = 0.002
# The edge change ratio, at working resolution, below which the frames either side of a change
# are the same picture. On the Plasma 5.25 film, its cuts replaced 58–100% of their edges; its
# wallpaper cross-fading behind unchanged windows, 7–44% from one end of each mix to the other.
KEPT_STRUCTURE = 0.5


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
    spread = _values(features["luma_std"])
    n = len(hd)
    candidates = []
    for i in range(1, n):
        if repeat_of[i] is not None or not np.isfinite(hd[i]) or not np.isfinite(pd[i]):
            continue
        hd_base = _local_median(hd, i)
        pd_base = _local_median(pd, i)
        above_surroundings = hd[i] >= 3 * hd_base + 0.05 and pd[i] >= 3 * pd_base + 0.02
        strong = above_surroundings and hd[i] >= 0.3 and pd[i] >= 0.05
        # A new picture in the same colours changes its histogram and pixels far beyond what they do
        # around it, but under the floors above. Where every edge is replaced, nothing tracks and there
        # is a picture on both sides, it is a cut: on the Plasma film, the blurred "OVERVIEW" card giving
        # way to the footage (frame 163: edges 0.87 replaced, nothing tracked, histogram 0.215 against
        # 0.028 around it). An element appearing on or leaving an empty canvas is not: one side is empty.
        restructured = (
            above_surroundings and np.isfinite(ecr[i]) and ecr[i] >= 0.8 and np.isfinite(tracked[i]) and tracked[i] <= 0.1
            and np.isfinite(spread[i - 1]) and np.isfinite(spread[i]) and min(spread[i - 1], spread[i]) >= UNIFORM_STD
        )
        if not (strong or restructured):
            continue
        # The same picture brightening or changing colour: its edges stay where they were and its features track.
        same_picture = np.isfinite(ecr[i]) and ecr[i] < 0.3 and np.isfinite(tracked[i]) and tracked[i] >= 0.7
        supported = (np.isfinite(ecr[i]) and ecr[i] >= 0.5) or (np.isfinite(tracked[i]) and tracked[i] < 0.3) or hd[i] >= 0.6
        if same_picture or not supported:
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


def split_frame(frames, i, block=10):
    """
    Whether frame i, the first changed frame of a cut, is still part the
    outgoing picture and part the incoming — an iris or a wipe completed within
    one frame — and if so how.

    Block by block, the frame is compared with the frames either side of it.
    A wipe's frame is explained far better by taking each block from whichever
    side it matches than by either side alone, and a real share of it is still
    the outgoing picture. A cut's first frame is already the incoming picture;
    a cut followed by fast motion matches neither side. None when it is not a
    split frame.
    """
    if i < 1 or i + 1 >= len(frames):
        return None
    before, this, after = (frames[k].astype(np.float32) for k in (i - 1, i, i + 1))

    def per_block(difference):
        h, w = difference.shape
        return difference[: h // block * block, : w // block * block].reshape(h // block, block, w // block, block).mean(axis=(1, 3))

    from_outgoing, from_incoming = per_block(np.abs(this - before)), per_block(np.abs(this - after))
    outgoing, incoming = float(from_outgoing.mean()), float(from_incoming.mean())
    composite = float(np.minimum(from_outgoing, from_incoming).mean())
    share = float((from_outgoing < from_incoming).mean())
    if not 0.1 <= share <= 0.9 or composite > 0.4 * outgoing or composite > 0.8 * incoming:
        return None
    return {"outgoingShare": share, "compositeResidual": composite / 255.0, "outgoingResidual": outgoing / 255.0, "incomingResidual": incoming / 255.0}


def structure_change(edges, a, b):
    """
    Zabih's edge change ratio between frames a and b at working resolution: how
    much of the picture's structure was replaced. None where either frame has
    too few edges to say.
    """
    if edges is None:
        return None
    from .video import edge_change_ratio

    height, width = edges["shape"]
    maps = [np.unpackbits(edges["packed"][k])[: height * width].reshape(height, width).astype(np.uint8) * 255 for k in (a, b)]
    if min(float((m > 0).mean()) for m in maps) < 0.002:
        return None
    return edge_change_ratio(maps[0], maps[1])


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
            # The mix itself: a window padded with frames it has not touched fits as well, and a step
            # from one picture to the next (α jumping from 1 to 0) fits too, but mixes nothing.
            mixing = [k for k, alpha in enumerate(alphas) if 0.03 < alpha < 0.97]
            steps = np.abs(np.diff([1.0] + list(alphas) + [0.0]))
            if len(mixing) < 2 or float(steps.max()) > 0.6:
                continue
            score = mean_residual / total
            if best is None or score < best["score"]:
                best = {"span": [a + mixing[0] - 1, a + mixing[-1] + 1], "score": score, "meanResidual": mean_residual, "totalChange": total,
                        "alphas": alphas[mixing[0]: mixing[-1] + 1]}
        if best:
            best = _widened(small_grey, pd, best, limit=int(round(3 * fps)))
        if best and not any(best["span"][0] <= f["span"][1] and f["span"][0] <= best["span"][1] for f in found):
            found.append(best)
    return found


def _mix(frames, first, last):
    """The weights of frames first+1..last−1 as a mix of frame first and frame last, when they fit one; else None."""
    fit = mixing_fit(frames, first + 1, last - 1) if last - first >= 2 else None
    if fit is None:
        return None
    alphas, residuals = fit
    if float(np.mean(residuals)) > 0.02 or any(alphas[k + 1] > alphas[k] + 0.05 for k in range(len(alphas) - 1)):
        return None
    return alphas, float(np.mean(residuals))


def _widened(frames, change, found, limit):
    """
    A mix found in a window centred on its fastest change, pushed out to where
    the picture stops changing — a cross-fade that jumps in and then eases out
    runs longer on one side than the other — for as long as its frames fit the
    mix as well as they did, then trimmed again to the frames it mixes. As well
    as they did, not merely well: a picture that goes on drifting after the mix
    would otherwise draw the next change into it.
    """
    first, last = found["span"]
    allowed = max(1.25 * found["meanResidual"], found["meanResidual"] + 0.002)

    def fits(a, b):
        mix = _mix(frames, a, b)
        return mix is not None and mix[1] <= allowed

    while last + 1 < len(frames) and last - first < limit and np.isfinite(change[last + 1]) and change[last + 1] > RAMP_CHANGE and fits(first, last + 1):
        last += 1
    while first - 1 >= 0 and last - first < limit and np.isfinite(change[first]) and change[first] > RAMP_CHANGE and fits(first - 1, last):
        first -= 1
    if [first, last] == found["span"]:
        return found
    alphas, residual = _mix(frames, first, last)
    mixing = [k for k, alpha in enumerate(alphas) if 0.03 < alpha < 0.97]
    if len(mixing) < 2:
        return found
    total = float(np.abs(frames[first].astype(np.float32) - frames[last].astype(np.float32)).mean() / 255.0)
    return dict(found, span=[first + mixing[0], first + mixing[-1] + 2], meanResidual=residual, totalChange=total, alphas=alphas[mixing[0]: mixing[-1] + 1])


def segment(features, vectors, repeat_of, small_grey, fps, edges=None):
    """
    Boundaries of every kind, in order, the shots between them, and the
    cross-fades of part of the picture inside a shot.
    """
    n = len(features["luma_mean"])
    cuts = detect_cuts(features, repeat_of, small_grey)
    boundaries = []
    for c in cuts:
        i = c["frame"]
        split = split_frame(small_grey, i)
        if split:
            boundaries.append({"kind": "wipe", "lastOutgoing": i - 1, "firstIncoming": i + 1, "span": [i - 1, i + 1], "scores": {**c["scores"], **split}})
        else:
            boundaries.append({"kind": "hard_cut", "lastOutgoing": i - 1, "firstIncoming": i, "span": [i - 1, i], "scores": c["scores"]})
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
    crossfades = []
    for dissolve in detect_dissolves(features, small_grey, cut_frames, fps):
        a, b = dissolve["span"]
        scores = {
            "meanMixResidual": dissolve["meanResidual"], "totalChange": dissolve["totalChange"],
            "alphaFirst": dissolve["alphas"][0], "alphaLast": dissolve["alphas"][-1],
            "edgeChangeRatio": structure_change(edges, a, b),
        }
        if scores["edgeChangeRatio"] is not None and scores["edgeChangeRatio"] < KEPT_STRUCTURE:
            crossfades.append({"lastOutgoing": a, "firstIncoming": b, "span": [a, b], "scores": scores})
            continue
        boundaries.append({"kind": "dissolve", "lastOutgoing": a, "firstIncoming": b, "span": [a, b], "scores": scores})
    boundaries.sort(key=lambda boundary: boundary["span"][0])
    # Overlapping boundaries: a cut inside a fade is the fade's.
    instant = ("hard_cut", "wipe")
    merged = []
    for boundary in boundaries:
        if merged and boundary["span"][0] < merged[-1]["span"][1]:
            if boundary["kind"] in instant:
                continue
            if merged[-1]["kind"] in instant:
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
    return {"boundaries": merged, "shots": shots, "crossfades": crossfades}


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
