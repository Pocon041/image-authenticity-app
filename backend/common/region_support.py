"""Report pixel support without changing masks or claiming localization accuracy."""
import numpy as np


def _validated_response(mask, response):
    response = np.asarray(response)
    if response.shape != np.asarray(mask).shape or response.ndim != 2:
        raise ValueError('Mask and response must have the same 2D shape')
    if not np.isfinite(response).all() or np.any((response < 0) | (response > 1)):
        raise ValueError('Response must contain finite values in [0, 1]')
    return response


def _support(values):
    if values.size == 0:
        return None
    return {
        'value': float(values.mean(dtype=np.float64)),
        'description': '标记区域内像素的平均篡改响应',
        'target': 'marked_region_pixels', 'source': 'mean_tamper_response',
        'calibrated': False, 'comparableAcrossModels': False
    }


def mask_pixel_support(mask, response):
    response = _validated_response(mask, response)
    return _support(response[np.asarray(mask) > 0])


def regions_with_support(mask, max_regions=20, response=None):
    import cv2
    if response is not None:
        response = _validated_response(mask, response)
    count, labels, stats, _ = cv2.connectedComponentsWithStats((np.asarray(mask) > 0).astype(np.uint8), 8)
    ordered = sorted(enumerate(stats[1:count], 1), key=lambda pair: int(pair[1][4]), reverse=True)
    regions = []
    for component, entry in ordered[:max_regions]:
        x, y, width, height = [int(n) for n in entry[:4]]
        region = {'bboxXYWH': [x, y, width, height], 'areaPixels': int(entry[4])}
        if response is not None:
            # Use this connected component only, excluding background and other
            # components even when their bounding boxes overlap.
            selected = labels[y:y+height, x:x+width] == component
            region['confidence'] = _support(response[y:y+height, x:x+width][selected])
        regions.append(region)
    return regions, max(0, count - 1)
