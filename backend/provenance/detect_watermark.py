import importlib.metadata
import importlib.util
import json
import math
import re
import sys
from difflib import SequenceMatcher


SDXL_WATERMARK_BITS = '101100111110110010010000011110111011000110011110'
MAX_OCR_SIDE = 2400
MAX_SDXL_PIXELS = 12_000_000
KNOWN_MARKERS = {
    '豆包': 'doubao_brand_text_candidate',
    'doubao': 'doubao_brand_text_candidate',
    'seedream': 'seedream_model_text_candidate',
    'chatgpt': 'openai_image_brand_text_candidate',
    'openai': 'openai_image_brand_text_candidate',
    'dalle': 'openai_image_model_text_candidate',
    'midjourney': 'midjourney_brand_text_candidate',
    'stabilityai': 'stability_ai_brand_text_candidate',
    'stablediffusion': 'stable_diffusion_model_text_candidate',
    'sdxl': 'stable_diffusion_model_text_candidate',
    'adobefirefly': 'adobe_firefly_brand_text_candidate',
    'googleimagen': 'google_imagen_model_text_candidate',
    'gemini': 'google_gemini_brand_text_candidate',
    'microsoftdesigner': 'microsoft_designer_brand_text_candidate',
    'copilot': 'microsoft_copilot_brand_text_candidate',
    'bingimagecreator': 'bing_image_creator_brand_text_candidate',
    'metaai': 'meta_ai_brand_text_candidate',
    'canva': 'canva_ai_brand_text_candidate',
    'leonardoai': 'leonardo_ai_brand_text_candidate',
    'ideogram': 'ideogram_brand_text_candidate',
    'runway': 'runway_brand_text_candidate',
    'kling': 'kling_brand_text_candidate',
    '可灵': 'kling_brand_text_candidate',
    'jimeng': 'jimeng_brand_text_candidate',
    '即梦': 'jimeng_brand_text_candidate',
    '通义万相': 'tongyi_wanxiang_brand_text_candidate',
    '文心一格': 'ernie_yige_brand_text_candidate',
    '腾讯混元': 'hunyuan_brand_text_candidate',
    '海螺ai': 'minimax_hailuo_brand_text_candidate',
    'minimax': 'minimax_hailuo_brand_text_candidate',
    '智谱清影': 'zhipu_qingying_brand_text_candidate',
    'ai生成': 'generic_ai_generated_text',
    'aigenerated': 'generic_ai_generated_text',
    '人工智能生成': 'generic_ai_generated_text',
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
    'copyright': 'generic_copyright_text',
    'allrightsreserved': 'generic_copyright_text',
    'donotcopy': 'generic_watermark_text',
    'donotremove': 'generic_watermark_text',
    'notforsale': 'generic_watermark_text',
    'watermark': 'generic_watermark_text',
    'preview': 'generic_preview_text',
    'previewonly': 'generic_preview_text',
    'forpreviewonly': 'generic_preview_text',
    'sample': 'generic_sample_text',
    'sampleimage': 'generic_sample_text',
    'proof': 'generic_sample_text',
    '水印': 'generic_watermark_text',
    '版权': 'generic_copyright_text',
    '版权所有': 'generic_copyright_text',
    '未经授权': 'generic_watermark_text',
    '未经许可': 'generic_watermark_text',
    '禁止转载': 'generic_watermark_text',
    '严禁转载': 'generic_watermark_text',
    '请勿转载': 'generic_watermark_text',
    '请勿盗图': 'generic_watermark_text',
    '盗图必究': 'generic_watermark_text',
    '预览': 'generic_preview_text',
    '仅供预览': 'generic_preview_text',
    '仅供参考': 'generic_preview_text',
    '样图': 'generic_sample_text',
    '样片': 'generic_sample_text',
    '样张': 'generic_sample_text',
    '样本': 'generic_sample_text',
    '示例': 'generic_sample_text',
}


def error_result(error):
    return {
        'status': 'failed',
        'outcome': 'unavailable',
        'errorType': type(error).__name__,
        'reason': str(error)[:600],
    }


def normalized_text(value):
    return re.sub(r'[\W_]+', '', value.casefold(), flags=re.UNICODE)


def known_markers(value):
    compact = normalized_text(value)
    return sorted({
        marker
        for needle, marker in KNOWN_MARKERS.items()
        if normalized_text(needle) in compact
    })


