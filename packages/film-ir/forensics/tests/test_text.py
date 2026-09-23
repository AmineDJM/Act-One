"""
The type measurements, against type whose geometry is known.

    python3 -m unittest discover -s tests      (from packages/film-ir/forensics)

Lines are drawn in the DejaVu faces shipped with the analyzer, on a plain
ground, and each letter is handed over with the box a recogniser gives it —
the letter's advance across, the line's ink with a pixel of margin down —
so what is measured can be checked against where the ink was put.
"""
import unittest

import numpy as np

from actone_forensics import synthetic, text
from actone_forensics.analyze import glyphs_for, respace

CANVAS = (360, 120)
GROUND = 40.0


def ink_rows(alpha):
    inked = np.nonzero(alpha.max(axis=1) > 0.02)[0]
    return int(inked[0]), int(inked[-1])


def recognised(alpha, letters, margin=1, drift=0.0):
    """
    Each letter with the box a recogniser reports for it, and the line's box.
    `drift` moves every box by that share of its letter's advance, as the
    recogniser's boxes are seen to sit, all to one side, on real footage.
    """
    top, bottom = ink_rows(alpha)
    y, h = top - margin, bottom - top + 1 + 2 * margin
    glyphs = [{"char": char, "box": [start + drift * (end - start), y, end - start, h]} for char, start, end, _ in letters if not char.isspace()]
    x0 = min(g["box"][0] for g in glyphs)
    x1 = max(g["box"][0] + g["box"][2] for g in glyphs)
    return glyphs, [x0, y, x1 - x0, h]


def picture(*alphas, ground=GROUND):
    return ground + (255.0 - ground) * np.maximum.reduce(alphas)


def paragraph(first, second, blank_rows):
    """Two lines, the second placed as close under the first as leaves `blank_rows` rows of ground between their ink."""
    above, above_letters, _ = synthetic.place(first, CANVAS)
    last_row = ink_rows(above)[1]
    centre = second[3]
    while True:
        spec = second[:3] + (centre,) + second[4:]
        below, below_letters, _ = synthetic.place(spec, CANVAS)
        if ink_rows(below)[0] - last_row - 1 >= blank_rows:
            return picture(above, below), (first, above, above_letters), (spec, below, below_letters)
        centre += 0.5


