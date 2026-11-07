"""Bounded-memory execution of the official FSD patch decomposition.

Adapted from Tai D. Nguyen et al., Forensic-Self-Descriptions-CVPR25,
https://github.com/ductai199x/Forensic-Self-Descriptions-CVPR25 .
Copyright (c) 2025 Tai D. Nguyen, Multimedia Information Security Lab,
Drexel University. CC BY-NC-SA 4.0:
https://creativecommons.org/licenses/by-nc-sa/4.0/ .

Change: yield row batches instead of materializing all image patches. The
official residual extractor, preprocessing, float64 arithmetic and KKT solver
are retained; no image resizing policy, weights or detection thresholds change.
"""

from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image


def compute_fsd_streaming(image, fre, kernel_size=11, num_scales=3,
                          max_size=1024, resize_mode='resize_and_crop'):
    from fsd.fsd_computation import _solve_constrained_least_squares

    device = fre.device
    if isinstance(image, (str, Path)):
        with Image.open(image) as opened:
            image = opened.convert('L')
    if isinstance(image, Image.Image):
        image_t = torch.from_numpy(np.array(image.convert('L'))).double().unsqueeze(0)
    elif isinstance(image, torch.Tensor):
        image_t = image.double()
        if image_t.ndim == 2:
            image_t = image_t.unsqueeze(0)
    else:
        raise TypeError(f'Unsupported image type: {type(image)}')
    channels = fre.conv.out_channels
    border = fre.conv.kernel_size // 2
    size = kernel_size
    center = size // 2
    mask = torch.ones(size, size, dtype=torch.bool, device=device)
    mask[center, center] = False

    with torch.no_grad():
        residuals = fre(image_t.to(device))
        residuals = residuals[:, border:-border, border:-border]
        if 'resize' in resize_mode:
            h, w = residuals.shape[-2:]
            scale = max_size / min(h, w)
            residuals = F.interpolate(residuals[None], size=(round(h * scale), round(w * scale)),
                                      mode='bilinear', antialias=False, align_corners=False)[0]
        if 'crop' in resize_mode:
            h, w = residuals.shape[-2:]
            crop_h, crop_w = min(max_size, h), min(max_size, w)
            top, left = (h - crop_h) // 2, (w - crop_w) // 2
            residuals = residuals[:, top:top + crop_h, left:left + crop_w]

        def patches():
            for level in range(num_scales):
                scaled = F.interpolate(residuals[None], scale_factor=1 / 2**level,
                                       mode='bilinear', antialias=False, align_corners=False)
                padded = F.pad(scaled, (center, center, center, center), mode='reflect')
                grid = padded[0].unfold(1, size, 1).unfold(2, size, 1)
                # Same row-major order as upstream. At 1024/512/256 these
                # batches exactly match the official solver's 16384 patches.
                rows = max(1, 16384 // grid.shape[2])
                for top in range(0, grid.shape[1], rows):
                    yield grid[:, top:top + rows].reshape(channels, -1, size, size).permute(1, 0, 2, 3)

        return _solve_constrained_least_squares(
            patches(), mask, center, channels, mask.sum().item(), device
        ).cpu()


def enable_streaming():
    import fsd.detector
    fsd.detector.compute_fsd = compute_fsd_streaming