def visible_position(box, width, height):
    points = box.reshape(-1, 2)
    center_x = float(points[:, 0].mean()) / width
    center_y = float(points[:, 1].mean()) / height
    horizontal = 'left' if center_x <= 0.32 else 'right' if center_x >= 0.68 else ''
    vertical = 'top' if center_y <= 0.32 else 'bottom' if center_y >= 0.68 else ''
    return f'{vertical}_{horizontal}' if horizontal and vertical else 'other'


def visual_features(image, points, bbox, width, height):
    left, top, box_width, box_height = bbox
    quad = points.reshape(-1, 2)
    angle = math.degrees(math.atan2(quad[1][1] - quad[0][1], quad[1][0] - quad[0][0]))
    angle = ((angle + 90) % 180) - 90
    crop = image[top:top + box_height, left:left + box_width]
    if crop.size:
        rgb = crop[:, :, ::-1].reshape(-1, 3)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        mean_rgb = [int(round(channel)) for channel in np.mean(rgb, axis=0)]
        contrast = round(float(np.percentile(gray, 90) - np.percentile(gray, 10)), 2)
        margin = max(4, box_height // 2)
        outer = image[max(0, top - margin):min(height, top + box_height + margin),
                      max(0, left - margin):min(width, left + box_width + margin)]
        surrounding_delta = round(abs(float(np.mean(gray)) - float(np.mean(cv2.cvtColor(outer, cv2.COLOR_BGR2GRAY)))), 2) if outer.size else None
    else:
        mean_rgb, contrast, surrounding_delta = None, None, None
    return {
        'textHeightRatio': round(box_height / max(height, 1), 5),
        'textWidthRatio': round(box_width / max(width, 1), 5),
        'tiltDegrees': round(angle, 2),
        'meanColorRgb': mean_rgb,
        'textRegionLuminanceRange': contrast,
        'surroundingLuminanceDelta': surrounding_delta,
        'crossesCentralImage': box_width >= width * 0.22 and width * 0.25 < left + box_width / 2 < width * 0.75,
    }


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
        ocr = RapidOCR()
        # Read the full image and enlarged crops of all four corners, where
        # generated-image labels are commonly placed. Boxes map to display pixels.
        crop_width, crop_height = max(1, round(original_width * 0.38)), max(1, round(original_height * 0.38))
        left, right = 0, original_width - crop_width
        top, bottom = 0, original_height - crop_height
        regions = [
            ('full_image', image, 0, 0),
            ('top_left_crop', image[top:top + crop_height, left:left + crop_width], left, top),
            ('top_right_crop', image[top:top + crop_height, right:right + crop_width], right, top),
            ('bottom_left_crop', image[bottom:bottom + crop_height, left:left + crop_width], left, bottom),
            ('bottom_right_crop', image[bottom:bottom + crop_height, right:right + crop_width], right, bottom),
        ]
        detections = []
        for region_name, region, offset_x, offset_y in regions:
            region_height, region_width = region.shape[:2]
            scale = min(MAX_OCR_SIDE / max(region_width, region_height), 2.0 if region_name != 'full_image' else 1.0)
            if scale != 1.0:
                interpolation = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
                region = cv2.resize(region, (max(1, round(region_width * scale)), max(1, round(region_height * scale))), interpolation=interpolation)
            scale_x, scale_y = region_width / region.shape[1], region_height / region.shape[0]
            result = ocr(region)
            boxes = getattr(result, 'boxes', None) if result is not None else None
            texts = getattr(result, 'txts', None) if result is not None else None
            scores = getattr(result, 'scores', None) if result is not None else None
            if boxes is None or texts is None:
                continue
            for index, (box, raw_text) in enumerate(zip(boxes, texts)):
                text = str(raw_text).strip()
                points = np.asarray(box, dtype=np.float64).reshape(-1, 2)
                if not text or points.size == 0 or not np.isfinite(points).all():
                    continue
                points[:, 0] = points[:, 0] * scale_x + offset_x
                points[:, 1] = points[:, 1] * scale_y + offset_y
                left = max(0, math.floor(float(points[:, 0].min())))
                top = max(0, math.floor(float(points[:, 1].min())))
                right = min(original_width, math.ceil(float(points[:, 0].max())))
                bottom = min(original_height, math.ceil(float(points[:, 1].max())))
                confidence = None
                if scores is not None and index < len(scores):
                    score = float(scores[index])
                    confidence = round(score, 4) if math.isfinite(score) else None
                bbox = [left, top, max(0, right - left), max(0, bottom - top)]
                normalized = normalized_text(text)
                # Merge duplicate readings of the same text/area from two passes.
                duplicate = next((item for item in detections if item['normalized'] == normalized and
                    abs(item['bboxXYWH'][0] - left) < max(24, bbox[2]) and
                    abs(item['bboxXYWH'][1] - top) < max(24, bbox[3])), None)
                detection = {
                    'recognizedText': text[:256], 'normalized': normalized,
                    'confidence': confidence, 'bboxXYWH': bbox,
                    'region': region_name,
                    'position': visible_position(points, original_width, original_height),
                    'visualFeatures': visual_features(image, points, bbox, original_width, original_height),
                }
                if duplicate is None:
                    detections.append(detection)
                elif (confidence or 0) > (duplicate['confidence'] or 0):
                    duplicate.update(detection)

        repeated_groups = []
        for index, item in enumerate(detections):
            if any(index in group for group in repeated_groups):
                continue
            group = [index]
            for other_index in range(index + 1, len(detections)):
                other = detections[other_index]
                text_similarity = SequenceMatcher(None, item['normalized'], other['normalized']).ratio()
                left_color = item['visualFeatures']['meanColorRgb']
                right_color = other['visualFeatures']['meanColorRgb']
                color_distance = (sum((a - b) ** 2 for a, b in zip(left_color, right_color)) ** 0.5) if left_color and right_color else 999
                size_ratio = max(item['bboxXYWH'][3], other['bboxXYWH'][3]) / max(1, min(item['bboxXYWH'][3], other['bboxXYWH'][3]))
                if text_similarity >= 0.72 and color_distance <= 65 and size_ratio <= 1.8:
                    group.append(other_index)
            if len(group) > 1:
                repeated_groups.append(group)
        group_for_index = {index: f'repeat-{number + 1}' for number, group in enumerate(repeated_groups) for index in group}
        candidates = []
        for index, item in enumerate(detections):
            markers = known_markers(item['recognizedText'])
            repeated = next((len(group) for group in repeated_groups if index in group), 1)
            features = item['visualFeatures']
            visual_overlay_hint = features['crossesCentralImage'] and abs(features['tiltDegrees']) >= 12 and (features['surroundingLuminanceDelta'] or 0) >= 8
            if not markers and repeated < 2 and not visual_overlay_hint:
                continue
            reasons = ['keyword_match'] if markers else []
            if repeated >= 2:
                reasons.append('similar_text_style_and_content_repeated')
            if item['position'] != 'other':
                reasons.append(f"{item['position']}_corner_placement")
            if visual_overlay_hint:
                reasons.append('tilted_text_crosses_subject_with_local_contrast')
            candidates.append({
                'markers': markers or ['generic_visual_watermark_candidate'],
                'recognizedText': item['recognizedText'],
                'confidence': item['confidence'],
                'bboxXYWH': item['bboxXYWH'],
                'coordinateSpace': 'display_image_pixels',
                'ruleEvidence': reasons,
                'repeatCount': repeated,
                'repeatGroupId': group_for_index.get(index),
                'visualFeatures': features,
                'region': item['region'],
                'limitation': 'OCR文字、位置和重复模式只形成候选线索；普通正文或角标也可能误命中，不能确认来源。',
            })
        return {
            'status': 'completed',
            'engine': 'RapidOCR',
            'engineVersion': importlib.metadata.version('rapidocr'),
            'outcome': 'candidate_visible_text_found' if candidates else 'no_known_visible_text_found',
            'imageDimensions': [original_width, original_height],
            'maxOcrSide': MAX_OCR_SIDE,
            'recognizedTexts': [{key: value for key, value in item.items() if key != 'normalized'} for item in detections[:200]],
            'candidates': candidates[:40],
            'rules': ['keyword_match', 'corner_placement', 'similar_text_style_and_content_repeated', 'tilted_text_crosses_subject_with_local_contrast'],
            'limitation': '对全图及四角区域执行OCR，保留所有识别文本及位置/颜色/几何特征；字体未被分类，颜色/尺寸仅是近似量。规则仅输出疑似叠加文字候选，可能误报，不验证图像来源。',
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
        decoder_path = str(
            importlib.metadata.distribution('invisible-watermark').locate_file(
                'imwatermark/maxDct.py'
            )
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
