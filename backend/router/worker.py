"""Single-image zero-shot content-type routing. Progress/error/result events use JSONL stdout."""
import argparse
import json
import math
from pathlib import Path
import sys
import time
import uuid
from datetime import datetime, timezone

from model_loader import RouterError, load_base_clip, sha256

# Frozen prompt sets. The router compares CLIP image embeddings against these texts;
# scores are content-type similarity, never an authenticity probability.
PROMPTS = {
    'photo': [
        'a photograph',
        'a photo of a real-world scene',
        'a camera photo of people, objects or scenery',
        'a natural image'
    ],
    'document': [
        'a document',
        'a screenshot of text',
        'a scanned document or form',
        'a receipt or invoice with printed text'
    ]
}
ROUTING_LIMITATIONS = [
    '本输出仅用于选择内容类型与检测器组合，不构成整图真实性或篡改结论。',
    '分数是内容相似度而非真实性概率，未在本项目目标数据上校准。',
    '采用官方 CLIP 短边缩放和中心裁剪，边缘内容可能不在路由实际视野内。'
]


def emit(kind, **payload):
    print(json.dumps({'type': kind, **payload}, ensure_ascii=False, allow_nan=False), flush=True)


def validate_threshold(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or not 0 < value < 1:
        raise RouterError('INVALID_REQUEST', 'marginThreshold 应为 0 到 1 之间的数值。')


def compute_route(model, preprocess, clip, image, threshold):
    """Return routing scores and decision for a PIL RGB image."""
    import torch
    device = next(model.parameters()).device
    tensor = preprocess(image).unsqueeze(0).to(device)
    prompts = [prompt for group in PROMPTS.values() for prompt in group]
    tokens = clip.tokenize(prompts).to(device)
    with torch.inference_mode():
        image_features = model.encode_image(tensor)
        text_features = model.encode_text(tokens)
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        logits = model.logit_scale.exp() * image_features @ text_features.T
        weights = logits.softmax(dim=-1)[0]
    photo_score = float(weights[:len(PROMPTS['photo'])].sum())
    document_score = float(weights[len(PROMPTS['photo']):].sum())
    margin = abs(photo_score - document_score)
    if photo_score - document_score >= threshold:
        decision = 'photo'
    elif document_score - photo_score >= threshold:
        decision = 'document'
    else:
        decision = 'unsure'
    return {'decision': decision, 'photo': photo_score, 'document': document_score, 'margin': margin}


def run(request):
    import torch
    started = time.perf_counter()
    if sha256(request['originalPath']) != request['image']['sha256']:
        raise RouterError('INVALID_IMAGE', '输入原文件身份不一致。')
    threshold = request.get('marginThreshold', 0.1)
    validate_threshold(threshold)
    model, preprocess, clip, audit = load_base_clip(
        request,
        lambda percent, label: emit('progress', percent=percent, label=label)
    )
    from PIL import Image
    with Image.open(request['displayPath']) as opened:
        image = opened.convert('RGB')
    if image.size != (request['image']['width'], request['image']['height']):
        raise RouterError('INVALID_IMAGE', '规范显示图尺寸不一致。')
    emit('progress', percent=60, label='计算内容路由嵌入')
    inference_ms_started = time.perf_counter()
    route = compute_route(model, preprocess, clip, image, threshold)
    inference_ms = round((time.perf_counter() - inference_ms_started) * 1000)
    decision, photo_score, document_score, margin = (
        route['decision'], route['photo'], route['document'], route['margin'])
    routing = {
        'schemaVersion': '1.0',
        'taskId': request['taskId'],
        'imageId': request['image']['imageId'],
        'mode': 'local',
        'status': 'completed',
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'elapsedMs': round((time.perf_counter() - started) * 1000),
        'producer': {'name': 'CLIP-ViT-L14-content-router', 'version': '0.1.0'},
        'decision': decision,
        'scores': {'photo': photo_score, 'document': document_score},
        'margin': margin,
        'marginThreshold': threshold,
        'scope': 'content_type_routing_only_not_tamper',
        'prompts': PROMPTS,
        'input': {
            'displayArtifactId': request['image']['displayArtifactId'],
            'preprocessing': audit['preprocessing']
        },
        'limitations': ROUTING_LIMITATIONS,
        'extensions': {
            **audit,
            'inferenceMs': inference_ms,
            'peakCudaMemoryBytes':
                torch.cuda.max_memory_allocated() if audit['device'] == 'cuda' else None
        }
    }
    output = Path(request['outputDirectory'])
    output.mkdir(parents=True, exist_ok=True)
    (output / 'routing.json').write_text(
        json.dumps(routing, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    emit('progress', percent=100, label='内容路由完成')
    emit('result', routingPath=str(output / 'routing.json'), decision=decision)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True, type=Path)
    args = parser.parse_args()
    try:
        run(json.loads(args.request.read_text(encoding='utf-8-sig')))
    except RouterError as error:
        emit('error', code=error.code, message=str(error))
        sys.exit(2)
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        emit('error', code='INFERENCE_FAILED', message=f'内容路由运行失败：{error}')
        sys.exit(1)
