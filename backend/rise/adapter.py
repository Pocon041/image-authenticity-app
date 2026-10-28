"""Pinned official RiSE-9 RGB inference with complete pixel coverage, no OCR/VLM."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image

COMMIT = '83c1c2fc86eeb31ee2c50155e09826bdb780be1f'
TILE_SIZE = 512


def digest(path):
    result = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def starts(length, stride):
    if length <= TILE_SIZE:
        return [0]
    values = list(range(0, length - TILE_SIZE + 1, stride))
    if values[-1] != length - TILE_SIZE:
        values.append(length - TILE_SIZE)
    return values


class RisePredictor:
    def __init__(self, request):
        self.stride = request.get('tileStride', 384)
        if not isinstance(self.stride, int) or not 128 <= self.stride <= 512:
            raise ValueError('tileStride must be an integer in [128,512]')
        self.max_tiles = request.get('maxTiles', 128)
        if not isinstance(self.max_tiles, int) or not 1 <= self.max_tiles <= 512:
            raise ValueError('maxTiles must be in [1,512]')
        if request.get('device') not in ('cpu', 'cuda:0'):
            raise ValueError('device must be cpu or cuda:0')
        self.device = request['device']
        self.gh_order = 5
        os.environ['HF_HUB_OFFLINE'] = '1'
        os.environ['TRANSFORMERS_OFFLINE'] = '1'
        source = Path(request['sourcePath'])
        lock = json.loads(Path(__file__).with_name('source-lock.json').read_text())
        for relative, expected in lock['files'].items():
            content = (source / relative).read_bytes().replace(b'\r\n', b'\n')
            if hashlib.sha256(content).hexdigest() != expected:
                raise ValueError(f'Official source checksum mismatch: {relative}')
        checkpoint_hash = digest(request['checkpointPath'])
        expected = request.get('checkpointSha256')
        if not expected or checkpoint_hash != expected:
            raise ValueError('RiSE checkpoint SHA256 mismatch; verify local configuration')
        sys.path.insert(0, str(Path(request['dependencyPath']).resolve()))
        sys.path.insert(0, str(source.resolve()))
        import torch
        from rise.config import ModelConfig
        from rise.models import RiSE
        from rise.inference import predict
        if self.device.startswith('cuda') and not torch.cuda.is_available():
            raise ValueError('CUDA is unavailable; configure device=cpu explicitly to use CPU')
        torch.set_num_threads(min(8, os.cpu_count() or 1))
        config = ModelConfig.read(source / 'configs/rise9.json')
        config.backbone = str(Path(__file__).with_name('backbone').resolve())
        checkpoint = torch.load(request['checkpointPath'], map_location='cpu', weights_only=True)
        weights = {key.removeprefix('module.'): value for key, value in checkpoint['model'].items()}
        if any(key.startswith('dct_encoder.') for key in weights):
            raise ValueError('Expected RiSE-9 RGB checkpoint, received DCT weights')
        self.model = RiSE(config, initialize=False)
        incompatible = self.model.load_state_dict(weights, strict=True)
        self.model.dct_fuse_prob = 1.0
        self.model = self.model.to(self.device).eval()
        self.predict_official = predict
        self.torch = torch
        if self.device.startswith('cuda'):
            torch.cuda.reset_peak_memory_stats()
        self.audit = {
            'variant': 'RiSE-9-RGB', 'sourceCommit': COMMIT,
            'strictStateDict': True, 'stateKeys': len(weights),
            'missingKeys': incompatible.missing_keys, 'unexpectedKeys': incompatible.unexpected_keys,
            'checkpointSha256': checkpoint_hash,
            'backboneConfigSha256': digest(Path(__file__).with_name('backbone') / 'config.json'),
            'dependencies': {name: importlib.metadata.version(name) for name in ('torch', 'torchvision', 'transformers', 'timm', 'tokenizers', 'huggingface-hub')},
            'device': self.device, 'expertMode': 'sequential', 'ghOrder': 5,
            'noiseVariance': 0.5, 'precision': 'official_cuda_fp16_autocast_adf_fp32' if self.device.startswith('cuda') else 'fp32',
            'sourceFiles': lock['files'],
        }

    def predict(self, image, progress=None):
        image = image.convert('RGB')
        width, height = image.size
        boxes = [(x, y, min(512, width - x), min(512, height - y))
                 for y in starts(height, self.stride) for x in starts(width, self.stride)]
        if len(boxes) > self.max_tiles:
            raise ValueError(f'Image requires {len(boxes)} tiles, exceeding maxTiles={self.max_tiles}; no pixels were silently skipped')
        total = np.zeros((height, width), dtype=np.float32)
        coverage = np.zeros((height, width), dtype=np.uint16)
        tile_records = []
        started = time.perf_counter()
        for index, (x, y, w, h) in enumerate(boxes):
            crop = np.asarray(image.crop((x, y, x + w, y + h))).copy()
            if w < 512 or h < 512:
                crop = np.pad(crop, ((0, 512 - h), (0, 512 - w), (0, 0)), mode='edge')
            tensor = self.torch.from_numpy(crop).permute(2, 0, 1).float().unsqueeze(0).to(self.device)
            result = self.predict_official(self.model, tensor, gh_order=5, noise_variance=0.5, mode='sequential')
            response = result['probability'][0].float().cpu().numpy()
            if response.shape != (512, 512) or not np.isfinite(response).all():
                raise ValueError('RiSE returned an invalid pixel response')
            total[y:y+h, x:x+w] += response[:h, :w]
            coverage[y:y+h, x:x+w] += 1
            tile_records.append({'tileIndex': index, 'bboxXYWH': [x, y, w, h],
                'expertId': int(result['expert_id'][0].item()),
                'expertSelectionConfidence': result['confidence'][0].float().cpu().tolist()})
            del result, tensor
            if progress:
                progress(index + 1, len(boxes))
        if np.any(coverage == 0):
            raise ValueError('Tiling did not cover every display pixel')
        response = total / coverage
        mask = (response >= 0.5).astype(np.uint8)
        audit = {**self.audit, 'tileSize': 512, 'tileStride': self.stride, 'tileCount': len(boxes),
                 'padding': 'replicate_right_bottom_only_when_smaller_than_512',
                 'fusion': 'uniform_mean_of_overlapping_pixel_responses_then_threshold_0.5',
                 'inputResize': False, 'coverageMin': int(coverage.min()), 'coverageMax': int(coverage.max()),
                 'tiles': tile_records, 'inferenceMs': round((time.perf_counter() - started) * 1000),
                 'peakCudaMemoryBytes': self.torch.cuda.max_memory_allocated() if self.device.startswith('cuda') else None}
        return mask, response, audit
