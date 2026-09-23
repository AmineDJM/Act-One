"""
A film whose every fact is known, for testing the analyzer against the truth.

    python3 -m actone_forensics.synthetic OUT.mp4

Writes a seven-second 320x180 film at exactly 25 frames per second with a
48 kHz mono soundtrack, and prints the ground truth as JSON. Everything in it
is placed on a frame or a sample by construction, so a measurement can be
checked to the frame rather than eyeballed:

    frames  0–39   dark blue field, "LAUNCH DAY" in white bold, fully visible
    frame   40     hard cut to an orange field
    frames 50–59   "NEW FEATURE" (bold) fades in, linearly, fully visible from 60
    frame   65     "Deploy in minutes" (regular weight) cuts in below it
    frames 80–89   the picture fades linearly to black; black from 90 to 99
    frame  100     hard cut to a slate field, "SEARCH" in white bold, tracked
                   out by 0.3 em
    frame  125     a wipe completed within the frame: its top two thirds are
                   already the next picture — a teal field with a white card
                   patterned in squares — its bottom third still the slate;
                   the next picture is whole from 126
    frames 140–149 the field behind the card cross-fades, linearly, to purple;
                   the card stays: a cross-fade inside the shot, not a boundary
    frame  162     the whole picture brightens in one frame, nothing moving:
                   the same picture, not a cut; until the end at frame 174

    0.0–1.0 s      440 Hz tone
    1.0–1.6 s      digital silence
    1.6 s          a 5 ms click, on the cut
    2.0–3.2 s      880 Hz tone
    3.2–7.0 s      digital silence

The type is set in DejaVu Sans, shipped beside this module so the film is the
same film on every machine. Its geometry — baseline, cap height, x-height —
is taken from the clean render, before the film is encoded, so the truth
does not depend on how the analyzer measures it.
"""
import json
import os
import sys
from fractions import Fraction

import av
import numpy as np
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS, FRAMES = 320, 180, 25, 175
RATE = 48000
BLUE = (20, 32, 92)
ORANGE = (236, 118, 36)
SLATE = (38, 44, 54)
TEAL = (20, 140, 140)
PURPLE = (110, 40, 160)
FONTS = {
    "bold": (os.path.join(os.path.dirname(__file__), "fonts", "DejaVuSans-Bold.ttf"), 700),
    "book": (os.path.join(os.path.dirname(__file__), "fonts", "DejaVuSans.ttf"), 400),
}
# Where each line sits: its text, face, size in pixels, the vertical centre
# of its ink, and the space added after every letter (tracking), in pixels.
LINES = {
    "launch": ("LAUNCH DAY", "bold", 30, HEIGHT / 2, 0),
    "feature": ("NEW FEATURE", "bold", 28, HEIGHT / 2, 0),
    "deploy": ("Deploy in minutes", "book", 18, 140, 0),
    "search": ("SEARCH", "bold", 44, HEIGHT / 2, 13),
}
# Glyphs whose tops sit on the cap line or the x-height without overshoot,
# and whose bottoms sit on the baseline.
FLAT_CAPS = set("BDEFHIKLMNPRTUVWXYZ")
FLAT_X = set("mnruvwxz")
ON_BASELINE = set("ABDEFHIKLMNPRTXZhiklmnrxz")


def _font(face, size):
    path, _ = FONTS[face]
    if not os.path.exists(path):
        raise SystemExit(f"the synthetic film's font is missing: {path}")
    return ImageFont.truetype(path, size)


def _starts(draw, font, text, tracking):
    """Where each letter is drawn from, left to right, with the tracking after every letter."""
    starts = []
    for index, char in enumerate(text):
        starts.append(round(draw.textlength(text[:index], font=font) + index * tracking))
    return starts


def place(spec, canvas=(WIDTH, HEIGHT)):
    """
    A line of type drawn alone on a canvas: its coverage layer, and each
    letter with the columns it was drawn from and to and its own ink.

    `spec` is (text, face, size in pixels, vertical centre of its ink,
    tracking in pixels); the line is centred across the canvas. Each letter
    is drawn by itself at the whole pixel its pen position rounds to, so the
    hinted outlines sit on the pixel grid, and the layer is their union: the
    picture is exactly its letters, and each letter's ink is known apart from
    its neighbours' — an i's dot can overhang the next letter's advance.
    Each letter's ink is (left, top, coverage) of its own drawing, or None
    for a space.
    """
    text, face, size, centre, tracking = spec
    width, height = canvas
    font = _font(face, size)
    draw = ImageDraw.Draw(Image.new("L", (1, 1)))
    starts = _starts(draw, font, text, tracking)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    x = int(round((width - (right - left) - tracking * (len(text) - 1)) / 2 - left))
    y = int(round(centre - (bottom - top) / 2 - top))
    layer = np.zeros((height, width), np.float32)
    letters = []
    for char, start in zip(text, starts):
        ink = None
        if not char.isspace():
            l, t, r, b = draw.textbbox((x + start, y), char, font=font)
            # A pixel of margin about the box the face gives, for the anti-aliased edge.
            l, t, r, b = max(0, l - 2), max(0, t - 2), min(width, r + 2), min(height, b + 2)
            if r > l and b > t:
                piece = Image.new("L", (r - l, b - t), 0)
                ImageDraw.Draw(piece).text((x + start - l, y - t), char, fill=255, font=font)
                own = np.asarray(piece, dtype=np.float32) / 255.0
                layer[t:b, l:r] = np.maximum(layer[t:b, l:r], own)
                ink = (l, t, own)
        letters.append((char, x + start, x + start + draw.textlength(char, font=font), ink))
    return layer, letters, font


