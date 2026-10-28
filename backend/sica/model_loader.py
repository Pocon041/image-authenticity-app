"""Strict inference loader; no training and no network calls during model loading."""
import argparse
import contextlib
import gc
import hashlib
from pathlib import Path
import sys
import types

SICA_COMMIT = 'def6e344ca3f18a2313adb6be3bd1f8fb8d27e7d'
SICA_SOURCE_HASH = 'c82d71ddb0664a74c7e0b056cf661b3b55c815342bc842bce3ab8629ee05a87c'
CLIP_COMMIT = 'd05afc436d78f1c48dc0dbf8e5980a9d471f35f6'


class SicaError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def sha256(path):
    hasher = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for part in iter(lambda: stream.read(1024*1024), b''):
            hasher.update(part)
    return hasher.hexdigest()


def validate_state(state):
    import torch
    if not isinstance(state, dict) or not state or any(not isinstance(value, torch.Tensor) for value in state.values()):
        raise SicaError('INVALID_MODEL', 'SICA 权重不是完整张量 state_dict。')
    if tuple(state.get('fc.weight', torch.empty(0)).shape) != (1, 768) or tuple(state.get('fc.bias', torch.empty(0)).shape) != (1,):
        raise SicaError('INVALID_MODEL', '缺少 SICA ViT-L/14 的二分类头。')
    for index in range(24):
        prefix = f'model.visual.transformer.resblocks.{index}.attn'
        expected = {
            f'{prefix}.parametrizations.in_proj_weight.0.A': (8, 1024),
            f'{prefix}.parametrizations.in_proj_weight.0.B': (3072, 8),
            f'{prefix}.out_proj.parametrizations.weight.0.A': (8, 1024),
            f'{prefix}.out_proj.parametrizations.weight.0.B': (1024, 8)
        }
        for key, shape in expected.items():
            if key not in state or tuple(state[key].shape) != shape:
                raise SicaError('INVALID_MODEL', f'LoRA 参数缺失或不匹配：{key}')


