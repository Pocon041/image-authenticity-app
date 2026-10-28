"""Read-only local classification observation, with fixed threshold and explicit exposure limits."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import sys
import time

from PIL import Image, ImageOps
from model_loader import load_model, predict

ROOT = Path(__file__).resolve().parents[2]


def configuration(path):
    config = json.loads(path.read_text(encoding='utf-8-sig'))
    for key in ('upstreamPath', 'clipSourcePath', 'checkpointPath'):
        config[key] = str((ROOT / config[key]).resolve())
    return config


def metrics(rows, threshold):
    from sklearn.metrics import roc_auc_score, average_precision_score
    tp = sum(row['label'] == 1 and row['score'] >= threshold for row in rows)
    tn = sum(row['label'] == 0 and row['score'] < threshold for row in rows)
    fp = sum(row['label'] == 0 and row['score'] >= threshold for row in rows)
    fn = sum(row['label'] == 1 and row['score'] < threshold for row in rows)
    real = tn + fp; fake = tp + fn
    return {
        'count':len(rows), 'realCount':real, 'fakeCount':fake,
        'truePositive':tp, 'trueNegative':tn, 'falsePositive':fp, 'falseNegative':fn,
        'accuracy':(tp+tn)/len(rows) if rows else None,
        'precision':tp/(tp+fp) if tp+fp else 0.0,
        'recall':tp/fake if fake else None,
        'specificity':tn/real if real else None,
        'falsePositiveRate':fp/real if real else None,
        'falseNegativeRate':fn/fake if fake else None,
        'balancedAccuracy':(tp/fake + tn/real)/2 if real and fake else None,
        'f1':2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else 0.0,
        'auc':float(roc_auc_score([row['label'] for row in rows],[row['score'] for row in rows])) if real and fake else None,
        'averagePrecision':float(average_precision_score([row['label'] for row in rows],[row['score'] for row in rows])) if real and fake else None
    }


def run(args):
    config = configuration(args.config)
    threshold = float(config.get('threshold', 0.5))
    if threshold != 0.5: raise ValueError('This initial observation is fixed at threshold 0.5; no tuning permitted')
    entries = []
    manifests = []
    for split in ('train', 'validation', 'test'):
        file = args.casia_root/f'{split}_manifest.json'
        content = file.read_bytes()
        manifests.append({'split':split,'sha256':hashlib.sha256(content).hexdigest()})
        for item in json.loads(content):
            name = Path(item['path']).name
            label = 0 if item['label'] == 'real' else 1
            kind = 'real' if not label else ('copy_move' if name.startswith('Tp_S_') else 'splicing' if name.startswith('Tp_D_') else 'unknown_tamper')
            entries.append({'path':item['path'],'label':label,'split':split,'kind':kind})
    if len({item['path'] for item in entries}) != len(entries): raise ValueError('Duplicate source paths in manifests')
    args.output.mkdir(parents=True, exist_ok=True)
    print(f'Found {len(entries)} local CASIA files; fixed threshold={threshold}. Loading model...',flush=True)
    started = time.perf_counter()
    model, audit = load_model(config, lambda percent,label:print(label,flush=True))
    rows, errors = [], []
    for index, item in enumerate(entries):
        try:
            with Image.open(item['path']) as original:
                image = ImageOps.exif_transpose(original).convert('RGB')
            score, elapsed = predict(model, image)
            rows.append({**item,'score':score,'prediction':int(score>=threshold),'correct':int((score>=threshold)==bool(item['label'])),'inferenceMs':elapsed})
        except Exception as error:
            errors.append({**item,'error':str(error)})
        if (index+1)%40 == 0 or index+1 == len(entries):
            print(f'{index+1}/{len(entries)}: evaluated={len(rows)}, errors={len(errors)}',flush=True)
    with (args.output/'predictions.csv').open('w',newline='',encoding='utf-8-sig') as stream:
        writer=csv.DictWriter(stream,fieldnames=['path','label','split','kind','score','prediction','correct','inferenceMs'])
        writer.writeheader(); writer.writerows(rows)
    summary = {
        'purpose':'entire_local_CASIA_subset_observation_not_independent_generalization',
        'datasetComplete':False,'threshold':threshold,'thresholdTuned':False,
        'nominalCount':len(entries),'evaluatedCount':len(rows),'errorCount':len(errors),
        'audit':audit,'sourceManifests':manifests,'overall':metrics(rows,threshold),
        'byKind':{kind:metrics([row for row in rows if row['kind']==kind],threshold) for kind in sorted({row['kind'] for row in rows})},
        'byLocalSplit':{split:metrics([row for row in rows if row['split']==split],threshold) for split in ('train','validation','test')},
        'limitations':[
            'Local CASIA subset only; not the full CASIA v2 dataset.',
            'SICA full checkpoint was described upstream as trained on all OpenMMSec; source exposure may overlap CASIA.',
            'All local train/validation/test files are observed here; split names are provenance, not an independently held-out test guarantee.',
            'Official CLIP short-edge resize and center crop are used; edge-local manipulations may fall outside the view.',
            'No threshold fitting or image-level calibration was performed.'
        ],'wallSeconds':round(time.perf_counter()-started,2)
    }
    (args.output/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    (args.output/'errors.json').write_text(json.dumps(errors,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',type=Path,default=ROOT/'config/sica.local.json')
    parser.add_argument('--casia-root',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    run(parser.parse_args())
