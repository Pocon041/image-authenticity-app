"""Integration checks with synthetic fixtures; these are not accuracy benchmarks."""
import importlib.metadata
import importlib.util
import tempfile
from pathlib import Path
import unittest

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from detect_watermark import SDXL_WATERMARK_BITS, known_markers, visible_watermark, sdxl_invisible_watermark, watermark_candidate_evidence


class PixelWatermarkTests(unittest.TestCase):
    def test_repeated_body_text_and_corner_placement_are_not_watermarks(self):
        item = {'recognizedText': '中国农业银行 您尾号8481的信用卡', 'position': 'top_left',
                'visualFeatures': {'crossesCentralImage': True, 'tiltDegrees': 0, 'surroundingLuminanceDelta': 25}}
        self.assertIsNone(watermark_candidate_evidence(item, 5))
        item['recognizedText'] = '12月19日周四18:50'
        self.assertIsNone(watermark_candidate_evidence(item, 3))
        item['recognizedText'] = 'Adobe Stock'
        self.assertIn('adobe_stock', watermark_candidate_evidence(item, 1)[0])
        item['recognizedText'] = '作者名字'
        item['visualFeatures']['tiltDegrees'] = 25
        self.assertIn('tilted_text_crosses_subject_with_local_contrast', watermark_candidate_evidence(item, 1)[1])

    def test_common_chinese_watermark_phrases_are_candidates(self):
        markers = known_markers('版权所有，未经授权请勿转载')
        self.assertIn('generic_copyright_text', markers)
        self.assertIn('generic_watermark_text', markers)

    def test_ordinary_text_without_watermark_terms_is_not_reported(self):
        self.assertEqual(known_markers('今天的天气很好，适合外出拍照'), [])

    def test_visible_keyword_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'visible.png'
            image = Image.new('RGB', (1024, 512), 'white')
            ImageDraw.Draw(image).text((100, 190), 'Adobe Stock sample', fill='black', font=ImageFont.load_default(size=68))
            image.save(path)
            result = visible_watermark(path)
            self.assertEqual(result['status'], 'completed', result)
            self.assertTrue(result['candidates'], result)
            markers = {marker for item in result['candidates'] for marker in item['markers']}
            self.assertIn('adobe_stock', markers)
            for candidate in result['candidates']:
                x, y, width, height = candidate['bboxXYWH']
                self.assertTrue(0 <= x < x+width <= 1024 and 0 <= y < y+height <= 512)

    def test_known_payload_round_trip_and_other_payload(self):
        module_path = importlib.metadata.distribution('invisible-watermark').locate_file('imwatermark/maxDct.py')
        spec = importlib.util.spec_from_file_location('test_max_dct', module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        # A flat carrier isolates the supported encoder/decoder profile from lossy texture changes.
        image = np.full((512, 512, 3), 128, dtype=np.uint8)
        with tempfile.TemporaryDirectory() as directory:
            for index, bits in enumerate([SDXL_WATERMARK_BITS, '01' * 24]):
                encoded = module.EmbedMaxDct(watermarks=[int(bit) for bit in bits], wmLen=48).encode(image)
                path = Path(directory) / f'payload-{index}.png'
                cv2.imwrite(str(path), encoded)
                result = sdxl_invisible_watermark(path)
                self.assertEqual(result['status'], 'completed', result)
                self.assertEqual(result['decodedBits'], bits)
                self.assertEqual(result['outcome'], 'candidate_signature_match' if index == 0 else 'no_signature_match')

    def test_textured_carrier_does_not_promote_inexact_bits(self):
        module_path = importlib.metadata.distribution('invisible-watermark').locate_file('imwatermark/maxDct.py')
        spec = importlib.util.spec_from_file_location('test_textured_max_dct', module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        image = np.random.default_rng(42).integers(70, 186, size=(512, 512, 3), dtype=np.uint8)
        encoded = module.EmbedMaxDct(watermarks=[int(bit) for bit in SDXL_WATERMARK_BITS], wmLen=48).encode(image)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'textured.png'
            cv2.imwrite(str(path), encoded)
            result = sdxl_invisible_watermark(path)
            self.assertEqual(result['status'], 'completed', result)
            self.assertEqual(len(result['decodedBits']), 48)
            exact = result['decodedBits'] == SDXL_WATERMARK_BITS
            self.assertEqual(result['outcome'], 'candidate_signature_match' if exact else 'no_signature_match')

    def test_small_image_is_not_a_watermark_absence_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'small.png'
            Image.new('RGB', (32, 32), 'white').save(path)
            result = sdxl_invisible_watermark(path)
            self.assertEqual(result['outcome'], 'image_too_small_for_profile')
            self.assertNotIn('decodedBits', result)

    def test_large_image_retains_unscanned_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'large.png'
            Image.new('RGB', (4001, 3001), 'white').save(path)
            result = sdxl_invisible_watermark(path)
            self.assertEqual(result['status'], 'not_run')
            self.assertEqual(result['outcome'], 'not_scanned_image_over_resource_limit')


if __name__ == '__main__':
    unittest.main()
