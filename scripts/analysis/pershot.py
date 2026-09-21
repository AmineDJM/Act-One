"""
Per-shot motion, colour and detail, so a whole-film metric can be blamed on a shot.

WHY THIS EXISTS. `profile.py` reports one `staticShare` for the film, and that
number sat at 0.303 against a 0.132-0.254 benchmark band through several
iterations without moving. It is an average, and the average was hiding the
shape of the problem: the motion was not thinly spread across fifteen shots, it
was absent from nine of them and fine in six. A film that opens frozen and ends
on three consecutive stills reads nothing like one that is evenly a bit slow,
and the whole-film number cannot tell those apart.

So this prints the same measurements per shot. The threshold below is the one
`profile.py` uses, deliberately, so a row here adds up to the number there.

    python3 scripts/analysis/pershot.py .renders/launch.mp4

`edgeE` is the share of pixels Canny calls an edge — a rough stand-in for how
much detail is in the frame, which is what separates a shot holding a real
capture from one holding a word on a field.
"""
import sys

import cv2
import numpy as np

# The film's cut list, in seconds. Kept here rather than read from the scene
# graph because this has to be runnable against a reference film too, and a
# reference has no graph.
SHOTS = [
    ('l1', 0, 3.6), ('l2', 3.6, 8.4), ('l3', 8.4, 13.6), ('l4', 13.6, 17.0),
    ('l5', 17.0, 19.6), ('l6', 19.6, 24.2), ('l7', 24.2, 26.8), ('l8', 26.8, 31.4),
    ('l9', 31.4, 33.4), ('l10', 33.4, 38.0), ('l11', 38.0, 43.2), ('l12', 43.2, 46.4),
    ('l13', 46.4, 50.8), ('l14', 50.8, 54.0), ('l15', 54.0, 57.8),
]

# Below this mean flow magnitude a frame counts as static. Same value as profile.py.
STATIC_BELOW = 0.35


def measure(path: str) -> None:
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        # Downscaled first: optical flow over 1080p fifteen hundred times is
        # minutes of waiting for a number that does not change.
        frames.append(cv2.resize(frame, (320, 180)))
    cap.release()

    print(f"=== {path}: {len(frames)} frames @ {fps:.1f}fps ===")
    print(f"{'shot':5} {'motion':>7} {'static%':>8} {'hues':>5} {'edgeE':>7}")
    for shot_id, start, end in SHOTS:
        first, last = int(start * fps), min(len(frames), int(end * fps))
        if last - first < 3:
            continue
        mags, hues, edges = [], set(), []
        for i in range(first + 1, last):
            grey_before = cv2.cvtColor(frames[i - 1], cv2.COLOR_BGR2GRAY)
            grey_now = cv2.cvtColor(frames[i], cv2.COLOR_BGR2GRAY)
            flow = cv2.calcOpticalFlowFarneback(grey_before, grey_now, None, 0.5, 3, 15, 3, 5, 1.2, 0)
            mags.append(float(np.mean(np.linalg.norm(flow, axis=2))))

            # Hue only counts where there is enough saturation and light to see
            # it; otherwise near-black pixels vote for whatever their noise says.
            hsv = cv2.cvtColor(frames[i], cv2.COLOR_BGR2HSV)
            visible = (hsv[:, :, 1] > 60) & (hsv[:, :, 2] > 40)
            hue = hsv[:, :, 0][visible]
            if hue.size:
                hues.update(np.unique(hue // 15).tolist())
            edges.append(float(np.mean(cv2.Canny(grey_now, 60, 160) > 0)))

        mags = np.array(mags)
        static = float(np.mean(mags < STATIC_BELOW))
        print(f"{shot_id:5} {mags.mean():7.3f} {static * 100:7.1f}% {len(hues):5} {np.mean(edges):7.3f}")


if __name__ == '__main__':
    measure(sys.argv[1] if len(sys.argv) > 1 else '.renders/launch.mp4')
