"""
The apparent camera, shot by shot.

Frame-to-frame homographies are chained from the first frame of each shot, so
every pose is relative to where its shot began and resets at a boundary. The
pose is the transform of the picture's content: content moving left is a
camera panning right, content growing is a camera pushing in.

Whether a camera is there to be seen at all is decided per shot. Corners
spread across the frame that move as one are a camera; corners bunched on one
panel over a flat field are that panel, and the shot says `partial`; a flat
field with nothing to track says `unobservable` and nothing is reported as
camera motion.
"""
import math

import numpy as np

from .fit import fit_curve, phases

REST_SPEED = 0.02          # frame widths per second
REST_SCALE_SPEED = 0.02    # log-scale per second
REST_ROTATION_SPEED = 1.0  # degrees per second
MIN_MOVE_FRAMES = 4


def trajectories(shots, homographies, features, fps, work_width, work_height):
    samples = {name: [None] * len(homographies) for name in ("tx", "ty", "scale", "rotation", "perspectiveX", "perspectiveY", "residual", "inliers", "coverage", "vx", "vy", "vscale", "speed", "acceleration")}
    shot_reports = []
    moves = []
    for shot_index, (first, last) in enumerate(shots):
        pose = np.eye(3)
        valid_frames = 0
        coverage = []
        inliers = []
        broken_at = None
        for frame in range(first, last + 1):
            if frame > first:
                h = homographies[frame]
                if h is None:
                    # A frame the corners could not follow breaks the chain: every pose
                    # after it would be relative to a guess, so the shot stops being measured.
                    broken_at = frame
                    break
                pose = h @ pose
                valid_frames += 1
                coverage.append(features["gm_coverage"][frame] or 0.0)
                inliers.append(features["gm_inliers"][frame] or 0)
            centre = np.array([work_width / 2.0, work_height / 2.0, 1.0])
            moved = pose @ centre
            moved = moved[:2] / moved[2]
            a, b, c, d = pose[0, 0], pose[0, 1], pose[1, 0], pose[1, 1]
            samples["tx"][frame] = float(moved[0] - work_width / 2.0) / work_width
            samples["ty"][frame] = float(moved[1] - work_height / 2.0) / work_width
            samples["scale"][frame] = float(math.sqrt(abs(a * d - b * c)))
            samples["rotation"][frame] = float(math.degrees(math.atan2(c - b, a + d)))
            samples["perspectiveX"][frame] = float(pose[2, 0] * work_width)
            samples["perspectiveY"][frame] = float(pose[2, 1] * work_height)
            samples["residual"][frame] = features["gm_residual"][frame] if frame > first else 0.0
            samples["inliers"][frame] = features["gm_inliers"][frame] if frame > first else None
            samples["coverage"][frame] = features["gm_coverage"][frame] if frame > first else None
        length = last - first
        valid_share = valid_frames / float(length) if length > 0 else 0.0
        mean_coverage = float(np.mean(coverage)) if coverage else 0.0
        mean_inliers = float(np.mean(inliers)) if inliers else 0.0
        if length == 0:
            observability, reason, confidence = "unobservable", "a single-frame shot has no motion to observe", 0.0
        elif valid_share < 0.5 or mean_inliers < 15 or mean_coverage < 0.12:
            observability = "unobservable"
            reason = f"too little trackable texture: {valid_share:.0%} of frames tracked, {mean_inliers:.0f} inliers, {mean_coverage:.0%} of the frame covered"
            confidence = 0.0
        elif mean_coverage < 0.45:
            observability = "partial"
            reason = f"tracked corners cover {mean_coverage:.0%} of the frame; the motion may be one layer rather than a camera"
            confidence = round(0.3 + mean_coverage, 3)
        else:
            observability = "observable"
            reason = f"corners across {mean_coverage:.0%} of the frame move as one"
            confidence = round(min(0.95, 0.5 + mean_coverage / 2 + min(0.2, mean_inliers / 500)), 3)
        if broken_at is not None and observability != "unobservable":
            reason += f"; tracking lost at frame {broken_at}, so the pose is measured only up to it"
        shot_reports.append({"shot": shot_index, "observability": observability, "reason": reason, "confidence": confidence, "brokenAt": broken_at})
        _derivatives(samples, first, last, fps)
        if observability != "unobservable":
            moves.extend(_moves(samples, shot_index, first, last, fps, observability))
    return {"samples": samples, "shots": shot_reports, "moves": moves}


