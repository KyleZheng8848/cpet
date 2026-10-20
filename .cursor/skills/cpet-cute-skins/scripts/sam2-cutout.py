#!/usr/bin/env python3
"""Cut a character out with SAM2 and composite it on opaque white.

Flood-fill flatten eats low-saturation clothes (ivory, blush, white shirts).
SAM2 keeps those pixels: positive points on the body, negative points in the
corners, holes inside the mask filled, background painted #FFFFFF.

Weights (first hit wins):
  $SAM2_CHECKPOINT
  ~/Desktop/sam2_hiera_small.pt
  ~/.cache/cpet-skins/sam2_hiera_small.pt
Config (hydra name inside the sam2 package, or an absolute yaml):
  $SAM2_CONFIG   default configs/sam2/sam2_hiera_s.yaml
"""
from __future__ import annotations

import os
import sys
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import cpet_paths  # noqa: F401,E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from scipy import ndimage  # noqa: E402

DEFAULT_CONFIG = "configs/sam2/sam2_hiera_s.yaml"


def checkpoint_path() -> Path:
    env = os.environ.get("SAM2_CHECKPOINT", "").strip()
    candidates = []
    if env:
        candidates.append(Path(env).expanduser())
    home = Path.home()
    candidates.extend(
        [
            home / "Desktop" / "sam2_hiera_small.pt",
            home / ".cache" / "cpet-skins" / "sam2_hiera_small.pt",
        ]
    )
    for p in candidates:
        if p.is_file():
            return p
    raise SystemExit(
        "SAM2 checkpoint missing. Put sam2_hiera_small.pt on the Desktop "
        "or set SAM2_CHECKPOINT. Install the package with: python3 -m pip install sam2"
    )


def pick_device() -> str:
    forced = os.environ.get("SAM2_DEVICE", "").strip()
    if forced:
        return forced
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_predictor():
    import torch
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    ckpt = checkpoint_path()
    cfg = os.environ.get("SAM2_CONFIG", DEFAULT_CONFIG).strip() or DEFAULT_CONFIG
    device = pick_device()
    try:
        model = build_sam2(cfg, str(ckpt), device=device)
    except Exception as exc:
        if device == "cpu":
            raise
        print(f"sam2 on {device} failed ({exc}); retrying on cpu", file=sys.stderr)
        device = "cpu"
        model = build_sam2(cfg, str(ckpt), device="cpu")
    model.eval()
    print(f"sam2 device={device} ckpt={ckpt}", file=sys.stderr)
    return SAM2ImagePredictor(model), torch