_LAYERS = {}


def _layer(key):
    if key not in _LAYERS:
        _LAYERS[key] = place(LINES[key])[0]
    return _LAYERS[key]


def geometry(spec, canvas=(WIDTH, HEIGHT)):
    """
    Where the line's type actually is in the clean render: the rows its
    flat-topped capitals and lowercase reach, and the row its baseline
    glyphs stand on, each read from the letter's own drawing and to a
    fraction of a pixel from the coverage of its edge row. The truth the
    analyzer's measurements are checked against.
    """
    text, face, size, _, _ = spec
    _, letters, font = place(spec, canvas)
    tops_cap, tops_x, bottoms = [], [], []
    for char, _, _, ink in letters:
        if ink is None:
            continue
        _, offset, own = ink
        rows = own.max(axis=1)
        inked = np.nonzero(rows > 0.02)[0]
        if len(inked) == 0:
            continue
        first, last = int(inked[0]), int(inked[-1])
        # A top edge lies inside its first inked row by the share of that row left uncovered.
        top, bottom = offset + first + (1.0 - rows[first]), offset + last + rows[last]
        if char in FLAT_CAPS:
            tops_cap.append(top)
        if char in FLAT_X:
            tops_x.append(top)
        if char in ON_BASELINE:
            bottoms.append(bottom)
    baseline = float(np.median(bottoms)) if bottoms else None
    _, weight = FONTS[face]
    cap_design = (font.getbbox("H")[3] - font.getbbox("H")[1])
    return {
        "face": font.getname()[0] + " " + font.getname()[1],
        "weightClass": weight,
        "sizePx": size,
        "baselineY": round(baseline, 3) if baseline is not None else None,
        "capHeightPx": round(baseline - float(np.median(tops_cap)), 3) if tops_cap and baseline is not None else None,
        "xHeightPx": round(baseline - float(np.median(tops_x)), 3) if tops_x and baseline is not None else None,
        # The face's own proportions: DejaVu Sans's cap height is 0.729 of the em, its x-height 0.547.
        "capHeightDesignPx": round(0.729 * size, 3),
        "xHeightDesignPx": round(0.547 * size, 3),
        "hintedCapHeightPx": int(cap_design),
    }


TRUTH = {
    "frames": FRAMES,
    "fps": FPS,
    "width": WIDTH,
    "height": HEIGHT,
    "cut": {"lastOutgoing": 39, "firstIncoming": 40},
    "fadeOut": {"first": 80, "black": 90},
    "texts": [
        {"text": "LAUNCH DAY", "firstVisible": 0, "lastVisible": 39},
        {"text": "NEW FEATURE", "fadeIn": [50, 59], "fullyVisible": 60, "lastVisible": 89},
        {"text": "Deploy in minutes", "firstVisible": 65, "fullyVisible": 65, "lastVisible": 89},
        {"text": "SEARCH", "firstVisible": 100, "fullyVisible": 100, "lastVisible": 124, "trackingPx": 13},
    ],
    "cut2": {"lastOutgoing": 99, "firstIncoming": 100},
    "wipe": {"lastOutgoing": 124, "firstIncoming": 126},
    "crossfade": {"lastOutgoing": 139, "firstIncoming": 150},
    "brightens": 162,
    "audio": {
        "rate": RATE,
        "tones": [{"hz": 440, "start": 0.0, "end": 1.0}, {"hz": 880, "start": 2.0, "end": 3.2}],
        "silences": [[1.0, 1.6], [3.2, 7.0]],
        "click": 1.6,
    },
}


