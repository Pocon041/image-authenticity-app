import tempfile
from pathlib import Path
import unittest
import numpy as np
from PIL import Image
from evaluate import classification,localization,canonical_annotation


class EvaluationRules(unittest.TestCase):
    def test_native_leaf_decision_and_binary_threshold_remain_distinct(self):
        rows=[{'label':0,'score':0.1,'nativePrediction':0},
              {'label':1,'score':0.6,'nativePrediction':0},
              {'label':1,'score':0.9,'nativePrediction':1}]
        native=classification(rows,'native')
        threshold=classification(rows,'threshold_0.5')
        self.assertEqual(native['falseNegative'],1)
        self.assertEqual(threshold['falseNegative'],0)
        self.assertEqual(native['auc'],1.0)
        self.assertEqual(threshold['auc'],1.0)

    def test_localization_includes_all_tampered_images_and_real_false_area(self):
        rows=[{'label':1,'pixelF1':0.,'pixelIoU':0.,'pixelAUC':0.5,'predictedAreaFraction':0.},
              {'label':1,'pixelF1':1.,'pixelIoU':1.,'pixelAUC':1.,'predictedAreaFraction':0.1},
              {'label':0,'pixelF1':None,'pixelIoU':None,'pixelAUC':None,'predictedAreaFraction':0.2}]
        result=localization(rows)
        self.assertEqual(result['tamperedCount'],2)
        self.assertEqual(result['macroPixelF1'],0.5)
        self.assertEqual(result['emptyPredictionOnTampered'],1)
        self.assertEqual(result['meanPredictedAreaOnReal'],0.2)

    def test_encoded_annotation_uses_the_image_exif_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'mask.png'
            source=np.array([[255,0,0],[0,0,0]],dtype=np.uint8)
            Image.fromarray(source).save(path)
            result=canonical_annotation(path,6)
            self.assertEqual(result.shape,(3,2))
            self.assertTrue(result[0,1])
            self.assertEqual(int(result.sum()),1)


if __name__=='__main__':unittest.main()
