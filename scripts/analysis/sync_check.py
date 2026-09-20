"""
Where a sound actually lands, measured off the finished file.

A mix graph places a sample at a time. That is not the same as the sound being
heard at that time, and the difference is made of three things nobody can see
from the timeline:

  SOURCE ATTACK OFFSET   a sample does not begin at its transient. An impact
                         with 40ms of air in front of it, placed on the frame,
                         is heard 40ms late. The engine already pulls each
                         sample back by the pre-roll recorded in the library,
                         which is a CLAIM about the file — this measures the
                         attack in the actual audio rather than trusting it.

  PIPELINE OFFSET        encode, mux and container timestamps can move the
                         whole track against the picture. A constant offset
                         across every cue is this, and it is invisible in any
                         per-cue check.

  PLACEMENT ERROR        what is left once the other two are accounted for:
                         the cue genuinely being in the wrong place.

So this does not ask "was the sample placed at 22.0s". It asks "where is the
transient in the finished master, and how far is that from the frame it was
supposed to hit" — and then separates the part that is the same for every cue
from the part that is not.

Usage: sync_check.py MASTER.mp4 --cues 23.85,56.70,59.35 [--json OUT.json]
"""
import json
import os
import subprocess
import sys

import numpy as np

FFMPEG = (
    os.environ.get("ACT_ONE_FFMPEG_PATH")
    or os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "node_modules", "ffmpeg-static", "ffmpeg",
    )
)
if not os.path.exists(FFMPEG):
    FFMPEG = "ffmpeg"

SR = 48000


def audio(path):
    """The master's audio as mono float, at the rate it was mixed."""
    out = subprocess.run(
        [FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
         "-map", "a:0", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True,
    )
    if not out.stdout:
        return None
    return np.frombuffer(out.stdout, dtype=np.float32)



def stereo_peak_dbfs(path):
    """
    The peak of the delivered file, not of a mono downmix.

    `audio()` above folds to mono because onset detection wants one signal, and
    a mono fold SUMS the channels: two correlated channels at -6 dBFS each add
    to 0 dBFS, and in float they happily go above it. Reading the peak off that
    signal reported a master at +0.37 dBFS — apparently clipping, alarmingly —
    when the file itself peaked at -1.98 and was never anywhere near the
    ceiling. An instrument that invents a delivery defect costs more than no
    instrument, because somebody then goes and "fixes" a mastering chain that
    was correct.
    """
    out = subprocess.run(
        [FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
         "-map", "a:0", "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True,
    )
    if not out.stdout:
        return None
    channels = np.frombuffer(out.stdout, dtype=np.float32)
    return round(float(20 * np.log10(max(1e-9, np.abs(channels).max()))), 2)


def onset_envelope(x, hop=256, win=1024):
    """
    Spectral flux: how much the spectrum GAINED energy, frame to frame.

    Rectified on purpose. A transient is energy appearing, and counting energy
    disappearing as well puts an onset on the end of every note.
    """
    n = 1 + (len(x) - win) // hop
    if n <= 1:
        return np.zeros(1), hop
    window = np.hanning(win).astype(np.float32)
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, win), strides=(x.strides[0] * hop, x.strides[0])
    ) * window
    mag = np.abs(np.fft.rfft(frames, axis=1))
    flux = np.maximum(0.0, np.diff(mag, axis=0)).sum(axis=1)
    # Normalised so a threshold means the same thing on a quiet film and a loud one.
    if flux.max() > 0:
        flux = flux / flux.max()
    return flux, hop


def nearest_attack(flux, hop, target, window_seconds=0.45, floor=0.08):
    """
    The strongest transient within a window of where the cue was aimed.

    A window rather than a global search: this is asking whether the cue landed,
    not hunting for the loudest moment in the film. Returns None when nothing in
    the window rises above the floor, which is a real answer — it means the cue
    is inaudible there, and a cue nobody can hear is not a cue that is early.
    """
    per = hop / SR
    lo = max(0, int((target - window_seconds) / per))
    hi = min(len(flux), int((target + window_seconds) / per))
    if hi <= lo:
        return None
    segment = flux[lo:hi]
    peak = int(np.argmax(segment))
    if segment[peak] < floor:
        return None
    return (lo + peak) * per


def main():
    path = sys.argv[1]
    cues = []
    if "--cues" in sys.argv:
        raw = sys.argv[sys.argv.index("--cues") + 1]
        cues = [float(v) for v in raw.split(",") if v.strip()]

    x = audio(path)
    if x is None or len(x) == 0:
        print(f"{os.path.basename(path)}: NO AUDIO STREAM")
        sys.exit(2)

    flux, hop = onset_envelope(x)
    rows = []
    for target in cues:
        found = nearest_attack(flux, hop, target)
        rows.append({
            "intendedAt": round(target, 3),
            "attackAt": None if found is None else round(found, 3),
            "offsetMs": None if found is None else round((found - target) * 1000, 1),
        })

    measured = [r["offsetMs"] for r in rows if r["offsetMs"] is not None]
    # The part every cue shares is the pipeline; what remains is placement.
    pipeline = round(float(np.median(measured)), 1) if measured else None
    for r in rows:
        r["placementErrorMs"] = (
            None if r["offsetMs"] is None or pipeline is None else round(r["offsetMs"] - pipeline, 1)
        )

    report = {
        "file": os.path.basename(path),
        "durationSeconds": round(len(x) / SR, 2),
        "peakDbfs": stereo_peak_dbfs(path),
        "cues": rows,
        "pipelineOffsetMs": pipeline,
        "audible": len(measured),
        "requested": len(cues),
    }

    print(f"{report['file']}: {report['durationSeconds']}s  peak {report['peakDbfs']} dBFS")
    for r in rows:
        if r["attackAt"] is None:
            print(f"  {r['intendedAt']:7.2f}s  NO AUDIBLE ATTACK within 450ms")
        else:
            print(
                f"  {r['intendedAt']:7.2f}s  attack at {r['attackAt']:7.3f}s "
                f"offset {r['offsetMs']:+7.1f}ms  placement {r['placementErrorMs']:+7.1f}ms"
            )
    if pipeline is not None:
        print(f"  pipeline offset (median across cues): {pipeline:+.1f}ms")

    if "--json" in sys.argv:
        json.dump(report, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)


if __name__ == "__main__":
    main()
