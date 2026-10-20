#!/usr/bin/env python3
"""Flatten baked-in checkerboard / dark / gray studio backdrops to solid white (in-place)."""
from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def flatten_fake_bg(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    arr = np.asarray(im).copy()
    rgb = arr[..., :3].astype(np.float32)
    h, w = rgb.shape[:2]
    n = min(48, h // 4, w // 4)
    if n < 8:
        return im
    corners = np.concatenate(
        [
            rgb[:n, :n].reshape(-1, 3),
            rgb[:n, -n:].reshape(-1, 3),
            rgb[-n:, :n].reshape(-1, 3),
            rgb[-n:, -n:].reshape(-1, 3),
        ],
        axis=0,
    )
    sat = float((corners.max(axis=1) - corners.min(axis=1)).mean())
    std = float(corners.std(axis=0).mean())
    lum_c = 0.299 * corners[:, 0] + 0.587 * corners[:, 1] + 0.114 * corners[:, 2]
    mean_lum = float(lum_c.mean())

    # Already solid near-white → nothing to do
    if mean_lum >= 245 and std <= 14 and sat < 20:
        return im

    is_checker = sat < 28 and std > 16 and mean_lum > 90
    is_dark = sat < 40 and mean_lum < 200
    is_grayish = sat < 35 and mean_lum < 245

    if is_checker:
        light = corners[lum_c >= np.median(lum_c)].mean(axis=0)
        dark = corners[lum_c < np.median(lum_c)].mean(axis=0)
        dist_l = np.max(np.abs(rgb - light.reshape(1, 1, 3)), axis=2)
        dist_d = np.max(np.abs(rgb - dark.reshape(1, 1, 3)), axis=2)
        sat_map = rgb.max(axis=2) - rgb.min(axis=2)
        bgish = ((dist_l <= 38) | (dist_d <= 38)) & (sat_map < 45)
    elif is_dark or is_grayish:
        ref = np.median(corners, axis=0)
        dist = np.max(np.abs(rgb - ref.reshape(1, 1, 3)), axis=2)
        sat_map = rgb.max(axis=2) - rgb.min(axis=2)
        tol = 55 if mean_lum < 120 else 42
        bgish = (dist <= tol) & (sat_map < 45)
    else:
        return im

    visited = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bgish[y, x]:
                visited[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y, x] and bgish[y, x]:
                visited[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and bgish[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))
    rgb[visited] = 255.0
    arr[..., :3] = rgb.astype(np.uint8)
    return Image.fromarray(arr)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: flatten-skin-bg.py <png> [more.png...]")
    for arg in sys.argv[1:]:
        p = Path(arg)
        out = flatten_fake_bg(Image.open(p))
        out.save(p)
        print("flattened", p)


if __name__ == "__main__":
    main()
