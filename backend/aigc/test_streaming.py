"""Numerical equivalence of execution paths, not detector accuracy testing."""
import sys
from pathlib import Path
import unittest

import numpy as np
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / '.tools/fsd'))
from fsd.fre import FRE
from fsd.fsd_computation import compute_fsd
from streaming import compute_fsd_streaming


class StreamingTests(unittest.TestCase):
    def test_official_math_is_preserved(self):
        torch.manual_seed(17)
        fre = FRE(out_channels=2, kernel_size=5).eval()
        image = Image.fromarray(np.random.default_rng(3).integers(0, 256, (83, 111), dtype=np.uint8))
        for mode in ['resize_and_crop', 'resize', 'crop']:
            with self.subTest(mode=mode):
                args = dict(kernel_size=5, num_scales=2, max_size=48, resize_mode=mode)
                expected = compute_fsd(image, fre, **args)
                actual = compute_fsd_streaming(image, fre, **args)
                torch.testing.assert_close(actual, expected, rtol=1e-10, atol=1e-10)

    def test_multi_batch_row_order(self):
        torch.manual_seed(19)
        fre = FRE(out_channels=1, kernel_size=3).eval()
        image = Image.fromarray(np.random.default_rng(6).integers(0, 256, (176, 208), dtype=np.uint8))
        args = dict(kernel_size=3, num_scales=1, max_size=160)
        torch.testing.assert_close(compute_fsd_streaming(image, fre, **args),
                                   compute_fsd(image, fre, **args), rtol=1e-9, atol=1e-9)


if __name__ == '__main__':
    unittest.main()
