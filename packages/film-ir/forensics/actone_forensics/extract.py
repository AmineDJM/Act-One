"""
Exact frames, by index, from the same decoder the analyzer used.

    python3 -m actone_forensics.extract FILM.mp4 OUT_DIR FIRST LAST [--width 960]

Writes frame-<index>.jpg for every frame FIRST..LAST inclusive and a
frames.json listing each index with its presentation timestamp, so a frame a
model is shown is the frame the measurements call by that number.
"""
import argparse
import json
import os
from fractions import Fraction

import cv2

from .video import Decoder, _size_for


def main(argv=None):
    parser = argparse.ArgumentParser(prog="actone_forensics.extract")
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("first", type=int)
    parser.add_argument("last", type=int)
    parser.add_argument("--width", type=int, default=960)
    args = parser.parse_args(argv)
    if args.first < 0 or args.last < args.first:
        raise SystemExit("frames must be 0 <= first <= last")
    if args.last - args.first > 600:
        raise SystemExit("at most 600 frames at a time")
    os.makedirs(args.output, exist_ok=True)
    decoder = Decoder(args.input)
    width, height = _size_for(decoder.width, decoder.height, min(args.width, decoder.width))
    base = decoder.stream.time_base
    listed = []
    for index, frame in enumerate(decoder.frames()):
        if index < args.first:
            continue
        if index > args.last:
            break
        path = os.path.join(args.output, f"frame-{index}.jpg")
        cv2.imwrite(path, decoder.bgr(frame, width, height), [cv2.IMWRITE_JPEG_QUALITY, 90])
        seconds = float(Fraction(int(frame.pts)) * base) if frame.pts is not None else None
        listed.append({"frame": index, "pts": str(int(frame.pts)) if frame.pts is not None else None, "seconds": seconds, "file": os.path.basename(path)})
    decoder.close()
    with open(os.path.join(args.output, "frames.json"), "w") as handle:
        json.dump(listed, handle)


if __name__ == "__main__":
    main()
