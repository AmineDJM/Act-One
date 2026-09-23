"""
A film whose every fact is known, for testing the analyzer against the truth.

    python3 -m actone_forensics.synthetic OUT.mp4

Writes a four-second 320x180 film at exactly 25 frames per second with a
48 kHz mono soundtrack, and prints the ground truth as JSON. Everything in it
is placed on a frame or a sample by construction, so a measurement can be
checked to the frame rather than eyeballed:

    frames  0–39   dark blue field, "LAUNCH DAY" in white, fully visible
    frame   40     hard cut to an orange field
    frames 50–59   "NEW FEATURE" fades in, linearly, fully visible from 60
    frames 80–89   the picture fades linearly to black; black from 90 to 99

    0.0–1.0 s      440 Hz tone
    1.0–1.6 s      digital silence
    1.6 s          a 5 ms click, on the cut
    2.0–3.2 s      880 Hz tone
    3.2–4.0 s      digital silence
"""
import json
import sys
from fractions import Fraction

import av
import numpy as np
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS, FRAMES = 320, 180, 25, 100
RATE = 48000
BLUE = (20, 32, 92)
ORANGE = (236, 118, 36)
FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]

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
    ],
    "audio": {
        "rate": RATE,
        "tones": [{"hz": 440, "start": 0.0, "end": 1.0}, {"hz": 880, "start": 2.0, "end": 3.2}],
        "silences": [[1.0, 1.6], [3.2, 4.0]],
        "click": 1.6,
    },
}


def _font(size):
    for path in FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    # Pillow's own face, scalable since 10.1: always present, less pretty, still legible.
    return ImageFont.load_default(size=size)


def _text_layer(text, size):
    """White type on transparent, centred: an alpha mask and its colour."""
    layer = Image.new("L", (WIDTH, HEIGHT), 0)
    draw = ImageDraw.Draw(layer)
    font = _font(size)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text(((WIDTH - (right - left)) / 2 - left, (HEIGHT - (bottom - top)) / 2 - top), text, fill=255, font=font)
    return np.asarray(layer, dtype=np.float32) / 255.0


def frame_rgb(index):
    launch = _text_layer("LAUNCH DAY", 30)
    feature = _text_layer("NEW FEATURE", 28)
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
    print(json.dumps(TRUTH))


if __name__ == "__main__":
    main()