def fill_holes(mask: np.ndarray) -> np.ndarray:
    """Foreground = person. Holes not connected to the border become person."""
    h, w = mask.shape
    bg = ~mask
    seen = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and bg[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return ~seen


def close_mask(mask: np.ndarray, radius: int = 9) -> np.ndarray:
    """Bridge hair speckles the model painted as checkerboard, then fill bays."""
    closed = ndimage.binary_closing(mask, iterations=radius)
    return fill_holes(closed)


def checker_pixels(rgb: np.ndarray) -> np.ndarray:
    """Gray squares baked into the character. Pale solid clothes are smooth and stay."""
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    lum_u = np.pad(lum, 1, mode="edge")
    neighbor_delta = np.maximum.reduce(
        [
            np.abs(lum - lum_u[:-2, 1:-1]),
            np.abs(lum - lum_u[2:, 1:-1]),
            np.abs(lum - lum_u[1:-1, :-2]),
            np.abs(lum - lum_u[1:-1, 2:]),
        ]
    )
    return (sat < 22) & (lum > 90) & (lum < 230) & (neighbor_delta > 28)


def inpaint_from_solid(rgb: np.ndarray, mask: np.ndarray, kill: np.ndarray) -> np.ndarray:
    kill = kill & mask
    source = mask & ~kill
    if not kill.any() or not source.any():
        return rgb
    _, indices = ndimage.distance_transform_edt(~source, return_indices=True)
    out = rgb.copy()
    out[kill] = rgb[indices[0][kill], indices[1][kill]]
    return out


def choose_mask(masks: np.ndarray, scores: np.ndarray) -> np.ndarray:
    h, w = masks.shape[-2:]
    area = float(h * w)
    best_i = int(np.argmax(scores))
    best_score = -1.0
    for i, score in enumerate(scores):
        frac = float(masks[i].mean())
        if frac < 0.04 or frac > 0.92:
            continue
        if float(score) > best_score:
            best_score = float(score)
            best_i = i
    return masks[best_i].astype(bool)


def is_key_blue(rgb: np.ndarray) -> np.ndarray:
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    return (b > 130) & (b > r + 40) & (b > g + 25)


def key_mask(rgb: np.ndarray) -> np.ndarray:
    """Chroma key is whatever flat saturated color fills the corners.

    Blue, green, yellow, red, cyan, and magenta all work. Blue remains the
    fallback when the corners are not one saturated key.
    """
    patches = (
        rgb[:24, :24],
        rgb[:24, -24:],
        rgb[-24:, :24],
        rgb[-24:, -24:],
    )
    corners = np.concatenate([p.reshape(-1, 3) for p in patches], axis=0)
    med = np.median(corners, axis=0)
    spread = float(
        np.median(np.linalg.norm(corners.astype(np.float32) - med.astype(np.float32), axis=1))
    )
    mx, mn = float(med.max()), float(med.min())
    saturated = (mx - mn) > 80 and mx > 140 and spread < 28 and mn < 200
    if not saturated:
        return is_key_blue(rgb)
    dist = np.linalg.norm(rgb.astype(np.int16) - med.astype(np.int16), axis=2)
    return dist < 55


def largest_blob(mask: np.ndarray) -> np.ndarray:
    labeled, n = ndimage.label(mask)
    if n == 0:
        return mask
    counts = np.bincount(labeled.ravel())
    counts[0] = 0
    return labeled == int(counts.argmax())


def cutout(predictor, im: Image.Image) -> Image.Image:
    rgb = np.array(im.convert("RGB"))
    h, w = rgb.shape[:2]
    key = key_mask(rgb)
    corners = np.concatenate(
        [key[:24, :24].ravel(), key[:24, -24:].ravel(), key[-24:, :24].ravel(), key[-24:, -24:].ravel()]
    )
    chroma = float(corners.mean()) > 0.6
    predictor.set_image(rgb)
    pts = np.array(
        [
            [w * 0.50, h * 0.36],
            [w * 0.50, h * 0.52],
            [w * 0.50, h * 0.68],
            [w * 0.40, h * 0.48],
            [w * 0.60, h * 0.48],
        ],
        dtype=np.float32,
    )
    labels = np.array([1, 1, 1, 1, 1], dtype=np.int32)
    neg = np.array(
        [[6, 6], [w - 7, 6], [6, h - 7], [w - 7, h - 7]],
        dtype=np.float32,
    )
    coords = np.concatenate([pts, neg], axis=0)
    labs = np.concatenate([labels, np.zeros(len(neg), dtype=np.int32)], axis=0)
    masks, scores, _ = predictor.predict(
        point_coords=coords,
        point_labels=labs,
        multimask_output=True,
    )
    sam = choose_mask(masks, scores) & ~key
    if chroma:
        # The corner key keeps hair and clothes. SAM only adds pieces the key missed.
        person = largest_blob(~key) | sam
    else:
        person = sam
    person = fill_holes(person) & ~key
    out = np.full_like(rgb, 255)
    out[person] = rgb[person]
    return Image.fromarray(out)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: sam2-cutout.py <png> [more.png...]")
    predictor, _torch = load_predictor()
    for arg in sys.argv[1:]:
        p = Path(arg)
        out = cutout(predictor, Image.open(p))
        out.save(p)
        print("sam2-cutout", p)


if __name__ == "__main__":
    main()
