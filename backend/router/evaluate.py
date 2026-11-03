"""Offline validation of the zero-shot content router.

Runs the router over a manifest of images with known content labels (photo/document),
reports per-label accuracy, unsure rate and the worst-case detector-skip risk, and
sweeps candidate margin thresholds so the production threshold can be chosen and frozen
before evaluation on independent material.

The manifest is read-only input; no manipulation ground truth is used.
"""
import argparse
import csv
import json
from pathlib import Path
import sys

from model_loader import RouterError, load_base_clip
from worker import PROMPTS, compute_route

# photo misrouted to document skips RITA (photo primary localizer);
# document misrouted to photo skips RiSE (document primary localizer).
SKIP_RISK = {
    ('photo', 'document'): 'RITA 被跳过（照片误判为文档）',
    ('document', 'photo'): 'RiSE 被跳过（文档误判为照片）'
}


def resolve(path, root):
    path = Path(path)
    return str(path if path.is_absolute() else (root / path).resolve())


def run(config_path, manifest_path, output_dir, thresholds):
    import torch
    import time
    import PIL.Image
    import PIL.ImageOps
    started_all = time.perf_counter()
    config = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    root = Path(config_path).resolve().parent.parent
    resolved = dict(config)
    for key in ('checkpointPath', 'clipSourcePath'):
        if key in resolved and isinstance(resolved[key], str):
            resolved[key] = resolve(resolved[key], root)
    model, preprocess, clip, audit = load_base_clip(resolved)
    manifest = json.loads(Path(manifest_path).read_text(encoding='utf-8-sig'))
    rows = []
    errors = []
    for index, entry in enumerate(manifest):
        path = entry['path']
        label = entry['label']
        if label not in ('photo', 'document'):
            errors.append({'index': index, 'path': path, 'error': f'未知标签：{label}'})
            continue
        try:
            with PIL.Image.open(resolve(path, root)) as opened:
                image = PIL.ImageOps.exif_transpose(opened).convert('RGB')
            route = compute_route(model, preprocess, clip, image, 0.1)
        except Exception as error:
            errors.append({'index': index, 'path': path, 'error': str(error)})
            continue
        rows.append({
            'path': path, 'label': label,
            'photoScore': route['photo'], 'documentScore': route['document'],
            'margin': route['margin'], 'decision': route['decision']
        })
    labels = {}
    for row in rows:
        labels.setdefault(row['label'], []).append(row)
    def matrix(threshold):
        counts = {}
        wrong = []
        for row in rows:
            if row['photoScore'] - row['documentScore'] >= threshold:
                decision = 'photo'
            elif row['documentScore'] - row['photoScore'] >= threshold:
                decision = 'document'
            else:
                decision = 'unsure'
            key = (row['label'], decision)
            counts[key] = counts.get(key, 0) + 1
            if decision in ('photo', 'document') and decision != row['label']:
                wrong.append({'path': row['path'], 'label': row['label'],
                              'routedTo': decision, 'margin': row['margin'],
                              'risk': SKIP_RISK.get((row['label'], decision))})
        total = len(rows)
        unsure = counts.get(('photo', 'unsure'), 0) + counts.get(('document', 'unsure'), 0)
        correct = counts.get(('photo', 'photo'), 0) + counts.get(('document', 'document'), 0)
        return {
            'threshold': threshold,
            'correct': correct,
            'unsure': unsure,
            'wrongSkip': len(wrong),
            'accuracyAmongConfident': round(correct / (correct + len(wrong)), 6) if correct + len(wrong) else None,
            'unsureRate': round(unsure / total, 6) if total else None,
            'wrongSkipDetails': wrong
        }
    sweep = [matrix(float(value)) for value in thresholds]
    summary = {
        'purpose': 'content_router_validation_on_frozen_prompt_set',
        'manifestPath': str(manifest_path),
        'nominalCount': len(manifest),
        'evaluatedCount': len(rows),
        'errorCount': len(errors),
        'labels': {label: len(rows_) for label, rows_ in labels.items()},
        'audit': audit,
        'prompts': PROMPTS,
        'note': 'validation_images_read_with_pil_exif_transpose_rgb_near_but_not_equal_to_app_sharp_srgb_pipeline',
        'thresholdSweep': sweep,
        'elapsedMs': round((time.perf_counter() - started_all) * 1000)
    }
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    with (output / 'predictions.csv').open('w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.DictWriter(stream, fieldnames=[
            'path', 'label', 'photoScore', 'documentScore', 'margin', 'decision'])
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    (output / 'summary.json').write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    if errors:
        (output / 'errors.json').write_text(
            json.dumps(errors, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({
        'evaluated': len(rows), 'errors': len(errors),
        'sweep': [{key: value for key, value in entry.items() if key != 'wrongSkipDetails'}
                  for entry in sweep]
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--thresholds', default='0.05,0.1,0.15,0.2,0.25')
    args = parser.parse_args()
    try:
        run(args.config, args.manifest, args.output, args.thresholds.split(','))
    except RouterError as error:
        print(f'{error.code}: {error}', file=sys.stderr)
        sys.exit(2)
