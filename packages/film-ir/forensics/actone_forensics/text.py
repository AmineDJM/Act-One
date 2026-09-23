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
                left, right = (i, j) if boxes[i][frame][0] <= boxes[j][frame][0] else (j, i)
                if _row_neighbours(boxes[left][frame], boxes[right][frame], _shared_edge(lines[left]["text"], lines[right]["text"])):
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


def _shared_edge(left_text, right_text):
    """
    How many letters the right piece repeats from the end of the left one.

    The detector sometimes cuts a line with its boxes overlapping, and the
    letter under the overlap is read in both pieces — "LAUNCH" and "HDAY".
    """
    a, b = "".join(left_text.split()), "".join(right_text.split())
    for k in range(min(3, len(a), len(b) - 1), 0, -1):
        if a.endswith(b[:k]):
            return k
    return 0


def _row_neighbours(left, right, shared=0):
    """
    Two boxes on one row, the first to the left of the second by no more than
    a word's gap — or overlapping by no more than the letters both pieces read.
    """
    height = max(left[3], right[3])
    if height <= 0 or max(left[3], right[3]) / max(1.0, min(left[3], right[3])) > 1.25:
        return False
    vertical = min(left[1] + left[3], right[1] + right[3]) - max(left[1], right[1])
    gap = right[0] - (left[0] + left[2])
    # A word space is a quarter to half of the type's height; the detector splits at the wide ones.
    # A letter is at most about as wide as the type is tall, so each shared letter allows that much overlap.
    return vertical >= 0.7 * min(left[3], right[3]) and -max(0.1, 1.1 * shared) * height <= gap <= 0.8 * height


def _trimmed(left_text, right_text, overlapping):
    """The right piece without the letters it repeats from the left, when their boxes overlap."""
    if not overlapping:
        return right_text
    shared = _shared_edge(left_text, right_text)
    if not shared:
        return right_text
    kept, skipped = [], 0
    for char in right_text:
        if skipped < shared and not char.isspace():
            skipped += 1
            continue
        kept.append(char)
    return "".join(kept).lstrip()


