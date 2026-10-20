#!/usr/bin/env python3
"""Fail-closed QA for cute-skin raws (+ optional pack GIFs).

Catches the defect classes that identity-hash misses:
  BG_CHECKER   — baked transparency checkerboard / alpha grid
  BG_DARK      — dark/gray studio backdrop
  BG_NOT_FLAT  — corners not solid near-white (cutout will fringe)
  MATTE_CORNER — GIF corner not transparent
  MATTE_FILL   — subject fill ratio absurd (matte ate character or kept whole canvas)

Does NOT judge limb count / floating props — those require agent visual Read
(see .cursor/skills/cpet-cute-skins/reference.md).

Usage:
  python3 scripts/qa-skin-raws.py cloud-sheep
  python3 scripts/qa-skin-raws.py --pack 云朵羊
  python3 scripts/qa-skin-raws.py cloud-sheep --pack 云朵羊
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "assets/skins/_work"
SKINS = ROOT / "assets/skins"


def load_skin(skin_id: str) -> dict:
    p = WORK / skin_id / "skin.json"
    if not p.exists():
        raise SystemExit(f"missing {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def corner_stats(rgb: np.ndarray, n: int = 40) -> dict:
    h, w = rgb.shape[:2]
    n = min(n, h // 4, w // 4)
    patches = [
        rgb[:n, :n],
        rgb[:n, -n:],
        rgb[-n:, :n],
        rgb[-n:, -n:],
    ]
    corners = np.concatenate([p.reshape(-1, 3) for p in patches], axis=0).astype(np.float32)
    sat = float((corners.max(axis=1) - corners.min(axis=1)).mean())
    std = float(corners.std(axis=0).mean())
    lum = 0.299 * corners[:, 0] + 0.587 * corners[:, 1] + 0.114 * corners[:, 2]
    mean_lum = float(lum.mean())
    # checker heuristic: low chroma + high variance + mid/high luminance
    is_checker = sat < 28 and std > 16 and mean_lum > 90
    is_dark = sat < 35 and mean_lum < 90 and std < 40
    return {
        "sat": sat,
        "std": std,
        "mean_lum": mean_lum,
        "is_checker": is_checker,
        "is_dark": is_dark,
    }


def qa_raw_png(path: Path) -> list[str]:
    errs: list[str] = []
    im = Image.open(path).convert("RGBA")
    arr = np.asarray(im)
    rgb = arr[..., :3]
    st = corner_stats(rgb)
    if st["is_checker"]:
        errs.append(f"{path.name}: BG_CHECKER (corner sat={st['sat']:.1f} std={st['std']:.1f})")
    if st["is_dark"]:
        errs.append(f"{path.name}: BG_DARK (corner lum={st['mean_lum']:.1f})")
    if not st["is_checker"] and not st["is_dark"] and st["mean_lum"] < 245:
        errs.append(f"{path.name}: BG_NOT_FLAT (corner lum={st['mean_lum']:.1f} need ≥245)")
    if not st["is_checker"] and not st["is_dark"] and st["std"] > 14 and st["mean_lum"] >= 245:
        errs.append(f"{path.name}: BG_NOT_FLAT (corner std={st['std']:.1f} need ≤14)")
    return errs


def qa_gif(path: Path) -> list[str]:
    errs: list[str] = []
    im = Image.open(path)
    im.seek(0)
    arr = np.asarray(im.convert("RGBA"))
    a = arr[..., 3]
    corners = np.concatenate(
        [a[0, :8], a[0, -8:], a[-1, :8], a[-1, -8:], a[:8, 0], a[:8, -1], a[-8:, 0], a[-8:, -1]]
    )
    if float(corners.mean()) > 8:
        errs.append(f"{path.name}: MATTE_CORNER (corner alpha mean={corners.mean():.1f})")
    opaque = float((a > 200).mean())
    if opaque < 0.12 or opaque > 0.82:
        errs.append(f"{path.name}: MATTE_FILL (opaque%={opaque*100:.1f} outside 12–82)")
    return errs


def qa_work(skin_id: str) -> list[str]:
    raw = WORK / skin_id / "raw"
    if not raw.exists():
        return [f"{skin_id}: missing raw/"]
    errs: list[str] = []
    pngs = sorted(raw.glob("*.png"))
    if not pngs:
        return [f"{skin_id}: raw/ empty"]
    idle = raw / "idle.png"
    if not idle.exists():
        errs.append(f"{skin_id}: missing raw/idle.png")
    for p in pngs:
        errs.extend(qa_raw_png(p))
    return errs


def qa_pack(pack_name: str) -> list[str]:
    pack = SKINS / pack_name
    if not pack.exists():
        return [f"{pack_name}: missing pack dir"]
    errs: list[str] = []
    gifs = sorted(pack.glob("*.gif"))
    if not gifs:
        return [f"{pack_name}: no gifs"]
    for p in gifs:
        errs.extend(qa_gif(p))
    return errs


def main() -> None:
    args = [a for a in sys.argv[1:] if a]
    if not args:
        raise SystemExit("Usage: qa-skin-raws.py <skinId> [--pack 包名]")
    skin_id = None
    pack = None
    i = 0
    while i < len(args):
        if args[i] == "--pack":
            pack = args[i + 1]
            i += 2
            continue
        if skin_id is None and not args[i].startswith("-"):
            skin_id = args[i]
        i += 1
    if pack is None and skin_id:
        try:
            pack = load_skin(skin_id).get("packName")
        except SystemExit:
            pack = None

    all_errs: list[str] = []
    if skin_id:
        print(f"qa raws: {skin_id}")
        all_errs.extend(qa_work(skin_id))
    if pack:
        print(f"qa pack: {pack}")
        all_errs.extend(qa_pack(pack))
    if all_errs:
        print(f"FAIL ({len(all_errs)})")
        for e in all_errs:
            print(" ", e)
        raise SystemExit(1)
    print("OK")


if __name__ == "__main__":
    main()
