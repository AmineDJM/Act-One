"""
The words in one picture, where they are.

For a still rather than a film: a product capture whose words have to be
checked before anything redraws them. Small interface type is read better a
little larger, so a picture narrower than 1600 px is read at twice its size;
the boxes are given back in the picture's own pixels either way.

    python -m actone_forensics.read_text <image>

prints one JSON array: [{"text", "box": {"x0", "y0", "x1", "y1"}, "score"}].
"""
import json
import sys

import cv2

from .text import OcrEngine

UPSCALE_BELOW = 1600


def main(argv):
    if len(argv) != 2:
        print("usage: python -m actone_forensics.read_text <image>", file=sys.stderr)
        return 2
    image = cv2.imread(argv[1], cv2.IMREAD_COLOR)
    if image is None:
        print(f"cannot read {argv[1]}", file=sys.stderr)
        return 1
    factor = 2 if image.shape[1] < UPSCALE_BELOW else 1
    if factor != 1:
        image = cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
    lines = OcrEngine().read(image, 1 / factor)
    out = []
    for line in lines:
        xs = [p[0] for p in line["poly"]]
        ys = [p[1] for p in line["poly"]]
        out.append({
            "text": line["text"],
            "box": {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)},
            "score": line["score"],
        })
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
