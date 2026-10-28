"""Negative-path checks: missing or incomplete weights must never become local results."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PROJECT = Path(__file__).resolve().parents[2]


class CheckpointTests(unittest.TestCase):
    def invoke(self, directory, checkpoint):
        source = PROJECT / '.tools/rita-upstream/rita.py'
        original = directory / 'original.bin'
        original.write_bytes(b'checkpoint-loading-negative-test')
        request = {
            'upstreamPath': str(source), 'checkpointPath': str(checkpoint),
            'originalPath': str(original), 'image': {'sha256': hashlib.sha256(original.read_bytes()).hexdigest()},
            'device': 'cpu'
        }
        file = directory / 'request.json'
        file.write_text(json.dumps(request), encoding='utf-8')
        process = subprocess.run([sys.executable, str(Path(__file__).with_name('worker.py')), '--request', str(file)],
                                 capture_output=True, text=True, encoding='utf-8', timeout=60)
        events = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertNotEqual(process.returncode, 0)
        self.assertFalse(any(event['type'] == 'result' for event in events))
        return events[-1]

    def test_missing_checkpoint_fails_explicitly(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            event = self.invoke(directory, directory / 'missing.pth')
            self.assertEqual(event['code'], 'MODEL_NOT_READY')

    @unittest.skipUnless((PROJECT / '.tools/rita-upstream/rita.py').exists(), 'Download pinned official source with rita:setup first')
    def test_incomplete_checkpoint_is_rejected_strictly(self):
        import torch
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            checkpoint = directory / 'incomplete.pth'
            torch.save({'irrelevant.weight': torch.zeros(1)}, checkpoint)
            event = self.invoke(directory, checkpoint)
            self.assertEqual(event['code'], 'INVALID_MODEL')
            self.assertIn('严格加载失败', event['message'])


if __name__ == '__main__':
    unittest.main()
