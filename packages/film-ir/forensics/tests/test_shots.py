"""
Boundaries on frames whose every pixel is known: a wipe within a frame, a
cross-fade, a step, and the structure either side of a change.

    python3 -m unittest discover -s tests      (from packages/film-ir/forensics)
"""
import unittest

import cv2
import numpy as np

from actone_forensics import shots

SIZE = (90, 160)


def texture(seed):
    """A picture with structure: rectangles of grey placed at random, so it has edges, and they are not another seed's."""
    rng = np.random.default_rng(seed)
    picture = np.full(SIZE, int(rng.integers(40, 90)), np.uint8)
    for _ in range(14):
        y, x = int(rng.integers(0, SIZE[0] - 12)), int(rng.integers(0, SIZE[1] - 16))
        h, w = int(rng.integers(6, 30)), int(rng.integers(8, 50))
        picture[y: y + h, x: x + w] = int(rng.integers(120, 250))
    return picture


def packed(frames):
    edges = [cv2.Canny(frame, 80, 160) for frame in frames]
    return {"packed": [np.packbits(e > 0) for e in edges], "shape": SIZE}


def features_for(frames):
    """The per-frame pixel change the dissolve detector reads: mean absolute luma difference to the frame before, 0..1."""
    change = [None] + [float(np.abs(b.astype(np.float32) - a.astype(np.float32)).mean() / 255.0) for a, b in zip(frames, frames[1:])]
    return {"pixel_difference": change}


class CutTest(unittest.TestCase):
    """The cut rule on the signals measured on the Plasma film, around one frame that changes."""

    def cuts(self, changed, before_spread=0.149, after_spread=0.1, quiet=None):
        n, at = 30, 15
        quiet = quiet or {"histogram_distance": 0.028, "pixel_difference": 0.003, "edge_change_ratio": 0.02, "gm_tracked_ratio": 1.0}
        features = {name: [None] + [value] * (n - 1) for name, value in quiet.items()}
        for name, value in changed.items():
            features[name][at] = value
        features["luma_std"] = [before_spread] * at + [after_spread] * (n - at)
        frames = [texture(8)] * at + [texture(9)] * (n - at)
        return [c["frame"] for c in shots.detect_cuts(features, [None] * n, frames)]

    def test_a_new_picture_in_the_same_colours_is_a_cut(self):
        # Frame 163: the blurred "OVERVIEW" card giving way to the footage it was made from.
        found = self.cuts({"histogram_distance": 0.215, "pixel_difference": 0.042, "edge_change_ratio": 0.868, "gm_tracked_ratio": 0.0})
        self.assertEqual(found, [15])

    def test_an_element_appearing_on_an_empty_canvas_is_not(self):
        # Frame 388: a magnifying glass drawn on an empty white card.
        found = self.cuts({"histogram_distance": 0.116, "pixel_difference": 0.021, "edge_change_ratio": 1.0, "gm_tracked_ratio": 0.0},
                          before_spread=0.0, after_spread=0.05, quiet={"histogram_distance": 0.002, "pixel_difference": 0.0, "edge_change_ratio": 0.0, "gm_tracked_ratio": 0.0})
        self.assertEqual(found, [])

    def test_a_change_that_keeps_most_edges_needs_the_histogram_and_the_pixels_to_say_so(self):
        found = self.cuts({"histogram_distance": 0.215, "pixel_difference": 0.042, "edge_change_ratio": 0.6, "gm_tracked_ratio": 0.0})
        self.assertEqual(found, [])

    def test_a_change_the_histogram_and_the_pixels_agree_on_is_a_cut_as_before(self):
        found = self.cuts({"histogram_distance": 0.919, "pixel_difference": 0.28, "edge_change_ratio": 1.0, "gm_tracked_ratio": 0.0})
        self.assertEqual(found, [15])


class SplitFrameTest(unittest.TestCase):
    def test_a_frame_that_is_part_one_picture_and_part_the_next_is_a_wipe(self):
        before, after = texture(1), texture(2)
        middle = after.copy()
        middle[60:] = before[60:]
        found = shots.split_frame([before, middle, after], 1)
        self.assertIsNotNone(found)
        self.assertAlmostEqual(found["outgoingShare"], 1 / 3, delta=0.05)

    def test_a_cut_whose_first_frame_is_already_the_next_picture_is_not(self):
        before, after = texture(1), texture(2)
        self.assertIsNone(shots.split_frame([before, after, after], 1))

    def test_a_cut_followed_by_movement_is_not_a_wipe(self):
        # The frame after the cut matches neither side where the next picture keeps changing.
        self.assertIsNone(shots.split_frame([texture(1), texture(2), texture(3)], 1))


class StructureTest(unittest.TestCase):
    def test_the_same_edges_either_side_are_the_same_picture(self):
        picture = texture(4)
        brighter = np.clip(picture.astype(np.int16) + 30, 0, 255).astype(np.uint8)
        self.assertLess(shots.structure_change(packed([picture, brighter]), 0, 1), 0.2)

    def test_other_edges_are_another_picture(self):
        self.assertGreater(shots.structure_change(packed([texture(4), texture(5)]), 0, 1), 0.5)

    def test_a_frame_without_edges_says_nothing(self):
        flat = np.full(SIZE, 128, np.uint8)
        self.assertIsNone(shots.structure_change(packed([flat, texture(4)]), 0, 1))


class DissolveTest(unittest.TestCase):
    def test_a_mix_is_measured_from_the_last_frame_it_leaves_to_the_first_it_completes(self):
        a, b = texture(6).astype(np.float32), texture(7).astype(np.float32)
        frames = [a] * 20 + [(1 - (k + 1) / 11.0) * a + ((k + 1) / 11.0) * b for k in range(10)] + [b] * 20
        frames = [np.clip(np.rint(frame), 0, 255).astype(np.uint8) for frame in frames]
        found = shots.detect_dissolves(features_for(frames), frames, [], 25.0)
        self.assertEqual([f["span"] for f in found], [[19, 30]])

    def test_a_step_from_one_picture_to_the_next_mixes_nothing(self):
        frames = [texture(6)] * 20 + [texture(7)] * 20
        self.assertEqual(shots.detect_dissolves(features_for(frames), frames, [], 25.0), [])


if __name__ == "__main__":
    unittest.main()
