"""
Type on screen: read on a stride, followed on every frame.

Reading is done by RapidOCR (PP-OCR detection and recognition, ONNX) on
sampled frames. Linking readings into tracks is geometry plus text: the same
place, or the same words nearby, across consecutive samples — with a reading
that grows letter by letter kept as one line being typed.

Timing is not taken from the stride. Each line's settled appearance is used
as a template and the line is measured on every frame around its readings:
where the template matches, how much of its ink contrast is present there (a
relative opacity) and how sharp it is against itself (a relative blur). Where
no match can be trusted, the line is measured where it will settle, and only
as far as what is there still correlates with it — so a line wiped on counts,
and another line later set in the same place does not. Milestones are the
first frames where the visibility crosses fixed fractions of its settled
value, so every time reported here sits on the frame grid.
"""
import math

import cv2
import numpy as np

from .common import normalise_text, text_similarity
from .fit import fit_curve

REFINE_WIDTH = 960
INK_THRESHOLD = 28
# Below this normalised cross-correlation the best match is not the line.
MATCH_TRUSTED = 0.6
# In place, below this correlation the ink there belongs to something else.
IN_PLACE_FLOOR = 0.15
MIN_SCORE = 0.5
LOOK_SECONDS = 1.2


class OcrEngine:
    def __init__(self):
        from rapidocr_onnxruntime import RapidOCR

        self.engine = RapidOCR()

    def read(self, bgr, scale):
        """
        Lines in native pixels: polygon, text, recogniser confidence, and a box
        per character. The boxes cost nothing measurable on top of the reading,
        and having them here means a line's glyphs never need a second read.
        """
        result, _ = self.engine(bgr, return_word_box=True)
        lines = []
        for entry in result or []:
            box, text, score = entry[0], entry[1], entry[2]
            if float(score) < MIN_SCORE or not str(text).strip():
                continue
            char_boxes = entry[3] if len(entry) > 3 else []
            chars = entry[4] if len(entry) > 4 else []
            lines.append({
                "poly": [[float(x) * scale, float(y) * scale] for x, y in box],
                "text": str(text),
                "score": float(score),
                "glyphs": [
                    {"char": str(ch), "box": _bbox([[float(x) * scale, float(y) * scale] for x, y in cb])}
                    for ch, cb in zip(chars, char_boxes)
                ],
            })
        return lines


def _bbox(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)]


