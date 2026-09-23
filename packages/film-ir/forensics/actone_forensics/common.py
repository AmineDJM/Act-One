"""
Shared pieces of the forensic analyzer.

Every time this analyzer reports is an integer: a frame index into the
decoded video, or a sample index into the decoded audio. Converting those to
seconds is the reader's job and is done with exact rational arithmetic, so
nothing measured here is ever rounded onto a clock it was not observed on.
"""
import json
import math
import sys

ANALYZER_NAME = "actone-forensics"
ANALYZER_VERSION = "1.3.0"


def emit(stage, progress, message=""):
    """One progress line on stdout, for the worker to relay. Never the result."""
    sys.stdout.write(json.dumps({"stage": stage, "progress": round(float(progress), 4), "message": message}) + "\n")
    sys.stdout.flush()


def r(value, digits=4):
    """Round for storage, or None for anything that is not a finite number."""
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return round(v, digits)


def rl(values, digits=4):
    return [r(v, digits) for v in values]


def hex_from_rgb(rgb):
    red, green, blue = (int(max(0, min(255, round(c)))) for c in rgb)
    return f"#{red:02x}{green:02x}{blue:02x}"


def levenshtein(a, b):
    """Edit distance, iteratively, for the short strings OCR produces."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def text_similarity(a, b):
    a, b = normalise_text(a), normalise_text(b)
    if not a and not b:
        return 1.0
    return 1.0 - levenshtein(a, b) / max(len(a), len(b))


def normalise_text(text):
    return " ".join(str(text).lower().split())
