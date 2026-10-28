import importlib.metadata
import importlib.util
import json
import math
import re
import sys


SDXL_WATERMARK_BITS = '101100111110110010010000011110111011000110011110'
MAX_OCR_SIDE = 2400
MAX_SDXL_PIXELS = 12_000_000
KNOWN_MARKERS = {
    'adobestock': 'adobe_stock',
    'adobest0ck': 'adobe_stock',
    'shutterstock': 'shutterstock',
    'gettyimages': 'getty_images',
    'gettyimage': 'getty_images',
    'istock': 'istock',
    'istockphoto': 'istock',
    'alamy': 'alamy',
    'dreamstime': 'dreamstime',
    'depositphotos': 'depositphotos',
    'watermark': 'generic_watermark_text',
    'preview': 'generic_preview_text',
    'sample': 'generic_sample_text',
}


def error_result(error):
    return {
        'status': 'failed',
        'outcome': 'unavailable',
        'errorType': type(error).__name__,
        'reason': str(error)[:600],
    }


def normalized_text(value):
    return re.sub(r'[^a-z0-9]+', '', value.casefold())


def visible_watermark(path):
    try:
        import cv2
        import numpy as np
        from rapidocr import RapidOCR

        encoded = np.fromfile(path, dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError('规范显示图无法解码。')
        original_height, original_width = image.shape[:2]
        scale = min(1.0, MAX_OCR_SIDE / max(original_width, original_height))
        if scale < 1.0:
            width = max(1, round(original_width * scale))
            height = max(1, round(original_height * scale))
            image = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
        scale_x = original_width / image.shape[1]
        scale_y = original_height / image.shape[0]

        result = RapidOCR()(image)
        boxes = getattr(result, 'boxes', None) if result is not None else None
        texts = getattr(result, 'txts', None) if result is not None else None
        scores = getattr(result, 'scores', None) if result is not None else None
        candidates = []
        if boxes is not None and texts is not None:
            for index, (box, text) in enumerate(zip(boxes, texts)):
                text = str(text).strip()
                compact = normalized_text(text)
                markers = sorted({marker for needle, marker in KNOWN_MARKERS.items() if needle in compact})
                if not markers:
                    continue
                points = np.asarray(box, dtype=np.float64).reshape(-1, 2)
                if points.size == 0 or not np.isfinite(points).all():
                    continue
                left = max(0, math.floor(float(points[:, 0].min()) * scale_x))
                top = max(0, math.floor(float(points[:, 1].min()) * scale_y))
                right = min(original_width, math.ceil(float(points[:, 0].max()) * scale_x))
                bottom = min(original_height, math.ceil(float(points[:, 1].max()) * scale_y))
                confidence = None
                if scores is not None and index < len(scores):
                    score = float(scores[index])
                    confidence = round(score, 4) if math.isfinite(score) else None
                candidates.append({
                    'markers': markers,
                    'recognizedText': text[:256],
                    'confidence': confidence,
                    'bboxXYWH': [left, top, max(0, right - left), max(0, bottom - top)],
                    'coordinateSpace': 'display_image_pixels',
                    'limitation': 'OCR文本匹配只提供可见标记候选；无法确认文字由水印叠加产生，也可能漏掉低对比度、倾斜、遮挡或非文字图形。',
                })
        return {
            'status': 'completed',
            'engine': 'RapidOCR',
            'engineVersion': importlib.metadata.version('rapidocr'),
            'outcome': 'candidate_visible_text_found' if candidates else 'no_known_visible_text_found',
            'imageDimensions': [original_width, original_height],
            'maxOcrSide': MAX_OCR_SIDE,
            'candidates': candidates[:40],
            'limitation': '只匹配内置的英文图库/水印关键词，不做通用水印图形分类；文字内容本身不能证明存在版权水印。',
        }
    except Exception as error:
        return error_result(error)


def sdxl_invisible_watermark(path):
    try:
        from PIL import Image

        with Image.open(path) as source:
            width, height = source.size
        if width < 256 or height < 256:
            return {
                'status': 'completed',
                'algorithm': 'stabilityai_sdxl_dwtDct_48bit',
                'outcome': 'image_too_small_for_profile',
                'imageDimensions': [width, height],
                'limitation': '该Stable Diffusion XL配置在任一边小于256像素时不嵌入此载荷。',
            }
        if width * height > MAX_SDXL_PIXELS:
            return {
                'status': 'not_run',
                'algorithm': 'stabilityai_sdxl_dwtDct_48bit',
                'outcome': 'not_scanned_image_over_resource_limit',
                'imageDimensions': [width, height],
                'maxPixels': MAX_SDXL_PIXELS,
                'limitation': '为避免降低原始载荷可读性或长时间阻塞，本检查不缩放超大图像；超过1200万像素时不运行SDXL解码。',
            }
        import cv2
        import numpy as np

        encoded = np.fromfile(path, dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError('原始图像无法解码。')
        height, width = image.shape[:2]
        decoder_path = importlib.metadata.distribution('invisible-watermark').locate_file(
            'imwatermark/maxDct.py'
        )
        spec = importlib.util.spec_from_file_location('srdp_invisible_watermark_max_dct', decoder_path)
        if spec is None or spec.loader is None:
            raise ImportError('invisible-watermark 的 DWT-DCT 实现不可读取。')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        decoder = module.EmbedMaxDct(watermarks=[], wmLen=len(SDXL_WATERMARK_BITS))
        decoded = decoder.decode(image)
        bits = ''.join(str(int(bit)) for bit in np.asarray(decoded).reshape(-1))
        matched = bits == SDXL_WATERMARK_BITS
        return {
            'status': 'completed',
            'algorithm': 'stabilityai_sdxl_dwtDct_48bit',
            'outcome': 'candidate_signature_match' if matched else 'no_signature_match',
            'decodedBits': bits,
            'imageDimensions': [width, height],
            'limitation': '只检测公开的Stable Diffusion XL固定48位DWT-DCT载荷；未匹配不代表没有其他隐形水印。固定载荷可被伪造，且压缩、缩放、裁剪或方向/颜色转换可能导致漏检。',
        }
    except Exception as error:
        return error_result(error)


def main(original_path, display_path):
    response = {
        'ok': True,
        'visible': visible_watermark(display_path),
        'invisible': sdxl_invisible_watermark(original_path),
    }
    print(json.dumps(response, ensure_ascii=False))


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError('Usage: detect_watermark.py <original-image> <display-image>')
        main(sys.argv[1], sys.argv[2])
    except Exception as error:
        print(json.dumps({
            'ok': False,
            'errorType': type(error).__name__,
            'error': str(error)[:1000],
        }, ensure_ascii=False))
        sys.exit(2)
