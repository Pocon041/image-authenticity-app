"""Router loader unit tests: key mapping, strict base-state validation and real load."""
import json
from pathlib import Path
import tempfile
import unittest

import torch

from model_loader import (
    RouterError, EXPECTED_ORIGINAL_KEYS, map_base_clip_state, validate_base_state,
    verify_clip_source
)


def synthetic_state():
    state = {}
    for index in range(EXPECTED_ORIGINAL_KEYS):
        base = f'model.visual.transformer.resblocks.{index}.attn'
        state[f'{base}.parametrizations.in_proj_weight.original'] = torch.zeros(3)
        state[f'{base}.parametrizations.in_proj_weight.0.A'] = torch.zeros(1)
        state[f'{base}.parametrizations.in_proj_weight.0.B'] = torch.zeros(1)
        state[f'{base}.ln_1.weight'] = torch.zeros(2)
    return state


class MappingTests(unittest.TestCase):
    def test_original_keys_map_to_base_names(self):
        mapped, excluded = map_base_clip_state({
            'model.visual.transformer.resblocks.0.attn.parametrizations.in_proj_weight.original': 1,
            'model.visual.transformer.resblocks.0.attn.parametrizations.in_proj_weight.0.A': 2,
            'model.transformer.resblocks.0.mlp.c_fc.weight': 3,
            'fc.weight': 4
        })
        self.assertEqual(mapped, {
            'visual.transformer.resblocks.0.attn.in_proj_weight': 1,
            'transformer.resblocks.0.mlp.c_fc.weight': 3
        })
        self.assertEqual(excluded, [
            'model.visual.transformer.resblocks.0.attn.parametrizations.in_proj_weight.0.A',
            'fc.weight'
        ])

    def test_lora_tensors_are_excluded_but_originals_kept(self):
        state = synthetic_state()
        mapped, excluded = map_base_clip_state(state)
        self.assertEqual(len(mapped), 2 * EXPECTED_ORIGINAL_KEYS)
        self.assertEqual(len(excluded), 2 * EXPECTED_ORIGINAL_KEYS)
        self.assertFalse(any('.parametrizations.' in key for key in mapped))
        self.assertFalse(any(key.startswith('model.') for key in mapped))
        self.assertTrue(all('.parametrizations.' in key for key in excluded))


class ValidationTests(unittest.TestCase):
    def test_empty_state_is_rejected(self):
        with self.assertRaisesRegex(RouterError, '张量'):
            validate_base_state({})

    def test_non_tensor_payload_is_rejected(self):
        state = synthetic_state()
        state['model.transformer.resblocks.0.mlp.c_fc.weight'] = 'not weights'
        with self.assertRaisesRegex(RouterError, '张量'):
            validate_base_state(state)

    def test_missing_originals_is_rejected(self):
        with self.assertRaisesRegex(RouterError, '基础 CLIP 注意力原始权重'):
            validate_base_state({'model.visual.conv1.weight': torch.zeros(1)})


class ClipSourceTests(unittest.TestCase):
    def test_missing_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RouterError, '固定版本校验'):
                verify_clip_source(Path(tmp))

    def test_wrong_commit_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'srdp-source-manifest.json').write_text(
                json.dumps({'commit': 'wrong', 'files': {}}), encoding='utf-8')
            with self.assertRaisesRegex(RouterError, '清单不完整'):
                verify_clip_source(root)


REPO_ROOT = Path(__file__).resolve().parent.parent.parent


@unittest.skipUnless(
    (REPO_ROOT / 'config' / 'router.local.json').is_file(),
    'config/router.local.json 不存在，跳过真实权重加载测试'
)
class RealLoadTests(unittest.TestCase):
    def test_base_clip_reconstructs_strict(self):
        config = json.loads(
            (REPO_ROOT / 'config' / 'router.local.json').read_text(encoding='utf-8'))
        for key in ('checkpointPath', 'clipSourcePath'):
            path = Path(config[key])
            if not path.is_absolute():
                config[key] = str((REPO_ROOT / path).resolve())
        from model_loader import load_base_clip
        model, preprocess, clip, audit = load_base_clip(config)
        self.assertTrue(audit['strictStateDict'])
        # 48 in_proj A/B + 48 out_proj A/B + 24 row_mask + fc head = 122 excluded keys.
        self.assertEqual(audit['excludedKeys'], 122)
        self.assertEqual(audit['baseKeyCount'] + audit['excludedKeys'], 568)
        self.assertFalse(audit['loRAAppliedInForward'])
        self.assertEqual(audit['checkpointSha256'], config.get('checkpointSha256') or audit['checkpointSha256'])
        self.assertIsNotNone(model)
        self.assertIsNotNone(preprocess)
        self.assertIsNotNone(clip)


if __name__ == '__main__':
    unittest.main()
