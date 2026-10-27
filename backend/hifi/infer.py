"""Save actual HiFi-Net outputs for inspection; this is not a desktop/VLM integration."""
import argparse
import hashlib
import json
from pathlib import Path
import uuid
from datetime import datetime,timezone

import numpy as np
from PIL import Image,ImageOps
from model_loader import HiFiPredictor

ROOT=Path(__file__).resolve().parents[2]


def run(args):
    config=json.loads(args.config.read_text(encoding='utf-8-sig'))
    for key in ('sourcePath','dependencyPath','encoderPath','detectorPath','centerPath'):config[key]=str((ROOT/config[key]).resolve())
    model=HiFiPredictor(config)
    args.output.mkdir(parents=True,exist_ok=True)
    original=args.image.read_bytes()
    with Image.open(args.image) as opened:image=ImageOps.exif_transpose(opened).convert('RGB')
    result,mask,distance=model.predict(image)
    image.save(args.output/'display.png')
    Image.fromarray(mask).save(args.output/'prediction.png')
    np.save(args.output/'distance.npy',distance)
    # Fixed visual scaling, not per-image enhancement or confidence normalization.
    Image.fromarray(np.rint(np.clip(distance/(2*model.distance_threshold),0,1)*255).astype(np.uint8)).save(args.output/'distance-preview.png')
    overlay=np.asarray(image).astype(np.float32)
    selected=mask>0
    overlay[selected]=overlay[selected]*0.55+np.array([238,88,82])*0.45
    Image.fromarray(overlay.astype(np.uint8)).save(args.output/'overlay.png')
    report={'runId':str(uuid.uuid4()),'createdAt':datetime.now(timezone.utc).isoformat(),
        'purpose':'model_output_inspection_not_vlm_input','imageId':'sha256:'+hashlib.sha256(original).hexdigest(),
        'mode':'local','model':'HiFi-Net-general-750001','classification':result,'audit':model.audit,
        'localization':{'binaryMask':'prediction.png','floatDistance':'distance.npy','overlay':'overlay.png',
            'coordinateSpace':'display_image_pixels','width':image.width,'height':image.height,
            'distanceThreshold':2.3,'distancePreviewScaleMax':4.6},
        'limitations':['Diagnostic output only; not the project v1.0 ModuleReport.','No VLM was called.',
            'Leaf attribute is a model candidate, not proof of the actual editing tool or history.',
            'Classification and localization evaluated separately; mask is not suppressed by classification.']}
    (args.output/'inspection.json').write_text(json.dumps(report,indent=2,allow_nan=False),encoding='utf-8')
    print(json.dumps({'output':str(args.output),'score':result['score'],'leafLabel':result['leafLabel'],
                      'predictedAreaFraction':result['predictedAreaFraction']},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',type=Path,default=ROOT/'config/hifi.local.json')
    parser.add_argument('--image',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    run(parser.parse_args())