def _card():
    """A white card patterned in dark squares, so the picture it is on has edges and corners to follow."""
    card = np.zeros((HEIGHT, WIDTH), np.float32)
    card[50:130, 100:220] = 1.0
    for row in range(58, 122, 16):
        for column in range(108, 212, 16):
            if ((row - 58) // 16 + (column - 108) // 16) % 2 == 0:
                card[row: row + 8, column: column + 8] = 0.0
    return card


def _on_field(field, card, ink=(255.0, 255.0, 255.0), square=(20.0, 24.0, 30.0)):
    """The card on a field: white where the card is, its squares dark, the field around it."""
    inside = np.zeros((HEIGHT, WIDTH), bool)
    inside[50:130, 100:220] = True
    picture = np.empty((HEIGHT, WIDTH, 3), np.float32)
    picture[:] = np.array(field, np.float32)
    picture[inside & (card > 0.5)] = np.array(ink, np.float32)
    picture[inside & (card <= 0.5)] = np.array(square, np.float32)
    return picture


def frame_rgb(index):
    launch, feature, deploy = _layer("launch"), _layer("feature"), _layer("deploy")
    if index >= 125:
        card = _card()
        if index < 140:
            picture = _on_field(TEAL, card)
        elif index < 150:
            mix = (index - 139) / 11.0
            picture = _on_field(tuple((1 - mix) * t + mix * p for t, p in zip(TEAL, PURPLE)), card)
        elif index < 162:
            picture = _on_field(PURPLE, card)
        else:
            # Everything lighter by the same amount; nothing moves.
            picture = np.minimum(255.0, _on_field(PURPLE, card) + 70.0)
        if index == 125:
            slate = np.array(SLATE, np.float32)[None, None, :] * (1 - _layer("search")[..., None]) + 255.0 * _layer("search")[..., None]
            picture[120:] = slate[120:]
        return np.clip(np.rint(picture), 0, 255).astype(np.uint8)
    if index >= 100:
        picture = np.array(SLATE, np.float32)[None, None, :] * (1 - _layer("search")[..., None]) + 255.0 * _layer("search")[..., None]
        return np.clip(np.rint(picture), 0, 255).astype(np.uint8)
    if index < 40:
        field, alpha = np.array(BLUE, np.float32), launch
    else:
        field = np.array(ORANGE, np.float32)
        if index < 50:
            alpha = np.zeros_like(feature)
        elif index < 60:
            alpha = feature * ((index - 49) / 11.0)
        else:
            alpha = feature
        if index >= 65:
            alpha = np.maximum(alpha, deploy)
    picture = field[None, None, :] * (1 - alpha[..., None]) + 255.0 * alpha[..., None]
    if index >= 80:
        picture = picture * max(0.0, 1 - (index - 79) / 11.0) if index < 90 else picture * 0
    return np.clip(np.rint(picture), 0, 255).astype(np.uint8)


def soundtrack():
    t = np.arange(int(RATE * FRAMES / FPS)) / RATE
    signal = np.zeros_like(t, dtype=np.float32)
    for tone in TRUTH["audio"]["tones"]:
        inside = (t >= tone["start"]) & (t < tone["end"])
        # 10 ms raised-cosine edges, so a tone's own start is not a click.
        ramp = np.minimum(1, np.minimum(t - tone["start"], tone["end"] - t) / 0.01)
        envelope = np.where(inside, 0.5 - 0.5 * np.cos(np.pi * np.clip(ramp, 0, 1)), 0)
        signal += (0.3 * envelope * np.sin(2 * np.pi * tone["hz"] * t)).astype(np.float32)
    click = int(TRUTH["audio"]["click"] * RATE)
    signal[click: click + int(0.005 * RATE)] += 0.8 * np.hanning(int(0.005 * RATE)).astype(np.float32)
    return signal


def write(path):
    container = av.open(path, "w")
    video = container.add_stream("libx264", rate=FPS)
    video.width, video.height, video.pix_fmt = WIDTH, HEIGHT, "yuv420p"
    video.time_base = Fraction(1, 12800)
    # Every frame a keyframe-capable frame, no B-frames: the decode order is the display order.
    video.options = {"crf": "12", "bf": "0", "g": "25", "colorprim": "bt709", "transfer": "bt709", "colormatrix": "bt709"}
    audio = container.add_stream("aac", rate=RATE, layout="mono")
    for index in range(FRAMES):
        frame = av.VideoFrame.from_ndarray(frame_rgb(index), format="rgb24")
        frame.pts = index * 512
        frame.time_base = Fraction(1, 12800)
        for packet in video.encode(frame):
            container.mux(packet)
    for packet in video.encode():
        container.mux(packet)
    samples = soundtrack()
    for start in range(0, len(samples), 1024):
        chunk = samples[start: start + 1024]
        if len(chunk) < 1024:
            chunk = np.pad(chunk, (0, 1024 - len(chunk)))
        frame = av.AudioFrame.from_ndarray(chunk[None, :], format="fltp", layout="mono")
        frame.sample_rate = RATE
        frame.pts = start
        frame.time_base = Fraction(1, RATE)
        for packet in audio.encode(frame):
            container.mux(packet)
    for packet in audio.encode():
        container.mux(packet)
    container.close()


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        raise SystemExit("usage: python3 -m actone_forensics.synthetic OUT.mp4")
    write(argv[0])
    truth = dict(TRUTH, texts=[dict(entry, geometry=geometry(LINES[key])) for entry, key in zip(TRUTH["texts"], LINES)])
    print(json.dumps(truth))


if __name__ == "__main__":
    main()
