"""
Rectangular panels — windows, cards, screens — found and followed.

A product film is mostly interface, and interface is mostly rectangles. The
candidates are closed four-sided contours that fill their bounding box, found
on the middle frame of each shot; each is followed through its shot by
template matching at three scales around its last size, so a panel that
pushes in or out is followed rather than lost. What a panel *is* (a sidebar,
a chart) is not decided here.
"""
import cv2
import numpy as np

from .fit import fit_curve, phases

MAX_PANELS_PER_SHOT = 6
SCALES = (0.94, 1.0, 1.06)


def detect_panels(grey, min_area=0.02, max_area=0.9):
    h, w = grey.shape
    edges = cv2.Canny(grey, 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    found = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area * w * h or area > max_area * w * h:
            continue
        approx = cv2.approxPolyDP(contour, 0.02 * cv2.arcLength(contour, True), True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        x, y, bw, bh = cv2.boundingRect(approx)
        if area / float(bw * bh) < 0.85 or bw < 24 or bh < 16:
            continue
        found.append([x, y, bw, bh])
    found.sort(key=lambda box: -box[2] * box[3])
    kept = []
    for box in found:
        if all(_iou(box, other) < 0.6 for other in kept):
            kept.append(box)
    return kept[:MAX_PANELS_PER_SHOT]


def _iou(a, b):
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    inter = max(0, x1 - x0) * max(0, y1 - y0)
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / float(union) if union else 0.0


class PanelTracker:
    """All panels of all shots, measured in one sequential decode at working resolution."""

    def __init__(self, shots, reference_greys, scale_to_native, fps):
        self.fps = fps
        self.scale_to_native = scale_to_native
        self.panels = []
        for shot_index, (first, last) in enumerate(shots):
            if last - first < 2:
                continue
            middle = (first + last) // 2
            grey = reference_greys.get(middle)
            if grey is None:
                continue
            for box in detect_panels(grey):
                x, y, w, h = box
                self.panels.append({
                    "shot": shot_index,
                    "first": first,
                    "last": last,
                    "referenceFrame": middle,
                    "template": grey[y: y + h, x: x + w].copy(),
                    "box": box,
                    "current": [float(x), float(y), float(w), float(h)],
                    "samples": {},
                })

    def reference_frames(self, shots):
        return {(first + last) // 2 for first, last in shots if last - first >= 2}

    def measure(self, frame_index, grey):
        H, W = grey.shape
        for panel in self.panels:
            if frame_index < panel["first"] or frame_index > panel["last"]:
                continue
            x, y, w, h = panel["current"]
            best = None
            for factor in SCALES:
                tw, th = int(round(panel["box"][2] * (w / panel["box"][2]) * factor)), int(round(panel["box"][3] * (h / panel["box"][3]) * factor))
                if tw < 8 or th < 8 or tw > W or th > H:
                    continue
                template = cv2.resize(panel["template"], (tw, th), interpolation=cv2.INTER_AREA)
                margin_x, margin_y = int(0.2 * W), int(0.2 * H)
                x0, y0 = max(0, int(x) - margin_x), max(0, int(y) - margin_y)
                x1, y1 = min(W, int(x + w) + margin_x), min(H, int(y + h) + margin_y)
                region = grey[y0:y1, x0:x1]
                if region.shape[0] < th or region.shape[1] < tw:
                    continue
                scores = cv2.matchTemplate(region, template, cv2.TM_CCOEFF_NORMED)
                _, score, _, location = cv2.minMaxLoc(scores)
                if best is None or score > best[0]:
                    best = (float(score), x0 + location[0], y0 + location[1], tw, th)
            if best is None:
                continue
            score, bx, by, bw, bh = best
            if score >= 0.5:
                panel["current"] = [float(bx), float(by), float(bw), float(bh)]
            panel["samples"][frame_index] = {"match": score, "box": [bx, by, bw, bh]}

    def results(self, frame_width, frame_height):
        out = []
        for panel in self.panels:
            frames = sorted(panel["samples"])
            if not frames:
                continue
            k = self.scale_to_native
            boxes = [panel["samples"][f]["box"] for f in frames]
            matches = [panel["samples"][f]["match"] for f in frames]
            trusted = [m >= 0.5 for m in matches]
            if sum(trusted) < max(3, 0.3 * len(frames)):
                continue
            xs = [b[0] * k if t else None for b, t in zip(boxes, trusted)]
            ys = [b[1] * k if t else None for b, t in zip(boxes, trusted)]
            ws = [b[2] * k if t else None for b, t in zip(boxes, trusted)]
            hs = [b[3] * k if t else None for b, t in zip(boxes, trusted)]
            reference_width = panel["box"][2] * k
            cx = [x + w / 2 if x is not None else None for x, w in zip(xs, ws)]
            cy = [y + h / 2 if y is not None else None for y, h in zip(ys, hs)]
            fits = {}
            found_phases = []
            complete = [v for v in cx if v is not None]
            if len(complete) == len(cx) and len(cx) >= 5:
                travel = max(complete) - min(complete)
                if travel >= 4:
                    found_phases = [{"kind": kind, "frame": frames[i], "value": value} for kind, i, value in phases(frames, cx, self.fps)]
                    fit = fit_curve(cx)
                    if fit:
                        fits["cx"] = fit
                widths = [w for w in ws if w is not None]
                if len(widths) == len(ws) and max(widths) / max(1e-6, min(widths)) > 1.05:
                    fit = fit_curve(ws)
                    if fit:
                        fits["width"] = fit
            out.append({
                "shot": panel["shot"],
                "referenceFrame": panel["referenceFrame"],
                "referenceBox": [v * k for v in panel["box"]],
                "frames": frames,
                "x": xs,
                "y": ys,
                "width": ws,
                "height": hs,
                "cx": cx,
                "cy": cy,
                "scale": [w / reference_width if w is not None else None for w in ws],
                "occupancy": [(w * h) / float(frame_width * frame_height) if w is not None else None for w, h in zip(ws, hs)],
                "match": matches,
                "phases": found_phases,
                "fits": fits,
            })
        return out