def _iou(a, b):
    ax0, ay0, aw, ah = a
    bx0, by0, bw, bh = b
    x0, y0 = max(ax0, bx0), max(ay0, by0)
    x1, y1 = min(ax0 + aw, bx0 + bw), min(ay0 + ah, by0 + bh)
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def link(ocr_frames, stride, width):
    """Readings into line tracks."""
    tracks = []
    for entry in ocr_frames:
        frame = entry["frame"]
        claimed = set()
        for line in entry["lines"]:
            box = _bbox(line["poly"])
            best, best_score = None, 0.0
            for index, track in enumerate(tracks):
                if index in claimed or frame - track["lastFrame"] > 3 * stride:
                    continue
                last = track["readings"][-1]
                last_box = _bbox(last["poly"])
                iou = _iou(box, last_box)
                similarity = text_similarity(line["text"], last["text"])
                a, b = normalise_text(line["text"]), normalise_text(last["text"])
                growing = min(len(a), len(b)) >= 3 and (a.startswith(b) or b.startswith(a))
                distance = math.hypot((box[0] + box[2] / 2) - (last_box[0] + last_box[2] / 2), (box[1] + box[3] / 2) - (last_box[1] + last_box[3] / 2)) / width
                if (iou >= 0.3 or (similarity >= 0.9 and distance < 0.15)) and (similarity >= 0.7 or growing):
                    score = iou + similarity
                    if score > best_score:
                        best, best_score = index, score
            if best is None:
                tracks.append({"readings": [dict(line, frame=frame)], "lastFrame": frame})
                claimed.add(len(tracks) - 1)
            else:
                tracks[best]["readings"].append(dict(line, frame=frame))
                tracks[best]["lastFrame"] = frame
                claimed.add(best)
    kept = []
    for track in tracks:
        readings = track["readings"]
        groups = {}
        for reading in readings:
            groups.setdefault(normalise_text(reading["text"]), []).append(reading)
        canonical_key = max(groups, key=lambda key: (sum(r["score"] for r in groups[key]), len(key)))
        canonical = groups[canonical_key]
        if len(canonical_key.replace(" ", "")) < 2:
            continue
        if len(readings) < 2 and readings[0]["score"] < 0.85:
            continue
        reference = canonical[len(canonical) // 2]
        kept.append({
            "text": max(canonical, key=lambda r: r["score"])["text"],
            "score": float(np.median([r["score"] for r in canonical])),
            "readings": [{"frame": r["frame"], "text": r["text"], "score": r["score"], "box": _bbox(r["poly"])} for r in readings],
            "firstRead": readings[0]["frame"],
            "lastRead": readings[-1]["frame"],
            "referenceFrame": reference["frame"],
            "referenceBox": _bbox(reference["poly"]),
            "referencePoly": reference["poly"],
            "variants": sorted({r["text"] for r in readings})[:8],
        })
    return kept


def merge_row_fragments(lines, stride):
    """
    Pieces of one line of type, read as separate lines, joined back into one.

    The recogniser's detector splits a line where the gap between two words is
    wide — "LAUNCH" and "DAY" come back as two readings — and a line that is
    two tracks is measured as two, with its own timings and its own block. Two
    tracks are one line when they sit on the same row, side by side with no
    more than a word's gap between them, at the same size, and are on screen
    together. Words that arrive one after another stay one line: their own
    timing is measured per word, inside it.

    One pass over the pairs that share frames, joined by union-find, so a row
    read as three pieces becomes one line and a screen full of interface text
    costs its neighbours, not every pair of lines in the film.
    """
    lines = list(lines)
    by_frame = {}
    boxes = []
    for index, line in enumerate(lines):
        frames = {}
        for reading in line["readings"]:
            frames[reading["frame"]] = reading["box"]
            by_frame.setdefault(reading["frame"], []).append(index)
        boxes.append(frames)
    parent = list(range(len(lines)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    needed = 1 if stride == 1 else 2
    checked = set()
    for members in by_frame.values():
        for i in members:
            for j in members:
                if i == j or (i, j) in checked:
                    continue
                checked.add((i, j))
                common = sorted(set(boxes[i]) & set(boxes[j]))
                if len(common) < needed:
                    continue
                a, b = lines[i], lines[j]
                # Pieces of one line arrive and leave together; interface text
                # side by side on a screen does too, but is not read as one
                # string of words with a word's gap between them.
                if abs(a["firstRead"] - b["firstRead"]) > 2 * stride or abs(a["lastRead"] - b["lastRead"]) > 2 * stride:
                    continue
                if text_similarity(a["text"], b["text"]) >= 0.8:
                    continue
                frame = common[len(common) // 2]
                if _row_neighbours(boxes[i][frame], boxes[j][frame]):
                    parent[find(i)] = find(j)
    groups = {}
    for index in range(len(lines)):
        groups.setdefault(find(index), []).append(index)
    joined = []
    for members in groups.values():
        if len(members) == 1:
            joined.append(lines[members[0]])
            continue
        common = set.intersection(*(set(boxes[m]) for m in members)) or set.union(*(set(boxes[m]) for m in members))
        anchor = sorted(common)[len(common) // 2]
        ordered = sorted(members, key=lambda m: boxes[m].get(anchor, lines[m]["referenceBox"])[0])
        line = lines[ordered[0]]
        for m in ordered[1:]:
            shared = sorted({r["frame"] for r in line["readings"]} & set(boxes[m]))
            line = _join(line, lines[m], shared[len(shared) // 2] if shared else lines[m]["referenceFrame"])
        joined.append(line)
    joined.sort(key=lambda line: (line["firstRead"], line["referenceBox"][1], line["referenceBox"][0]))
    return joined


def _row_neighbours(left, right):
    """Two boxes on one row, the first to the left of the second by no more than a word's gap."""
    height = max(left[3], right[3])
    if height <= 0 or max(left[3], right[3]) / max(1.0, min(left[3], right[3])) > 1.25:
        return False
    vertical = min(left[1] + left[3], right[1] + right[3]) - max(left[1], right[1])
    gap = right[0] - (left[0] + left[2])
    # A word space is a quarter to half of the type's height; the detector splits at the wide ones.
    return vertical >= 0.7 * min(left[3], right[3]) and -0.1 * height <= gap <= 0.8 * height


def _join(left, right, frame):
    by_frame = {}
    for side, line in (("left", left), ("right", right)):
        for reading in line["readings"]:
            by_frame.setdefault(reading["frame"], {})[side] = reading
    readings = []
    for index in sorted(by_frame):
        pair = by_frame[index]
        if "left" in pair and "right" in pair:
            a, b = pair["left"], pair["right"]
            x0, y0 = min(a["box"][0], b["box"][0]), min(a["box"][1], b["box"][1])
            x1 = max(a["box"][0] + a["box"][2], b["box"][0] + b["box"][2])
            y1 = max(a["box"][1] + a["box"][3], b["box"][1] + b["box"][3])
            readings.append({"frame": index, "text": f'{a["text"]} {b["text"]}', "score": min(a["score"], b["score"]), "box": [x0, y0, x1 - x0, y1 - y0]})
        else:
            readings.append(next(iter(pair.values())))
    reference = next((r for r in readings if r["frame"] == frame), None) or max(readings, key=lambda r: r["box"][2])
    x, y, w, h = reference["box"]
    return {
        "text": f'{left["text"]} {right["text"]}',
        "score": min(left["score"], right["score"]),
        "readings": readings,
        "firstRead": min(left["firstRead"], right["firstRead"]),
        "lastRead": max(left["lastRead"], right["lastRead"]),
        "referenceFrame": frame,
        "referenceBox": reference["box"],
        "referencePoly": [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
        "variants": sorted(set(left["variants"]) | set(right["variants"]) | {reference["text"]})[:8],
        "fragments": left.get("fragments", 1) + right.get("fragments", 1),
    }


def spaced_words(glyphs):
    """
    Glyphs grouped into words, at spaces the recogniser wrote and at gaps it did not.

    Recognition drops the space between two words set close together —
    "NEWFEATURE" — while the glyph boxes still show it: the gap between the W
    and the F is several times any gap inside a word. A gap counts as a space
    when it is a clear fraction of the type's height and well above the line's
    own letter spacing, so type that is tracked out wide is not cut into letters.
    """
    visible = [g for g in glyphs if not g["char"].isspace()]
    if len(visible) < 2:
        gaps_threshold = float("inf")
    else:
        heights = sorted(g["box"][3] for g in visible)
        height = heights[len(heights) // 2]
        gaps = sorted(max(0.0, visible[k + 1]["box"][0] - (visible[k]["box"][0] + visible[k]["box"][2])) for k in range(len(visible) - 1))
        typical = gaps[len(gaps) // 2]
        gaps_threshold = max(0.3 * height, 1.8 * typical)
    words, current, previous = [], [], None
    for glyph in glyphs:
        if glyph["char"].isspace():
            if current:
                words.append(current)
                current = []
            previous = None
            continue
        if previous is not None and glyph["box"][0] - (previous["box"][0] + previous["box"][2]) >= gaps_threshold and current:
            words.append(current)
            current = []
        current.append(glyph)
        previous = glyph
    if current:
        words.append(current)
    return words


def group_blocks(lines):
    """Lines that appear together, stacked and aligned, are one block."""
    parent = list(range(len(lines)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(lines)):
        for j in range(i + 1, len(lines)):
            a, b = lines[i], lines[j]
            overlap = min(a["lastRead"], b["lastRead"]) - max(a["firstRead"], b["firstRead"])
            span = min(a["lastRead"] - a["firstRead"], b["lastRead"] - b["firstRead"]) or 1
            if overlap < 0.6 * span:
                continue
            ax, ay, aw, ah = a["referenceBox"]
            bx, by, bw, bh = b["referenceBox"]
            height = max(ah, bh)
            if max(ah, bh) / max(1.0, min(ah, bh)) > 1.6:
                continue
            gap = max(by - (ay + ah), ay - (by + bh))
            if gap > 1.3 * height:
                continue
            aligned = abs(ax - bx) < 0.6 * height or abs((ax + aw / 2) - (bx + bw / 2)) < 0.6 * height or abs((ax + aw) - (bx + bw)) < 0.6 * height
            if aligned:
                parent[find(i)] = find(j)
    blocks = {}
    for i in range(len(lines)):
        blocks.setdefault(find(i), []).append(i)
    ordered = []
    for members in blocks.values():
        members.sort(key=lambda k: lines[k]["referenceBox"][1])
        ordered.append(members)
    ordered.sort(key=lambda members: (min(lines[k]["firstRead"] for k in members), min(lines[k]["referenceBox"][1] for k in members)))
    return ordered


class Refiner:
    """Measures every text line on every frame of its window, in one sequential decode."""

    def __init__(self, lines, references, width, height, fps, frame_count, cuts):
        self.scale = min(REFINE_WIDTH, width) / float(width)
        self.width, self.height = width, height
        self.fps = fps
        self.lines = lines
        self.state = []
        look = int(round(LOOK_SECONDS * fps))
        # Only a hard cut ends a line's window: across a fade or a dissolve the
        # line may be part of the transition itself.
        cuts = sorted(cuts)
        for line, reference in zip(lines, references):
            x, y, w, h = [v * self.scale for v in line["referenceBox"]]
            pad = max(2, int(round(0.25 * h)))
            gx0, gy0 = max(0, int(x) - pad), max(0, int(y) - pad)
            template = reference["grey"][gy0: int(y + h) + pad, gx0: int(x + w) + pad]
            colour = reference["bgr"][gy0: int(y + h) + pad, gx0: int(x + w) + pad]
            if template.size == 0 or template.shape[0] < 4 or template.shape[1] < 4:
                self.state.append(None)
                continue
            background = float(np.median(np.concatenate([template[0], template[-1], template[:, 0], template[:, -1]])))
            ink = np.abs(template.astype(np.float32) - background) > INK_THRESHOLD
            if ink.sum() < 8:
                self.state.append(None)
                continue
            contrast = float(np.abs(template.astype(np.float32) - background)[ink].mean())
            sharpness = float(cv2.Laplacian(template, cv2.CV_64F).var())
            ink_colour = np.median(colour[ink], axis=0) if colour.shape[:2] == ink.shape else None
            before = [c for c in cuts if c <= line["firstRead"]]
            after = [c for c in cuts if c > line["lastRead"]]
            window_start = max(before[-1] if before else 0, line["firstRead"] - look)
            window_end = min((after[0] - 1) if after else frame_count - 1, line["lastRead"] + look)
            words = []
            for word in reference.get("words", []):
                wx, wy, ww, wh = [v * self.scale for v in word["box"]]
                wx0, wy0 = int(round(wx - gx0)), int(round(wy - gy0))
                wx1, wy1 = int(round(wx + ww - gx0)), int(round(wy + wh - gy0))
                wx0, wy0 = max(0, wx0), max(0, wy0)
                wx1, wy1 = min(template.shape[1], wx1), min(template.shape[0], wy1)
                if wx1 - wx0 < 2 or wy1 - wy0 < 2:
                    continue
                word_ink = ink[wy0:wy1, wx0:wx1]
                if word_ink.sum() < 4:
                    continue
                words.append({"text": word["text"], "slice": (wy0, wy1, wx0, wx1), "contrast": float(np.abs(template[wy0:wy1, wx0:wx1].astype(np.float32) - background)[word_ink].mean()), "box": word["box"]})
            self.state.append({
                "template": template,
                "origin": (gx0, gy0),
                "background": background,
                "ink": ink,
                "inkArea": int(ink.sum()),
                "contrast": contrast,
                "sharpness": sharpness,
                "inkColour": [float(ink_colour[2]), float(ink_colour[1]), float(ink_colour[0])] if ink_colour is not None else None,
                "window": (int(window_start), int(window_end)),
                "search": (max(int(2 * h), int(0.25 * self.width * self.scale)), max(int(1.5 * h), int(0.06 * self.height * self.scale))),
                "words": words,
                "samples": [],
            })

    def windows(self):
        return [state["window"] for state in self.state if state is not None]

    def measure(self, frame_index, grey):
        for state in self.state:
            if state is None:
                continue
            start, end = state["window"]
            if frame_index < start or frame_index > end:
                continue
            template = state["template"]
            th, tw = template.shape
            ox, oy = state["origin"]
            sx, sy = state["search"]
            x0, y0 = max(0, ox - sx), max(0, oy - sy)
            x1, y1 = min(grey.shape[1], ox + tw + sx), min(grey.shape[0], oy + th + sy)
            region = grey[y0:y1, x0:x1]
            if region.shape[0] < th or region.shape[1] < tw:
                state["samples"].append({"frame": frame_index, "match": None})
                continue
            scores = cv2.matchTemplate(region, template, cv2.TM_CCOEFF_NORMED)
            _, best, _, location = cv2.minMaxLoc(scores)
            mx, my = location
            matched = best >= MATCH_TRUSTED
            # Where the line is measured: where it matches, when the match can be
            # trusted; otherwise where it will settle. Never the best match of a
            # template that matches nothing, which lands on whatever else is there.
            if matched:
                crop = region[my: my + th, mx: mx + tw].astype(np.float32)
            else:
                py, px = oy - y0, ox - x0
                crop = region[py: py + th, px: px + tw].astype(np.float32)
                if crop.shape != template.shape:
                    state["samples"].append({"frame": frame_index, "match": float(best)})
                    continue
            border = np.concatenate([crop[0], crop[-1], crop[:, 0], crop[:, -1]])
            background = float(np.median(border))
            contrast = float(np.abs(crop - background)[state["ink"]].mean())
            if not matched:
                # In place, the ink counts only as far as it still looks like this
                # line: a line half wiped on correlates with its template, another
                # line set in the same place does not.
                similarity = float(cv2.matchTemplate(crop.astype(np.uint8), template, cv2.TM_CCOEFF_NORMED)[0, 0])
                contrast *= max(0.0, min(1.0, (similarity - IN_PLACE_FLOOR) / (MATCH_TRUSTED - IN_PLACE_FLOOR)))
            sharpness = float(cv2.Laplacian(crop.astype(np.uint8), cv2.CV_64F).var())
            words = []
            for word in state["words"]:
                wy0, wy1, wx0, wx1 = word["slice"]
                patch = crop[wy0:wy1, wx0:wx1]
                word_ink = state["ink"][wy0:wy1, wx0:wx1]
                words.append(float(np.abs(patch - background)[word_ink].mean()) / word["contrast"] if word["contrast"] > 0 else None)
            ink_box = None
            if matched:
                window = np.abs(crop - background) > INK_THRESHOLD
                if window.any():
                    ys, xs = np.nonzero(window)
                    ink_box = [(x0 + mx + float(xs.min())) / self.scale, (y0 + my + float(ys.min())) / self.scale,
                               float(xs.max() - xs.min() + 1) / self.scale, float(ys.max() - ys.min() + 1) / self.scale]
            state["samples"].append({
                "frame": frame_index,
                "match": float(best),
                "trusted": bool(matched),
                "x": (x0 + mx) / self.scale if matched else None,
                "y": (y0 + my) / self.scale if matched else None,
                "opacity": contrast / state["contrast"] if state["contrast"] > 0 else None,
                "blur": sharpness / state["sharpness"] if state["sharpness"] > 0 else None,
                "inkBox": ink_box,
                "words": words,
            })

    def results(self):
        out = []
        for line, state in zip(self.lines, self.state):
            if state is None:
                out.append(None)
                continue
            out.append(summarise(line, state, self.fps))
        return out


def _first(frames, values, predicate, after=None):
    for frame, value in zip(frames, values):
        if after is not None and frame < after:
            continue
        if value is not None and predicate(value):
            return frame
    return None


def summarise(line, state, fps):
    samples = [s for s in state["samples"] if s.get("match") is not None and s.get("opacity") is not None]
    if not samples:
        return {"measured": False, "reason": "no frame in the window could be measured"}
    frames = [s["frame"] for s in samples]
    opacity = [s.get("opacity") for s in samples]
    visibility = [max(0.0, min(1.5, o or 0.0)) for o in opacity]
    settled_values = [v for v, s in zip(visibility, samples) if s["match"] >= 0.8]
    final = float(np.median(settled_values)) if settled_values else float(max(visibility))
    if final <= 0.05:
        return {"measured": False, "reason": "the line never reached a measurable contrast against its own reference"}
    level = lambda fraction: (lambda v: v >= fraction * final)  # noqa: E731
    first_visible = _first(frames, visibility, level(0.05))
    milestones = {"firstVisible": first_visible}
    for name, fraction in (("p10", 0.1), ("p25", 0.25), ("p50", 0.5), ("p75", 0.75), ("p90", 0.9)):
        milestones[name] = _first(frames, visibility, level(fraction), after=first_visible)
    settled = None
    if milestones["p90"] is not None:
        index_of = {frame: i for i, frame in enumerate(frames)}
        start = index_of[milestones["p90"]]
        for i in range(start, len(samples) - 2):
            window = samples[i: i + 3]
            if all(abs(visibility[i + k] - final) <= 0.05 * final for k in range(3)) and all(
                w.get("x") is not None for w in window
            ) and all(
                abs(window[k]["x"] - window[0]["x"]) <= 1.0 and abs(window[k]["y"] - window[0]["y"]) <= 1.0 for k in range(3)
            ):
                settled = frames[i]
                break
    milestones["settled"] = settled
    last_visible = None
    for frame, value in zip(reversed(frames), reversed(visibility)):
        if value >= 0.05 * final:
            last_visible = frame
            break
    milestones["lastVisible"] = last_visible
    exit_start = None
    if settled is not None and last_visible is not None:
        for i in range(len(samples) - 1, -1, -1):
            if frames[i] > last_visible:
                continue
            steady = i == 0 or (samples[i].get("x") is not None and samples[i - 1].get("x") is not None and abs(samples[i]["x"] - samples[i - 1]["x"]) <= 1.0)
            if abs(visibility[i] - final) <= 0.05 * final and steady:
                exit_start = frames[i]
                break
    milestones["exitStart"] = exit_start
    window_start, window_end = state["window"]
    cut_in = first_visible == window_start and visibility[0] >= 0.9 * final
    cut_out = last_visible == window_end and visibility[-1] >= 0.9 * final
    enter = _animation(samples, visibility, final, first_visible, settled, fps, cut_in)
    exit_ = _animation(samples, visibility, final, exit_start, last_visible, fps, cut_out, leaving=True)
    word_times = []
    for w, word in enumerate(state["words"]):
        values = [s["words"][w] if s.get("words") and w < len(s["words"]) else None for s in samples]
        half = _first(frames, values, lambda v: v >= 0.5)
        word_times.append({"text": word["text"], "p50": half, "box": word["box"]})
    return {
        "measured": True,
        "milestones": milestones,
        "cutIn": bool(cut_in),
        "cutOut": bool(cut_out),
        "enter": enter,
        "exit": exit_,
        "words": word_times,
        "inkColour": state["inkColour"],
        "samples": {
            "frames": frames,
            "x": [s.get("x") for s in samples],
            "y": [s.get("y") for s in samples],
            "match": [s["match"] for s in samples],
            "trusted": [bool(s.get("trusted")) for s in samples],
            "opacity": [min(1.5, max(0.0, v)) if v is not None else None for v in opacity],
            "blur": [s.get("blur") for s in samples],
            "inkBox": [s.get("inkBox") for s in samples],
        },
        "window": list(state["window"]),
    }


def _animation(samples, visibility, final, start, end, fps, instantaneous, leaving=False):
    if instantaneous:
        return {"kind": "cut", "frames": None}
    if start is None or end is None or end <= start:
        return {"kind": "unmeasured", "frames": None}
    index_of = {s["frame"]: i for i, s in enumerate(samples)}
    if start not in index_of or end not in index_of:
        return {"kind": "unmeasured", "frames": None}
    a, b = index_of[start], index_of[end]
    segment = samples[a: b + 1]
    vis = visibility[a: b + 1]
    trusted = [s for s in segment if s.get("trusted") and s.get("x") is not None]
    out = {
        "kind": "measured",
        "frames": [start, end],
        "durationMs": (end - start) * 1000.0 / fps,
        "translation": None,
        "opacity": {"from": vis[0] / final, "to": vis[-1] / final},
        "blur": None,
        "scale": None,
        "mask": None,
        "trustedFrames": len(trusted),
        "fits": {},
    }
    if len(trusted) >= 2:
        first, last = trusted[0], trusted[-1]
        # Measured between the first and last frames where the line is where its template says.
        out["translation"] = {"dx": last["x"] - first["x"], "dy": last["y"] - first["y"], "fromFrame": first["frame"], "toFrame": last["frame"]}
        if first.get("blur") is not None and last.get("blur") is not None:
            out["blur"] = {"from": first["blur"], "to": last["blur"]}
        boxes = [s["inkBox"] for s in trusted if s.get("inkBox")]
        if len(boxes) >= 2 and boxes[-1][3] > 0:
            ratio = boxes[0][3] / boxes[-1][3]
            out["scale"] = {"from": ratio, "to": 1.0} if not leaving else {"from": 1.0, "to": 1.0 / ratio if ratio else None}
    opaque = [s.get("opacity") or 0 for s in segment]
    boxes = [s.get("inkBox") for s in segment]
    widths = [box[2] for box in boxes if box]
    if len(widths) >= 3 and max(widths) > 1.4 * min(widths) and np.median(opaque) > 0.6:
        lefts = [box[0] for box in boxes if box]
        rights = [box[0] + box[2] for box in boxes if box]
        if np.std(lefts) < 0.2 * np.std(rights):
            out["mask"] = "wipe_left_to_right" if not leaving else "wipe_right_to_left"
        elif np.std(rights) < 0.2 * np.std(lefts):
            out["mask"] = "wipe_right_to_left" if not leaving else "wipe_left_to_right"
    fit = fit_curve(vis)
    if fit:
        out["fits"]["opacity"] = fit
    if len(trusted) >= 5 and len(trusted) == len(segment):
        for name in ("x", "y"):
            values = [s[name] for s in trusted]
            if abs(values[-1] - values[0]) >= 2.0:
                fit = fit_curve(values)
                if fit:
                    out["fits"][name] = fit
    return out
