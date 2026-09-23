"""
Motion phases and curve fits.

A fit is a description of an observed trajectory, never a recovery of the
curve its author used: several models are tried, each is scored by how much
of the observed variance it explains with how many parameters, and the
winner is reported with its residual, its R², the number of samples it
rests on and the runner-up. Nothing is fitted to fewer than five samples.
"""
import math

import numpy as np

MIN_SAMPLES = 5


def phases(times, values, fps, rest_fraction=0.08, min_rest_frames=3):
    """
    Where a one-dimensional motion starts, peaks and settles.

    `values` is a position-like series on consecutive frames. Speed is its
    first difference per second; the thresholds are relative to the peak
    speed of this motion, so a slow drift and a whip are read by the same
    rule. Returns (kind, index, value) triples on the frame grid.
    """
    y = np.asarray(values, dtype=np.float64)
    if len(y) < 3 or not np.all(np.isfinite(y)):
        return []
    speed = np.abs(np.diff(y)) * fps
    peak = float(speed.max()) if len(speed) else 0.0
    if peak <= 0:
        return []
    moving = speed > rest_fraction * peak
    found = []
    start = int(np.argmax(moving)) if moving.any() else None
    if start is None:
        return []
    found.append(("start", start, None))
    peak_index = int(np.argmax(speed))
    found.append(("peak_velocity", peak_index + 1, peak))
    if len(speed) >= 3:
        acceleration = np.diff(speed) * fps
        found.append(("acceleration_peak", int(np.argmax(acceleration)) + 1, float(acceleration.max())))
        found.append(("deceleration_peak", int(np.argmin(acceleration)) + 1, float(acceleration.min())))
    settle = None
    for i in range(peak_index, len(speed) - min_rest_frames + 1):
        if not moving[i: i + min_rest_frames].any():
            settle = i
            break
    if settle is not None:
        found.append(("settle", settle, None))
    velocity = np.diff(y)
    signs = np.sign(velocity[np.abs(velocity) * fps > rest_fraction * peak])
    if len(signs) > 1:
        flips = np.where(np.diff(signs) != 0)[0]
        moving_indices = np.where(np.abs(velocity) * fps > rest_fraction * peak)[0]
        for flip in flips[:3]:
            found.append(("reversal", int(moving_indices[flip + 1]), None))
    return found


def _bezier_curve(x1, y1, x2, y2, t):
    """CSS cubic-bezier(x1, y1, x2, y2) evaluated at progress t, by solving x(s) = t with bisection."""
    lo = np.zeros_like(t)
    hi = np.ones_like(t)
    for _ in range(40):
        mid = (lo + hi) / 2
        x = 3 * (1 - mid) ** 2 * mid * x1 + 3 * (1 - mid) * mid ** 2 * x2 + mid ** 3
        lo = np.where(x < t, mid, lo)
        hi = np.where(x < t, hi, mid)
    s = (lo + hi) / 2
    return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s ** 2 * y2 + s ** 3


def _spring(omega, zeta, t):
    zeta = min(max(zeta, 0.01), 0.999)
    damped = omega * math.sqrt(1 - zeta ** 2)
    return 1 - np.exp(-zeta * omega * t) * (np.cos(damped * t) + (zeta * omega / damped) * np.sin(damped * t))


MODELS = {
    "linear": (0, lambda p, t: t),
    "power_ease_in": (1, lambda p, t: t ** p[0]),
    "power_ease_out": (1, lambda p, t: 1 - (1 - t) ** p[0]),
    "power_ease_in_out": (1, lambda p, t: np.where(t < 0.5, 0.5 * (2 * t) ** p[0], 1 - 0.5 * (2 * (1 - t)) ** p[0])),
    "exponential_ease_out": (1, lambda p, t: (1 - np.exp(-p[0] * t)) / (1 - math.exp(-p[0]))),
    "cubic_bezier": (4, lambda p, t: _bezier_curve(p[0], p[1], p[2], p[3], t)),
    "damped_spring": (2, lambda p, t: _spring(p[0], p[1], t)),
}

GRIDS = {
    "power_ease_in": [[k] for k in np.linspace(1.05, 8, 40)],
    "power_ease_out": [[k] for k in np.linspace(1.05, 8, 40)],
    "power_ease_in_out": [[k] for k in np.linspace(1.05, 8, 40)],
    "exponential_ease_out": [[k] for k in np.linspace(0.5, 16, 40)],
    "cubic_bezier": [[x1, y1, x2, y2] for x1 in (0.0, 0.17, 0.33, 0.5, 0.7) for y1 in (0.0, 0.3, 0.6, 1.0, 1.3)
                     for x2 in (0.2, 0.4, 0.58, 0.8, 1.0) for y2 in (0.7, 1.0)],
    "damped_spring": [[w, z] for w in np.linspace(3, 30, 28) for z in (0.2, 0.35, 0.5, 0.65, 0.8, 0.95)],
}

