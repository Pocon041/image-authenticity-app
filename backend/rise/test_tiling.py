"""Geometry regression: native pixels must survive tiling, averaging and edge padding."""
import unittest
import numpy as np
import torch
from PIL import Image
from adapter import RisePredictor, starts


class TilingTests(unittest.TestCase):
    def test_every_pixel_is_covered_at_image_edges(self):
        for size in (1, 511, 512, 513, 1170, 1205, 1280, 1706):
            for stride in (128, 384, 512):
                covered = np.zeros(size, dtype=bool)
                for start in starts(size, stride):
                    covered[start:start+512] = True
                self.assertTrue(covered.all(), (size, stride))

    def test_native_pixel_coordinates_survive_overlap_and_padding(self):
        predictor = RisePredictor.__new__(RisePredictor)
        predictor.stride, predictor.max_tiles = 384, 128
        predictor.device, predictor.torch, predictor.model, predictor.audit = 'cpu', torch, None, {}
        def pixel_oracle(model, image, **kwargs):
            return {'probability': image[:, 0] / 255, 'expert_id': torch.tensor([0]), 'confidence': torch.zeros(1, 9)}
        predictor.predict_official = pixel_oracle
        rng = np.random.default_rng(42)
        for width, height in ((1170, 1205), (173, 311), (513, 1)):
            pixels = rng.integers(0, 256, (height, width, 3), dtype=np.uint8)
            mask, response, audit = predictor.predict(Image.fromarray(pixels))
            np.testing.assert_allclose(response, pixels[:, :, 0] / 255, atol=2e-7)
            np.testing.assert_array_equal(mask, pixels[:, :, 0] >= 128)
            self.assertEqual(audit['coverageMin'], 1)

    def test_tile_limit_does_not_silently_skip_pixels(self):
        predictor = RisePredictor.__new__(RisePredictor)
        predictor.stride, predictor.max_tiles = 384, 1
        with self.assertRaisesRegex(ValueError, 'exceeding maxTiles'):
            predictor.predict(Image.new('RGB', (1200, 1200)))


if __name__ == '__main__':
    unittest.main()