def load_model(config, progress=None):
    import torch
    source = Path(config['upstreamPath'])
    checkpoint = Path(config['checkpointPath'])
    clip_path = Path(config['clipSourcePath'])
    if not checkpoint.is_file():
        raise SicaError('MODEL_NOT_READY', f'SICA 权重不存在：{checkpoint}')
    if not source.is_file() or not (clip_path/'clip/model.py').is_file():
        raise SicaError('MODEL_NOT_READY', '缺少 SICA 或 CLIP 源码，请先执行 npm.cmd run sica:setup。')
    if sha256(source) != SICA_SOURCE_HASH:
        raise SicaError('INVALID_MODEL', 'SICA 源码 SHA256 不匹配。')
    clip_manifest_path = clip_path/'srdp-source-manifest.json'
    if not clip_manifest_path.is_file():
        raise SicaError('MODEL_NOT_READY', 'CLIP 源码未完成固定版本校验，请执行 sica:setup。')
    import json
    manifest = json.loads(clip_manifest_path.read_text(encoding='utf-8'))
    required = ['clip/__init__.py', 'clip/model.py', 'clip/clip.py', 'clip/simple_tokenizer.py', 'clip/bpe_simple_vocab_16e6.txt.gz']
    if manifest.get('commit') != CLIP_COMMIT or any(name not in manifest.get('files', {}) for name in required):
        raise SicaError('INVALID_MODEL', 'CLIP 固定版本清单不完整。')
    for name, expected in manifest['files'].items():
        path = clip_path/name
        if name not in required or sha256(path) != expected:
            raise SicaError('INVALID_MODEL', f'CLIP 源码文件校验失败：{name}')
    checkpoint_hash = sha256(checkpoint)
    if config.get('checkpointSha256') and checkpoint_hash != config['checkpointSha256']:
        raise SicaError('INVALID_MODEL', 'SICA 权重 SHA256 不匹配。')
    device = config.get('device', 'auto')
    if device not in ('auto', 'cpu', 'cuda'):
        raise SicaError('INVALID_REQUEST', 'device 必须为 auto、cpu 或 cuda。')
    if device == 'auto': device = 'cuda' if torch.cuda.is_available() else 'cpu'
    if device == 'cuda' and not torch.cuda.is_available():
        raise SicaError('MODEL_NOT_READY', '当前 PyTorch 无法使用 CUDA。')
    if progress: progress(15, '核对完整权重与分类头')
    # The official checkpoint stores an argparse Namespace; permit only that class.
    with torch.serialization.safe_globals([argparse.Namespace]):
        payload = torch.load(checkpoint, map_location='cpu', weights_only=True)
    if not isinstance(payload, dict):
        raise SicaError('INVALID_MODEL', 'SICA 权重顶层必须为字典。')
    state = payload.get('model', payload.get('state_dict', payload))
    if state and all(key.startswith('module.') for key in state): state = {key[7:]:value for key,value in state.items()}
    validate_state(state)
    sys.path.insert(0, str(clip_path.resolve()))
    import clip
    from clip.model import CLIP
    from clip.clip import _transform
    # Construct the exact backbone without downloading a second copy of CLIP weights.
    # No randomly initialized tensor is used for inference: the full model is loaded strictly.
    def local_clip(name, device='cpu', **kwargs):
        if name != 'ViT-L/14': raise SicaError('INVALID_MODEL', '此适配器只接受 ViT-L/14 权重。')
        return CLIP(768, 224, 24, 1024, 14, 77, 49408, 768, 12, 12).float(), _transform(224)
    old_load = clip.load
    module = types.ModuleType('srdp_sica_pinned')
    try:
        clip.load = local_clip
        with contextlib.redirect_stdout(sys.stderr):
            exec(compile(source.read_text(encoding='utf-8'), str(source), 'exec'), module.__dict__)
            model = module.CLIP_LORA_PURE(name='ViT-L/14', num_classes=1, lora_r=8, lora_alpha=16.0,
                                         lora_qkv='qkv', lora_apply_out_proj=True, tune_mode='lora')
            try: model.load_state_dict(state, strict=True)
            except RuntimeError as error: raise SicaError('INVALID_MODEL', f'SICA 严格加载失败：{error}') from error
    finally:
        clip.load = old_load
    audit = {
        'checkpointSha256': checkpoint_hash, 'checkpointVariant': config.get('checkpointVariant', 'unknown'),
        'checkpointEpoch': payload.get('epoch'), 'strictStateDict': True, 'stateKeyCount':len(model.state_dict()),
        'missingKeys': [], 'unexpectedKeys': [], 'loraModuleCount':len(model._lora_params),
        'upstreamCommit': SICA_COMMIT, 'clipCommit': CLIP_COMMIT, 'device': device, 'torchVersion':torch.__version__,
        'precision':'fp32', 'preprocessing':'official_clip_short_edge_resize_224_center_crop',
        'fullCheckpointExposureWarning':config.get('checkpointVariant') == 'full'
    }
    del state, payload
    gc.collect()
    torch.set_num_threads(min(4, torch.get_num_threads()))
    model = model.float().to(device).eval()
    if device == 'cuda': torch.cuda.reset_peak_memory_stats()
    if progress: progress(40, 'SICA 完整权重严格加载完成')
    return model, audit


def predict(model, image):
    import time
    import torch
    device = next(model.parameters()).device
    tensor = model.preprocess(image.convert('RGB')).unsqueeze(0).to(device)
    if device.type == 'cuda': torch.cuda.synchronize()
    started = time.perf_counter()
    with torch.inference_mode():
        value = model(image=tensor)['pred_label'].float()
        if value.numel() != 1 or not torch.isfinite(value).all():
            raise SicaError('INFERENCE_FAILED', 'SICA 没有输出有限的单一分类分数。')
        probability = float(value.item())
    if device.type == 'cuda': torch.cuda.synchronize()
    return probability, round((time.perf_counter()-started)*1000)
