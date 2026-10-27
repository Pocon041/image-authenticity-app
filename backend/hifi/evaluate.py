"""CASIA local observation: independent classification and ungated native-size localization."""
import argparse
import csv
import json
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image,ImageOps
from sklearn.metrics import roc_auc_score
from model_loader import HiFiPredictor

ROOT=Path(__file__).resolve().parents[2]
from metrics import metrics


def canonical_annotation(path,orientation):
    mask=Image.open(path).convert('L')
    methods={2:Image.Transpose.FLIP_LEFT_RIGHT,3:Image.Transpose.ROTATE_180,4:Image.Transpose.FLIP_TOP_BOTTOM,
        5:Image.Transpose.TRANSPOSE,6:Image.Transpose.ROTATE_270,7:Image.Transpose.TRANSVERSE,8:Image.Transpose.ROTATE_90}
    return np.asarray(mask.transpose(methods[orientation]) if orientation in methods else mask)>127


def classification(rows,rule):
    if rule=='threshold_0.5':return metrics(rows,0.5)
    # Reuse metric definitions while keeping author argmax-based labels for thresholded metrics.
    changed=[{**row,'score':float(row['nativePrediction'])} for row in rows]
    result=metrics(changed,0.5)
    result['auc']=float(roc_auc_score([row['label'] for row in rows],[row['score'] for row in rows])) if {row['label'] for row in rows}=={0,1} else None
    result['averagePrecision']=metrics(rows,0.5)['averagePrecision']
    return result


def localization(rows):
    positive=[row for row in rows if row['label']==1]
    real=[row for row in rows if row['label']==0]
    return {'tamperedCount':len(positive),'macroPixelF1':float(np.mean([row['pixelF1'] for row in positive])) if positive else None,
        'macroPixelIoU':float(np.mean([row['pixelIoU'] for row in positive])) if positive else None,
        'macroPixelAUC':float(np.mean([row['pixelAUC'] for row in positive if row['pixelAUC'] is not None])) if any(row['pixelAUC'] is not None for row in positive) else None,
        'emptyPredictionOnTampered':sum(row['predictedAreaFraction']==0 for row in positive),
        'meanPredictedAreaOnReal':float(np.mean([row['predictedAreaFraction'] for row in real])) if real else None}


def run(args):
    config=json.loads(args.config.read_text(encoding='utf-8-sig'))
    for key in ('sourcePath','dependencyPath','encoderPath','detectorPath','centerPath'):config[key]=str((ROOT/config[key]).resolve())
    args.output.mkdir(parents=True,exist_ok=True)
    entries=[]
    for split in ('train','validation','test'):
        for item in json.loads((args.casia_root/f'{split}_manifest.json').read_text(encoding='utf-8')):
            name=Path(item['path']).name
            label=int(item['label']!='real')
            entries.append({**item,'label':label,'split':split,'kind':'real' if not label else 'copy_move' if name.startswith('Tp_S_') else 'splicing'})
    print(f'Observe {len(entries)} local CASIA images; general 750001, localization threshold=2.3',flush=True)
    started=time.perf_counter();model=HiFiPredictor(config)
    print('Both model state_dicts strictly loaded; no threshold fitting.',flush=True)
    rows=[];errors=[]
    selected=sorted({0,len(entries)//2,len(entries)-1})
    for index,item in enumerate(entries):
        try:
            with Image.open(item['path']) as opened:
                orientation=opened.getexif().get(274,1)
                image=ImageOps.exif_transpose(opened).convert('RGB')
            result,prediction,distance=model.predict(image)
            mask=prediction>0
            row={**item,**result,'pixelF1':None,'pixelIoU':None,'pixelAUC':None}
            if item['label']:
                truth=canonical_annotation(item['mask'],orientation)
                if truth.shape!=mask.shape:raise ValueError('Native image / ground truth geometry mismatch')
                tp=int((mask&truth).sum());fp=int((mask&~truth).sum());fn=int((~mask&truth).sum())
                row['pixelF1']=2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else 0.
                row['pixelIoU']=tp/(tp+fp+fn) if tp+fp+fn else 0.
                if truth.any() and not truth.all():row['pixelAUC']=float(roc_auc_score(truth.ravel(),distance.ravel()))
            rows.append(row)
            if index in selected:
                folder=args.output/f'preview-{index:03d}';folder.mkdir(exist_ok=True)
                image.save(folder/'display.png');Image.fromarray(prediction).save(folder/'prediction.png')
                np.save(folder/'distance.npy',distance)
            if (index+1)%40==0 or index+1==len(entries):print(f'{index+1}/{len(entries)}, errors={len(errors)}',flush=True)
        except Exception as error:
            errors.append({'path':item['path'],'error':str(error)})
            print(f'ERROR {item["path"]}: {error}',flush=True)
    fields=['path','label','split','kind','score','nativePrediction','predictionAtPointFive','leafIndex','leafLabel','pixelF1','pixelIoU','pixelAUC','predictedAreaFraction','distanceMin','distanceMax','distanceMean','inferenceMs']
    with (args.output/'predictions.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fields,extrasaction='ignore');writer.writeheader();writer.writerows(rows)
    summary={'purpose':'local_CASIA_subset_general_HiFi_750001_observation_not_independent_benchmark',
        'nominalCount':len(entries),'evaluatedCount':len(rows),'errorCount':len(errors),'thresholdTuned':False,'audit':model.audit,
        'classificationNativeArgmax':classification(rows,'native'), 'classificationThresholdPointFive':classification(rows,'threshold_0.5'),
        'nativeAndThresholdDisagreements':sum(row['nativePrediction']!=row['predictionAtPointFive'] for row in rows),
        'localization':localization(rows),
        'byKind':{kind:{'classification':classification([row for row in rows if row['kind']==kind],'native'),'localization':localization([row for row in rows if row['kind']==kind])} for kind in sorted({row['kind'] for row in rows})},
        'limitations':['Local 479-image subset, not full CASIA v2.','General 750001 weights, not dedicated localization 225000 weights.',
            'Source overlap with training is not independently excluded.','Official API 256-square bicubic preprocessing and distance threshold 2.3 retained.',
            'Metrics use original display dimensions, no ground-truth-driven inversion, border omission or threshold selection.',
            'Localization measured on all tampered images regardless of classification, not only detected positives.'],
        'wallSeconds':round(time.perf_counter()-started,2)}
    (args.output/'summary.json').write_text(json.dumps(summary,indent=2,allow_nan=False),encoding='utf-8')
    (args.output/'errors.json').write_text(json.dumps(errors,indent=2),encoding='utf-8')
    print(json.dumps(summary,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',type=Path,default=ROOT/'config/hifi.local.json')
    parser.add_argument('--casia-root',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    run(parser.parse_args())
