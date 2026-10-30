"""Batch RITA observation on the local CASIA subset with native-size pixel metrics."""
import argparse
import contextlib
import csv
import hashlib
import json
from pathlib import Path
import sys
import time
import types

import numpy as np
from PIL import Image, ImageOps
from sklearn.metrics import roc_auc_score

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend/common'))
from evaluation import metrics, canonical_annotation
sys.path.insert(0, str(ROOT / 'backend/rita'))
from postprocess import decode_sequence

#PINNED_SOURCE_SHA256 = '599223ee738f81d5e3fa55cba881277b4aa7e4e97e40b9e60b2fa001cb0df4b4'
PINNED_SOURCE_SHA256 = '4ab0cb2a76ce537833589d12b54a4599322a5a5ba6a5277378d21c093c002c56'
UPSTREAM_COMMIT = 'b50efcd5b4c41b8bfc69b0b10ce6230dcb67b983'


def digest(path):
    hasher = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(block)
    return hasher.hexdigest()


def load_model(config, device):
    source = Path(config['upstreamPath'])
    checkpoint = Path(config['checkpointPath'])
    if digest(source) != PINNED_SOURCE_SHA256:
        raise ValueError('RITA 源码校验失败')
    if config.get('checkpointSha256') and digest(checkpoint) != config['checkpointSha256']:
        raise ValueError('RITA 权重哈希与配置不一致')
    import torch
    module = types.ModuleType('srdp_pinned_rita')
    module.__file__ = str(source)
    text = source.read_text(encoding='utf-8')
    old = "MixVisionTransformer('/mnt/data0/xuekang/workspace/convswin/mit_b3.pth')"
    if text.count(old) != 1:
        raise ValueError('无法识别官方预训练路径')
    text = text.replace(old, 'MixVisionTransformer(pretrain_path=None)')
    with contextlib.redirect_stdout(sys.stderr):
        exec(compile(text, str(source), 'exec'), module.__dict__)
        model = module.RITA(num_classes=4)
        payload = torch.load(checkpoint, map_location='cpu', weights_only=True)
        state = payload
        if isinstance(payload, dict):
            for name in ('state_dict', 'model'):
                if name in payload and isinstance(payload[name], dict):
                    state = payload[name]
                    break
        if all(key.startswith('module.') for key in state):
            state = {key[7:]: value for key, value in state.items()}
        model.load_state_dict(state, strict=True)
        model = model.to(device).eval()
    return model, len(state), digest(checkpoint)


def infer(model, image, device, max_steps=10):
    import torch
    pixels = np.asarray(image.resize((512, 512), Image.Resampling.BICUBIC), dtype=np.float32) / 255
    tensor = torch.from_numpy(pixels.transpose(2, 0, 1).copy()).to(device)
    mean = torch.tensor([0.485, 0.456, 0.406], device=device)[:, None, None]
    std = torch.tensor([0.229, 0.224, 0.225], device=device)[:, None, None]
    tensor = (tensor - mean) / std
    current = torch.full((512, 512), 3, dtype=torch.long, device=device)
    labels, responses = [], []
    with torch.inference_mode():
        for step in range(max_steps):
            iteration = torch.full((1, 512, 512), float(step), device=device)
            inputs = torch.cat([tensor, current[None].float(), iteration], dim=0)[None]
            logits = model(inputs).float()
            if not torch.isfinite(logits).all():
                raise ValueError('模型产生非有限数值')
            predicted = logits.argmax(dim=1)[0]
            labels.append(predicted.cpu().numpy().astype(np.uint8))
            responses.append(logits.softmax(dim=1)[0, 0].cpu().numpy())
            if bool(torch.all(predicted == 2)):
                break
            current = predicted
    mask, response, statistics = decode_sequence(labels, responses, image.size)
    return mask, response, statistics, len(labels)


