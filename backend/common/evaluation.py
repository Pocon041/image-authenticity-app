"""Shared offline metrics and display-coordinate annotation conversion."""
import numpy as np
from PIL import Image


def canonical_annotation(path, orientation):
    mask = Image.open(path).convert('L')
    methods = {
        2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180,
        4: Image.Transpose.FLIP_TOP_BOTTOM, 5: Image.Transpose.TRANSPOSE,
        6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
        8: Image.Transpose.ROTATE_90,
    }
    return np.asarray(mask.transpose(methods[orientation]) if orientation in methods else mask) > 127


def metrics(rows, threshold):
    from sklearn.metrics import roc_auc_score, average_precision_score
    tp = sum(row['label'] == 1 and row['score'] >= threshold for row in rows)
    tn = sum(row['label'] == 0 and row['score'] < threshold for row in rows)
    fp = sum(row['label'] == 0 and row['score'] >= threshold for row in rows)
    fn = sum(row['label'] == 1 and row['score'] < threshold for row in rows)
    real, fake = tn + fp, tp + fn
    labels = [row['label'] for row in rows]
    scores = [row['score'] for row in rows]
    return {
        'count': len(rows), 'realCount': real, 'fakeCount': fake,
        'truePositive': tp, 'trueNegative': tn, 'falsePositive': fp, 'falseNegative': fn,
        'accuracy': (tp + tn) / len(rows) if rows else None,
        'precision': tp / (tp + fp) if tp + fp else 0.,
        'recall': tp / fake if fake else None, 'specificity': tn / real if real else None,
        'falsePositiveRate': fp / real if real else None, 'falseNegativeRate': fn / fake if fake else None,
        'balancedAccuracy': (tp / fake + tn / real) / 2 if real and fake else None,
        'f1': 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.,
        'auc': float(roc_auc_score(labels, scores)) if real and fake else None,
        'averagePrecision': float(average_precision_score(labels, scores)) if real and fake else None,
    }
