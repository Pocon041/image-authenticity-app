"""Single-image RiSE-9 RGB tiled localization. Progress/error/result events use JSONL stdout."""
import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from adapter import COMMIT, RisePredictor, digest


class WorkerError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def emit(kind, **payload):
    print(json.dumps({'type': kind, **payload}, ensure_ascii=False, allow_nan=False), flush=True)


def regions_from_mask(mask, max_regions=20):
    import cv2
    count, _labels, stats, _centroids = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    entries = sorted(stats[1:count], key=lambda entry: int(entry[4]), reverse=True)
    return [{'bboxXYWH': [int(n) for n in entry[:4]], 'areaPixels': int(entry[4])} for entry in entries[:max_regions]], max(0, count - 1)


def run(request):
    started = time.perf_counter()
    if digest(request['originalPath']) != request['image']['sha256']:
        raise WorkerError('INVALID_IMAGE', '输入原文件身份不一致。')
    emit('progress', percent=8, label='核对原文件与官方源码')
    try:
        model = RisePredictor(request)
    except Exception as error:
        raise WorkerError('INVALID_MODEL', f'RiSE 权重、依赖或源码校验失败：{error}') from error
    emit('progress', percent=25, label='RiSE-9 RGB 严格加载完成，开始全图分块推理')
    with Image.open(request['displayPath']) as opened:
        image = opened.convert('RGB')
    if image.size != (request['image']['width'], request['image']['height']):
        raise WorkerError('INVALID_IMAGE', '规范显示图尺寸不一致。')
    mask, score_map, audit = model.predict(image, progress=lambda done, total: emit('progress', percent=25+round(60*done/total), label=f'RiSE 分块推理 {done}/{total}（九专家顺序执行）'))
    np.save(Path(request['outputDirectory']) / 'response.float32.npy', score_map)
    emit('progress', percent=88, label='生成掩码、区域与叠加图')
    region_entries, region_count = regions_from_mask(mask)
    values = score_map.ravel()
    count = max(1, int(np.ceil(values.size * 0.01)))
    score = float(np.partition(values, values.size - count)[-count:].mean())
    report_id = f'report-{uuid.uuid4()}'
    output = Path(request['outputDirectory'])
    (output / 'artifacts').mkdir(parents=True, exist_ok=True)
    Image.fromarray((mask * 255).astype(np.uint8)).save(output / 'artifacts/mask.png')
    Image.fromarray(np.rint(score_map * 255).astype(np.uint8)).save(output / 'artifacts/response.png')
    overlay = np.asarray(image).astype(np.float32)
    selected = mask > 0
    overlay[selected] = overlay[selected] * 0.55 + np.array([238, 88, 82]) * 0.45
    Image.fromarray(overlay.astype(np.uint8)).save(output / 'artifacts/overlay.png')

    def artifact(name, kind, uri, space='display_image_pixels', bbox=None):
        path = output / uri
        with Image.open(path) as content:
            width, height = content.size
        return {'artifactId': name, 'type': kind, 'uri': uri, 'mediaType': 'image/png',
                'sha256': digest(path), 'width': width, 'height': height, 'coordinateSpace': space,
                'bboxXYWH': bbox, 'sourceArtifactId': request['image']['displayArtifactId'], 'origin': 'derived'}

    mask_id = f'{report_id}:mask'
    artifacts = [artifact(mask_id, 'mask', 'artifacts/mask.png'), artifact(f'{report_id}:response', 'heatmap', 'artifacts/response.png')]
    regions = []
    for index, entry in enumerate(region_entries):
        box = entry['bboxXYWH']
        x, y, width, height = box
        region_id = f'{report_id}:region-{index + 1}'
        crop_uri = f'artifacts/crop-{index + 1}.png'
        image.crop((x, y, x + width, y + height)).save(output / crop_uri)
        crop = artifact(f'{region_id}:crop', 'crop', crop_uri, 'region_local_pixels', box)
        artifacts.append(crop)
        regions.append({'regionId': region_id, **entry, 'coordinateSpace': 'display_image_pixels',
                        'maskArtifactId': mask_id, 'cropArtifactId': crop['artifactId']})
    limitations = [
        '本次仅运行 RiSE-9 RGB 视觉定位，未运行 SICA、OCR、AI生成专用检测或VLM。',
        '像素响应与专家选择分数均未经图像级校准，整图判断保留为inconclusive。',
        '全图采用512×512重叠分块并平均响应，与论文预裁剪输入协议不同，可能产生边缘效应。',
        '手工擦除、物理编辑及重新拍摄效果未通过本项目质量验收；未标记不代表真实。',
        '最多展示20个连通区域裁剪，完整掩码和float32响应保留全部像素。'
    ]
    timestamp = datetime.now(timezone.utc).isoformat()
    report = {
        'schemaVersion': '1.0', 'reportId': report_id, 'moduleId': 'manipulation',
        'imageId': request['image']['imageId'], 'taskId': request['taskId'], 'mode': 'local', 'status': 'completed',
        'producer': {'name': 'RiSE-9-RGB', 'version': f'1.0.0+{COMMIT[:7]}'},
        'createdAt': timestamp, 'elapsedMs': round((time.perf_counter() - started) * 1000), 'inputReportIds': [],
        'result': {
            'decision': 'inconclusive',
            'score': {'name': 'top_1pct_mask_probability', 'value': score, 'positiveClass': 'tampered', 'calibrated': False},
            'regions': regions, 'operationHints': [],
            'localization': {'status': 'completed', 'regionCount': region_count,
                'manipulatedAreaFraction': float(selected.mean()), 'maskThreshold': 0.5,
                'decision': 'inconclusive', 'reason': 'uncalibrated_image_score_no_validated_threshold'},
            'preprocessing': {'strategy': 'native_resolution_overlapping_tiles', 'inputSize': [512, 512], 'maskThreshold': 0.5, 'tileStride': model.stride}
        },
        'evidence': [{'evidenceId': f'{report_id}:e1', 'kind': 'model_localization', 'origin': 'measured',
            'description': '官方 RiSE-9 RGB 权重严格加载后执行全图分块视觉定位。', 'regionId': None,
            'artifactIds': [mask_id, f'{report_id}:response'],
            'data': {'score': score, 'maskThreshold': 0.5, 'regionCount': region_count},
            'limitation': '像素响应及LPC专家选择分数不代表整图真实性概率。'}],
        'artifacts': artifacts, 'limitations': limitations, 'error': None,
        'extensions': {**audit, 'rawResponse': {'uri': 'response.float32.npy', 'sha256': digest(output / 'response.float32.npy'), 'dtype': 'float32', 'coordinateSpace': 'display_image_pixels'}}
    }
    bundle = {'schemaVersion': '1.0', 'bundleId': f'bundle-{uuid.uuid4()}', 'purpose': 'analysis', 'createdAt': timestamp,
              'image': request['image'], 'reports': [report], 'artifacts': request['imageArtifacts'] + artifacts}
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    (output / 'bundle.json').write_text(json.dumps(bundle, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    emit('progress', percent=100, label='RiSE 定位完成，报告已保存')
    emit('result', bundlePath=str(output / 'bundle.json'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True, type=Path)
    args = parser.parse_args()
    try:
        run(json.loads(args.request.read_text(encoding='utf-8-sig')))
    except WorkerError as error:
        emit('error', code=error.code, message=str(error))
        sys.exit(2)
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        emit('error', code='INFERENCE_FAILED', message=f'RiSE 运行失败：{error}')
        sys.exit(1)