def _join(left, right, frame):
    by_frame = {}
    for side, line in (("left", left), ("right", right)):
        for reading in line["readings"]:
            by_frame.setdefault(reading["frame"], {})[side] = reading
    readings = []
    overlap_seen = False
    for index in sorted(by_frame):
        pair = by_frame[index]
        if "left" in pair and "right" in pair:
            a, b = pair["left"], pair["right"]
            x0, y0 = min(a["box"][0], b["box"][0]), min(a["box"][1], b["box"][1])
            x1 = max(a["box"][0] + a["box"][2], b["box"][0] + b["box"][2])
            y1 = max(a["box"][1] + a["box"][3], b["box"][1] + b["box"][3])
            overlapping = b["box"][0] < a["box"][0] + a["box"][2] - 0.1 * max(a["box"][3], b["box"][3])
            overlap_seen = overlap_seen or overlapping
            readings.append({"frame": index, "text": f'{a["text"]} {_trimmed(a["text"], b["text"], overlapping)}', "score": min(a["score"], b["score"]), "box": [x0, y0, x1 - x0, y1 - y0]})
        else:
            readings.append(next(iter(pair.values())))
    reference = next((r for r in readings if r["frame"] == frame), None) or max(readings, key=lambda r: r["box"][2])
    x, y, w, h = reference["box"]
    return {
        "text": f'{left["text"]} {_trimmed(left["text"], right["text"], overlap_seen)}',
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


def pixel_spaces(grey, box, glyphs, consensus):
    """
    Where the words of a line break: the spaces in the recogniser's consensus
    reading, corrected by the gaps in the pixels where the pixels can be
    trusted to say more.

    The recogniser's glyph boxes are approximate in width. It invents spaces
    inside words set wide ("O N M U LTIPLE", "up dates") and drops the space
    between words set close ("Deployin minutes"). The ink is exact where the
    type stands on a clean ground: between each pair of neighbouring letters,
    the widest run of columns with no ink is the gap they leave. Measured on
    the Plasma 5.25 film, small interface type blurs its word gaps into its
    letter gaps (3–5 px against 0–2 px) and type over a picture leaves no
    clean column at all, so the pixels only correct the recogniser, with
    margin:

    - a space the recogniser wrote is removed only in large type, where the
      gap there is no wider than the line's letter spacing in type visibly
      tracked out, or clearly narrower than the line's own word breaks — and
      never beside punctuation or a symbol;
    - a space is added only where the gap is well beyond the widest of the
      line's letter gaps, and never beside a figure one or a mark, whose side
      bearings look like one.

    Returns the indices, among the line's non-space glyphs, of the letters a
    word ends at — or None where the ground is not clean enough to measure.
    """
    letters = [g for g in glyphs if not g["char"].isspace()]
    if len(letters) < 2 or "".join(g["char"] for g in letters) != "".join(consensus.split()):
        # The glyphs at the reference frame must be the consensus's letters, one for one.
        return None
    # The spaces the recogniser's consensus wrote, as positions among its letters.
    written = set()
    count = -1
    for char in consensus:
        if char.isspace():
            if 0 <= count < len(letters) - 1:
                written.add(count)
        else:
            count += 1
    x, y, w, h = box
    pad_x, pad_y = int(round(0.3 * h)), int(round(0.15 * h))
    x0, y0 = max(0, int(np.floor(x)) - pad_x), max(0, int(np.floor(y)) - pad_y)
    x1, y1 = min(grey.shape[1], int(np.ceil(x + w)) + pad_x), min(grey.shape[0], int(np.ceil(y + h)) + pad_y)
    region = grey[y0:y1, x0:x1].astype(np.float32)
    if region.shape[0] < 4 or region.shape[1] < 4:
        return None
    ring = np.concatenate([region[0], region[-1], region[:, 0], region[:, -1]])
    background = float(np.median(ring))
    low, high = np.percentile(region, [2, 98])
    ink = float(low) if background - low > high - background else float(high)
    if abs(ink - background) < 40:
        return None
    coverage = np.clip((region - background) / (ink - background), 0.0, 1.0)
    # The line's own rows: in a paragraph set tight, the margin holds its neighbours' descenders and capitals.
    band = _own_span(coverage[:, max(0, int(np.floor(x)) - x0): max(1, int(np.ceil(x + w)) - x0)].max(axis=1), int(np.floor(y)) - y0, int(np.ceil(y + h)) - 1 - y0)
    if band is None:
        return None
    coverage = coverage[band[0]: band[1] + 1].max(axis=0)
    centres = [g["box"][0] + g["box"][2] / 2.0 - x0 for g in letters]
    if any(b <= a for a, b in zip(centres, centres[1:])):
        return None
    gaps, floors = [], []
    for a, b in zip(centres, centres[1:]):
        between = coverage[max(0, int(np.ceil(a))): min(len(coverage), int(np.floor(b)) + 1)]
        run = best = 0
        for value in between:
            run = 0 if value >= 0.35 else run + 1
            best = max(best, run)
        gaps.append(best)
        floors.append(float(between.min()) if len(between) else 1.0)
    # A clean ground shows through between most letters; a picture or a gradient under the type does not.
    if float(np.median(floors)) >= 0.3:
        return None
    height = float(np.median([g["box"][3] for g in letters]))
    # The line's letter spacing, from where its words hold together: in a short
    # line with several words ("IS A BI"), the word gaps would pull a median of
    # every gap up to their own width.
    inside = [gap for k, gap in enumerate(gaps) if k not in written]
    typical = float(np.median(inside if len(inside) >= 2 else gaps))
    chars = [g["char"] for g in letters]

    def beside(k, kinds):
        return any(not c.isalnum() or c in kinds for c in (chars[k], chars[k + 1]))

    spaces = set(written)
    # Only large type resolves its gaps well enough to overrule a space the
    # recogniser wrote: in small type a real word gap can blur to one pixel.
    if height >= 40:
        tracked = typical >= 0.1 * height
        for k in sorted(written):
            # A space beside punctuation or a symbol is almost always meant: "Creating, moving", "★★★★★ 137".
            if beside(k, ""):
                continue
            others = [gaps[j] for j in written if j != k]
            if tracked and gaps[k] <= 1.35 * typical:
                spaces.discard(k)
            elif others and gaps[k] <= 0.4 * float(np.median(others)) and gaps[k] <= typical + 1:
                # Clearly narrower than the line's own word breaks.
                spaces.discard(k)
    # Letter gaps vary with the letters — a straight stem stands in a wider
    # side bearing than a round one ("U N" in a bold face is 6 px where "L A"
    # is 1) — so a missing space must be well beyond the widest of them.
    widest = float(np.percentile(inside if len(inside) >= 2 else gaps, 80))
    wide = max(2.0 * widest + 1.0, 0.3 * height, 3.0)
    for k, gap in enumerate(gaps):
        # A figure one and a mark stand in wide side bearings: "F11" is not "F1 1".
        if gap >= wide and floors[k] < 0.1 and not beside(k, "1"):
            spaces.add(k)
    return spaces


# Glyphs whose tops sit on the cap line or on the x-height without overshoot,
# and whose bottoms sit on the baseline or on the descender line.
FLAT_CAPS = set("BDEFHIKLMNPRTUVWXYZ")
FLAT_X = set("mnruvwxz")
ASCENDERS = set("bdhkl")
DESCENDERS = set("gjpqy")
ON_BASELINE = set("ABDEFHIKLMNPRTXZhiklmnrxz")


def _runs(mask):
    """The runs of True in a boolean vector, as the first and last index of each, in order."""
    changes = np.flatnonzero(np.diff(np.concatenate(([0], mask.astype(np.int8), [0]))))
    return list(zip(changes[0::2].tolist(), (changes[1::2] - 1).tolist()))


def _own_span(profile, first, last):
    """
    The rows a line's own ink spans, in a coverage profile that reaches past
    its box (rows first..last): every run of ink lying at least half inside
    the box. The margin that catches ink a tight box cut off also holds the
    descenders of the line above and the capitals of the line below in a
    paragraph set tight, and those lie mostly outside it.
    """
    runs = [(a, b) for a, b in _runs(profile >= 0.5) if 2 * (min(b, last) - max(a, first) + 1) >= b - a + 1]
    return (runs[0][0], runs[-1][1]) if runs else None


def _edges(profile, first=0, last=None):
    """
    A glyph's top and bottom from its vertical coverage profile, each to a
    fraction of a pixel: where the profile crosses half coverage, between the
    centres of the rows either side. Row r spans [r, r+1). Only the ink of
    the line whose box spans rows first..last counts.
    """
    own = _own_span(profile, first, len(profile) - 1 if last is None else last)
    # Ink that runs to the end of what was looked at — type cut by the frame's edge — has an edge that was not seen.
    if own is None or own[0] == 0 or own[1] == len(profile) - 1:
        return None
    first, last = own
    above = float(profile[first - 1]) if first > 0 else 0.0
    below = float(profile[last + 1]) if last + 1 < len(profile) else 0.0
    top = first - 0.5 + (0.5 - above) / max(1e-6, float(profile[first]) - above)
    bottom = last + 0.5 + (float(profile[last]) - 0.5) / max(1e-6, float(profile[last]) - below)
    return top, bottom


def type_geometry(grey, box, glyphs):
    """
    Where a line's type sits and how it is drawn, from the pixels of its
    settled frame at the film's own resolution.

    Each glyph's ink is found in the middle of its box, and its top and
    bottom are read to a fraction of a pixel. The baseline is where the
    glyphs that stand on it without overshoot end; the cap height and the
    x-height are where flat-topped capitals and lowercase begin. The
    recogniser's glyph boxes can sit half a letter off their letters, so a
    class's edge is the one most of its glyphs agree on (`_consensus`), and a
    class too few agree on gives nothing — as does a class the line does not
    have: a line of lowercase has no cap height to measure. Stems are read
    from the line as a whole (`_stems`).
    """
    letters = [g for g in glyphs if not g["char"].isspace() and g["box"][2] > 0 and g["box"][3] > 0]
    if not letters:
        return None
    x, y, w, h = box
    pad_x, pad_y = int(round(0.2 * h)), int(round(0.5 * h))
    x0, y0 = max(0, int(np.floor(x)) - pad_x), max(0, int(np.floor(y)) - pad_y)
    x1, y1 = min(grey.shape[1], int(np.ceil(x + w)) + pad_x), min(grey.shape[0], int(np.ceil(y + h)) + pad_y)
    region = grey[y0:y1, x0:x1].astype(np.float32)
    if region.shape[0] < 6 or region.shape[1] < 6:
        return None
    ring = np.concatenate([region[0], region[-1], region[:, 0], region[:, -1]])
    background = float(np.median(ring))
    low, high = np.percentile(region, [1, 99])
    ink = float(low) if background - low > high - background else float(high)
    if abs(ink - background) < 40:
        return None
    coverage = np.clip((region - background) / (ink - background), 0.0, 1.0)
    box_rows = (int(np.floor(y)) - y0, int(np.ceil(y + h)) - 1 - y0)
    columns = (max(0, int(np.floor(x)) - x0), min(coverage.shape[1], max(1, int(np.ceil(x + w)) - x0)))
    band = _own_span(coverage[:, columns[0]: columns[1]].max(axis=1), *box_rows)
    if band is None:
        return None
    # Each letter's own ink where it can be told apart; otherwise the middle of its glyph box.
    own = _letter_ink(coverage, band, columns, [(g["box"][0] - x0 - columns[0], g["box"][0] + g["box"][2] - x0 - columns[0]) for g in letters])
    exact = [profile is not None for profile in own] if own is not None else [False] * len(letters)
    profiles = []
    for k, glyph in enumerate(letters):
        if exact[k]:
            profiles.append(own[k])
            continue
        gx, _, gw, _ = glyph["box"]
        c0 = max(0, int(round(gx + 0.25 * gw)) - x0)
        c1 = min(coverage.shape[1], int(round(gx + 0.75 * gw)) - x0 + 1)
        profiles.append(coverage[:, c0:c1].max(axis=1) if c1 > c0 else None)
    tops_cap, tops_x, tops_asc, bottoms, bottoms_desc = [], [], [], [], []
    # Whether every sample of a class was read from its letter's own ink.
    from_ink = {"cap": True, "x": True, "ascender": True, "descender": True}
    for glyph, profile, clean in zip(letters, profiles, exact):
        edges = _edges(profile, *box_rows) if profile is not None else None
        if edges is None:
            continue
        top, bottom = edges[0] + y0, edges[1] + y0
        char = glyph["char"]
        for name, values, members, edge in (("cap", tops_cap, FLAT_CAPS, top), ("x", tops_x, FLAT_X, top), ("ascender", tops_asc, ASCENDERS, top), ("descender", bottoms_desc, DESCENDERS, bottom)):
            if char in members:
                values.append(edge)
                from_ink[name] = from_ink[name] and clean
        if char in ON_BASELINE:
            bottoms.append(bottom)
    # Samples within a pixel or two per hundred of one another are one edge; big type resolves its edges to a fraction of that.
    tolerance = max(0.75, 0.02 * h)
    base = _agreed(_consensus(bottoms, tolerance))
    if base is None:
        return None
    baseline = base["value"]
    # One glyph of a class is enough where it was read from its own ink, or where every glyph standing on
    # the baseline agrees, which the recogniser's boxes do when they sit on their letters.
    aligned = base["support"] == base["total"] >= 3
    tops = {name: _agreed(_consensus(values, tolerance), aligned or from_ink[name]) for name, values in (("cap", tops_cap), ("x", tops_x), ("ascender", tops_asc))}
    descender = _agreed(_consensus(bottoms_desc, tolerance), aligned or from_ink["descender"])
    cap = baseline - tops["cap"]["value"] if tops["cap"] else None
    xh = baseline - tops["x"]["value"] if tops["x"] else None
    # What no face draws: capitals under a third of their line's box, or lowercase as tall as them.
    if cap is not None and not 0.3 * h <= cap <= h + 1:
        cap, tops["cap"] = None, None
    if xh is not None and not 0.2 * h <= xh <= h + 1:
        xh, tops["x"] = None, None
    if cap is not None and xh is not None and not 0.45 <= xh / cap <= 0.9:
        # One of the two read another letter's edge: the one fewer glyphs agree on goes, and both when as many agree on each.
        cap_support, x_support = tops["cap"]["support"], tops["x"]["support"]
        if cap_support <= x_support:
            cap, tops["cap"] = None, None
        if x_support <= cap_support:
            xh, tops["x"] = None, None
    reference = xh or cap
    # Across the line's own columns: the margin can hold the edge of whatever stands beside it.
    stems = _stems(coverage[:, columns[0]: columns[1]], baseline - y0, reference) if reference else []
    found = {"baseline": base, "cap": tops["cap"], "x": tops["x"], "ascender": tops["ascender"], "descender": descender}
    return {
        "baselineY": round(baseline, 3),
        "capHeightPx": round(cap, 3) if cap is not None else None,
        "xHeightPx": round(xh, 3) if xh is not None else None,
        "ascenderPx": round(baseline - tops["ascender"]["value"], 3) if tops["ascender"] else None,
        "descenderPx": round(descender["value"] - baseline, 3) if descender else None,
        "stemPx": round(float(np.median(stems)), 3) if len(stems) >= 3 else None,
        # How many glyphs of each class were read, how many agree on the edge given, and how far apart those lie.
        "samples": {"baseline": len(bottoms), "cap": len(tops_cap), "x": len(tops_x), "stems": len(stems)},
        # How many letters were read from their own ink rather than from the middle of the recogniser's box for them.
        "lettersFromInk": int(sum(exact)),
        "letters": len(letters),
        "agreeing": {name: (value["support"] if value else 0) for name, value in found.items()},
        "spread": {name: round(value["spread"], 3) for name, value in found.items() if value},
    }


def _letter_ink(coverage, band, columns, boxes):
    """
    Each letter's own ink, as a coverage profile down the region's rows; None
    for a letter whose ink cannot be told from a neighbour's.

    The runs of ink connected in the line's rows are its letters' strokes.
    The parts of one letter — the dot over an i, an accent — stand wholly
    above or below its body and are put together; a kerned neighbour that
    reaches over another letter ("To") does not. The groups are then matched
    to the letters read, in order (`_match`): letters that touch ("To" in a
    heavy face) share a group and are left to their boxes, and a letter in
    two pieces gets both. `boxes` are the letters' (left, right) columns as
    the recogniser put them, relative to `columns`.
    """
    (r0, r1), (c0, c1) = band, columns
    inked = (coverage[r0: r1 + 1, c0:c1] >= 0.5).astype(np.uint8)
    found, labels, stats, _ = cv2.connectedComponentsWithStats(inked, connectivity=8)
    # Compression leaves specks of ink no letter drew.
    speck = max(3.0, 0.005 * (r1 - r0 + 1) ** 2)
    pieces = sorted(
        (int(stats[k, cv2.CC_STAT_LEFT]), int(stats[k, cv2.CC_STAT_LEFT] + stats[k, cv2.CC_STAT_WIDTH]) - 1,
         int(stats[k, cv2.CC_STAT_TOP]), int(stats[k, cv2.CC_STAT_TOP] + stats[k, cv2.CC_STAT_HEIGHT]) - 1, k)
        for k in range(1, found) if stats[k, cv2.CC_STAT_AREA] >= speck
    )
    groups = []
    for left, right, top, bottom, label in pieces:
        if groups:
            # A letter's body is its tallest part; a dot or an accent stands wholly above or below it, over it.
            body = groups[-1]["body"]
            overlap = min(right, body[1]) - max(left, body[0]) + 1
            apart = bottom < body[2] or top > body[3]
            if apart and overlap >= 0.5 * min(right - left + 1, body[1] - body[0] + 1):
                groups[-1]["labels"].append(label)
                groups[-1]["span"] = (min(left, groups[-1]["span"][0]), max(right, groups[-1]["span"][1]))
                if bottom - top > body[3] - body[2]:
                    groups[-1]["body"] = (left, right, top, bottom)
                continue
        groups.append({"body": (left, right, top, bottom), "span": (left, right), "labels": [label]})
    matched = _match([g["span"] for g in groups], boxes)
    if matched is None:
        return None
    kernel = np.ones((3, 3), np.uint8)
    profiles = []
    for owned in matched:
        if owned is None:
            profiles.append(None)
            continue
        parts = [label for k in owned for label in groups[k]["labels"]]
        span = (min(groups[k]["span"][0] for k in owned), max(groups[k]["span"][1] for k in owned))
        # The letter's pixels and the anti-aliased pixel around them, and nothing of its neighbours'.
        a, b = max(0, span[0] - 1), min(c1 - c0, span[1] + 2)
        mask = np.zeros((coverage.shape[0], b - a), np.uint8)
        mask[r0: r1 + 1] = np.isin(labels[:, a:b], parts)
        mask = cv2.dilate(mask, kernel)
        profiles.append((coverage[:, c0 + a: c0 + b] * mask).max(axis=1))
    return profiles


# What matching two or three letters to one group of ink, or one letter to two, costs over matching one to one,
# in letter widths: enough that the match takes them only where the positions ask for it.
UNEVEN_MATCH = 0.3


def _match(spans, boxes):
    """
    Which groups of ink are which letter: for each letter, the indices of the
    groups that are its own ink, or None where it shares a group.

    An alignment in order, by dynamic programming over where the letters'
    boxes and the groups' spans sit: one letter to one group, two or three
    letters to one (letters that touch), one letter to two groups (a letter
    in pieces). The recogniser's boxes can sit half a letter off, and often
    all to one side, so the boxes are first moved by their median offset to
    the ink. None when the reading and the ink disagree by more than a few
    letters.
    """
    n, m = len(boxes), len(spans)
    if n == 0 or m == 0 or abs(n - m) > max(2, n // 6):
        return None
    width = float(np.median([b - a + 1 for a, b in spans]))
    centres = np.array([(a + b) / 2.0 for a, b in spans])
    shift = float(np.median([centres[np.argmin(np.abs(centres - (a + b) / 2.0))] - (a + b) / 2.0 for a, b in boxes]))
    boxes = [(a + shift, b + shift) for a, b in boxes]

    def cost(first, last, g_first, g_last, uneven):
        return (abs(boxes[first][0] - spans[g_first][0]) + abs(boxes[last][1] - spans[g_last][1])) / (2.0 * width) + uneven * UNEVEN_MATCH

    moves = ((1, 1), (2, 1), (3, 1), (1, 2))
    best = {(0, 0): (0.0, None)}
    for i in range(n + 1):
        for j in range(m + 1):
            if (i, j) not in best:
                continue
            here = best[(i, j)][0]
            for di, dj in moves:
                if i + di > n or j + dj > m:
                    continue
                total = here + cost(i, i + di - 1, j, j + dj - 1, (di - 1) + (dj - 1))
                key = (i + di, j + dj)
                if key not in best or total < best[key][0]:
                    best[key] = (total, (i, j, di, dj))
    if (n, m) not in best:
        return None
    owned = [None] * n
    key = (n, m)
    while best[key][1] is not None:
        i, j, di, dj = best[key][1]
        if di == 1:
            owned[i] = list(range(j, j + dj))
        key = (i, j)
    return owned


def _consensus(values, tolerance):
    """
    What most of one class of glyphs agree on: the largest group of samples
    within `tolerance` of one of them, its median, how many it holds and how
    far apart they lie.

    A recogniser's glyph box that drifted onto a neighbour reads the
    neighbour's edge — in small interface type, an "r" boxed over the next
    line's ascender, a "D" over the gap beside it — so the samples are not
    averaged: the largest group decides, and the rest are set aside.
    """
    if not values:
        return None
    ordered = sorted(values)
    best = []
    for anchor in ordered:
        group = [value for value in ordered if abs(value - anchor) <= tolerance]
        if len(group) > len(best) or (len(group) == len(best) and group[-1] - group[0] < best[-1] - best[0]):
            best = group
    return {"value": float(np.median(best)), "support": len(best), "total": len(ordered), "spread": float(best[-1] - best[0])}


def _agreed(found, alone=False):
    """
    An edge at least two glyphs and most of their class agree on; or the only
    one of its class, when `alone` allows it. Half is not most: two boxes that
    drifted onto ascenders agree with each other as well as two on the x-height do.
    """
    if found is None:
        return None
    if found["support"] >= 2 and 2 * found["support"] > found["total"]:
        return found
    return found if alone and found["total"] == 1 else None


def _stems(coverage, baseline, reference):
    """
    The widths of the line's straight vertical strokes, one per stroke, from
    the middle of the lowercase (or the capitals) where nothing but stems,
    bowls and diagonals cross.

    The line is read whole rather than glyph by glyph: the recogniser's glyph
    boxes can sit half a letter off their letters even in large type, and a
    stroke cut by a box's edge is measured short. Each row's runs of ink are
    followed down the band into strokes; a stroke counts when it runs
    straight — upright or slanted as italics are, not curving like a bowl's
    side or leaning like a diagonal's — and its width is the ink across it,
    row by row, as area rather than a threshold so blur does not widen it.
    """
    first, last = int(round(baseline - 0.7 * reference)), int(round(baseline - 0.3 * reference))
    if first < 0 or last >= coverage.shape[0] or last - first < 2:
        return []
    strokes, open_strokes = [], []
    for row in range(first, last + 1):
        values = coverage[row]
        found = []
        for start, end in _runs(values >= 0.25):
            if start == 0 or end == len(values) - 1:
                continue
            piece = values[start - 1: end + 2]
            width = float(piece.sum())
            if width <= 0.35 * reference:
                found.append((float((piece * np.arange(start - 1, end + 2)).sum() / width), width))
        continuing = []
        for centre, width in found:
            chain = next((c for c in open_strokes if abs(c[-1][1] - centre) <= 0.5 * max(1.0, width)), None)
            if chain is None:
                chain = []
                strokes.append(chain)
            else:
                open_strokes.remove(chain)
            chain.append((row, centre, width))
            continuing.append(chain)
        open_strokes = continuing
    widths = []
    for chain in strokes:
        if len(chain) < max(3, 0.25 * (last - first + 1)):
            continue
        rows = np.array([r for r, _, _ in chain], dtype=float)
        centres = np.array([c for _, c, _ in chain])
        slope, intercept = np.polyfit(rows, centres, 1)
        straight = np.abs(centres - (slope * rows + intercept)).max() <= max(0.75, 0.02 * reference)
        if straight and abs(slope) <= 0.25:
            widths.append(float(np.median([w for _, _, w in chain])))
    return widths


def spaced_words(glyphs, spaces=None):
    """
    Glyphs grouped into words, at spaces the recogniser wrote and at gaps it did not.

    Recognition drops the space between two words set close together —
    "NEWFEATURE" — while the glyph boxes still show it: the gap between the W
    and the F is several times any gap inside a word. A gap counts as a space
    when it is a clear fraction of the type's height and well above the line's
    own letter spacing, so type that is tracked out wide is not cut into letters.
    Where the gaps were measured in the pixels (`pixel_spaces`), those decide.
    """
    visible = [g for g in glyphs if not g["char"].isspace()]
    if spaces is not None:
        # Measured in the pixels: the words break after exactly these letters.
        words, current = [], []
        for k, glyph in enumerate(visible):
            current.append(glyph)
            if k in spaces:
                words.append(current)
                current = []
        if current:
            words.append(current)
        return words
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
    if start is not None and start == end:
        # Whole on the one frame, and absent on the frame beside it: the line
        # pops on (or off) inside the shot, within a frame, with no boundary.
        index_of = {s["frame"]: i for i, s in enumerate(samples)}
        i = index_of.get(start)
        beside = start + 1 if leaving else start - 1
        j = index_of.get(beside)
        if i is not None and j is not None and visibility[i] >= 0.9 * final and visibility[j] < 0.05 * final:
            return {"kind": "instant", "frames": [start, start]}
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