def _derivatives(samples, first, last, fps):
    for frame in range(first + 1, last + 1):
        now, before = frame, frame - 1
        if samples["tx"][now] is None or samples["tx"][before] is None:
            continue
        vx = (samples["tx"][now] - samples["tx"][before]) * fps
        vy = (samples["ty"][now] - samples["ty"][before]) * fps
        vscale = (math.log(samples["scale"][now]) - math.log(samples["scale"][before])) * fps if samples["scale"][now] > 0 and samples["scale"][before] > 0 else None
        samples["vx"][now] = vx
        samples["vy"][now] = vy
        samples["vscale"][now] = vscale
        samples["speed"][now] = math.hypot(vx, vy)
        if samples["speed"][before] is not None:
            samples["acceleration"][now] = (samples["speed"][now] - samples["speed"][before]) * fps


def _moves(samples, shot_index, first, last, fps, observability):
    moving = []
    for frame in range(first, last + 1):
        speed = samples["speed"][frame]
        vscale = samples["vscale"][frame]
        rotation_speed = None
        if frame > first and samples["rotation"][frame] is not None and samples["rotation"][frame - 1] is not None:
            rotation_speed = abs(samples["rotation"][frame] - samples["rotation"][frame - 1]) * fps
        is_moving = (speed is not None and speed > REST_SPEED) or (vscale is not None and abs(vscale) > REST_SCALE_SPEED) or (rotation_speed is not None and rotation_speed > REST_ROTATION_SPEED)
        moving.append(is_moving)
    segments = []
    start = None
    for offset, flag in enumerate(moving + [False]):
        if flag and start is None:
            start = offset
        elif not flag and start is not None:
            if offset - start >= MIN_MOVE_FRAMES:
                segments.append((first + start, first + offset - 1))
            start = None
    moves = []
    for move_index, (a, b) in enumerate(segments):
        begin = max(first, a - 1)
        tx = [samples["tx"][f] for f in range(begin, b + 1)]
        ty = [samples["ty"][f] for f in range(begin, b + 1)]
        scale = [samples["scale"][f] for f in range(begin, b + 1)]
        rotation = [samples["rotation"][f] for f in range(begin, b + 1)]
        if any(v is None for v in tx + ty + scale + rotation):
            continue
        translation = math.hypot(tx[-1] - tx[0], ty[-1] - ty[0])
        scale_ratio = scale[-1] / scale[0] if scale[0] > 0 else None
        turn = rotation[-1] - rotation[0]
        kind = _classify(tx[-1] - tx[0], ty[-1] - ty[0], scale_ratio, turn)
        speeds = [samples["speed"][f] for f in range(a, b + 1) if samples["speed"][f] is not None]
        dominant = "scale" if kind in ("zoom_in", "zoom_out") else "rotation" if kind == "roll" else ("tx" if abs(tx[-1] - tx[0]) >= abs(ty[-1] - ty[0]) else "ty")
        series = {"tx": tx, "ty": ty, "scale": scale, "rotation": rotation}[dominant]
        found = phases(list(range(len(series))), series, fps)
        moves.append({
            "shot": shot_index,
            "first": a,
            "last": b,
            "type": kind,
            "translation": translation,
            "scaleRatio": scale_ratio,
            "rotation": turn,
            "peakSpeed": max(speeds) if speeds else None,
            "dominantProperty": dominant,
            "phases": [{"kind": k, "frame": begin + i, "value": v} for k, i, v in found],
            "fit": fit_curve(series),
            "observability": observability,
        })
    return moves


def _classify(dx, dy, scale_ratio, turn):
    zoom = scale_ratio is not None and abs(math.log(scale_ratio)) > 0.03
    pan = math.hypot(dx, dy) > 0.02
    roll = abs(turn) > 2.0
    if zoom and pan:
        return "pan_and_zoom"
    if zoom:
        return "zoom_in" if scale_ratio > 1 else "zoom_out"
    if roll and not pan:
        return "roll"
    if pan:
        # Content moving left is the camera moving right; the type names the camera.
        return "pan" if abs(dx) >= abs(dy) else "tilt"
    return "complex" if roll else "static"
