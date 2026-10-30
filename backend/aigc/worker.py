# [第三人任务] FSD 结构化单图 worker；模型阈值遵循上游 z-score 定义。
import json, sys, time, uuid, hashlib, os
from pathlib import Path
from urllib.request import Request, urlopen

# [第三人任务] GitHub release 的来源 GMM 检查点固定长度；代理可能提前正常 EOF，上游未校验长度。
SOURCE_GMMS_BYTES = 206_992_755
SOURCE_GMMS_URL = 'https://github.com/ductai199x/Forensic-Self-Descriptions-CVPR25/releases/download/v1.2.0/source_gmms.pt'

def emit(kind, **data): print(json.dumps({'type': kind, **data}, ensure_ascii=False), flush=True)

def repair_source_gmms():
    cache = Path.home() / '.cache' / 'fsd' / 'v1.2.0'
    target = cache / 'source_gmms.pt'
    if not target.exists() or target.stat().st_size == SOURCE_GMMS_BYTES:
        return
    size = target.stat().st_size
    if size > SOURCE_GMMS_BYTES:
        raise RuntimeError(f'来源归因权重大小异常：{size} 字节。')
    temp = target.with_suffix('.resume.tmp')
    emit('progress', percent=8, label=f'续传 FSD 来源归因权重（已下载 {size / 1_000_000:.1f} / 207 MB）')
    request = Request(SOURCE_GMMS_URL, headers={'User-Agent': 'fsd-detector', 'Range': f'bytes={size}-{SOURCE_GMMS_BYTES - 1}'})
    with urlopen(request, timeout=300) as response:
        content_range = response.headers.get('Content-Range', '')
        if response.status != 206 or not content_range.startswith(f'bytes {size}-'):
            raise RuntimeError(f'来源归因权重续传响应无效：HTTP {response.status}，{content_range}')
        with target.open('rb') as existing, temp.open('wb') as output:
            while chunk := existing.read(1 << 20): output.write(chunk)
            while chunk := response.read(1 << 20): output.write(chunk)
    if temp.stat().st_size != SOURCE_GMMS_BYTES:
        temp.unlink(missing_ok=True)
        raise RuntimeError(f'来源归因权重仍不完整：{temp.stat().st_size} / {SOURCE_GMMS_BYTES} 字节。')
    os.replace(temp, target)

def run(req):
    started = time.perf_counter()
    sys.path.insert(0, req['fsdSourcePath'])
    from fsd import FSDDetector, download_weights
    # [第三人任务] 上游 get_weights_dir 只检查 config.json，下载中断后可能把残缺缓存误判为完整。
    # 显式调用 download_weights 逐个检查检测所需文件；下载完成后再加载模型。
    emit('progress', percent=3, label='检查并下载 FSD 检测权重（首次运行可能较久）')
    download_weights(attribution=req['attribution'])
    if req['attribution']:
        repair_source_gmms()
    emit('progress', percent=20, label='权重就绪，正在加载 FSD 模型')
    detector = FSDDetector.load(attribution=req['attribution'], device=req['device'])
    emit('progress', percent=70, label='FSD 模型已加载，正在分析图片')
    scored = detector.score(req['imagePath'])
    z = float(scored.z_score)
    threshold = float(req['threshold'])
    decision = 'ai_generated' if z < threshold else 'non_ai'
    source = None
    source_score = None
    attribution_label = None
    no_generator_match = False
    if req['attribution'] and decision == 'ai_generated':
        attributed = detector.attribute(req['imagePath'])
        source = getattr(attributed, 'source', None)
        source_score = getattr(attributed, 'confidence', None)
        # FSD can return Real as an attribution class; never present it as a generator.
        attribution_label = source
        if isinstance(source, str) and source.strip().casefold() == 'real':
            source = None
            no_generator_match = True
    image = req['image']
    report_id = 'aigc-' + str(uuid.uuid4())
    report = {'schemaVersion':'1.0','reportId':report_id,'moduleId':'aigc','imageId':image['imageId'],'taskId':req['taskId'],'mode':'local','status':'completed','producer':{'name':'FSD','version':'CVPR2025'},'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'elapsedMs':round((time.perf_counter()-started)*1000),'inputReportIds':[],'result':{'decision':decision,'score':{'name':'fsd_z_score','value':z,'positiveClass':'ai_generated','calibrated':False},'threshold':threshold,'attribution':{'source':source,'rawLabel':attribution_label,'score':source_score,'status':'no_supported_generator' if no_generator_match else 'attributed'} if req['attribution'] and decision == 'ai_generated' else None,'clues':[{'kind':'forensic_self_description_score','value':z,'description':'FSD forensic residual z-score; lower values indicate stronger AI-generated evidence.'}]},'evidence':[{'evidenceId':report_id+':e1','kind':'aigc_classification','origin':'measured','description':'FSD forensic residual score','regionId':None,'artifactIds':[image['displayArtifactId']],'data':{'zScore':z,'threshold':threshold,'source':source,'attributionLabel':attribution_label},'limitation':'Detector score is not a calibrated probability; attribution is limited to supported generators.'}],'artifacts':[],'limitations':['FSD z-score is not a calibrated probability.','Attribution may be wrong for unknown or unsupported generators.','Detection performance on this project’s target image domains has not been independently validated.'],'error':None}
    bundle={'schemaVersion':'1.0','bundleId':'bundle-'+str(uuid.uuid4()),'purpose':'analysis','createdAt':report['createdAt'],'image':image,'reports':[report],'artifacts':req['artifacts']}
    out=Path(req['outputDirectory']); out.mkdir(parents=True,exist_ok=True)
    (out/'bundle.json').write_text(json.dumps(bundle,ensure_ascii=False,indent=2),encoding='utf-8')
    emit('progress',percent=100,label='FSD 检测完成')
    emit('result',bundlePath=str(out/'bundle.json'))

if __name__ == '__main__':
    try: run(json.loads(Path(sys.argv[sys.argv.index('--request')+1]).read_text(encoding='utf-8')))
    except Exception as exc: emit('error',code='INFERENCE_FAILED',message='FSD 推理失败：'+str(exc)); sys.exit(1)