class TypeGeometryTest(unittest.TestCase):
    def assertGeometry(self, measured, truth, tolerance=0.15):
        self.assertIsNotNone(measured)
        for key in ("baselineY", "capHeightPx", "xHeightPx"):
            if truth[key] is None:
                self.assertIsNone(measured[key], key)
            else:
                self.assertAlmostEqual(measured[key], truth[key], delta=tolerance, msg=key)

    def test_each_line_of_the_film_to_a_fraction_of_a_pixel(self):
        for key, spec in synthetic.LINES.items():
            with self.subTest(line=spec[0]):
                alpha, letters, _ = synthetic.place(spec)
                glyphs, box = recognised(alpha, letters)
                self.assertGeometry(text.type_geometry(picture(alpha), box, glyphs), synthetic.geometry(spec))

    def test_the_stems_follow_the_weight_of_the_face(self):
        # DejaVu Sans Bold draws its stems at about a quarter of the cap height; Book at about a seventh.
        ratios = {}
        for face in ("bold", "book"):
            spec = ("HUNDRED MILLION", face, 40, 60, 0)
            alpha, letters, _ = synthetic.place(spec, CANVAS)
            glyphs, box = recognised(alpha, letters)
            measured = text.type_geometry(picture(alpha), box, glyphs)
            ratios[face] = measured["stemPx"] / measured["capHeightPx"]
        self.assertAlmostEqual(ratios["bold"], 0.25, delta=0.03)
        self.assertAlmostEqual(ratios["book"], 0.14, delta=0.02)

    def test_a_paragraph_set_tight_does_not_lend_one_line_the_other_s_ink(self):
        cases = [
            (("Deploy in minutes", "book", 18, 40, 0), ("Keep every build", "book", 18, 50, 0)),
            (("BUILD FASTER", "bold", 40, 40, 0), ("SHIP SOONER", "bold", 40, 60, 0)),
        ]
        for first, second in cases:
            grey, *lines = paragraph(first, second, blank_rows=1)
            for spec, alpha, letters in lines:
                with self.subTest(line=spec[0]):
                    glyphs, box = recognised(alpha, letters)
                    self.assertGeometry(text.type_geometry(grey, box, glyphs), synthetic.geometry(spec, CANVAS))

    def test_letters_are_read_from_their_own_ink_when_the_boxes_sit_off_them(self):
        spec = ("HUNTING BROWN Foxes", "bold", 40, 60, 0)
        canvas = (640, 120)
        alpha, letters, _ = synthetic.place(spec, canvas)
        glyphs, box = recognised(alpha, letters, drift=0.45)
        measured = text.type_geometry(picture(alpha), box, glyphs)
        self.assertEqual(measured["lettersFromInk"], measured["letters"])
        self.assertGeometry(measured, synthetic.geometry(spec, canvas))

    def test_letters_that_touch_are_left_to_their_boxes_and_the_rest_read_from_ink(self):
        # At this size the bar of the bold T reaches the o: one run of ink for two letters.
        spec = ("Tomorrow Hunt", "bold", 96, 90, 0)
        canvas = (900, 180)
        alpha, letters, _ = synthetic.place(spec, canvas)
        glyphs, box = recognised(alpha, letters, drift=0.3)
        measured = text.type_geometry(picture(alpha), box, glyphs)
        self.assertEqual(measured["lettersFromInk"], measured["letters"] - 2)
        self.assertGeometry(measured, synthetic.geometry(spec, canvas))

    def test_lowercase_has_no_cap_height_to_measure(self):
        spec = ("summer is near", "book", 24, 60, 0)
        alpha, letters, _ = synthetic.place(spec, CANVAS)
        glyphs, box = recognised(alpha, letters)
        measured = text.type_geometry(picture(alpha), box, glyphs)
        self.assertIsNone(measured["capHeightPx"])
        self.assertAlmostEqual(measured["xHeightPx"], synthetic.geometry(spec, CANVAS)["xHeightPx"], delta=0.15)

    def test_nothing_is_measured_where_the_ink_barely_stands_out(self):
        spec = ("LAUNCH DAY", "bold", 30, 60, 0)
        alpha, letters, _ = synthetic.place(spec, CANVAS)
        glyphs, box = recognised(alpha, letters)
        faint = GROUND + 30.0 * alpha
        self.assertIsNone(text.type_geometry(faint, box, glyphs))


class PixelSpacesTest(unittest.TestCase):
    def words(self, spec, consensus, grey=None, margin=1):
        alpha, letters, _ = synthetic.place(spec, CANVAS)
        glyphs, box = recognised(alpha, letters, margin)
        spaces = text.pixel_spaces(picture(alpha) if grey is None else grey, box, glyphs, consensus)
        return None if spaces is None else " ".join("".join(g["char"] for g in word) for word in text.spaced_words(glyphs, spaces))

    def test_a_space_the_recogniser_dropped_comes_back(self):
        self.assertEqual(self.words(("Deploy in minutes", "book", 18, 60, 0), "Deployin minutes"), "Deploy in minutes")

    def test_type_tracked_out_wide_is_not_cut_into_letters(self):
        # The recogniser boxed this line 43 px tall in the synthetic film: five pixels of margin about 32 of ink.
        self.assertEqual(self.words(("SEARCH", "bold", 44, 60, 13), "SE AR CH", margin=5), "SEARCH")

    def test_small_type_keeps_the_spaces_the_recogniser_wrote(self):
        # Below 40 px a real word gap can blur to a pixel, so the pixels only ever add a space there.
        self.assertEqual(self.words(("Deploy in minutes", "book", 18, 60, 0), "Depl oy in minutes"), "Depl oy in minutes")

    def test_the_wide_side_bearings_of_a_bold_face_are_not_a_space(self):
        self.assertEqual(self.words(("LAUNCH DAY", "bold", 30, 60, 0), "LAUNCH DAY"), "LAUNCH DAY")

    def test_the_line_below_does_not_fill_a_word_gap(self):
        grey, first, second = paragraph(("BUILD FASTER", "bold", 40, 40, 0), ("SHIP SOONER", "bold", 40, 60, 0), blank_rows=1)
        for spec, _, _ in (first, second):
            with self.subTest(line=spec[0]):
                self.assertEqual(self.words(spec, spec[0], grey), spec[0])

    def test_letters_that_are_not_the_consensus_s_letters_are_not_measured(self):
        self.assertIsNone(self.words(("LAUNCH DAY", "bold", 30, 60, 0), "LAUNCH DAX"))

    def test_the_consensus_stands_where_the_pixels_say_nothing(self):
        line = {"text": "Deployin minutes"}
        self.assertEqual(respace(line, [], None), "Deployin minutes")


