import unittest
import numpy as np
from postprocess import decode_sequence, regions_from_mask


class GeometryTests(unittest.TestCase):
    def test_control_tokens_are_not_tampered_and_last_step_is_selected(self):
        initial = np.array([[0, 3], [3, 3]], dtype=np.uint8)
        complete = np.array([[0, 1], [1, 1]], dtype=np.uint8)
        eos = np.full((2, 2), 2, dtype=np.uint8)
        response = np.array([[0.8, 0.1], [0.2, 0.3]], dtype=np.float32)
        mask, heatmap, stats = decode_sequence([initial, complete, eos], [response]*3, (8, 4))
        self.assertEqual(stats['selectedStep'], 1)
        self.assertEqual(stats['decision'], 'inconclusive')
        self.assertAlmostEqual(stats['score'], 0.8)
        self.assertEqual(set(np.unique(mask)), {0, 255})
        self.assertEqual(mask.shape, (4, 8))
        regions, count = regions_from_mask(mask)
        self.assertEqual(count, 1)
        self.assertEqual(regions[0]['bboxXYWH'], [0, 0, 4, 2])
        self.assertTrue(np.all(np.isfinite(heatmap)))

    def test_immediate_eos_is_inconclusive(self):
        eos = np.full((2, 2), 2, dtype=np.uint8)
        mask, _, stats = decode_sequence([eos], [np.zeros((2, 2))], (8, 4), threshold=0.5)
        self.assertEqual(stats['decision'], 'inconclusive')
        self.assertIsNone(stats['score'])
        self.assertFalse(mask.any())

    def test_padding_never_turns_into_tamper(self):
        padding = np.full((2, 2), 3, dtype=np.uint8)
        mask, _, stats = decode_sequence([padding], [np.ones((2, 2))], (5, 3))
        self.assertFalse(mask.any())
        self.assertIsNone(stats['score'])
        self.assertEqual(stats['paddingFraction'], 1)

    def test_first_eos_boundary_excludes_later_outputs(self):
        authentic = np.ones((2, 2), dtype=np.uint8)
        eos = np.full((2, 2), 2, dtype=np.uint8)
        later = np.zeros((2, 2), dtype=np.uint8)
        mask, _, stats = decode_sequence([authentic, eos, later], [np.zeros((2, 2))]*3, (4, 4))
        self.assertEqual(stats['selectedStep'], 0)
        self.assertFalse(mask.any())

    def test_score_does_not_depend_on_display_resolution(self):
        label = np.ones((2, 2), dtype=np.uint8)
        response = np.array([[0.1, 0.3], [0.5, 0.9]], dtype=np.float32)
        small = decode_sequence([label], [response], (4, 4), threshold=0.8)[2]
        large = decode_sequence([label], [response], (100, 80), threshold=0.8)[2]
        self.assertEqual(small['score'], large['score'])
        self.assertEqual(small['decision'], 'suspicious')


if __name__ == '__main__':
    unittest.main()
