"""
Whether the library's pre-roll claims match the audio.

Every sample in the library records a `preRoll`: how long the file plays
before its transient. The sound director subtracts it when placing a cue, so
an impact with 40ms of air in front of it, asked for at 8.0s, is started at
7.96s and HEARD at 8.0s. That only works if the number is true.

Nothing has ever checked. The numbers were written by hand next to the
filenames, and a wrong one is invisible: the film sounds slightly off and
every timeline in the system says it is exactly right.

So this measures the attack in each actual file — first sample that crosses a
fraction of the file's own peak — and prints it against the claim.

Usage: preroll_check.py STORAGE_DIR
"""
import json
import subprocess
import sys
import wave
import array
from pathlib import Path

# The claims, mirrored from packages/sound/src/library.ts. Kept here rather
# than parsed out of TypeScript: a measurement tool that imports the thing it
# is auditing can be fooled by the same mistake twice.
CLAIMS = {
    "library/sfx/impact-soft.wav": 0.04,
    "library/sfx/impact-hard.wav": 0.06,
    "library/sfx/sub-drop.wav": 0.08,
    "library/sfx/riser-short.wav": 0.0,
    "library/sfx/riser-long.wav": 0.0,
    "library/sfx/whoosh-short.wav": 0.12,
    "library/sfx/whoosh-long.wav": 0.2,
    "library/sfx/ui-click.wav": 0.0,
    "library/sfx/ui-confirm.wav": 0.0,
    "library/sfx/texture-air.wav": 0.0,
    "library/sfx/logo-warm.wav": 0.05,
    "library/sfx/logo-clean.wav": 0.05,
}

# A tenth of the file's own peak. High enough to ignore the noise floor and a
# fade-in's first whisper, low enough to catch the start of a transient rather
# than its summit — the summit is what a listener hears as "late".
THRESHOLD = 0.1


def attack_seconds(path: Path) -> float | None:
    with wave.open(str(path), "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        frames = handle.readframes(handle.getnframes())

    if width == 2:
        samples = array.array("h", frames)
    elif width == 4:
        samples = array.array("i", frames)
    else:
        return None

    if channels > 1:
        samples = samples[::channels]
    if not samples:
        return None

    peak = max(abs(value) for value in samples)
    if peak == 0:
        return None

    limit = peak * THRESHOLD
    for index, value in enumerate(samples):
        if abs(value) >= limit:
            return index / rate
    return None


def main() -> None:
    storage = Path(sys.argv[1] if len(sys.argv) > 1 else ".act-one-demo/storage")
    rows = []
    for key, claimed in sorted(CLAIMS.items()):
        path = storage / key
        if not path.exists():
            print(f"{key:36s} MISSING")
            continue
        measured = attack_seconds(path)
        if measured is None:
            print(f"{key:36s} unreadable")
            continue
        drift_ms = (measured - claimed) * 1000
        flag = "  <-- off by more than a frame" if abs(drift_ms) > 33 else ""
        print(f"{key:36s} claimed {claimed*1000:6.0f}ms  measured {measured*1000:6.0f}ms  drift {drift_ms:+7.0f}ms{flag}")
        rows.append({"key": key, "claimedMs": claimed * 1000, "measuredMs": measured * 1000, "driftMs": drift_ms})

    if "--json" in sys.argv:
        Path(sys.argv[sys.argv.index("--json") + 1]).write_text(json.dumps(rows, indent=2))


main()
