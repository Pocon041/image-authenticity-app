"""Single-image RITA adapter. JSONL stdout is reserved for desktop protocol events."""
import argparse
import contextlib
import hashlib
import json
import sys
import time
import types
import uuid
from datetime import datetime, timezone
from pathlib import Path

#PINNED_SOURCE_SHA256 = '599223ee738f81d5e3fa55cba881277b4aa7e4e97e40b9e60b2fa001cb0df4b4'
PINNED_SOURCE_SHA256 = '4ab0cb2a76ce537833589d12b54a4599322a5a5ba6a5277378d21c093c002c56'
UPSTREAM_COMMIT = 'b50efcd5b4c41b8bfc69b0b10ce6230dcb67b983'


class AdapterError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def emit(kind, **payload):
    print(json.dumps({'type': kind, **payload}, ensure_ascii=False, allow_nan=False), flush=True)


def digest(path):
    hasher = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            hasher.update(block)
    return hasher.hexdigest()


def run(request):
    started = time.perf_counter()
    source = Path(request['upstreamPath'])
    checkpoint = Path(request['checkpointPath'])
    if not checkpoint.is_file():
        raise AdapterError('MODEL_NOT_READY', f'RITA 权重不存在，请将官方 rita_catnet.pth 放到 {checkpoint}')
    if not source.is_file():
        raise AdapterError('MODEL_NOT_READY', '缺少官方 RITA 代码，请先执行 npm.cmd run rita:setup。')
    if digest(source) != PINNED_SOURCE_SHA256:
        raise AdapterError('INVALID_MODEL', 'RITA 源码校验失败，请重新执行 rita:setup。')
    emit('progress', percent=10, label='核对原文件与模型权重')
    if digest(request['originalPath']) != request['image']['sha256']:
        raise AdapterError('INVALID_IMAGE', '输入原文件身份已变化，请重新导入。')
    checkpoint_hash = digest(checkpoint)
    expected_hash = request.get('checkpointSha256')
    if expected_hash and expected_hash != checkpoint_hash:
        raise AdapterError('INVALID_MODEL', '权重 SHA256 与本机配置不一致。')
    import numpy as np
    import torch
    from PIL import Image
    from postprocess import decode_sequence, regions_from_mask
    if request.get('device', 'auto') not in ('auto', 'cpu', 'cuda'):
        raise AdapterError('INVALID_REQUEST', 'device 必须是 auto、cpu 或 cuda。')
    device = request.get('device', 'auto')
    if device == 'auto':
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
    if device == 'cuda' and not torch.cuda.is_available():
        raise AdapterError('MODEL_NOT_READY', '配置要求 CUDA，但当前 PyTorch 无法使用 CUDA。')
    torch.set_num_threads(min(4, torch.get_num_threads()))
    if device == 'cuda':
        torch.cuda.reset_peak_memory_stats()
    module = types.ModuleType('srdp_pinned_rita')
    module.__file__ = str(source)
    source_text = source.read_text(encoding='utf-8')
    old = "MixVisionTransformer('/mnt/data0/xuekang/workspace/convswin/mit_b3.pth')"
    if source_text.count(old) != 1:
        raise AdapterError('INVALID_MODEL', '无法识别官方预训练路径；拒绝自动修改未知代码。')
    # A complete task checkpoint is strictly loaded below. No backbone bootstrap file is needed.
    source_text = source_text.replace(old, 'MixVisionTransformer(pretrain_path=None)')
    with contextlib.redirect_stdout(sys.stderr):
        exec(compile(source_text, str(source), 'exec'), module.__dict__)
        model = module.RITA(num_classes=4)
        payload = torch.load(checkpoint, map_location='cpu', weights_only=True)
        state = payload
        if isinstance(payload, dict):
            for name in ('state_dict', 'model'):
                if name in payload and isinstance(payload[name], dict):
                    state = payload[name]
                    break
        if not isinstance(state, dict) or not state:
            raise AdapterError('INVALID_MODEL', '权重不是可识别的 state_dict。')
        if all(key.startswith('module.') for key in state):
            state = {key[7:]: value for key, value in state.items()}
        try:
            model.load_state_dict(state, strict=True)
        except RuntimeError as error:
            raise AdapterError('INVALID_MODEL', f'官方四类模型严格加载失败：{error}') from error
        model = model.to(device).eval()
    emit('progress', percent=25, label='官方权重严格加载完成，开始单图推理')
    image = Image.open(request['displayPath']).convert('RGB')
    size = (request['image']['width'], request['image']['height'])
    if image.size != size:
        raise AdapterError('INVALID_IMAGE', '规范显示图尺寸与协议不一致。')
    # Matches torchvision Resize((512,512), BICUBIC), ToTensor, ImageNet Normalize.
    pixels = np.asarray(image.resize((512, 512), Image.Resampling.BICUBIC), dtype=np.float32) / 255
    tensor = torch.from_numpy(pixels.transpose(2, 0, 1).copy()).to(device)
    mean = torch.tensor([0.485, 0.456, 0.406], device=device)[:, None, None]
    std = torch.tensor([0.229, 0.224, 0.225], device=device)[:, None, None]
    tensor = (tensor - mean) / std
    current = torch.full((512, 512), 3, dtype=torch.long, device=device)
    labels, responses, steps = [], [], []
    max_steps = request.get('maxSteps', 10)
    if not isinstance(max_steps, int) or isinstance(max_steps, bool) or not 1 <= max_steps <= 20:
        raise AdapterError('INVALID_REQUEST', 'maxSteps 应在 1 到 20 之间。')
    threshold = request.get('decisionThreshold')
    if threshold is not None and (not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not 0 <= threshold <= 1):
        raise AdapterError('INVALID_REQUEST', 'decisionThreshold 必须为空或 0 到 1 的数值。')
    stopped = 'max_steps'
    inference_started = time.perf_counter()
    with torch.inference_mode():
        for step in range(max_steps):
            iteration = torch.full((1, 512, 512), float(step), device=device)
            inputs = torch.cat([tensor, current[None].float(), iteration], dim=0)[None]
            logits = model(inputs).float()
            if not torch.isfinite(logits).all():
                raise AdapterError('INFERENCE_FAILED', '模型产生非有限数值，未保存定位结果。')
            predicted = logits.argmax(dim=1)[0]
            label = predicted.cpu().numpy().astype(np.uint8)
            # All four classes remain in the denominator; do not renormalize away control tokens.
            response = logits.softmax(dim=1)[0, 0].cpu().numpy()
            labels.append(label); responses.append(response)
            fractions = [float(np.mean(label == index)) for index in range(4)]
            steps.append({'index': step, 'classFractions': fractions})
            emit('progress', percent=30 + int(45 * (step+1)/max_steps), label=f'RITA 推理步骤 {step+1}/{max_steps}')
            if bool(torch.all(predicted == 2)):
                stopped = 'eos'
                break
            current = predicted
    inference_ms = round((time.perf_counter()-inference_started)*1000)
    mask, response, statistics = decode_sequence(labels, responses, size, threshold)
    region_entries, region_count = regions_from_mask(mask)
    output = Path(request['outputDirectory'])
    (output / 'artifacts').mkdir(parents=True, exist_ok=True)
    Image.fromarray(mask).save(output / 'artifacts/mask.png')
    Image.fromarray(np.rint(response*255).astype(np.uint8)).save(output / 'artifacts/response.png')
    overlay = np.asarray(image).astype(np.float32)
    selected = mask > 0
    overlay[selected] = overlay[selected]*0.55 + np.array([238, 88, 82])*0.45
    Image.fromarray(overlay.astype(np.uint8)).save(output / 'artifacts/overlay.png')
    report_id = f'report-{uuid.uuid4()}'
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
        region_id = f'{report_id}:region-{index+1}'
        crop_uri = f'artifacts/crop-{index+1}.png'
        image.crop((x, y, x+width, y+height)).save(output / crop_uri)
        crop = artifact(f'{region_id}:crop', 'crop', crop_uri, 'region_local_pixels', box)
        artifacts.append(crop)
        regions.append({'regionId': region_id, **entry, 'coordinateSpace': 'display_image_pixels', 'maskArtifactId': mask_id, 'cropArtifactId': crop['artifactId']})
    score = statistics['score']
    limitations = [
        'RITA 输出为定位模型响应，未校准为图像真实性概率。',
        '推理步骤不是已证实的真实编辑历史，当前不识别具体编辑手段。',
        '固定 512×512 模型输入可能丢失细小区域；定位已映射回规范显示坐标。',
        '当前权重的训练数据覆盖与目标场景泛化尚需验证。'
    ]
    if threshold is None:
        limitations.append('尚未设定经验证的整图判断阈值，整图结论保留为 inconclusive。')
    else:
        limitations.append('当前整图阈值由配置提供，尚不能视为经过充分质量验证。')
    if statistics['selectedStep'] is None:
        limitations.append('未产生可用的定位步骤，空掩码不表示图片真实。')
    report = {
        'schemaVersion': '1.0', 'reportId': report_id, 'moduleId': 'manipulation',
        'imageId': request['image']['imageId'], 'taskId': request['taskId'], 'mode': 'local', 'status': 'completed',
        'producer': {'name': 'RITA-CATNet-adapter', 'version': f'1.0.0+{UPSTREAM_COMMIT[:7]}'},
        'createdAt': datetime.now(timezone.utc).isoformat(), 'elapsedMs': round((time.perf_counter()-started)*1000),
        'inputReportIds': [], 'result': {
            'decision': statistics['decision'],
            'score': {'name': 'top_1pct_valid_pixels_class0_softmax', 'value': score, 'positiveClass': 'tampered', 'calibrated': False} if score is not None else None,
            'regions': regions, 'operationHints': [], 'localization': statistics,
            'responseEncoding': {'range': [0, 255], 'scale': 'round(class0_softmax*255)', 'calibrated': False},
            'regionCount': region_count, 'returnedRegionCount': len(regions), 'manipulatedAreaFraction': float(selected.mean()),
            'sequence': {'steps': steps, 'stoppedBy': stopped, 'interpretation': 'model_inference_steps_not_verified_edit_history'}
        },
        'evidence': [{ 'evidenceId': f'{report_id}:e1', 'kind': 'model_localization', 'origin': 'measured',
            'description': '官方 RITA 权重严格加载后执行的单图像素响应与定位结果。', 'regionId': None,
            'artifactIds': [mask_id, f'{report_id}:response'],
            'data': {'score': score, 'selectedStep': statistics['selectedStep'], 'decisionThreshold': threshold},
            'limitation': '模型响应未校准，不能直接还原编辑工具或历史。' }],
        'artifacts': artifacts, 'limitations': limitations, 'error': None,
        'extensions': {'upstreamCommit': UPSTREAM_COMMIT, 'checkpointSha256': checkpoint_hash,
            'checkpointDigestPinned': bool(expected_hash), 'strictStateDict': True, 'device': device,
            'torchVersion': torch.__version__, 'inputSize': [512, 512], 'inferenceMs': inference_ms,
            'peakCudaMemoryBytes': torch.cuda.max_memory_allocated() if device == 'cuda' else None}
    }
    # The caller adds canonical image artifacts to the global bundle index.
    bundle = { 'schemaVersion': '1.0', 'bundleId': f'bundle-{uuid.uuid4()}', 'purpose': 'analysis',
        'createdAt': report['createdAt'], 'image': request['image'], 'reports': [report],
        'artifacts': request['imageArtifacts'] + artifacts }
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    (output / 'bundle.json').write_text(json.dumps(bundle, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    emit('progress', percent=100, label='定位完成，报告已保存')
    emit('result', bundlePath=str(output / 'bundle.json'), overlayPath=str(output / 'artifacts/overlay.png'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True)
    arguments = parser.parse_args()
    try:
        request = json.loads(Path(arguments.request).read_text(encoding='utf-8-sig'))
        run(request)
    except AdapterError as error:
        emit('error', code=error.code, message=str(error))
        sys.exit(2)
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        emit('error', code='INFERENCE_FAILED', message=f'RITA 运行失败：{error}')
        sys.exit(1)
