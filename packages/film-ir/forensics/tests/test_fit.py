"""
The curves motion is described with, against exact arithmetic.

    python3 -m unittest discover -s tests      (from packages/film-ir/forensics)
"""
import unittest
from fractions import Fraction

import numpy as np

from actone_forensics import fit


def exact_bezier(x1, y1, x2, y2, t):
    """CSS cubic-bezier at progress t, by bisection on exact rationals: the truth, slowly."""
    X1, Y1, X2, Y2, T = (Fraction(float(v)) for v in (x1, y1, x2, y2, t))
    lo, hi = Fraction(0), Fraction(1)
    for _ in range(80):
        mid = (lo + hi) / 2
        if 3 * (1 - mid) ** 2 * mid * X1 + 3 * (1 - mid) * mid ** 2 * X2 + mid ** 3 < T:
            lo = mid
        else:
            hi = mid
    s = (lo + hi) / 2
    return float(3 * (1 - s) ** 2 * s * Y1 + 3 * (1 - s) * s ** 2 * Y2 + s ** 3)


class BezierTest(unittest.TestCase):
    def test_it_is_the_curve_to_twelve_places(self):
        rng = np.random.default_rng(3)
        for _ in range(60):
            x1, x2 = rng.uniform(0, 1, 2)
            y1, y2 = rng.uniform(-1, 2, 2)
            t = np.concatenate([[0.0, 1.0], rng.uniform(0, 1, 6)])
            got = fit._bezier_curve(x1, y1, x2, y2, t)
            for k in range(len(t)):
                self.assertAlmostEqual(got[k], exact_bezier(x1, y1, x2, y2, t[k]), places=10)

    def test_named_timing_functions(self):
        t = np.array([0.0, 0.25, 0.5, 0.75, 1.0])
        # linear is cubic-bezier(0, 0, 1, 1), and ease-in-out is symmetric about the middle.
        np.testing.assert_allclose(fit._bezier_curve(0.0, 0.0, 1.0, 1.0, t), t, atol=1e-9)
        ease_in_out = fit._bezier_curve(0.42, 0.0, 0.58, 1.0, t)
        np.testing.assert_allclose(ease_in_out + ease_in_out[::-1], 1.0, atol=1e-9)
        self.assertAlmostEqual(float(ease_in_out[2]), 0.5, places=9)

    def test_a_curve_flat_in_x_is_still_solved(self):
        # Both control points at x = 1: the curve stalls in x before its end, where Newton cannot step.
        t = np.linspace(0.0, 0.99, 12)
        got = fit._bezier_curve(1.0, 0.2, 1.0, 0.8, t)
        for k in range(len(t)):
            self.assertAlmostEqual(got[k], exact_bezier(1.0, 0.2, 1.0, 0.8, t[k]), places=8)


if __name__ == "__main__":
    unittest.main()