BOUNDS = {
    "power_ease_in": [(1.0, 12.0)],
    "power_ease_out": [(1.0, 12.0)],
    "power_ease_in_out": [(1.0, 12.0)],
    "exponential_ease_out": [(0.05, 40.0)],
    "cubic_bezier": [(0.0, 1.0), (-1.0, 2.0), (0.0, 1.0), (-1.0, 2.0)],
    "damped_spring": [(0.5, 60.0), (0.01, 0.999)],
}

PARAMETER_NAMES = {
    "linear": [],
    "power_ease_in": ["power"],
    "power_ease_out": ["power"],
    "power_ease_in_out": ["power"],
    "exponential_ease_out": ["rate"],
    "cubic_bezier": ["x1", "y1", "x2", "y2"],
    "damped_spring": ["angularFrequency", "dampingRatio"],
}


def _sse(model, params, t, y):
    predicted = MODELS[model][1](params, t)
    return float(np.sum((predicted - y) ** 2))


def _nelder_mead(model, start, t, y, iterations=200):
    """A plain Nelder-Mead with the parameters clamped to their bounds; deterministic from its start."""
    bounds = BOUNDS[model]
    clamp = lambda p: np.array([min(max(v, lo), hi) for v, (lo, hi) in zip(p, bounds)])  # noqa: E731
    n = len(start)
    simplex = [clamp(np.array(start, dtype=np.float64))]
    for i in range(n):
        point = np.array(start, dtype=np.float64)
        point[i] = point[i] + (0.1 * (bounds[i][1] - bounds[i][0]))
        simplex.append(clamp(point))
    scores = [_sse(model, p, t, y) for p in simplex]
    for _ in range(iterations):
        order = np.argsort(scores)
        simplex = [simplex[i] for i in order]
        scores = [scores[i] for i in order]
        centroid = np.mean(simplex[:-1], axis=0)
        reflected = clamp(centroid + (centroid - simplex[-1]))
        reflected_score = _sse(model, reflected, t, y)
        if reflected_score < scores[0]:
            expanded = clamp(centroid + 2 * (centroid - simplex[-1]))
            expanded_score = _sse(model, expanded, t, y)
            simplex[-1], scores[-1] = (expanded, expanded_score) if expanded_score < reflected_score else (reflected, reflected_score)
        elif reflected_score < scores[-2]:
            simplex[-1], scores[-1] = reflected, reflected_score
        else:
            contracted = clamp(centroid + 0.5 * (simplex[-1] - centroid))
            contracted_score = _sse(model, contracted, t, y)
            if contracted_score < scores[-1]:
                simplex[-1], scores[-1] = contracted, contracted_score
            else:
                best = simplex[0]
                simplex = [best] + [clamp(best + 0.5 * (p - best)) for p in simplex[1:]]
                scores = [scores[0]] + [_sse(model, p, t, y) for p in simplex[1:]]
        if max(scores) - min(scores) < 1e-12:
            break
    best = int(np.argmin(scores))
    return simplex[best], scores[best]


def fit_curve(values):
    """
    The best description of a transition from its first to its last value.

    `values` are consecutive per-frame samples. Returns None when the motion
    is too short or too small to say anything about its shape.
    """
    y = np.asarray(values, dtype=np.float64)
    if len(y) < MIN_SAMPLES or not np.all(np.isfinite(y)):
        return None
    start, end = y[0], y[-1]
    span = end - start
    if abs(span) < 1e-6:
        return None
    t = np.linspace(0.0, 1.0, len(y))
    normalised = (y - start) / span
    total = float(np.sum((normalised - normalised.mean()) ** 2))
    if total <= 0:
        return None
    results = []
    for model, (count, _) in MODELS.items():
        if count >= len(y) - 1:
            continue
        if count == 0:
            params, sse = np.array([]), _sse(model, [], t, normalised)
        else:
            grid_scores = [(_sse(model, np.array(p), t, normalised), p) for p in GRIDS[model]]
            grid_scores.sort(key=lambda entry: entry[0])
            params, sse = _nelder_mead(model, grid_scores[0][1], t, normalised)
        n = len(y)
        # A small-sample AIC: a model with more parameters has to explain enough more to be preferred.
        aic = n * math.log(max(sse, 1e-12) / n) + 2 * (count + 1)
        if n - count - 2 > 0:
            aic += 2 * (count + 1) * (count + 2) / (n - count - 2)
        results.append((aic, model, params, sse))
    results.sort(key=lambda entry: entry[0])
    aic, model, params, sse = results[0]
    runner = results[1] if len(results) > 1 else None
    residual_rms = math.sqrt(sse / len(y)) * abs(span)
    return {
        "model": model,
        "parameters": {name: float(v) for name, v in zip(PARAMETER_NAMES[model], params)},
        "from": float(start),
        "to": float(end),
        "residualRms": residual_rms,
        "rSquared": 1 - sse / total,
        "samples": int(len(y)),
        "runnerUp": {"model": runner[1], "rSquared": 1 - runner[3] / total} if runner else None,
    }