def run(args):
    config = json.loads(args.config.read_text(encoding='utf-8-sig'))
    for key in ('upstreamPath', 'checkpointPath'):
        config[key] = str((ROOT / config[key]).resolve())
    args.output.mkdir(parents=True, exist_ok=True)
    entries = []
    for split in ('train', 'validation', 'test'):
        for item in json.loads((args.casia_root / f'{split}_manifest.json').read_text(encoding='utf-8')):
            name = Path(item['path']).name
            label = int(item['label'] != 'real')
            entries.append({**item, 'label': label, 'split': split,
                            'kind': 'real' if not label else 'copy_move' if name.startswith('Tp_S_') else 'splicing'})
    if args.limit:
        entries = entries[:args.limit]
    print(f'Observe {len(entries)} local CASIA images with RITA (maxSteps=10)', flush=True)
    import torch
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    started = time.perf_counter()
    model, state_keys, checkpoint_sha = load_model(config, device)
    print(f'RITA strict loaded ({state_keys} state keys); no threshold tuning.', flush=True)
    rows = []
    for index, item in enumerate(entries):
        try:
            with Image.open(item['path']) as opened:
                orientation = opened.getexif().get(274, 1)
                image = ImageOps.exif_transpose(opened).convert('RGB')
            mask, response, statistics, steps = infer(model, image, device)
            predicted = mask > 0
            row = {**item, 'score': statistics['score'], 'steps': steps,
                   'selectedStep': statistics['selectedStep'], 'predictedAreaFraction': float(predicted.mean()),
                   'pixelF1': None, 'pixelIoU': None, 'pixelAUC': None}
            if item['label']:
                truth = canonical_annotation(item['mask'], orientation)
                if truth.shape != predicted.shape:
                    raise ValueError('原图与真值几何不一致')
                tp = int((predicted & truth).sum()); fp = int((predicted & ~truth).sum()); fn = int((~predicted & truth).sum())
                row['pixelF1'] = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.
                row['pixelIoU'] = tp / (tp + fp + fn) if tp + fp + fn else 0.
                if truth.any() and not truth.all():
                    row['pixelAUC'] = float(roc_auc_score(truth.ravel(), response.ravel()))
            rows.append(row)
            if (index + 1) % 40 == 0 or index + 1 == len(entries):
                print(f'{index + 1}/{len(entries)}', flush=True)
        except Exception as error:
            print(f'ERROR {item["path"]}: {error}', flush=True)
    fields = ['path', 'label', 'split', 'kind', 'score', 'steps', 'selectedStep', 'predictedAreaFraction',
              'pixelF1', 'pixelIoU', 'pixelAUC']
    with (args.output / 'predictions.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader(); writer.writerows(rows)
    positive = [row for row in rows if row['label'] == 1]
    real = [row for row in rows if row['label'] == 0]

    def mean(values):
        return float(np.mean(values)) if values else None

    labels_present = {row['label'] for row in rows}
    summary = {
        'purpose': 'local_CASIA_subset_RITA_observation_not_independent_benchmark',
        'nominalCount': len(entries), 'evaluatedCount': len(rows),
        'audit': {'upstreamCommit': UPSTREAM_COMMIT, 'sourceSha256': PINNED_SOURCE_SHA256,
                  'checkpointSha256': checkpoint_sha, 'strictStateDict': True, 'stateKeys': state_keys,
                  'inputSize': [512, 512], 'preprocessing': 'PIL_bicubic_512_RGB_div255_imagenet_norm',
                  'maxSteps': 10, 'device': device, 'torchVersion': __import__('torch').__version__},
        'classificationDiagnostic': {
            'auroc': float(roc_auc_score([row['label'] for row in rows], [row['score'] for row in rows])) if labels_present == {0, 1} else None,
            'note': 'RITA 分数为未校准响应统计，无整图阈值；AUROC 仅作诊断，不作为可用分类器。'},
        'localization': {
            'tamperedCount': len(positive),
            'macroPixelF1': mean([row['pixelF1'] for row in positive]),
            'macroPixelIoU': mean([row['pixelIoU'] for row in positive]),
            'macroPixelAUC': mean([row['pixelAUC'] for row in positive if row['pixelAUC'] is not None]),
            'emptyPredictionOnTampered': sum(row['predictedAreaFraction'] == 0 for row in positive),
            'meanPredictedAreaOnReal': mean([row['predictedAreaFraction'] for row in real])},
        'byKind': {kind: {
            'count': len([row for row in rows if row['kind'] == kind]),
            'macroPixelF1': mean([row['pixelF1'] for row in rows if row['kind'] == kind and row['pixelF1'] is not None]),
            'macroPixelAUC': mean([row['pixelAUC'] for row in rows if row['kind'] == kind and row['pixelAUC'] is not None]),
            'meanPredictedArea': mean([row['predictedAreaFraction'] for row in rows if row['kind'] == kind])}
            for kind in sorted({row['kind'] for row in rows})},
        'limitations': ['Local 479-image CASIA2 pilot subset, not an independent benchmark.',
                        'RITA score is uncalibrated; no image-level threshold was fitted.',
                        'Source overlap with training is not independently excluded.',
                        'Fixed 512x512 input may lose small regions; masks mapped back to display size.'],
        'wallSeconds': round(time.perf_counter() - started, 2)}
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, default=ROOT / 'config/rita.local.json')
    parser.add_argument('--casia-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--limit', type=int, default=0)
    run(parser.parse_args())