class EdgesTest(unittest.TestCase):
    def test_a_top_and_bottom_to_a_fraction_of_a_pixel(self):
        top, bottom = text._edges(np.array([0.0, 0.25, 1.0, 1.0, 0.75, 0.0]))
        self.assertAlmostEqual(top, 1.5 + 0.25 / 0.75)
        self.assertAlmostEqual(bottom, 4.5 + 0.25 / 0.75)

    def test_a_glyph_in_pieces_is_one_glyph(self):
        # The arms of an E, seen through the middle of its box.
        profile = np.array([0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0], dtype=float)
        self.assertEqual(text._own_span(profile, 1, 10), (1, 10))

    def test_ink_mostly_outside_the_box_is_a_neighbour_s(self):
        # The line above's descender reaches one row into this line's box.
        profile = np.array([1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0], dtype=float)
        self.assertEqual(text._own_span(profile, 3, 11), (6, 10))
        self.assertIsNone(text._own_span(np.zeros(8), 2, 6))


def reading(frame, text_, box, score=0.9):
    return {"frame": frame, "text": text_, "score": score, "box": box}


def piece(text_, box, frames=(10, 12, 14)):
    readings = [reading(frame, text_, box) for frame in frames]
    return {"text": text_, "score": 0.9, "readings": readings, "firstRead": frames[0], "lastRead": frames[-1],
            "referenceFrame": frames[1], "referenceBox": box, "variants": [text_]}


class FragmentsTest(unittest.TestCase):
    def test_letters_read_twice_under_an_overlap_are_read_once(self):
        self.assertEqual(text._shared_edge("LAUNCH", "HDAY"), 1)
        self.assertEqual(text._shared_edge("NEW", "FEATURE"), 0)
        self.assertEqual(text._trimmed("LAUNCH", "HDAY", overlapping=True), "DAY")
        self.assertEqual(text._trimmed("LAUNCH", "HDAY", overlapping=False), "HDAY")

    def test_two_pieces_of_one_row_are_one_line(self):
        joined = text.merge_row_fragments([piece("LAUNCH", [50, 80, 100, 24]), piece("HDAY", [140, 80, 70, 24])], stride=2)
        self.assertEqual([line["text"] for line in joined], ["LAUNCH DAY"])
        self.assertEqual(joined[0]["referenceBox"], [50, 80, 160, 24])

    def test_lines_that_are_not_on_one_row_stay_apart(self):
        joined = text.merge_row_fragments([piece("Launch", [50, 80, 100, 24]), piece("today", [50, 110, 80, 24])], stride=2)
        self.assertEqual(sorted(line["text"] for line in joined), ["Launch", "today"])

    def test_side_by_side_within_a_word_s_gap(self):
        self.assertTrue(text._row_neighbours([0, 0, 100, 20], [110, 0, 60, 20]))
        self.assertFalse(text._row_neighbours([0, 0, 100, 20], [140, 0, 60, 20]))
        self.assertFalse(text._row_neighbours([0, 0, 100, 20], [110, 0, 60, 30]))
        # Overlapping by a letter is allowed only when a letter is read in both pieces.
        self.assertFalse(text._row_neighbours([0, 0, 100, 20], [85, 0, 60, 20]))
        self.assertTrue(text._row_neighbours([0, 0, 100, 20], [85, 0, 60, 20], shared=1))

    def test_the_glyphs_of_overlapping_pieces_are_counted_once(self):
        line = {"text": "LAUNCH DAY", "referenceBox": [50, 80, 160, 24]}
        glyph = lambda char, x: {"char": char, "box": [x, 80, 14, 24]}
        read = [
            {"poly": [[50, 80], [150, 80], [150, 104], [50, 104]], "text": "LAUNCH", "score": 0.9,
             "glyphs": [glyph(c, 50 + 16 * k) for k, c in enumerate("LAUNCH")]},
            # The second piece starts under the H the first one ends with.
            {"poly": [[130, 80], [210, 80], [210, 104], [130, 104]], "text": "HDAY", "score": 0.9,
             "glyphs": [glyph(c, 130 + 20 * k) for k, c in enumerate("HDAY")]},
        ]
        glyphs = glyphs_for(line, read)
        self.assertEqual("".join(g["char"] for g in glyphs), "LAUNCH DAY")


if __name__ == "__main__":
    unittest.main()
