"""Single-image SICA classification. Progress/error/result events use JSONL stdout."""
import argparse
import json
import math
from pathlib import Path
import sys
import time
import uuid
from datetime import datetime, timezone

from model_loader import SicaError, load_model, predict, sha256


def emit(kind, **payload):
    print(json.dumps({'type':kind,**payload},ensure_ascii=False,allow_nan=False),flush=True)


def run(request):
    started=time.perf_counter()
    if sha256(request['originalPath']) != request['image']['sha256']:
        raise SicaError('INVALID_IMAGE','输入原文件身份不一致。')
    threshold=request.get('threshold',0.5)
    if isinstance(threshold,bool) or not isinstance(threshold,(int,float)) or not math.isfinite(threshold) or not 0<=threshold<=1:
        raise SicaError('INVALID_REQUEST','分类阈值应为 0 到 1 的数值。')
    model,audit=load_model(request,lambda percent,label:emit('progress',percent=percent,label=label))
    from PIL import Image
    import torch
    with Image.open(request['displayPath']) as opened:
        image=opened.convert('RGB')
    if image.size != (request['image']['width'],request['image']['height']):
        raise SicaError('INVALID_IMAGE','规范显示图尺寸不一致。')
    emit('progress',percent=60,label='执行 SICA 图像级二分类')
    score,inference_ms=predict(model,image)
    fake=score>=threshold
    report_id=f'report-{uuid.uuid4()}'
    limitations=[
        '此输出为通用图像真假二分类，未区分 AI 生成、人脸修改或局部篡改，不确认具体编辑手段。',
        'SICA 不产生像素掩码，本次未运行 RITA、其他定位模型或 VLM。',
        'Sigmoid 分数未在本项目目标数据上校准，不等于可信的图像真实性概率。',
        '采用官方 CLIP 短边缩放和中心裁剪，边缘的局部篡改可能不在模型实际视野内。'
    ]
    if audit['fullCheckpointExposureWarning']:
        limitations.append('当前为 full 权重，作者说明其使用过完整 OpenMMSec 数据；本地效果观察不能当作独立泛化评测。')
    timestamp=datetime.now(timezone.utc).isoformat()
    report={
        'schemaVersion':'1.0','reportId':report_id,'moduleId':'manipulation','imageId':request['image']['imageId'],
        'taskId':request['taskId'],'mode':'local','status':'completed',
        'producer':{'name':'SICA-general-classification','version':f'1.0.0+{audit["upstreamCommit"][:7]}'},
        'createdAt':timestamp,'elapsedMs':round((time.perf_counter()-started)*1000),'inputReportIds':[],
        'result':{
            'decision':'suspicious' if fake else 'no_anomaly_detected',
            'score':{'name':'sica_fake_sigmoid','value':score,'positiveClass':'fake','calibrated':False},
            'regions':[],'operationHints':[],
            'classification':{'predictedClass':'fake' if fake else 'real','threshold':threshold,
                'scope':'general_image_authenticity_not_tamper_only','thresholdValidatedOnTarget':False},
            'localization':{'status':'not_run'},
            'preprocessing':{'strategy':audit['preprocessing'],'inputSize':[224,224],'mayOmitEdgeRegions':True}
        },
        'evidence':[{'evidenceId':f'{report_id}:e1','kind':'image_classification','origin':'measured',
            'description':'SICA 完整分类头与 LoRA 参数严格加载后的图像级分数。','regionId':None,
            'artifactIds':[request['image']['displayArtifactId']],
            'data':{'score':score,'positiveClass':'fake','threshold':threshold,'calibrated':False},
            'limitation':'不定位区域、不鉴定编辑类型；中心裁剪与训练域覆盖影响结果。'}],
        'artifacts':[],'limitations':limitations,'error':None,
        'extensions':{**audit,'inferenceMs':inference_ms,'peakCudaMemoryBytes':torch.cuda.max_memory_allocated() if audit['device']=='cuda' else None}
    }
    bundle={'schemaVersion':'1.0','bundleId':f'bundle-{uuid.uuid4()}','purpose':'analysis','createdAt':timestamp,
            'image':request['image'],'reports':[report],'artifacts':request['imageArtifacts']}
    output=Path(request['outputDirectory'])
    output.mkdir(parents=True,exist_ok=True)
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    (output/'bundle.json').write_text(json.dumps(bundle,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    emit('progress',percent=100,label='SICA 二分类完成，报告已保存')
    emit('result',bundlePath=str(output/'bundle.json'))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--request',required=True,type=Path)
    args=parser.parse_args()
    try:
        run(json.loads(args.request.read_text(encoding='utf-8-sig')))
    except SicaError as error:
        emit('error',code=error.code,message=str(error));sys.exit(2)
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        emit('error',code='INFERENCE_FAILED',message=f'SICA 运行失败：{error}');sys.exit(1)
