import unittest
import torch
from model_loader import SicaError,validate_state


class StateTests(unittest.TestCase):
    def test_missing_head_is_rejected(self):
        with self.assertRaisesRegex(SicaError,'二分类头'):
            validate_state({'other':torch.zeros(1)})

    def test_missing_adapter_is_rejected(self):
        with self.assertRaisesRegex(SicaError,'LoRA'):
            validate_state({'fc.weight':torch.zeros(1,768),'fc.bias':torch.zeros(1)})

    def test_unknown_rank_is_rejected(self):
        state={'fc.weight':torch.zeros(1,768),'fc.bias':torch.zeros(1),
            'model.visual.transformer.resblocks.0.attn.parametrizations.in_proj_weight.0.A':torch.zeros(4,1024)}
        with self.assertRaisesRegex(SicaError,'LoRA'):
            validate_state(state)

    def test_non_tensor_payload_is_rejected(self):
        with self.assertRaisesRegex(SicaError,'张量'):
            validate_state({'fc.weight':'not weights'})


if __name__=='__main__':unittest.main()
