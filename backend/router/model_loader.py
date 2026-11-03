"""Rebuild the base CLIP ViT-L/14 from the local SICA checkpoint for zero-shot content routing.

No new weights are downloaded and no training happens: the SICA checkpoint already
contains the full base CLIP state (48 ``parametrizations.*.original`` tensors plus the
complete text tower). LoRA keys are stripped by key mapping and the remaining state is
loaded strictly into the official CLIP architecture.
"""
import contextlib
import gc
import hashlib
import json
from pathlib import Path
import sys

CLIP_COMMIT = 'd05afc436d78f1c48dc0dbf8e5980a9d471f35f6'
EXPECTED_ORIGINAL_KEYS = 48


class RouterError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def sha256(path):
    hasher = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(part)
    return hasher.hexdigest()


def map_base_clip_state(state):
    """Drop LoRA tensors and SICA head, recover plain CLIP keys.

    ``parametrizations.<name>.original`` maps back to ``<name>``; LoRA tensors are
    excluded; the ``model.`` prefix of the inner CLIP and the SICA ``fc.*`` head are
    removed so the state matches the official CLIP architecture exactly.
    """
    mapped = {}
    excluded = []
    for key, value in state.items():
        if '.parametrizations.' in key:
            if key.endswith('.original'):
                base, suffix = key.split('.parametrizations.', 1)
                key = f'{base}.{suffix[:-len(".original")]}'
            else:
                excluded.append(key)
                continue
        if key in ('fc.weight', 'fc.bias'):
            excluded.append(key)
            continue
        if key.startswith('model.'):
            key = key[len('model.'):]
        mapped[key] = value
    return mapped, excluded


def validate_base_state(state):
    import torch
    if not isinstance(state, dict) or not state or any(
        not isinstance(value, torch.Tensor) for value in state.values()
    ):
        raise RouterError('INVALID_MODEL', '权重不是完整张量 state_dict。')
    originals = [key for key in state if 'parametrizations' in key and key.endswith('.original')]
    if len(originals) != EXPECTED_ORIGINAL_KEYS:
        raise RouterError(
            'INVALID_MODEL',
            f'未找到 {EXPECTED_ORIGINAL_KEYS} 个基础 CLIP 注意力原始权重，无法重建零样本 CLIP。'
        )


def verify_clip_source(clip_path):
    manifest_path = clip_path / 'srdp-source-manifest.json'
    if not manifest_path.is_file():
        raise RouterError('MODEL_NOT_READY', 'CLIP 源码未完成固定版本校验，请执行 sica:setup。')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    required = ['clip/__init__.py', 'clip/model.py', 'clip/clip.py',
                'clip/simple_tokenizer.py', 'clip/bpe_simple_vocab_16e6.txt.gz']
    if manifest.get('commit') != CLIP_COMMIT or any(
        name not in manifest.get('files', {}) for name in required
    ):
        raise RouterError('INVALID_MODEL', 'CLIP 固定版本清单不完整。')
    for name in required:
        path = clip_path / name
        if sha256(path) != manifest['files'][name]:
            raise RouterError('INVALID_MODEL', f'CLIP 源码文件校验失败：{name}')


def load_base_clip(config, progress=None):
    import torch
    checkpoint = Path(config['checkpointPath'])
    clip_path = Path(config['clipSourcePath'])
    if not checkpoint.is_file():
        raise RouterError('MODEL_NOT_READY', f'路由权重不存在：{checkpoint}')
    if not (clip_path / 'clip' / 'model.py').is_file():
        raise RouterError('MODEL_NOT_READY', '缺少固定版本 CLIP 源码，请先执行 npm.cmd run sica:setup。')
    verify_clip_source(clip_path)
    checkpoint_hash = sha256(checkpoint)
    if config.get('checkpointSha256') and checkpoint_hash != config['checkpointSha256']:
        raise RouterError('INVALID_MODEL', '路由权重 SHA256 不匹配。')
    device = config.get('device', 'auto')
    if device not in ('auto', 'cpu', 'cuda'):
        raise RouterError('INVALID_REQUEST', 'device 必须为 auto、cpu 或 cuda。')
    if device == 'auto':
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
    if device == 'cuda' and not torch.cuda.is_available():
        raise RouterError('MODEL_NOT_READY', '当前 PyTorch 无法使用 CUDA。')
    if progress:
        progress(15, '核对基础 CLIP 权重')
    import argparse
    with torch.serialization.safe_globals([argparse.Namespace]):
        payload = torch.load(checkpoint, map_location='cpu', weights_only=True)
    if not isinstance(payload, dict):
        raise RouterError('INVALID_MODEL', '路由权重顶层必须为字典。')
    state = payload.get('model', payload.get('state_dict', payload))
    if state and all(key.startswith('module.') for key in state):
        state = {key[7:]: value for key, value in state.items()}
    validate_base_state(state)
    mapped, excluded = map_base_clip_state(state)
    if progress:
        progress(25, '剥离 LoRA 键并构造基础 CLIP')
    sys.path.insert(0, str(clip_path.resolve()))
    import clip
    from clip.model import CLIP
    from clip.clip import _transform
    # Construct the exact base architecture without any download.
    def local_clip(name, device='cpu', **kwargs):
        if name != 'ViT-L/14':
            raise RouterError('INVALID_MODEL', '此适配器只接受 ViT-L/14 权重。')
        return CLIP(768, 224, 24, 1024, 14, 77, 49408, 768, 12, 12).float(), _transform(224)
    old_load = clip.load
    try:
        clip.load = local_clip
        model, preprocess = local_clip('ViT-L/14')
    finally:
        clip.load = old_load
    try:
        model.load_state_dict(mapped, strict=True)
    except RuntimeError as error:
        raise RouterError('INVALID_MODEL', f'基础 CLIP 严格加载失败：{error}') from error
    audit = {
        'checkpointSha256': checkpoint_hash,
        'checkpointVariant': config.get('checkpointVariant', 'unknown'),
        'clipCommit': CLIP_COMMIT,
        'device': device,
        'torchVersion': torch.__version__,
        'precision': 'fp32',
        'strictStateDict': True,
        'baseKeyCount': len(mapped),
        'excludedKeys': len(excluded),
        'loRAAppliedInForward': False,
        'preprocessing': 'official_clip_short_edge_resize_224_center_crop',
        'fullCheckpointExposureWarning': config.get('checkpointVariant') == 'full',
        'weightsOrigin': 'reconstructed_from_local_SICA_checkpoint_no_download'
    }
    del state, mapped, payload
    gc.collect()
    torch.set_num_threads(min(4, torch.get_num_threads()))
    model = model.float().to(device).eval()
    if device == 'cuda':
        torch.cuda.reset_peak_memory_stats()
    if progress:
        progress(40, '基础 CLIP 严格加载完成')
    return model, preprocess, clip, audit
