"""Model-independent geometry and mask decoding for the public four-class protocol."""
import numpy as np
from PIL import Image


def decode_sequence(labels, responses, output_size, threshold=None):
    """Use the last non-EOS step, keeping padding outside the binary manipulation mask.

    0=manipulated, 1=remaining/authentic, 2=EOS, 3=padding.
    Sequence indices are inference steps, not recovered historical edits.
    """
    first_eos = next((i for i, label in enumerate(labels) if float(np.mean(label == 2)) >= 0.9), len(labels))
    valid = list(range(first_eos))
    if not valid:
        shape = (output_size[1], output_size[0])
        return np.zeros(shape, np.uint8), np.zeros(shape, np.float32), {
            'selectedStep': None, 'score': None, 'decision': 'inconclusive',
            'paddingFraction': 0.0, 'reason': 'no_valid_localization_step'
        }
    selected = valid[-1]
    label = labels[selected]
    probability = responses[selected]
    mask = np.array(Image.fromarray((label == 0).astype(np.uint8) * 255).resize(output_size, Image.Resampling.NEAREST))
    response = np.array(Image.fromarray(probability.astype(np.float32)).resize(output_size, Image.Resampling.BILINEAR))
    response = np.clip(response, 0, 1)
    # Score the model-resolution valid pixels; upsampling must not change this statistic.
    values = probability[(label == 0) | (label == 1)]
    count = max(1, int(np.ceil(values.size * 0.01)))
    score = float(np.partition(values, values.size-count)[-count:].mean()) if values.size else None
    decision = 'inconclusive'
    if threshold is not None and score is not None:
        decision = 'suspicious' if score >= threshold else 'no_anomaly_detected'
    return mask, response, {
        'selectedStep': selected, 'score': score, 'decision': decision,
        'paddingFraction': float(np.mean(label == 3)),
        'reason': 'uncalibrated_image_score_no_threshold' if threshold is None else 'configured_unvalidated_threshold'
    }


def regions_from_mask(mask, max_regions=20):
    import cv2
    count, _labels, stats, _centroids = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    entries = sorted(stats[1:count], key=lambda entry: int(entry[4]), reverse=True)
    return [{'bboxXYWH': [int(n) for n in entry[:4]], 'areaPixels': int(entry[4])} for entry in entries[:max_regions]], max(0, count-1)
