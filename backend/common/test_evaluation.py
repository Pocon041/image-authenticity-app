import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
from evaluation import canonical_annotation, metrics


class EvaluationTests(unittest.TestCase):
    def test_threshold_and_auc_keep_continuous_score_semantics(self):
        rows = [{'label': 0, 'score': 0.1}, {'label': 1, 'score': 0.4}, {'label': 1, 'score': 0.9}]
        result = metrics(rows, 0.5)
        self.assertEqual(result['falseNegative'], 1)
        self.assertEqual(result['auc'], 1.0)
        self.assertAlmostEqual(result['f1'], 2 / 3)

    def test_single_class_auc_is_unavailable(self):
        self.assertIsNone(metrics([{'label': 0, 'score': 0.2}], 0.5)['auc'])

    def test_annotation_follows_image_exif_orientation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'mask.png'
            Image.fromarray(np.array([[255, 0, 0], [0, 0, 0]], dtype=np.uint8)).save(path)
            mask = canonical_annotation(path, 6)
            self.assertEqual(mask.shape, (3, 2))
            self.assertTrue(mask[0, 1])
            self.assertEqual(int(mask.sum()), 1)


if __name__ == '__main__':
    unittest.main()
