import unittest
import numpy as np
from region_support import mask_pixel_support, regions_with_support


class RegionSupportTests(unittest.TestCase):
    def test_empty_mask_is_unavailable(self):
        mask = np.zeros((4, 5), dtype=np.uint8)
        self.assertIsNone(mask_pixel_support(mask, np.full(mask.shape, .9)))
        self.assertEqual(regions_with_support(mask, response=np.zeros(mask.shape)), ([], 0))

    def test_mean_uses_marked_pixels_not_bbox_or_maximum(self):
        mask = np.array([[1, 1, 0], [1, 0, 0]], dtype=np.uint8)
        response = np.array([[.7, .8, 1], [.9, 1, 1]])
        original = mask.copy()
        entries, count = regions_with_support(mask, response=response)
        self.assertEqual(count, 1)
        self.assertAlmostEqual(entries[0]['confidence']['value'], .8)
        self.assertAlmostEqual(mask_pixel_support(mask, response)['value'], .8)
        self.assertEqual(entries[0]['confidence']['target'], 'marked_region_pixels')
        np.testing.assert_array_equal(mask, original)

    def test_overlapping_boxes_keep_components_independent(self):
        mask = np.zeros((7, 7), dtype=np.uint8)
        mask[0, :] = 1
        mask[:, 0] = 1
        mask[-1, :] = 1
        mask[3, 3] = 1
        response = np.full(mask.shape, .6)
        response[3, 3] = .95
        entries, count = regions_with_support(mask, response=response)
        self.assertEqual(count, 2)
        self.assertAlmostEqual(entries[0]['confidence']['value'], .6)
        self.assertAlmostEqual(entries[1]['confidence']['value'], .95)

    def test_area_weighted_whole_mask_and_region_limit(self):
        mask = np.zeros((4, 5), dtype=np.uint8)
        mask[0, 0:2] = 255
        mask[3, 4] = 255
        response = np.full(mask.shape, .6)
        response[3, 4] = .9
        entries, count = regions_with_support(mask, max_regions=1, response=response)
        self.assertEqual(len(entries), 1)
        self.assertEqual(count, 2)
        self.assertAlmostEqual(mask_pixel_support(mask, response)['value'], .7)

    def test_missing_float_response_does_not_invent_support(self):
        entries, count = regions_with_support(np.ones((3, 3), dtype=np.uint8))
        self.assertEqual(count, 1)
        self.assertNotIn('confidence', entries[0])

    def test_invalid_response_rejected(self):
        mask = np.ones((2, 2), dtype=np.uint8)
        for response in [np.zeros((3, 3)), np.full((2, 2), np.nan), np.full((2, 2), 1.1)]:
            with self.assertRaises(ValueError):
                mask_pixel_support(mask, response)
            with self.assertRaises(ValueError):
                regions_with_support(mask, response=response)


if __name__ == '__main__':
    unittest.main()
